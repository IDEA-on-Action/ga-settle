import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Card } from "@/components/ui/card";

interface DefListHead {
  total: number;
}

/**
 * F-045 시책룰 ↔ 시상정의 브리지.
 * 시상정의 카탈로그(참조/후보)는 운영룰(incentive_rules)과 도메인 분리돼 있어(F-044),
 * 확정한 정의는 promote(HITL) 전까지 시책룰 목록에 뜨지 않는다. 고객이 "확정했는데
 * 시책룰에 안 보인다"고 오인하는 갭(260710 데모 피드백 AI-1)을 이 안내로 메운다.
 */
export function DefinitionBridge({ operationalRuleCount }: { operationalRuleCount: number }) {
  const defCountQuery = useQuery({
    queryKey: ["plan-definitions", "count"],
    queryFn: () => apiFetch<DefListHead>("/api/incentive-plan-definitions?limit=1"),
  });
  const total = defCountQuery.data?.total ?? 0;

  // 카탈로그가 비어 있으면 안내할 게 없다.
  if (total === 0) return null;

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-axis-text-primary">
        <ClipboardCheck className="size-4 text-axis-text-brand" />
        시상정의에서 운영룰 만들기
      </div>
      <p className="text-xs leading-relaxed text-axis-text-secondary">
        원수사 시상정의{" "}
        <span className="font-semibold text-axis-text-primary">{total.toLocaleString()}건</span>이 카탈로그에 있어요.
        시상정의는 참조·후보라 시책룰 목록에 바로 뜨지 않아요 -{" "}
        <span className="font-semibold">확정 후 운영룰로 승격</span>하면 여기 시책룰로 표시돼요.
        {operationalRuleCount === 0 && " 현재 승격된 운영룰이 없어요."}
      </p>
      <Link
        to="/plan-definitions"
        className="inline-flex w-fit items-center gap-1.5 rounded-md bg-axis-surface-info px-3 py-1.5 text-xs font-semibold text-axis-text-info hover:opacity-90"
      >
        시상정의 확정 화면으로
        <ArrowRight className="size-3.5" />
      </Link>
    </Card>
  );
}
