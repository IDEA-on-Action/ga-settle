import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RuleCard } from "./_rules/RuleCard";
import { RuleForm } from "./_rules/RuleForm";
import { SimulatePanel } from "./_rules/SimulatePanel";
import { DefinitionBridge } from "./_rules/DefinitionBridge";
import type { IncentiveRule, RuleCreateInput } from "./_rules/types";

/**
 * 시책 룰 화면 (F-027). GET/POST/DELETE /api/rules + POST /api/rules/simulate.
 * 룰 수정 API는 없어서(생성 + soft-delete만) 폼은 생성 전용.
 */
export default function Rules() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const rulesQuery = useQuery({
    queryKey: ["rules"],
    queryFn: () => apiFetch<IncentiveRule[]>("/api/rules"),
  });

  const createMutation = useMutation({
    mutationFn: (input: RuleCreateInput) =>
      apiFetch<IncentiveRule>("/api/rules", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ id: string; active: boolean }>(`/api/rules/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
    onError: (err) => setListError(err instanceof ApiError ? err.message : "룰 삭제에 실패했어요"),
  });

  const rules = rulesQuery.data ?? [];

  return (
    <div className="grid max-w-[1280px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b border-axis-border-default py-3.5">
          <CardTitle className="text-sm">시책 룰 (선언형 JSON · 순수 평가기)</CardTitle>
          <Button type="button" size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="size-4" />
            새 룰
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {showForm && (
            <div className="border-b border-axis-border-default bg-axis-surface-secondary/40">
              <RuleForm
                isSubmitting={createMutation.isPending}
                onCancel={() => setShowForm(false)}
                onSubmit={async (input) => {
                  await createMutation.mutateAsync(input);
                }}
              />
            </div>
          )}

          {rulesQuery.isLoading && <p className="p-6 text-sm text-axis-text-tertiary">룰 목록을 불러오는 중...</p>}
          {rulesQuery.isError && (
            <p className="p-6 text-sm text-axis-text-error">
              {rulesQuery.error instanceof ApiError ? rulesQuery.error.message : "룰 목록을 불러오지 못했어요"}
            </p>
          )}
          {!rulesQuery.isLoading && !rulesQuery.isError && rules.length === 0 && (
            <p className="p-6 text-sm text-axis-text-tertiary">
              등록된 운영룰이 없어요. "새 룰"로 직접 만들거나, 오른쪽 안내에서 시상정의를 운영룰로 승격해 보세요.
            </p>
          )}
          {listError && <p className="px-4 pt-3 text-sm text-axis-text-error">{listError}</p>}

          {[...rules]
            .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
            .map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onDelete={(id) => deleteMutation.mutate(id)}
                isDeleting={deleteMutation.isPending && deleteMutation.variables === rule.id}
              />
            ))}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3.5">
        <DefinitionBridge operationalRuleCount={rules.length} />
        <SimulatePanel currentRules={rules} />
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold text-axis-text-primary">평가기 규약</div>
          <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-axis-text-secondary">
            <div>· priority 오름차순 + 동순위 id 정렬 → 결정적 평가</div>
            <div>· exclusive 매칭 시 이후 룰 중단, stack은 누적</div>
            <div>· 동일 입력 재실행 = 동일 출력 (재현성 보장)</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
