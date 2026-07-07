import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import { insurers, uploads, jobs, commissionRecords, uploadErrors } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { queueConsumer, type ParseJob } from "../src/queue";

function xlsxBytes(grid: (string | number | null)[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(grid);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
function batchOf(body: ParseJob) {
  return { messages: [{ id: "m", timestamp: new Date(0), attempts: 1, body, ack() {}, retry() {} }] } as unknown as MessageBatch<ParseJob>;
}
// 5행: 2 valid, 설계사명 누락 1, 중복 1, valid 1 -> staged 3 / errors 2
const GRID: (string | number | null)[][] = [
  ["B화재 2026-06 지급명세서"],
  ["증권No", "계약일", "FC성명", "실적보험료", "지급율", "항목A"],
  ["P-1", "2026-06-01", "김철수", 100000, 15, 15000],
  ["P-2", "2026-06-02", "이영희", 200000, 20, 40000],
  ["P-3", "2026-06-03", "", 300000, 25, 75000],         // 설계사명(필수) 누락
  ["P-1", "2026-06-01", "김철수", 100000, 15, 15000],    // 중복(P-1)
  ["P-4", "2026-06-04", "박길동", 400000, 30, 120000],
];

beforeEach(async () => {
  await getDb(env).insert(insurers).values({ id: "ins1", name: "B화재", createdAt: "2026-07-07" });
});

async function seedAndParse(status = "queued") {
  const db = getDb(env);
  const uploadId = "u1", jobId = "j1", r2Key = "uploads/2026-07/u1.xlsx";
  await env.UPLOADS.put(r2Key, xlsxBytes(GRID));
  await db.insert(uploads).values({ id: uploadId, insurerId: "ins1", r2Key, fileHash: "h1", status, settlementMonth: "2026-07", createdBy: "system", createdAt: "2026-07-07" });
  await db.insert(jobs).values({ id: jobId, kind: "parse-upload", refId: uploadId, status: "queued", progress: 0, updatedAt: "2026-07-07" });
  return { db, uploadId, jobId, r2Key };
}

describe("F-008 파싱 + 검증 + 승인 커밋", () => {
  it("파싱: xlsx -> 매핑 -> 행 검증 -> review + 카운트 + 오류 리포트", async () => {
    const { db, uploadId, jobId } = await seedAndParse();
    await queueConsumer(batchOf({ kind: "parse-upload", uploadId, jobId, r2Key: "uploads/2026-07/u1.xlsx", insurerId: "ins1" }), env);

    const up = await db.select().from(uploads).where(eq(uploads.id, uploadId)).get();
    expect(up?.status).toBe("review");
    expect(up?.rowCount).toBe(5);
    expect(up?.okCount).toBe(3);
    expect(up?.errorCount).toBe(2);
    expect((await db.select().from(jobs).where(eq(jobs.id, jobId)).get())?.status).toBe("done");

    const errs = (await (await SELF.fetch(`https://x/api/uploads/${uploadId}/errors`)).json()) as { rowNo: number; field: string }[];
    expect(errs.length).toBe(2);
    expect(errs.some((e) => e.rowNo === 3 && e.field === "설계사명")).toBe(true);
    expect(errs.some((e) => e.rowNo === 4)).toBe(true); // 중복
  });

  it("승인: review -> 원장(commission_records) 커밋, upload_id+row_no 역추적 (REQ-016)", async () => {
    const { db, uploadId, jobId } = await seedAndParse();
    await queueConsumer(batchOf({ kind: "parse-upload", uploadId, jobId, r2Key: "uploads/2026-07/u1.xlsx", insurerId: "ins1" }), env);

    const res = await SELF.fetch(`https://x/api/uploads/${uploadId}/approve`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json() as { committed: number }).committed).toBe(3);

    const recs = await db.select().from(commissionRecords).where(eq(commissionRecords.uploadId, uploadId)).all();
    expect(recs.length).toBe(3);
    expect(recs.every((r) => r.uploadId === uploadId && r.rowNo > 0)).toBe(true); // 역추적 불변식
    expect((await db.select().from(uploads).where(eq(uploads.id, uploadId)).get())?.status).toBe("approved");
  });

  it("승인은 review 상태에서만 (REQ-016): queued 상태 승인 -> 409", async () => {
    const { uploadId } = await seedAndParse("queued"); // 파싱 전
    const res = await SELF.fetch(`https://x/api/uploads/${uploadId}/approve`, { method: "POST" });
    expect(res.status).toBe(409);
    // 원장 미커밋
    expect((await getDb(env).select().from(commissionRecords).where(eq(commissionRecords.uploadId, uploadId)).all()).length).toBe(0);
  });
});
