import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { Cell } from "@ga-settle/mapping";
import { insurers, uploads, commissionRecords } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { ingestParsed } from "../src/queue";

// F-008 파이프라인은 합성 Grid 주입으로 결정적 테스트(XLSX round-trip은 workerd 환경편차로
// flaky -> sheetToGrid는 프로덕션 스모크로 검증). 5행: valid 3 / 설계사명누락 1 / 중복 1.
const GRID: Cell[][] = [
  ["B화재 2026-06 지급명세서"],
  ["증권No", "계약일", "FC성명", "실적보험료", "지급율", "항목A"],
  ["P-1", "2026-06-01", "김철수", 100000, 15, 15000],
  ["P-2", "2026-06-02", "이영희", 200000, 20, 40000],
  ["P-3", "2026-06-03", "", 300000, 25, 75000],         // 설계사명(필수) 누락
  ["P-1", "2026-06-01", "김철수", 100000, 15, 15000],    // 중복(P-1)
  ["P-4", "2026-06-04", "박길동", 400000, 30, 120000],
];
const R2KEY = "uploads/2026-07/u1.xlsx";

beforeEach(async () => {
  await getDb(env).insert(insurers).values({ id: "ins1", name: "B화재", createdAt: "2026-07-07" });
});

async function seedUpload(status = "queued") {
  await getDb(env).insert(uploads).values({
    id: "u1", insurerId: "ins1", r2Key: R2KEY, fileHash: "h1", status,
    settlementMonth: "2026-07", createdBy: "system", createdAt: "2026-07-07",
  });
}
const ingest = () => ingestParsed(env, getDb(env), { uploadId: "u1", r2Key: R2KEY, insurerId: "ins1" }, GRID);

describe("F-008 파싱 파이프라인 + 승인 커밋", () => {
  it("매핑 -> 행 검증 -> review + 카운트 + 오류 리포트 (REQ-015)", async () => {
    await seedUpload();
    const counts = await ingest();
    expect(counts).toMatchObject({ rowCount: 5, okCount: 3, errorCount: 2 });

    const up = await getDb(env).select().from(uploads).where(eq(uploads.id, "u1")).get();
    expect(up?.status).toBe("review");
    expect(up?.okCount).toBe(3);

    const errs = (await (await SELF.fetch("https://x/api/uploads/u1/errors")).json()) as { rowNo: number; field: string }[];
    expect(errs.length).toBe(2);
    expect(errs.some((e) => e.rowNo === 3 && e.field === "설계사명")).toBe(true);
    expect(errs.some((e) => e.rowNo === 4)).toBe(true); // 중복
  });

  it("승인: review -> 원장 커밋, upload_id+row_no 역추적 (REQ-016)", async () => {
    await seedUpload();
    await ingest();
    const res = await SELF.fetch("https://x/api/uploads/u1/approve", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json() as { committed: number }).committed).toBe(3);

    const recs = await getDb(env).select().from(commissionRecords).where(eq(commissionRecords.uploadId, "u1")).all();
    expect(recs.length).toBe(3);
    expect(recs.every((r) => r.uploadId === "u1" && r.rowNo > 0)).toBe(true); // 역추적 불변식
    expect((await getDb(env).select().from(uploads).where(eq(uploads.id, "u1")).get())?.status).toBe("approved");
  });

  it("이중 승인 방지(낙관적 락): 승인 후 재승인 -> 409, 원장 중복 없음", async () => {
    await seedUpload();
    await ingest();
    expect((await SELF.fetch("https://x/api/uploads/u1/approve", { method: "POST" })).status).toBe(200);
    expect((await SELF.fetch("https://x/api/uploads/u1/approve", { method: "POST" })).status).toBe(409);
    const recs = await getDb(env).select().from(commissionRecords).where(eq(commissionRecords.uploadId, "u1")).all();
    expect(recs.length).toBe(3); // 중복 커밋 없음
  });

  it("승인은 review 상태에서만 (REQ-016): queued 승인 -> 409, 원장 미커밋", async () => {
    await seedUpload("queued");
    const res = await SELF.fetch("https://x/api/uploads/u1/approve", { method: "POST" });
    expect(res.status).toBe(409);
    expect((await getDb(env).select().from(commissionRecords).where(eq(commissionRecords.uploadId, "u1")).all()).length).toBe(0);
  });
});
