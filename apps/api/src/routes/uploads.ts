import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { uploads, jobs, insurers, uploadErrors, commissionRecords, settlementRuns, settlementLines } from "@ga-settle/schema";
import type { StagedRow } from "@ga-settle/mapping";
import type { Env } from "../types";
import { getDb, sha256Hex, encField, writeAudit } from "../db";
import { authUser } from "../auth";
import { pageParams } from "../pagination";

// 업로드 파이프라인 (F-003): 해시 멱등 -> R2 불변 -> Queue -> jobs 진행률.
export const uploadsRoutes = new Hono<{ Bindings: Env }>();

const actorOf = async (c: { req: { raw: Request }; env: Env }, db: ReturnType<typeof getDb>) =>
  (await authUser(c.req.raw, db, c.env.SESSION_SECRET))?.id ?? "system";

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

// 업로드 목록 (F-036 REQ-052): 최근순 선택기용. 민감정보(r2Key/해시) 제외, 원수사명 조인.
// F-042: ?q(원수사명/월/상태/id 검색)·?limit·?offset + total.
uploadsRoutes.get("/api/uploads", async (c) => {
  const { q, limit, offset } = pageParams(c);
  const db = getDb(c.env);
  const where = q
    ? or(
        like(insurers.name, `%${q}%`),
        like(uploads.settlementMonth, `%${q}%`),
        like(uploads.status, `%${q}%`),
        like(uploads.insurerId, `%${q}%`),
      )
    : undefined;
  const rows = await db
    .select({
      id: uploads.id,
      insurerId: uploads.insurerId,
      insurerName: insurers.name,
      settlementMonth: uploads.settlementMonth,
      status: uploads.status,
      rowCount: uploads.rowCount,
      okCount: uploads.okCount,
      errorCount: uploads.errorCount,
      createdAt: uploads.createdAt,
    })
    .from(uploads)
    .leftJoin(insurers, eq(uploads.insurerId, insurers.id))
    .where(where)
    .orderBy(desc(uploads.createdAt))
    .limit(limit)
    .offset(offset);
  const cnt = await db
    .select({ n: sql<number>`count(*)` })
    .from(uploads)
    .leftJoin(insurers, eq(uploads.insurerId, insurers.id))
    .where(where);
  return c.json({ uploads: rows, total: Number(cnt[0]?.n ?? 0) });
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

  // 낙관적 락: review -> approved 전환을 조건부로 선점. 동시 승인 중 진 쪽은 0 rows -> 409
  // (원장 이중 커밋 방지). 이 요청이 전환을 소유한 뒤에만 원장 insert.
  const claim = await db.update(uploads).set({ status: "approved" })
    .where(and(eq(uploads.id, up.id), eq(uploads.status, "review")));
  if (claim.meta.changes === 0) return c.json({ error: "이미 승인됐거나 review 상태가 아니에요" }, 409);

  const key = c.env.FIELD_ENCRYPTION_KEY;
  const recs = await Promise.all(staged.map(async (s) => ({
    id: crypto.randomUUID(),
    uploadId: up.id, rowNo: s.rowNo, settlementMonth: up.settlementMonth, insurerId: up.insurerId,
    contractNo: String(s.fields["계약번호"] ?? ""),
    installment: typeof s.fields["납입회차"] === "number" ? s.fields["납입회차"] : null,
    agentId: s.fields["설계사코드"] != null ? String(s.fields["설계사코드"]) : null,
    productName: s.fields["상품명"] != null ? String(s.fields["상품명"]) : null,
    contractDate: s.fields["계약일"] != null ? String(s.fields["계약일"]) : null,
    premiumEnc: await encField(s.fields["보험료"], key),
    commissionEnc: await encField(s.fields["지급수수료"], key),
    clawbackEnc: await encField(s.fields["환수금액"], key),
  })));

  // 상태는 claim에서 전환됨. 원장 insert만 (있을 때) batch 커밋.
  if (recs.length) {
    await db.batch([
      db.insert(commissionRecords).values(recs[0]!),
      ...recs.slice(1).map((r) => db.insert(commissionRecords).values(r)),
    ]);
  }

  return c.json({ committed: recs.length, status: "approved" });
});

// DELETE /api/uploads/:id (F-047): 업로드 삭제.
// 정책: 마감(closed run)된 정산월의 업로드는 차단(불변식 #2, API+D1 트리거 이중). 그 외는
// 파생 정산라인 → 원장 → 검증오류 → jobs → 업로드 → R2 원본까지 cascade. 삭제도 audit_logs 동반(불변식 #4).
uploadsRoutes.delete("/api/uploads/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const up = await db.select().from(uploads).where(eq(uploads.id, id)).get();
  if (!up) return c.json({ error: "없는 업로드예요" }, 404);

  // 불변식 #2: 해당 정산월에 마감된 run이 있으면 삭제 불가. (마감 run 종속 라인은 트리거도 차단)
  const closed = await db
    .select({ id: settlementRuns.id })
    .from(settlementRuns)
    .where(and(eq(settlementRuns.settlementMonth, up.settlementMonth), eq(settlementRuns.status, "closed")))
    .limit(1)
    .get();
  if (closed) return c.json({ error: "마감된 정산월의 업로드는 삭제할 수 없어요", settlementMonth: up.settlementMonth }, 409);

  // cascade: 이 업로드의 원장 id 수집 → 파생 정산라인(미마감 run 소속) 청크 삭제(D1 변수 100 한도).
  const recIds = (await db.select({ id: commissionRecords.id }).from(commissionRecords).where(eq(commissionRecords.uploadId, id)).all()).map((r) => r.id);
  let deletedLines = 0;
  for (let i = 0; i < recIds.length; i += 90) {
    const res = await db.delete(settlementLines).where(inArray(settlementLines.commissionRecordId, recIds.slice(i, i + 90)));
    deletedLines += res.meta.changes ?? 0;
  }
  const delRec = await db.delete(commissionRecords).where(eq(commissionRecords.uploadId, id));
  const delErr = await db.delete(uploadErrors).where(eq(uploadErrors.uploadId, id));
  const delJob = await db.delete(jobs).where(and(eq(jobs.kind, "parse-upload"), eq(jobs.refId, id)));
  await db.delete(uploads).where(eq(uploads.id, id));
  // R2 원본 제거 - 같은 파일 재업로드 시 해시 멱등 충돌 방지.
  await c.env.UPLOADS.delete(up.r2Key).catch(() => {});

  const deleted = {
    settlementMonth: up.settlementMonth,
    insurerId: up.insurerId,
    commissionRecords: delRec.meta.changes ?? 0,
    settlementLines: deletedLines,
    uploadErrors: delErr.meta.changes ?? 0,
    jobs: delJob.meta.changes ?? 0,
  };
  await writeAudit(db, { actor: await actorOf(c, db), action: "upload.delete", entity: "uploads", entityId: id, summary: deleted });
  return c.json({ ok: true, id, deleted });
});
