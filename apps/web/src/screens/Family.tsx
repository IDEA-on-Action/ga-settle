import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pager } from "@/components/ui/pager";
import { FamilyDetectForm } from "./_rules/FamilyDetectForm";
import { FamilyTable } from "./_rules/FamilyTable";
import type { FamilyContractInput, FamilyFlag } from "./_rules/types";

const FAMILY_PAGE = 20;

/**
 * 가족계약 HITL 화면 (F-027). GET /api/family + POST /api/family/detect·/:id/confirm·/:id/release.
 * 자동 확정 경로 없음(FR-14) - 확정은 실무자가 '확정' 버튼을 눌러야만 진행되고,
 * 확정자는 로그인 사용자로 서버가 자동 기록한다(F-038).
 */
export default function Family() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const familyQuery = useQuery({
    queryKey: ["family", offset],
    queryFn: () => apiFetch<{ items: FamilyFlag[]; total: number }>(`/api/family?limit=${FAMILY_PAGE}&offset=${offset}`),
  });

  const detectMutation = useMutation({
    mutationFn: (contracts: FamilyContractInput[]) =>
      apiFetch<{ candidates: number }>("/api/family/detect", {
        method: "POST",
        body: JSON.stringify({ contracts }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["family"] }),
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string; status: string; confirmedBy: string }>(`/api/family/${id}/confirm`, {
        method: "POST",
      }),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["family"] });
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "확정 처리에 실패했어요"),
  });

  const releaseMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ id: string; status: string }>(`/api/family/${id}/release`, { method: "POST" }),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["family"] });
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : "해제 처리에 실패했어요"),
  });

  const flags = familyQuery.data?.items ?? [];
  const total = familyQuery.data?.total ?? 0;
  const pendingId = confirmMutation.isPending ? confirmMutation.variables : undefined;
  const releasingId = releaseMutation.isPending ? releaseMutation.variables : undefined;

  return (
    <div className="flex max-w-[1000px] flex-col gap-4">
      <div className="flex items-center gap-2.5 rounded-lg border border-axis-border-focus/40 bg-axis-surface-info px-4 py-2.5">
        <Info className="size-4 shrink-0 text-axis-text-brand" />
        <span className="text-sm text-axis-text-info">
          자동 확정 경로는 존재하지 않아요. 감지는 <b>후보 생성</b>까지만 하고, 확정·해제는 실무자만 가능하며 이력이
          보존돼요 (FR-14).
        </span>
      </div>

      <FamilyDetectForm
        isDetecting={detectMutation.isPending}
        onDetect={async (contracts) => {
          await detectMutation.mutateAsync(contracts);
        }}
      />

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-axis-border-default py-3.5">
          <CardTitle className="text-sm">가족계약 후보 목록</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {familyQuery.isLoading && <p className="p-6 text-sm text-axis-text-tertiary">목록을 불러오는 중...</p>}
          {familyQuery.isError && (
            <p className="p-6 text-sm text-axis-text-error">
              {familyQuery.error instanceof ApiError ? familyQuery.error.message : "목록을 불러오지 못했어요"}
            </p>
          )}
          {actionError && <p className="px-6 pt-3 text-sm text-axis-text-error">{actionError}</p>}
          {!familyQuery.isLoading && !familyQuery.isError && (
            <FamilyTable
              flags={flags}
              onConfirm={(id) => confirmMutation.mutate(id)}
              onRelease={(id) => releaseMutation.mutate(id)}
              isConfirming={(id) => pendingId === id}
              isReleasing={(id) => releasingId === id}
            />
          )}
          {!familyQuery.isLoading && !familyQuery.isError && total > 0 && (
            <div className="border-t border-axis-border-default px-4 py-2.5">
              <Pager offset={offset} limit={FAMILY_PAGE} total={total} onOffset={setOffset} />
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-axis-text-tertiary">
        확정된 가족계약은 R-015류 룰에 의해 시책 지급 대상에서 제외돼요. 해제 시 행은 유지되고 status만 변경돼요
        (이력 보존).
      </p>
    </div>
  );
}
