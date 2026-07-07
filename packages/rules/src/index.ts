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

/** F-010에서 구현. 재현성 테스트(F-013 REQ-022)가 이 함수를 대상으로 한다. */
export function evaluate(_records: CommissionInput[], _rules: IncentiveRule[]): IncentiveLine[] {
  // TODO(F-010): priority 정렬 -> 조건 매칭 -> overlapPolicy 적용 -> 라인 산출
  throw new Error("TODO F-010");
}
