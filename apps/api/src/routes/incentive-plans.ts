import { Hono } from "hono";
import { desc, eq, like, or, sql } from "drizzle-orm";
import { incentivePlans, insurers } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb, sha256Hex } from "../db";
import { authUser } from "../auth";
import { pageParams } from "../pagination";
import { extractIncentivePlan, OcrError } from "../ocr";

// 시책안 OCR 인식 + 등록 대장 (F-043 REQ-059/060, F-048 REQ-068/069).
// 이미지/PDF → R2 불변 보관 → CLOVA OCR + Upstage 구조화 → 저신뢰 필드 표시.
// F-048: 업로드 즉시 incentive_plans 대장 레코드 생성(누가·언제·무엇을 올렸는지 조회). R2 원본 역추적 뿌리.
// /api/* 전역 인증 게이트(index.ts) 뒤 - 상용 OCR 할당량이 공개 트래픽에 노출되지 않는다.
export const incentivePlansRoutes = new Hono<{ Bindings: Env }>();

const MAX_BYTES = 8 * 1024 * 1024; // 8MB

// OCR 적용기간 문자열에서 정산월(YYYY-MM) best-effort 파싱 (F-048).
// "2026년 3월" / "2026-03" / "2026.3" 등 → "2026-03". 실패 시 null(수동 보정).
function parseSettlementMonth(period: string | null | undefined): string | null {
  if (!period) return null;
  const m = period.match(/(20\d{2})\s*[년.\-/]\s*(1[0-2]|0?[1-9])\b/);
  if (!m || !m[1] || !m[2]) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}`;
}

incentivePlansRoutes.post("/api/incentive-plans/ocr", async (c) => {
  const db = getDb(c.env);
  // 전역 게이트가 인증을 강제하나, 대장 created_by 기록을 위해 사용자를 조회한다.
  const user = await authUser(c.req.raw, db, c.env.SESSION_SECRET);
  if (!user) return c.json({ error: "인증이 필요해요" }, 401);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return c.json({ error: "파일이 필요해요 (multipart/form-data)" }, 400);
  const type = file.type || "";
  // 시책안은 이미지(PNG/JPG/WEBP) 또는 PDF(F-046). CLOVA General OCR V2가 format=pdf 네이티브 지원.
  const isPdf = type === "application/pdf";
  const isImg = /^image\/(png|jpe?g|webp)$/.test(type);
  if (!isPdf && !isImg) return c.json({ error: `지원하지 않는 형식이에요: ${type || "unknown"} (PNG·JPG·WEBP·PDF)` }, 415);
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return c.json({ error: "파일이 너무 커요 (최대 8MB)" }, 413);

  // 원본 근거 불변 보관 (SHA-256 멱등: 같은 파일이면 재업로드 없이 재사용).
  const sha = await sha256Hex(bytes);
  const ext = isPdf ? "pdf" : type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const key = `incentive-plans/${sha}.${ext}`;
  const existing = await c.env.UPLOADS.head(key);
  if (!existing) await c.env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: type } });

  // F-048: 업로드 즉시 대장 등록 (OCR 이전, status=pending). sha 멱등 - 재업로드 시 원 레코드 보존.
  const now = new Date().toISOString();
  await db.insert(incentivePlans).values({
    id: crypto.randomUUID(),
    insurerId: null,
    settlementMonth: null,
    fileName: file.name,
    r2Key: key,
    sha256: sha,
    contentType: type,
    byteSize: bytes.byteLength,
    ocrStatus: "pending",
    createdBy: user.id,
    createdAt: now,
  }).onConflictDoNothing();

  try {
    const result = await extractIncentivePlan(bytes, ext, c.env);
    const month = parseSettlementMonth(result.rule.period?.value);
    const lowCount = result.lowConfidenceKeys.length;
    // OCR 결과로 대장 갱신. settlementMonth는 파싱 성공 시에만 덮어쓴다(수동 보정 보존).
    await db.update(incentivePlans).set({
      ocrStatus: lowCount > 0 ? "low_confidence" : "ok",
      ocrAvgConfidence: result.ocr.avgConfidence,
      ocrFieldCount: result.ocr.fieldCount,
      lowConfidenceCount: lowCount,
      ...(month ? { settlementMonth: month } : {}),
      updatedAt: new Date().toISOString(),
    }).where(eq(incentivePlans.sha256, sha));
    const plan = await db.select({ id: incentivePlans.id }).from(incentivePlans).where(eq(incentivePlans.sha256, sha)).get();
    return c.json({ planId: plan?.id, planImageKey: key, sha256: sha, idempotentReuse: !!existing, ...result });
  } catch (e) {
    // OCR 실패도 대장에 남긴다(업로드 즉시 등록 정책, F-048): status=failed.
    await db.update(incentivePlans).set({ ocrStatus: "failed", updatedAt: new Date().toISOString() }).where(eq(incentivePlans.sha256, sha));
    // OcrError(503 미설정 / 502 상류 오류 / 422 빈결과)는 그대로, 그 외는 500.
    if (e instanceof OcrError) return c.json({ error: e.message, planImageKey: key }, e.status as 502);
    return c.json({ error: "OCR 처리 실패", detail: String(e) }, 500);
  }
});

// F-048: 시책안 등록 대장 목록. 원수사명 조인 + ?q·?limit·?offset 검색/페이지.
incentivePlansRoutes.get("/api/incentive-plans", async (c) => {
  const { q, limit, offset } = pageParams(c);
  const db = getDb(c.env);
  const where = q
    ? or(
        like(insurers.name, `%${q}%`),
        like(incentivePlans.fileName, `%${q}%`),
        like(incentivePlans.settlementMonth, `%${q}%`),
        like(incentivePlans.ocrStatus, `%${q}%`),
      )
    : undefined;
  const rows = await db
    .select({
      id: incentivePlans.id,
      insurerId: incentivePlans.insurerId,
      insurerName: insurers.name,
      settlementMonth: incentivePlans.settlementMonth,
      fileName: incentivePlans.fileName,
      sha256: incentivePlans.sha256,
      ocrStatus: incentivePlans.ocrStatus,
      ocrAvgConfidence: incentivePlans.ocrAvgConfidence,
      ocrFieldCount: incentivePlans.ocrFieldCount,
      lowConfidenceCount: incentivePlans.lowConfidenceCount,
      createdBy: incentivePlans.createdBy,
      createdAt: incentivePlans.createdAt,
    })
    .from(incentivePlans)
    .leftJoin(insurers, eq(incentivePlans.insurerId, insurers.id))
    .where(where)
    .orderBy(desc(incentivePlans.createdAt))
    .limit(limit)
    .offset(offset);
  const cnt = await db
    .select({ n: sql<number>`count(*)` })
    .from(incentivePlans)
    .leftJoin(insurers, eq(incentivePlans.insurerId, insurers.id))
    .where(where);
  return c.json({ items: rows, total: Number(cnt[0]?.n ?? 0) });
});
