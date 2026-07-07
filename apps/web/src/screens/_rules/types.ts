/**
 * 시책 룰 / 가족계약 화면 공유 타입.
 * packages/rules(@ga-settle/rules)의 RuleCondition/RuleAction/IncentiveRule 셰이프를 그대로 미러링한다.
 * apps/web은 @ga-settle/rules를 워크스페이스 의존성으로 갖고 있지 않아(신규 npm 의존성 추가 금지)
 * apps/api/src/routes/rules.ts 실측 기준으로 로컬 재정의함.
 */

export interface RuleCondition {
  period: { from: string; to: string }; // YYYY-MM-DD
  insurerIds?: string[];
  productPatterns?: string[];
  orgUnitIds?: string[];
  performanceBand?: { minPremium?: number; maxPremium?: number };
  excludeFamilyContracts?: boolean;
}

export type RuleAction = { kind: "rate"; rate: number } | { kind: "fixed"; amount: number };

export interface IncentiveRule {
  id: string;
  name: string;
  priority: number;
  overlapPolicy: "exclusive" | "stack";
  condition: RuleCondition;
  action: RuleAction;
}

export type RuleCreateInput = Omit<IncentiveRule, "id">;

export interface CommissionInput {
  recordId: string;
  insurerId: string;
  productName: string;
  orgUnitId: string;
  agentId: string;
  contractDate: string;
  premium: number;
  isFamilyContract: boolean;
}

export interface SimulateResult {
  totalCurrent: number;
  totalProposed: number;
  totalDiff: number;
  byRecord: Array<{ recordId: string; current: number; proposed: number; diff: number }>;
}

export type FamilyStatus = "candidate" | "confirmed" | "released";

export interface FamilyFlag {
  id: string;
  contractNo: string;
  agentId: string;
  matchedNameEnc: string | null;
  status: FamilyStatus;
  confirmedBy: string | null;
  createdAt: string;
}

export interface FamilyContractInput {
  contractNo: string;
  agentId: string;
  holderName: string;
  holderBirth: string;
}
