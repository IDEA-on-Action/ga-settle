import { describe, it, expect } from "vitest";
import { evaluate, ruleMatches, type IncentiveRule, type CommissionInput } from "../src/index";

const rec = (o: Partial<CommissionInput> = {}): CommissionInput => ({
  recordId: "r1", insurerId: "ins1", productName: "종신보험", orgUnitId: "team1", agentId: "a1",
  contractDate: "2026-06-15", premium: 100000, isFamilyContract: false, ...o,
});
const rule = (o: Partial<IncentiveRule> = {}): IncentiveRule => ({
  id: "R1", name: "기본시책", priority: 10, overlapPolicy: "stack",
  condition: { period: { from: "2026-01-01", to: "2026-12-31" } },
  action: { kind: "rate", rate: 0.1 }, ...o,
});

describe("시책 룰 평가기 (F-010, case table)", () => {
  it("지급률 액션: 보험료 x rate (반올림)", () => {
    const lines = evaluate([rec({ premium: 123456 })], [rule({ action: { kind: "rate", rate: 0.15 } })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amount).toBe(Math.round(123456 * 0.15)); // 18518
  });

  it("고정액 액션", () => {
    const lines = evaluate([rec()], [rule({ action: { kind: "fixed", amount: 50000 } })]);
    expect(lines[0]!.amount).toBe(50000);
  });

  it("구간시상(tiered): 실적 구간별 차등 지급 (F-053)", () => {
    const tiered = rule({
      action: { kind: "tiered", tiers: [{ maxPremium: 100000, rate: 0.1 }, { minPremium: 100001, rate: 0.2 }] },
    });
    expect(evaluate([rec({ premium: 50000 })], [tiered])[0]!.amount).toBe(5000);   // 하위 구간 10%
    expect(evaluate([rec({ premium: 200000 })], [tiered])[0]!.amount).toBe(40000); // 상위 구간 20%
    // 어느 구간에도 안 맞으면 0
    const gap = rule({ action: { kind: "tiered", tiers: [{ minPremium: 500000, rate: 0.3 }] } });
    expect(evaluate([rec({ premium: 100000 })], [gap])[0]!.amount).toBe(0);
  });

  it("stack: 여러 룰 누적", () => {
    const lines = evaluate([rec()], [
      rule({ id: "A", priority: 10, action: { kind: "rate", rate: 0.1 } }),
      rule({ id: "B", priority: 20, action: { kind: "fixed", amount: 5000 } }),
    ]);
    expect(lines.map((l) => l.ruleId)).toEqual(["A", "B"]);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(10000 + 5000);
  });

  it("exclusive: 최우선 배타 룰만 적용, 하위 차단", () => {
    const lines = evaluate([rec()], [
      rule({ id: "HI", priority: 5, overlapPolicy: "exclusive", action: { kind: "fixed", amount: 9000 } }),
      rule({ id: "LO", priority: 20, action: { kind: "rate", rate: 0.1 } }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.ruleId).toBe("HI");
  });

  it("priority 오름차순 결정적 정렬 (재현성)", () => {
    const a = evaluate([rec()], [rule({ id: "Z", priority: 5 }), rule({ id: "A", priority: 5 })]);
    const b = evaluate([rec()], [rule({ id: "A", priority: 5 }), rule({ id: "Z", priority: 5 })]);
    expect(a).toEqual(b); // 입력 순서 무관, 동일 출력
    expect(a.map((l) => l.ruleId)).toEqual(["A", "Z"]);
  });

  describe("조건 매칭", () => {
    it("기간 밖이면 미적용", () => {
      expect(ruleMatches(rule(), rec({ contractDate: "2025-12-31" }))).toBe(false);
      expect(ruleMatches(rule(), rec({ contractDate: "2026-06-15" }))).toBe(true);
    });
    it("원수사/조직/상품/실적구간 필터", () => {
      expect(ruleMatches(rule({ condition: { period: { from: "2026-01-01", to: "2026-12-31" }, insurerIds: ["insX"] } }), rec())).toBe(false);
      expect(ruleMatches(rule({ condition: { period: { from: "2026-01-01", to: "2026-12-31" }, orgUnitIds: ["team1"] } }), rec())).toBe(true);
      expect(ruleMatches(rule({ condition: { period: { from: "2026-01-01", to: "2026-12-31" }, productPatterns: ["암보험"] } }), rec())).toBe(false);
      expect(ruleMatches(rule({ condition: { period: { from: "2026-01-01", to: "2026-12-31" }, performanceBand: { minPremium: 200000 } } }), rec({ premium: 100000 }))).toBe(false);
    });
    it("가족계약 제외 옵션", () => {
      const r = rule({ condition: { period: { from: "2026-01-01", to: "2026-12-31" }, excludeFamilyContracts: true } });
      expect(ruleMatches(r, rec({ isFamilyContract: true }))).toBe(false);
      expect(ruleMatches(r, rec({ isFamilyContract: false }))).toBe(true);
    });
  });
});
