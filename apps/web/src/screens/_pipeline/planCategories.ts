// F-051 시책룰 4대 대분류. 업로드 시 선택 + 등록 대장 표시 공용.
// 코드는 백엔드 routes/incentive-plans.ts PLAN_CATEGORIES와 일치해야 한다.
export const PLAN_CATEGORIES = [
  { code: "sonbo_planner", label: "손보설계사시상" },
  { code: "sonbo_self", label: "손보자체시상" },
  { code: "sengbo_fc", label: "생보FC시상" },
  { code: "sengbo_corp", label: "생보법인시상" },
] as const;

export type PlanCategoryCode = (typeof PLAN_CATEGORIES)[number]["code"];

export const planCategoryLabel = (code: string | null | undefined): string =>
  PLAN_CATEGORIES.find((c) => c.code === code)?.label ?? "미분류";
