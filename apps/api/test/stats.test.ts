import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { insurers, orgUnits, agents, agentAssignments, uploads, commissionRecords } from "@ga-settle/schema";
import { getDb } from "../src/db";

const post = (path: string, body: unknown = {}) =>
  SELF.fetch(`https://x${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const getJson = async (path: string) => (await SELF.fetch(`https://x${path}`)).json();
const now = "2026-07-07";

beforeEach(async () => {
  const db = getDb(env);
  await db.insert(insurers).values({ id: "ins1", name: "A생명", createdAt: now });
  await db.insert(orgUnits).values([{ id: "team1", name: "1팀", kind: "team", createdAt: now }, { id: "team2", name: "2팀", kind: "team", createdAt: now }]);
  await db.insert(agents).values([{ id: "ag1", code: "F1", name: "홍", status: "active", createdAt: now }, { id: "ag2", code: "F2", name: "김", status: "active", createdAt: now }]);
  await db.insert(agentAssignments).values([
    { id: "as1", agentId: "ag1", orgUnitId: "team1", validFrom: "2026-01-01", validTo: null },
    { id: "as2", agentId: "ag2", orgUnitId: "team2", validFrom: "2026-01-01", validTo: null },
  ]);
  await db.insert(uploads).values({ id: "up1", insurerId: "ins1", r2Key: "k", fileHash: "h", status: "approved", settlementMonth: "2026-06", createdBy: "system", createdAt: now });
  await db.insert(commissionRecords).values([
    { id: "cr1", uploadId: "up1", rowNo: 1, settlementMonth: "2026-06", insurerId: "ins1", contractNo: "C1", agentId: "ag1", premiumEnc: "100000", commissionEnc: "10000" },
    { id: "cr2", uploadId: "up1", rowNo: 2, settlementMonth: "2026-06", insurerId: "ins1", contractNo: "C2", agentId: "ag1", premiumEnc: "100000", commissionEnc: "10000" },
    { id: "cr3", uploadId: "up1", rowNo: 3, settlementMonth: "2026-06", insurerId: "ins1", contractNo: "C3", agentId: "ag2", premiumEnc: "200000", commissionEnc: "20000" },
  ]);
  await post("/api/rules", { name: "6월", priority: 10, overlapPolicy: "stack", condition: { period: { from: "2026-06-01", to: "2026-06-30" }, insurerIds: ["ins1"] }, action: { kind: "rate", rate: 0.1 } });
  const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
  await post(`/api/runs/${id}/calculate`); // 계산액: team1 20000(ag1 2건), team2 20000(ag2 1건)
});

describe("F-019 통계/집계", () => {
  it("조직별 집계 (by-org)", async () => {
    const r = (await getJson("/api/stats/by-org?month=2026-06")) as { byOrg: { orgUnitId: string; total: number; count: number }[] };
    expect(r.byOrg.find((o) => o.orgUnitId === "team1")).toMatchObject({ total: 20000, count: 2 });
    expect(r.byOrg.find((o) => o.orgUnitId === "team2")).toMatchObject({ total: 20000, count: 1 });
  });

  it("원수사별 집계 (by-insurer, 원수사 보고 지급액)", async () => {
    const r = (await getJson("/api/stats/by-insurer?month=2026-06")) as { byInsurer: { insurerId: string; total: number; count: number }[] };
    expect(r.byInsurer).toHaveLength(1);
    expect(r.byInsurer[0]).toMatchObject({ insurerId: "ins1", total: 40000, count: 3 }); // 10000+10000+20000
  });

  it("기간별(월별) 집계 (by-month)", async () => {
    const r = (await getJson("/api/stats/by-month")) as { byMonth: { month: string; total: number }[] };
    expect(r.byMonth).toEqual([{ month: "2026-06", total: 40000, count: 3 }]);
  });

  it("month 누락 -> 400", async () => {
    expect((await SELF.fetch("https://x/api/stats/by-org")).status).toBe(400);
  });
});
