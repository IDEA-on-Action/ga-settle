import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { uploads, jobs, insurers } from "@ga-settle/schema";
import { queueConsumer, type ParseJob } from "./queue";
import { getDb, sha256Hex } from "./db";

export type Env = {
  DB: D1Database;
  UPLOADS: R2Bucket;
  PARSE_QUEUE: Queue<ParseJob>;
  ANTHROPIC_API_KEY: string;
  FIELD_ENCRYPTION_KEY: string;
  SESSION_SECRET: string;
  ADMIN_IP_ALLOWLIST: string;
  ENV: string;
};

export const app = new Hono<{ Bindings: Env }>();

// --- 미들웨어 (F-017에서 확장: 세션 인증, RBAC 스코프, 감사 로그) ---
app.use("*", async (c, next) => {
  await next();
  // TODO(F-015/F-017): 쓰기 요청 감사 로그 기록
});

app.get("/health", (c) => c.json({ ok: true, env: c.env.ENV }));

// --- 업로드 (F-003): 해시 멱등 -> R2 불변 -> Queue -> jobs 진행률 ---
const uploadMeta = z.object({
  insurerId: z.string().min(1),
  settlementMonth: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM 형식"),
});

app.post("/api/uploads", async (c) => {
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

  const bytes = await file.arrayBuffer();
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
  const createdBy = c.req.header("x-user-id") ?? "system"; // F-017 인증 전 임시
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
app.get("/api/jobs/:id", async (c) => {
  const job = await getDb(c.env).select().from(jobs).where(eq(jobs.id, c.req.param("id"))).get();
  return job ? c.json(job) : c.json({ error: "없는 작업이에요" }, 404);
});

app.get("/api/uploads/:id", async (c) => {
  const up = await getDb(c.env).select().from(uploads).where(eq(uploads.id, c.req.param("id"))).get();
  return up ? c.json(up) : c.json({ error: "없는 업로드예요" }, 404);
});

// --- 매핑 (F-005~F-007) ---
app.get("/api/uploads/:id/mapping", async (c) => c.json({ todo: "F-005 L0~L4 결과" }, 501));
app.post("/api/uploads/:id/mapping/confirm", async (c) => c.json({ todo: "F-007 TemplateVersion 저장" }, 501));

// --- 정산/대사 (F-013~F-016) ---
app.post("/api/runs", async (c) => c.json({ todo: "F-013 정산 실행" }, 501));
app.get("/api/runs/:id/reconciliation", async (c) => c.json({ todo: "F-014 대사" }, 501));
app.post("/api/runs/:id/close", async (c) => c.json({ todo: "F-016 마감 이중 잠금" }, 501));

export default {
  fetch: app.fetch,
  queue: queueConsumer,
} satisfies ExportedHandler<Env, ParseJob>;
