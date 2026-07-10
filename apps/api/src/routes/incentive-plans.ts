import { Hono } from "hono";
import type { Env } from "../types";
import { sha256Hex } from "../db";
import { extractIncentivePlan, OcrError } from "../ocr";

// 시책안 OCR 인식 (F-043 REQ-059/060).
// 이미지 → CLOVA OCR + Upstage 구조화 → 저신뢰 필드 표시 + 원본 이미지 R2 불변 보관(감사 근거).
// /api/* 전역 인증 게이트(index.ts) 뒤에 있어 상용 OCR 할당량이 공개 트래픽에 노출되지 않는다.
export const incentivePlansRoutes = new Hono<{ Bindings: Env }>();

const MAX_BYTES = 8 * 1024 * 1024; // 8MB

incentivePlansRoutes.post("/api/incentive-plans/ocr", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return c.json({ error: "image 파일이 필요해요 (multipart/form-data)" }, 400);
  const type = file.type || "";
  if (!/^image\/(png|jpe?g|webp)$/.test(type)) return c.json({ error: `지원하지 않는 형식이에요: ${type || "unknown"}` }, 415);
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return c.json({ error: "이미지가 너무 커요 (최대 8MB)" }, 413);

  // 원본 근거 불변 보관 (SHA-256 멱등: 같은 이미지면 재업로드 없이 재사용).
  const sha = await sha256Hex(bytes);
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const key = `incentive-plans/${sha}.${ext}`;
  const existing = await c.env.UPLOADS.head(key);
  if (!existing) await c.env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: type } });

  try {
    const result = await extractIncentivePlan(bytes, ext, c.env);
    return c.json({ planImageKey: key, sha256: sha, idempotentReuse: !!existing, ...result });
  } catch (e) {
    // OcrError(503 미설정 / 502 상류 오류 / 422 빈결과)는 그대로, 그 외는 500.
    if (e instanceof OcrError) return c.json({ error: e.message, planImageKey: key }, e.status as 502);
    return c.json({ error: "OCR 처리 실패", detail: String(e) }, 500);
  }
});
