import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { uploads, jobs, insurers } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { queueConsumer, type ParseJob } from "../src/queue";
import { authHeader } from "./helpers";

// D1 은 FK 를 강제하므로 원수사 부모 행을 먼저 시드 (격리 스토리지라 테스트마다)
beforeEach(async () => {
  await getDb(env).insert(insurers).values({ id: "ins1", name: "A생명", createdAt: "2026-07-07" });
});

function form(bytes: Uint8Array, opts: { insurerId?: string; month?: string; filename?: string } = {}) {
  const fd = new FormData();
  fd.set("file", new File([bytes], opts.filename ?? "a.xlsx", { type: "application/octet-stream" }));
  fd.set("insurerId", opts.insurerId ?? "ins1");
  fd.set("settlementMonth", opts.month ?? "2026-07");
  return fd;
}
const post = async (body: FormData) => SELF.fetch("https://x/api/uploads", { method: "POST", body, headers: await authHeader() });

describe("POST /api/uploads (F-003)", () => {
  it("업로드 -> 202, uploads/jobs 생성", async () => {
    const res = await post(form(new Uint8Array([1, 2, 3, 4, 5])));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { uploadId: string; jobId: string; status: string };
    expect(body.status).toBe("queued");

    const db = getDb(env);
    // 불변 필드로 확인 (consumer 가 비동기로 status 를 바꿀 수 있음)
    const up = await db.select().from(uploads).where(eq(uploads.id, body.uploadId)).get();
    expect(up?.fileHash).toHaveLength(64); // SHA-256 hex
    const job = await db.select().from(jobs).where(eq(jobs.id, body.jobId)).get();
    expect(job?.kind).toBe("parse-upload");
    expect(job?.refId).toBe(body.uploadId);
  });

  it("x-user-id 헤더는 신뢰하지 않음 (createdBy=system), auth-bypass 방지", async () => {
    const res = await SELF.fetch("https://x/api/uploads", {
      method: "POST", headers: { "x-user-id": "attacker", ...(await authHeader()) }, body: form(new Uint8Array([5, 5, 5])),
    });
    expect(res.status).toBe(202);
    const { uploadId } = (await res.json()) as { uploadId: string };
    const up = await getDb(env).select().from(uploads).where(eq(uploads.id, uploadId)).get();
    expect(up?.createdBy).toBe("system");
  });

  it("같은 파일 2회 -> 두 번째 409 반려 (멱등, UNIQUE 제약 실측)", async () => {
    const bytes = new Uint8Array([9, 9, 9, 9]);
    const r1 = await post(form(bytes));
    expect(r1.status).toBe(202);
    const r2 = await post(form(bytes));
    expect(r2.status).toBe(409);
    expect((await r2.json() as { duplicate?: boolean }).duplicate).toBe(true);
  });

  it("내용이 다르면 다른 업로드로 허용", async () => {
    expect((await post(form(new Uint8Array([1])))).status).toBe(202);
    expect((await post(form(new Uint8Array([2])))).status).toBe(202);
  });

  it("검증: file 없으면 400 / xls·xlsx 아니면 415 / month 형식 오류 400", async () => {
    const noFile = new FormData();
    noFile.set("insurerId", "ins1");
    noFile.set("settlementMonth", "2026-07");
    expect((await post(noFile as FormData)).status).toBe(400);

    expect((await post(form(new Uint8Array([1]), { filename: "a.txt" }))).status).toBe(415);
    expect((await post(form(new Uint8Array([3]), { month: "202607" }))).status).toBe(400);
  });
});

describe("queueConsumer (F-003 진행률 골격)", () => {
  async function seed(uploadId: string, jobId: string, r2Key: string, putR2: boolean) {
    const db = getDb(env);
    const now = new Date().toISOString();
    if (putR2) await env.UPLOADS.put(r2Key, new Uint8Array([1, 2, 3]));
    await db.insert(uploads).values({ id: uploadId, insurerId: "ins1", r2Key, fileHash: `h-${uploadId}`, status: "queued", settlementMonth: "2026-07", createdBy: "system", createdAt: now });
    await db.insert(jobs).values({ id: jobId, kind: "parse-upload", refId: uploadId, status: "queued", progress: 0, updatedAt: now });
  }
  function batchOf(body: ParseJob, spies: { ack: () => void; retry: () => void }) {
    return { messages: [{ id: "m", timestamp: new Date(0), attempts: 1, body, ack: spies.ack, retry: spies.retry }] } as unknown as MessageBatch<ParseJob>;
  }

  it("R2 원본 있으면 running -> done, upload review + ack", async () => {
    const r2Key = "uploads/2026-07/u1.xlsx";
    await seed("u1", "j1", r2Key, true);
    let acked = false;
    await queueConsumer(batchOf({ kind: "parse-upload", uploadId: "u1", jobId: "j1", r2Key, insurerId: "ins1" }, { ack: () => { acked = true; }, retry: () => {} }), env as never);
    expect(acked).toBe(true);
    const db = getDb(env);
    expect((await db.select().from(jobs).where(eq(jobs.id, "j1")).get())?.status).toBe("done");
    expect((await db.select().from(jobs).where(eq(jobs.id, "j1")).get())?.progress).toBe(1);
    expect((await db.select().from(uploads).where(eq(uploads.id, "u1")).get())?.status).toBe("review");
  });

  it("R2 원본 없으면 failed + retry", async () => {
    await seed("u2", "j2", "missing/x.xlsx", false);
    let retried = false;
    await queueConsumer(batchOf({ kind: "parse-upload", uploadId: "u2", jobId: "j2", r2Key: "missing/x.xlsx", insurerId: "ins1" }, { ack: () => {}, retry: () => { retried = true; } }), env as never);
    expect(retried).toBe(true);
    expect((await getDb(env).select().from(jobs).where(eq(jobs.id, "j2")).get())?.status).toBe("failed");
  });
});
