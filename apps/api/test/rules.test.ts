import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { evaluate, type CommissionInput } from "@ga-settle/rules";
import { loadRules } from "../src/routes/rules";
import { getDb } from "../src/db";

import { apost as post, agetJson as getJson, aget } from "./helpers";

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
    expect((await aget(`/api/rules/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await getJson("/api/rules") as unknown[]).length).toBe(0);
    expect((await aget(`/api/rules/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("검증 실패 -> 400", async () => {
    expect((await post("/api/rules", { name: "x", priority: 1, overlapPolicy: "bad", condition: {}, action: {} })).status).toBe(400);
  });

  it("등록 항목(terms) + 구간시상(tiered) 왕복 (F-053)", async () => {
    const body = {
      name: "손보 구간시상", priority: 5, overlapPolicy: "exclusive",
      condition: { period: { from: "2026-03-01", to: "2026-03-31" }, insurerIds: ["ins1"] },
      action: { kind: "tiered", tiers: [{ maxPremium: 300000, rate: 0.5 }, { minPremium: 300001, rate: 0.9 }] },
      terms: {
        performanceRecognition: "당월 취소·철회 차감, 자기계약 제외",
        clawbackYear1: "1회100%/6회60%/12회10%",
        clawbackYear2: "13회차 이후 환수율 별도",
        exceptions: "금소법 위법계약 회차 불문 100%",
        bridge: "25·26회차 유지 시 브릿지",
      },
    };
    expect((await post("/api/rules", body)).status).toBe(201);
    const listed = (await getJson("/api/rules")) as { action: { kind: string }; terms?: { clawbackYear1?: string } }[];
    const r = listed.find((x) => x.action.kind === "tiered");
    expect(r).toBeTruthy();
    expect(r!.terms?.clawbackYear1).toBe("1회100%/6회60%/12회10%");
  });

  it("시뮬레이션: 현재 vs 제안 룰 diff, 실데이터 불변 (F-012 REQ-021)", async () => {
    await post("/api/rules", ruleBody); // 현재 룰(rate 0.12)
    const before = ((await getJson("/api/rules")) as unknown[]).length;
    const res = await post("/api/rules/simulate", {
      records: [rec({ premium: 100000 })],
      proposedRules: [{
        id: "P1", name: "제안", priority: 10, overlapPolicy: "stack",
        condition: { period: { from: "2026-06-01", to: "2026-06-30" }, insurerIds: ["ins1"], productPatterns: ["종신"] },
        action: { kind: "rate", rate: 0.2 },
      }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalCurrent: number; totalProposed: number; totalDiff: number };
    expect(body.totalCurrent).toBe(12000);  // 현재 0.12
    expect(body.totalProposed).toBe(20000); // 제안 0.20
    expect(body.totalDiff).toBe(8000);
    expect(((await getJson("/api/rules")) as unknown[]).length).toBe(before); // DB 무변(시뮬은 쓰기 없음)
  });
});
