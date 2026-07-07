import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { insurers, orgUnits, agents, agentAssignments, uploads, commissionRecords, settlementLines, auditLogs } from "@ga-settle/schema";
import { getDb } from "../src/db";

const getJson = async (path: string) => (await SELF.fetch(`https://x${path}`)).json();

const post = (path: string, body: unknown = {}) =>
  SELF.fetch(`https://x${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const now = "2026-07-07";

beforeEach(async () => {
  const db = getDb(env);
  await db.insert(insurers).values({ id: "ins1", name: "A생명", createdAt: now });
  await db.insert(orgUnits).values({ id: "team1", name: "1팀", kind: "team", createdAt: now });
  await db.insert(agents).values({ id: "ag1", code: "FC1", name: "홍길동", status: "active", createdAt: now });
  await db.insert(agentAssignments).values({ id: "as1", agentId: "ag1", orgUnitId: "team1", validFrom: "2026-01-01", validTo: null });
  await db.insert(uploads).values({ id: "up1", insurerId: "ins1", r2Key: "k", fileHash: "h", status: "approved", settlementMonth: "2026-06", createdBy: "system", createdAt: now });
  for (let i = 1; i <= 3; i++) {
    await db.insert(commissionRecords).values({
      id: `cr${i}`, uploadId: "up1", rowNo: i, settlementMonth: "2026-06", insurerId: "ins1",
      contractNo: `C${i}`, agentId: "ag1", productName: "종신보험", contractDate: "2026-06-10", premiumEnc: "100000",
      // 원수사 보고액: C1/C2는 계산액(10000)과 일치, C3만 9000으로 의도적 차액
      commissionEnc: i === 3 ? "9000" : "10000",
    });
  }
  // 6월 시책: 보험료 x 10%
  await post("/api/rules", { name: "6월시책", priority: 10, overlapPolicy: "stack", condition: { period: { from: "2026-06-01", to: "2026-06-30" }, insurerIds: ["ins1"] }, action: { kind: "rate", rate: 0.1 } });
});

const lineTuples = async (runId: string) =>
  (await getDb(env).select().from(settlementLines).where(eq(settlementLines.runId, runId)).all())
    .map((l) => `${l.commissionRecordId}|${l.ruleId}|${l.amountEnc}|${l.orgUnitId}`).sort();

describe("F-013 정산 계산 배치", () => {
  it("당월 records -> 룰 evaluate -> settlement_lines (룰별 산출 분해)", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    const calc = (await (await post(`/api/runs/${id}/calculate`)).json()) as { status: string; lines: number; totalAmount: number };
    expect(calc.status).toBe("calculated");
    expect(calc.lines).toBe(3);
    expect(calc.totalAmount).toBe(30000); // 3 x (100000 x 0.1)

    const run = (await (await SELF.fetch(`https://x/api/runs/${id}`)).json()) as { status: string; lineCount: number };
    expect(run.status).toBe("calculated");
    expect(run.lineCount).toBe(3);
  });

  it("동일 입력 재실행 시 동일 출력 (재현성, REQ-022)", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    const c1 = (await (await post(`/api/runs/${id}/calculate`)).json()) as { totalAmount: number };
    const first = await lineTuples(id);
    const c2 = (await (await post(`/api/runs/${id}/calculate`)).json()) as { lines: number; totalAmount: number };
    const second = await lineTuples(id);
    expect(second).toEqual(first);       // id 제외 동일 튜플
    expect(c2.lines).toBe(3);            // 재계산해도 3개(중복 누적 없음, 멱등)
    expect(c2.totalAmount).toBe(c1.totalAmount);
  });

  it("월당 run 1개 (중복 -> 409)", async () => {
    await post("/api/runs", { settlementMonth: "2026-06" });
    expect((await post("/api/runs", { settlementMonth: "2026-06" })).status).toBe(409);
  });

  it("대사: 원수사 보고액 vs 계산액, 의도적 차액 계약 특정 (F-014 REQ-023)", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    await post(`/api/runs/${id}/calculate`); // 계산액 각 10000

    const recon = (await (await SELF.fetch(`https://x/api/runs/${id}/reconciliation`)).json()) as {
      insurers: { insurerId: string; insurerTotal: number; calculatedTotal: number; diff: number; status: string }[];
      diffContracts: { contractNo: string; diff: number }[];
    };
    // 원수사 총액 29000(10000+10000+9000) vs 계산 30000 -> diff -1000
    expect(recon.insurers).toHaveLength(1);
    expect(recon.insurers[0]).toMatchObject({ insurerTotal: 29000, calculatedTotal: 30000, diff: -1000, status: "diff" });
    // 드릴다운: C3만 원인 계약
    expect(recon.diffContracts).toHaveLength(1);
    expect(recon.diffContracts[0]).toMatchObject({ contractNo: "C3", diff: -1000 });
  });

  it("보정: reason 필수 + adjustments/audit_logs 동반 (F-015 REQ-024)", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    // reason 없이 -> 400 (도메인 불변식4)
    expect((await post(`/api/runs/${id}/adjustments`, { targetType: "line", targetId: "cr1", amount: 5000 })).status).toBe(400);
    // 정상(이중 승인 approvedBy 포함)
    const res = await post(`/api/runs/${id}/adjustments`, { targetType: "line", targetId: "cr1", amount: 5000, reason: "과소지급 보정", approvedBy: "manager1" });
    expect(res.status).toBe(201);
    const { id: adjId } = (await res.json()) as { id: string };

    const list = (await getJson(`/api/runs/${id}/adjustments`)) as { reason: string; approvedBy: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: "과소지급 보정", approvedBy: "manager1" });

    // 감사 로그 동반
    const audits = await getDb(env).select().from(auditLogs).all();
    expect(audits.some((a) => a.action === "adjustment.create" && a.entityId === adjId)).toBe(true);
  });
});
