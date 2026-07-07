import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RunStatusBadge } from "@/screens/_close/RunStatusBadge";
import { AdjustmentsPanel } from "@/screens/_close/AdjustmentsPanel";
import { CloseRunDialog } from "@/screens/_close/CloseRunDialog";
import { currentMonth, krw } from "@/screens/_close/format";
import { getLastRunId, getRecentRuns, touchRecentRun, type RecentRun } from "@/screens/_close/run-storage";

interface RunSummary {
  id: string;
  settlementMonth: string;
  status: "draft" | "calculated" | "closed";
  snapshotR2Key: string | null;
  closedAt: string | null;
  closedBy: string | null;
  lineCount: number;
  totalAmount: number;
}

interface CreateRunResponse {
  id: string;
  settlementMonth: string;
  status: "draft";
}

interface CalculateResponse {
  runId: string;
  status: "calculated";
  lines: number;
  totalAmount: number;
}

export default function Runs() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [runId, setRunId] = useState<string | null>(() => getLastRunId());
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>(() => getRecentRuns());

  const runQuery = useQuery({
    queryKey: ["run", runId],
    queryFn: () => apiFetch<RunSummary>(`/api/runs/${runId}`),
    enabled: !!runId,
  });

  const findOrCreateMutation = useMutation({
    mutationFn: async (settlementMonth: string) => {
      try {
        const res = await apiFetch<CreateRunResponse>("/api/runs", {
          method: "POST",
          body: JSON.stringify({ settlementMonth }),
        });
        return res.id;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.body && typeof err.body === "object" && "runId" in err.body) {
          return (err.body as { runId: string }).runId;
        }
        throw err;
      }
    },
    onSuccess: (id, settlementMonth) => {
      setRunId(id);
      touchRecentRun(id, settlementMonth);
      setRecentRuns(getRecentRuns());
      void queryClient.invalidateQueries({ queryKey: ["run", id] });
    },
  });

  const calculateMutation = useMutation({
    mutationFn: () => apiFetch<CalculateResponse>(`/api/runs/${runId}/calculate`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
  });

  const run = runQuery.data;
  const isClosed = run?.status === "closed";
  const canCalculate = !!run && run.status !== "closed";
  const canClose = run?.status === "calculated";

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>정산 Run 조회 · 생성</CardTitle>
          <CardDescription>월(YYYY-MM) 단위 Run은 1개만 존재해요. 이미 있으면 기존 Run을 이어서 조회해요.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
          <div className="w-40">
            <Label htmlFor="run-month" className="text-xs text-axis-text-tertiary">
              정산월
            </Label>
            <Input id="run-month" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="2026-06" />
          </div>
          <Button onClick={() => findOrCreateMutation.mutate(month)} disabled={!/^\d{4}-\d{2}$/.test(month) || findOrCreateMutation.isPending}>
            {findOrCreateMutation.isPending ? "조회 중..." : "Run 조회 · 생성"}
          </Button>
          {findOrCreateMutation.isError && (
            <p className="text-xs font-medium text-axis-text-error">
              {findOrCreateMutation.error instanceof ApiError ? findOrCreateMutation.error.message : "요청에 실패했어요"}
            </p>
          )}
        </CardContent>
      </Card>

      {runId && (
        <Card className={isClosed ? "border-l-4 border-l-axis-border-secondary" : "border-l-4 border-l-axis-border-focus"}>
          <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
            <CardTitle className="text-base">{run?.settlementMonth ?? "-"} Run</CardTitle>
            {run && <RunStatusBadge status={run.status} />}
            <span className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => calculateMutation.mutate()} disabled={!canCalculate || calculateMutation.isPending}>
                {calculateMutation.isPending ? "계산 중..." : "계산 실행"}
              </Button>
              {run && <CloseRunDialog runId={run.id} defaultClosedBy={auth?.email ?? "system"} disabled={!canClose} />}
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {runQuery.isLoading && <p className="text-xs text-axis-text-tertiary">Run 상태 조회 중...</p>}
            {calculateMutation.isError && (
              <p className="text-xs font-medium text-axis-text-error">
                {calculateMutation.error instanceof ApiError ? calculateMutation.error.message : "계산에 실패했어요"}
              </p>
            )}
            {isClosed && (
              <p className="text-xs font-medium text-axis-text-warning">
                마감된 run이에요. API 검사 + D1 트리거 이중 잠금으로 재계산·보정이 차단돼요.
              </p>
            )}
            {run && (
              <div className="grid grid-cols-2 gap-0 divide-x divide-axis-border-default rounded-md border border-axis-border-default sm:grid-cols-4">
                <div className="p-3">
                  <div className="text-[11px] text-axis-text-tertiary">계산 지급 총액</div>
                  <div className="mt-1 text-sm font-bold tabular-nums">{krw(run.totalAmount)}</div>
                </div>
                <div className="p-3">
                  <div className="text-[11px] text-axis-text-tertiary">settlement_lines</div>
                  <div className="mt-1 text-sm font-bold tabular-nums">{run.lineCount.toLocaleString("ko-KR")}</div>
                </div>
                <div className="p-3">
                  <div className="text-[11px] text-axis-text-tertiary">마감 처리자</div>
                  <div className="mt-1 text-sm font-medium">{run.closedBy ?? "-"}</div>
                </div>
                <div className="p-3">
                  <div className="text-[11px] text-axis-text-tertiary">마감 스냅샷</div>
                  <div className="mt-1 truncate font-mono text-xs text-axis-text-secondary" title={run.snapshotR2Key ?? undefined}>
                    {run.snapshotR2Key ?? "- (마감 시 생성)"}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {runId && run && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">수동 보정 (adjustments)</CardTitle>
            <CardDescription>모든 보정은 reason 필수 + audit_logs 동반. 마감된 run은 등록 불가.</CardDescription>
          </CardHeader>
          <CardContent>
            <AdjustmentsPanel runId={run.id} closed={isClosed} />
          </CardContent>
        </Card>
      )}

      {recentRuns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">최근 조회한 Run</CardTitle>
            <CardDescription>
              GET /api/runs(목록) 엔드포인트가 없어 이 브라우저에서 조회·생성한 Run만 로컬로 기억해요 - API 갭.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {recentRuns.map((r) => (
              <button
                key={r.runId}
                onClick={() => setRunId(r.runId)}
                className="flex items-center gap-3 rounded-md border border-axis-border-default px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="font-semibold">{r.settlementMonth}</span>
                <span className="font-mono text-xs text-axis-text-tertiary">{r.runId}</span>
                {r.runId === runId && <span className="ml-auto text-xs text-axis-text-brand">현재 조회 중</span>}
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
