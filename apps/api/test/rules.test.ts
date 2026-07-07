import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { evaluate, type CommissionInput } from "@ga-settle/rules";
import { loadRules } from "../src/routes/rules";
import { getDb } from "../src/db";

const post = (path: string, body: unknown) =>
  SELF.fetch(`https://x${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const getJson = async (path: string) => (await SELF.fetch(`https://x${path}`)).json();

const ruleBody = {
  name: "6월 종신 시책", priority: 10, overlapPolicy: "stack",
  condition: { period: { from: "2026-06-01", to: "2026-06-30" }, insurerIds: ["ins1"], productPatterns: ["종신"] },
  action: { kind: "rate", rate: 0.12 },
};
const rec = (o: Partial<CommissionInput> = {}): CommissionInput => ({
  recordId: "r1", insurerId: "ins1", productName: "종신보험", orgUnitId: "t1", agentId: "a1",
  contractDate: "2026-06-15", premium: 100000, isFamilyContract: false, ...o,
});

describe("F-010 시책 룰 CRUD + 평가 통합", () => {
  it("생성 -> 조회 -> loadRules로 로드해 evaluate", async () => {
    expect((await post("/api/rules", ruleBody)).status).toBe(201);
    const listed = (await getJson("/api/rules")) as unknown[];
    expect(listed).toHaveLength(1);

    const rules = await loadRules(getDb(env));
    const lines = evaluate([rec()], rules);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amount).toBe(12000); // 100000 x 0.12

    // 조건 밖(다른 원수사)은 미적용
    expect(evaluate([rec({ insurerId: "insX" })], rules)).toHaveLength(0);
  });

  it("DELETE -> 비활성, 재조회 목록에서 제외", async () => {
    const { id } = (await (await post("/api/rules", ruleBody)).json()) as { id: string };
    expect((await SELF.fetch(`https://x/api/rules/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await getJson("/api/rules") as unknown[]).length).toBe(0);
    expect((await SELF.fetch(`https://x/api/rules/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("검증 실패 -> 400", async () => {
    expect((await post("/api/rules", { name: "x", priority: 1, overlapPolicy: "bad", condition: {}, action: {} })).status).toBe(400);
  });
});
