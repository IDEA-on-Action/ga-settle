/**
 * @ga-settle/rules - 시책 룰 엔진 (F-010~F-012)
 * 원칙: 순수 함수, 같은 입력 = 같은 출력 (시뮬레이션과 본 계산이 동일 코드 사용).
 * LLM은 룰 "초안 생성"까지만 (B-003). 평가/계산에 개입 금지.
 */

export type RuleCondition = {
  period: { from: string; to: string };          // YYYY-MM-DD
  insurerIds?: string[];
  productPatterns?: string[];
  orgUnitIds?: string[];
  performanceBand?: { minPremium?: number; maxPremium?: number };
  excludeFamilyContracts?: boolean;              // F-011 연계
};

export type RuleAction =
  | { kind: "rate"; rate: number }               // 지급률 (0-1)
  | { kind: "fixed"; amount: number };           // 고정액 (원)

export type IncentiveRule = {
  id: string;
  name: string;
  priority: number;                              // 낮을수록 우선
  overlapPolicy: "exclusive" | "stack";          // 중복 적용 정책
  condition: RuleCondition;
  action: RuleAction;
};

export type CommissionInput = {
  recordId: string;
  insurerId: string;
  productName: string;
  orgUnitId: string;
  agentId: string;
  contractDate: string;
  premium: number;
  isFamilyContract: boolean;
};

export type IncentiveLine = {
  recordId: string;
  ruleId: string;
  amount: number;
  basis: string; // 산출 근거 설명 (감사용)
};

/** 단일 룰이 레코드에 적용되는지 (조건 매칭). */
export function ruleMatches(rule: IncentiveRule, rec: CommissionInput): boolean {
  const c = rule.condition;
  if (rec.contractDate < c.period.from || rec.contractDate > c.period.to) return false;
  if (c.insurerIds && !c.insurerIds.includes(rec.insurerId)) return false;
  if (c.orgUnitIds && !c.orgUnitIds.includes(rec.orgUnitId)) return false;
  if (c.productPatterns && !c.productPatterns.some((p) => rec.productName.includes(p))) return false;
  if (c.performanceBand) {
    const { minPremium, maxPremium } = c.performanceBand;
    if (minPremium != null && rec.premium < minPremium) return false;
    if (maxPremium != null && rec.premium > maxPremium) return false;
  }
  if (c.excludeFamilyContracts && rec.isFamilyContract) return false;
  return true;
}

function amountOf(action: RuleAction, premium: number): number {
  return action.kind === "rate" ? Math.round(premium * action.rate) : action.amount;
}

/**
 * 시책 룰 평가 (F-010). 순수·결정적: priority 오름차순(동순위는 id) 정렬 -> 조건 매칭 ->
 * overlapPolicy 적용(exclusive면 그 룰만 적용 후 중단, stack이면 누적). 재현성(FR-13).
 * 재현성 테스트(F-013 REQ-022) + 시뮬레이션(F-012)이 이 함수를 공유한다.
 */
export function evaluate(records: CommissionInput[], rules: IncentiveRule[]): IncentiveLine[] {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const lines: IncentiveLine[] = [];
  for (const rec of records) {
    for (const rule of sorted) {
      if (!ruleMatches(rule, rec)) continue;
      const amount = amountOf(rule.action, rec.premium);
      const basis = rule.action.kind === "rate"
        ? `${rule.name}: 보험료 ${rec.premium} x ${rule.action.rate} = ${amount}`
        : `${rule.name}: 고정 ${amount}`;
      lines.push({ recordId: rec.recordId, ruleId: rule.id, amount, basis });
      if (rule.overlapPolicy === "exclusive") break; // 최우선 배타 룰이 하위 룰 차단
    }
  }
  return lines;
}
