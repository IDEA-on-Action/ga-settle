import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { uploads, jobs, insurers, uploadErrors, commissionRecords } from "@ga-settle/schema";
import type { StagedRow } from "@ga-settle/mapping";
import type { Env } from "../types";
import { getDb, sha256Hex, encField } from "../db";

// 업로드 파이프라인 (F-003): 해시 멱등 -> R2 불변 -> Queue -> jobs 진행률.
export const uploadsRoutes = new Hono<{ Bindings: Env }>();

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB (수만 행 엑셀 여유분, 메모리 보호)
const uploadMeta = z.object({
  insurerId: z.string().min(1),
  settlementMonth: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM 형식"),
});

uploadsRoutes.post("/api/uploads", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "file 필드(멀티파트)가 필요해요" }, 400);

  const meta = uploadMeta.safeParse({
    insurerId: form.get("insurerId"),
    settlementMonth: form.get("settlementMonth"),
  });
  if (!meta.success) return c.json({ error: "메타 검증 실패", detail: meta.error.flatten().fieldErrors }, 400);

  const name = file.name.toLowerCase();
  const ext = name.endsWith(".xlsx") ? "xlsx" : name.endsWith(".xls") ? "xls" : null;
  if (!ext) return c.json({ error: "xls/xlsx 파일만 허용해요" }, 415);

  // 업로드 크기 상한(메모리 보호). Content-Length 선차단 + 실바이트 재확인.
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return c.json({ error: "파일이 너무 커요 (최대 50MB)" }, 413);

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: "파일이 너무 커요 (최대 50MB)" }, 413);
  const fileHash = await sha256Hex(bytes);
  const db = getDb(c.env);

  // 원수사 사전 등록 필수 (양식/템플릿은 F-005~F-007에서 등록)
  const ins = await db.select({ id: insurers.id }).from(insurers).where(eq(insurers.id, meta.data.insurerId)).get();
  if (!ins) return c.json({ error: "등록되지 않은 원수사예요", insurerId: meta.data.insurerId }, 404);

  // 멱등: 동일 해시가 이미 있으면 즉시 반려 (FR-06)
  const dup = await db.select({ id: uploads.id }).from(uploads).where(eq(uploads.fileHash, fileHash)).get();
  if (dup) return c.json({ error: "이미 업로드된 파일이에요", uploadId: dup.id, duplicate: true }, 409);

  const uploadId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  // F-017 세션 인증 도입 전까지 클라이언트 제공 신원(x-user-id)은 신뢰하지 않음(스푸핑 방지).
  // TODO(F-017): 세션에서 인증된 사용자로 대체.
  const createdBy = "system";
  const r2Key = `uploads/${meta.data.settlementMonth}/${uploadId}.${ext}`;
  const now = new Date().toISOString();

  // R2 불변 보관 (uploadId 기반 키 - 덮어쓰기 없음)
  await c.env.UPLOADS.put(r2Key, bytes, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { fileHash, insurerId: meta.data.insurerId, uploadedBy: createdBy },
  });

  try {
    await db.batch([
      db.insert(uploads).values({
        id: uploadId, insurerId: meta.data.insurerId, r2Key, fileHash, status: "queued",
        settlementMonth: meta.data.settlementMonth, createdBy, createdAt: now,
      }),
      db.insert(jobs).values({
        id: jobId, kind: "parse-upload", refId: uploadId, status: "queued", progress: 0, updatedAt: now,
      }),
    ]);
  } catch {
    // UNIQUE(file_hash) 경합 (동시 업로드) -> 멱등 반려
    return c.json({ error: "이미 업로드된 파일이에요", duplicate: true }, 409);
  }

  await c.env.PARSE_QUEUE.send({ kind: "parse-upload", uploadId, jobId, r2Key, insurerId: meta.data.insurerId });

  return c.json({ uploadId, jobId, status: "queued" }, 202);
});

// 진행률 폴링 (F-003 REQ-006, SPA)
// SECURITY(F-017): 현재 무인증 + 소유권 검사 없음(id로 조회). F-017에서 세션 인증 +
//   RBAC 조직 스코프로 IDOR 차단. 그 전까지는 신뢰 네트워크(관리자 IP 허용목록) 전제.
uploadsRoutes.get("/api/jobs/:id", async (c) => {
  const job = await getDb(c.env).select().from(jobs).where(eq(jobs.id, c.req.param("id"))).get();
  return job ? c.json(job) : c.json({ error: "없는 작업이에요" }, 404);
});

uploadsRoutes.get("/api/uploads/:id", async (c) => {
  const up = await getDb(c.env).select().from(uploads).where(eq(uploads.id, c.req.param("id"))).get();
  return up ? c.json(up) : c.json({ error: "없는 업로드예요" }, 404);
});

// 오류 리포트 (F-008 REQ-015): 검증 실패 행 전량 (rowNo + field + reason)
uploadsRoutes.get("/api/uploads/:id/errors", async (c) => {
  const rows = await getDb(c.env).select().from(uploadErrors).where(eq(uploadErrors.uploadId, c.req.param("id"))).all();
  return c.json(rows);
});

// 승인 커밋 (F-008 REQ-016): review 상태에서만, 스테이징 -> 원장 트랜잭션 커밋.
// commission_records는 upload_id + row_no 역추적 보장 (도메인 불변식 1).
uploadsRoutes.post("/api/uploads/:id/approve", async (c) => {
  const db = getDb(c.env);
  const up = await db.select().from(uploads).where(eq(uploads.id, c.req.param("id"))).get();
  if (!up) return c.json({ error: "없는 업로드예요" }, 404);
  if (up.status !== "review") return c.json({ error: "검토(review) 상태에서만 승인해요", status: up.status }, 409);

  const stagedObj = await c.env.UPLOADS.get(`${up.r2Key}.staged.json`);
  if (!stagedObj) return c.json({ error: "스테이징 데이터가 없어요" }, 409);
  const { staged } = JSON.parse(await stagedObj.text()) as { staged: StagedRow[] };

  const recs = staged.map((s) => ({
    id: crypto.randomUUID(),
    uploadId: up.id, rowNo: s.rowNo, settlementMonth: up.settlementMonth, insurerId: up.insurerId,
    contractNo: String(s.fields["계약번호"] ?? ""),
    installment: typeof s.fields["납입회차"] === "number" ? s.fields["납입회차"] : null,
    agentId: s.fields["설계사코드"] != null ? String(s.fields["설계사코드"]) : null,
    productName: s.fields["상품명"] != null ? String(s.fields["상품명"]) : null,
    contractDate: s.fields["계약일"] != null ? String(s.fields["계약일"]) : null,
    premiumEnc: encField(s.fields["보험료"]),
    commissionEnc: encField(s.fields["지급수수료"]),
    clawbackEnc: encField(s.fields["환수금액"]),
  }));

  // 트랜잭션 커밋: 상태 전환 + 원장 insert 원자적 (D1 batch)
  const first = db.update(uploads).set({ status: "approved" }).where(eq(uploads.id, up.id));
  await db.batch([first, ...recs.map((r) => db.insert(commissionRecords).values(r))]);

  return c.json({ committed: recs.length, status: "approved" });
});
