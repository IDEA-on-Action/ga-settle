import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { IncentiveRule } from "./types";

function conditionChips(rule: IncentiveRule): string[] {
  const c = rule.condition;
  const chips: string[] = [`${c.period.from} ~ ${c.period.to}`];
  chips.push(c.insurerIds?.length ? c.insurerIds.join(" · ") : "전 원수사");
  chips.push(c.orgUnitIds?.length ? c.orgUnitIds.join(" · ") : "전 조직");
  if (c.productPatterns?.length) chips.push(`상품 "${c.productPatterns.join(", ")}"`);
  if (c.performanceBand?.minPremium != null || c.performanceBand?.maxPremium != null) {
    const { minPremium, maxPremium } = c.performanceBand;
    chips.push(
      `보험료 ${minPremium != null ? `₩${minPremium.toLocaleString()} 이상` : ""}${minPremium != null && maxPremium != null ? " · " : ""}${maxPremium != null ? `₩${maxPremium.toLocaleString()} 이하` : ""}`,
    );
  }
  if (c.excludeFamilyContracts) chips.push("가족계약 제외");
  return chips;
}

function actionLabel(rule: IncentiveRule): string {
  return rule.action.kind === "rate"
    ? `지급률 ${(rule.action.rate * 100).toFixed(1)}%`
    : `고정액 ₩${rule.action.amount.toLocaleString()}`;
}

interface RuleCardProps {
  rule: IncentiveRule;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

export function RuleCard({ rule, onDelete, isDeleting }: RuleCardProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-axis-border-default p-4 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-bold text-axis-text-brand">
          {rule.id.slice(0, 8)}
        </span>
        <span className="text-sm font-semibold text-axis-text-primary">{rule.name}</span>
        <Badge
          className={
            rule.overlapPolicy === "exclusive"
              ? "border-transparent bg-axis-badge-warning-bg text-axis-badge-warning-text"
              : "border-transparent bg-axis-badge-info-bg text-axis-badge-info-text"
          }
        >
          {rule.overlapPolicy}
        </Badge>
        <span className="ml-auto text-xs text-axis-text-tertiary">priority {rule.priority}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={isDeleting}
          onClick={() => onDelete(rule.id)}
          aria-label="룰 삭제"
        >
          <Trash2 className="size-4 text-axis-text-error" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {conditionChips(rule).map((chip, i) => (
          <span
            key={i}
            className="rounded-md bg-axis-surface-secondary px-2 py-0.5 text-xs text-axis-text-secondary"
          >
            {chip}
          </span>
        ))}
        <span className="rounded-md bg-axis-surface-info px-2 py-0.5 text-xs font-semibold text-axis-text-info">
          {actionLabel(rule)}
        </span>
      </div>
    </div>
  );
}
