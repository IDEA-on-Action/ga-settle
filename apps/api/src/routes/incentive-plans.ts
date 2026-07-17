import { Hono } from "hono";
import { desc, eq, like, or, sql } from "drizzle-orm";
import { incentivePlans, insurers, jobs } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb, sha256Hex } from "../db";
import { authUser } from "../auth";
import { pageParams } from "../pagination";

// 시책안 OCR 인식 + 등록 대장 (F-043 REQ-059/060, F-048 REQ-068/069).
// 이미지/PDF → R2 불변 보관 → CLOVA OCR + Upstage 구조화 → 저신뢰 필드 표시.
// F-048: 업로드 즉시 incentive_plans 대장 레코드 생성(누가·언제·무엇을 올렸는지 조회). R2 원본 역추적 뿌리.
// /api/* 전역 인증 게이트(index.ts) 뒤 - 상용 OCR 할당량이 공개 트래픽에 노출되지 않는다.
export const incentivePlansRoutes = new Hono<{ Bindings: Env }>();

const MAX_BYTES = 8 * 1024 * 1024; // 8MB

// F-051 시책룰 4대 대분류. 업로드 시 담당자가 먼저 선택 → 대장 category에 기록.
const PLAN_CATEGORIES = ["sonbo_planner", "sonbo_self", "sengbo_fc", "sengbo_corp"] as const;
type PlanCategory = (typeof PLAN_CATEGORIES)[number];
const isPlanCategory = (v: unknown): v is PlanCategory => typeof v === "string" && (PLAN_CATEGORIES as readonly string[]).includes(v);

incentivePlansRoutes.post("/api/incentive-plans/ocr", async (c) => {
  const db = getDb(c.env);
  // 전역 게이트가 인증을 강제하나, 대장 created_by 기록을 위해 사용자를 조회한다.
  const user = await authUser(c.req.raw, db, c.env.SESSION_SECRET);
  if (!user) return c.json({ error: "인증이 필요해요" }, 401);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return c.json({ error: "파일이 필요해요 (multipart/form-data)" }, 400);
  // F-051: 대분류 필수(4대 중 하나). 미선택/오값이면 400.
  const category = form?.get("category");
  if (!isPlanCategory(category)) {
    return c.json({ error: "대분류를 선택하세요 (손보설계사시상/손보자체시상/생보FC시상/생보법인시상)" }, 400);
  }
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
    category,
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
  }).onConflictDoUpdate({
    // 같은 파일 재업로드(sha 멱등): created_by/at은 보존하되 대분류는 최신 선택으로 갱신(F-051).
    target: incentivePlans.sha256,
    set: { category, updatedAt: now },
  });

  // F-066: OCR을 동기 처리하지 않고 큐로 이관한다. 대용량 다청크는 144~310s라 HTTP 요청을 오래
  // 붙잡아 긴 스피너가 됐다(F-065 부작용). 엑셀 업로드(F-003)와 동일하게 job 발행 후 즉시 202.
  const plan = await db.select({ id: incentivePlans.id }).from(incentivePlans).where(eq(incentivePlans.sha256, sha)).get();
  if (!plan) return c.json({ error: "대장 등록에 실패했어요" }, 500);
  // 재업로드(멱등) 시 이전 실패 사유를 클리어하고 다시 대기 상태로 - 실패 후 재시도가 성공하면 깨끗이.
  await db.update(incentivePlans).set({ ocrStatus: "pending", ocrErrorStage: null, ocrErrorMessage: null, updatedAt: now })
    .where(eq(incentivePlans.id, plan.id));
  const jobId = crypto.randomUUID();
  await db.insert(jobs).values({ id: jobId, kind: "ocr-plan", refId: plan.id, status: "queued", progress: 0, updatedAt: now });
  await c.env.PARSE_QUEUE.send({ kind: "ocr-plan", planId: plan.id, jobId, r2Key: key, ext });
  return c.json({ planId: plan.id, jobId, planImageKey: key, sha256: sha, idempotentReuse: !!existing, status: "queued" }, 202);
});

// F-066: OCR 결과 조회. 큐 consumer가 R2(`{r2Key}.ocr.json`)에 저장한 구조화 결과를 반환.
// 프론트는 job(GET /api/jobs/:id) done 확인 후 이걸로 rule/payoutRows 후보를 표시(동기 응답 대체).
incentivePlansRoutes.get("/api/incentive-plans/:id/ocr-result", async (c) => {
  const db = getDb(c.env);
  const plan = await db.select({ r2Key: incentivePlans.r2Key, ocrStatus: incentivePlans.ocrStatus })
    .from(incentivePlans).where(eq(incentivePlans.id, c.req.param("id"))).get();
  if (!plan) return c.json({ error: "시책안을 찾을 수 없어요" }, 404);
  const obj = await c.env.UPLOADS.get(`${plan.r2Key}.ocr.json`);
  if (!obj) return c.json({ error: "OCR 결과가 아직 없어요", ocrStatus: plan.ocrStatus }, 404);
  return c.json(JSON.parse(await obj.text()));
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
      category: incentivePlans.category,
      insurerId: incentivePlans.insurerId,
      insurerName: insurers.name,
      settlementMonth: incentivePlans.settlementMonth,
      fileName: incentivePlans.fileName,
      sha256: incentivePlans.sha256,
      ocrStatus: incentivePlans.ocrStatus,
      ocrAvgConfidence: incentivePlans.ocrAvgConfidence,
      ocrFieldCount: incentivePlans.ocrFieldCount,
      lowConfidenceCount: incentivePlans.lowConfidenceCount,
      ocrErrorStage: incentivePlans.ocrErrorStage,
      ocrErrorMessage: incentivePlans.ocrErrorMessage,
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
