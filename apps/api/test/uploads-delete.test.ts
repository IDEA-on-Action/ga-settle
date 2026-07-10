import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { uploads, insurers, commissionRecords, uploadErrors, settlementRuns, auditLogs } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { authHeader } from "./helpers";

// F-047: 업로드 삭제. 마감(closed run) 월은 차단, 그 외는 원장·검증오류까지 cascade + 감사로그.
const del = async (id: string) =>
  SELF.fetch(`https://x/api/uploads/${id}`, { method: "DELETE", headers: await authHeader() });

async function seedUpload(id: string, month: string) {
  const db = getDb(env);
  await db.insert(insurers).values({ id: "ins1", name: "A생명", createdAt: "2026-07-07" }).onConflictDoNothing();
  await env.UPLOADS.put(`uploads/${month}/${id}.xlsx`, new Uint8Array([1, 2, 3]));
  await db.insert(uploads).values({
    id, insurerId: "ins1", r2Key: `uploads/${month}/${id}.xlsx`, fileHash: `h-${id}`,
    status: "approved", settlementMonth: month, createdBy: "system", createdAt: "2026-07-08T00:00:00Z",
  });
}

describe("DELETE /api/uploads/:id (F-047)", () => {
  it("없는 업로드는 404", async () => {
    expect((await del("nope")).status).toBe(404);
  });

  it("마감된 정산월 업로드는 409 차단 + 업로드 보존", async () => {
    await seedUpload("u-closed", "2026-08");
    await getDb(env).insert(settlementRuns).values({ id: "run-closed", settlementMonth: "2026-08", status: "closed" });
    const res = await del("u-closed");
    expect(res.status).toBe(409);
    expect(await getDb(env).select().from(uploads).where(eq(uploads.id, "u-closed")).get()).toBeTruthy();
  });

  it("미마감 업로드는 cascade 삭제(원장·검증오류) + 감사로그", async () => {
    const db = getDb(env);
    await seedUpload("u-ok", "2026-09");
    await db.insert(commissionRecords).values([
      { id: "cr1", uploadId: "u-ok", rowNo: 1, settlementMonth: "2026-09", insurerId: "ins1", contractNo: "C1" },
      { id: "cr2", uploadId: "u-ok", rowNo: 2, settlementMonth: "2026-09", insurerId: "ins1", contractNo: "C2" },
    ]);
    await db.insert(uploadErrors).values({ uploadId: "u-ok", rowNo: 3, field: "보험료", reason: "형식오류" });

    const res = await del("u-ok");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: { commissionRecords: number; uploadErrors: number } };
    expect(body.deleted.commissionRecords).toBe(2);
    expect(body.deleted.uploadErrors).toBe(1);

    expect(await db.select().from(uploads).where(eq(uploads.id, "u-ok")).get()).toBeUndefined();
    expect((await db.select().from(commissionRecords).where(eq(commissionRecords.uploadId, "u-ok")).all()).length).toBe(0);
    expect((await db.select().from(uploadErrors).where(eq(uploadErrors.uploadId, "u-ok")).all()).length).toBe(0);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, "u-ok")).get();
    expect(audit?.action).toBe("upload.delete");
  });
});
