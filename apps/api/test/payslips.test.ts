import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { insurers, orgUnits, agents, agentAssignments, uploads, commissionRecords } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { csvField } from "../src/routes/payslips";
import { enc } from "./helpers";

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
    { id: "cr1", uploadId: "up1", rowNo: 1, settlementMonth: "2026-06", insurerId: "ins1", contractNo: "C1", agentId: "ag1", premiumEnc: await enc("100000") },
    { id: "cr2", uploadId: "up1", rowNo: 2, settlementMonth: "2026-06", insurerId: "ins1", contractNo: "C2", agentId: "ag1", premiumEnc: await enc("100000") },
    { id: "cr3", uploadId: "up1", rowNo: 3, settlementMonth: "2026-06", insurerId: "ins1", contractNo: "C3", agentId: "ag2", premiumEnc: await enc("200000") },
  ]);
  await post("/api/rules", { name: "6월", priority: 10, overlapPolicy: "stack", condition: { period: { from: "2026-06-01", to: "2026-06-30" }, insurerIds: ["ins1"] }, action: { kind: "rate", rate: 0.1 } });
});

async function calcRun() {
  const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
  await post(`/api/runs/${id}/calculate`);
  return id;
}

describe("F-018 지급 내역서 + 출력물", () => {
  it("설계사별 롤업 payslip 생성", async () => {
    const id = await calcRun();
    const gen = (await (await post(`/api/runs/${id}/payslips`)).json()) as { payslips: number; totalAmount: number };
    expect(gen.payslips).toBe(2);       // ag1, ag2
    expect(gen.totalAmount).toBe(40000); // 20000 + 20000

    const list = (await getJson(`/api/runs/${id}/payslips`)) as { agentId: string; orgUnitId: string; total: number }[];
    expect(list.find((p) => p.agentId === "ag1")).toMatchObject({ orgUnitId: "team1", total: 20000 });
    expect(list.find((p) => p.agentId === "ag2")).toMatchObject({ orgUnitId: "team2", total: 20000 });
  });

  it("설계사별 내역서: 총액 + 라인 상세", async () => {
    const id = await calcRun();
    await post(`/api/runs/${id}/payslips`);
    const slip = (await getJson(`/api/runs/${id}/payslips/ag1`)) as { total: number; lines: unknown[] };
    expect(slip.total).toBe(20000);
    expect(slip.lines).toHaveLength(2); // ag1 계약 2건
  });

  it("급여 이체 마스터 CSV", async () => {
    const id = await calcRun();
    await post(`/api/runs/${id}/payslips`);
    const res = await SELF.fetch(`https://x/api/runs/${id}/transfer-master`);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\n")[0]).toBe("agentId,orgUnitId,amount");
    expect(csv).toContain("ag1,team1,20000");
    expect(csv).toContain("ag2,team2,20000");
  });
});

describe("CSV 인젝션 방지 (F-018)", () => {
  it("수식 선두문자(= + - @)는 ' 프리픽스", () => {
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("@cmd")).toBe("'@cmd");
    expect(csvField("normal")).toBe("normal");
    expect(csvField(20000)).toBe("20000");
  });
  it("쉼표/따옴표는 CSV 이스케이프", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('a"b')).toBe('"a""b"');
  });
});
