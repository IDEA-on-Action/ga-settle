import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RunSelect } from "@/components/pickers/EntitySelects";
import { downloadFile } from "./_output/download";
import { formatWon, initialOf } from "./_output/format";

interface PayslipSummary {
  agentId: string;
  orgUnitId: string;
  total: number;
}

interface PayslipLine {
  commissionRecordId: string;
  ruleId: string | null;
  amount: number;
  basis: string | null;
}

interface PayslipDetail {
  agentId: string;
  orgUnitId: string;
  total: number;
  lines: PayslipLine[];
}

/** breakdownJson 원문을 표시용으로 정리(파싱 실패 시 원문 그대로). */
function formatBasis(basis: string | null): string {
  if (!basis) return "-";
  try {
    const parsed = JSON.parse(basis) as unknown;
    return typeof parsed === "object" ? JSON.stringify(parsed) : String(parsed);
  } catch {
    return basis;
  }
}

export default function Payslips() {
  const [activeRunId, setActiveRunId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["payslips", activeRunId],
    queryFn: () => apiFetch<PayslipSummary[]>(`/api/runs/${activeRunId}/payslips`),
    enabled: activeRunId.length > 0,
  });

  const detailQuery = useQuery({
    queryKey: ["payslip-detail", activeRunId, selectedAgentId],
    queryFn: () => apiFetch<PayslipDetail>(`/api/runs/${activeRunId}/payslips/${selectedAgentId}`),
    enabled: activeRunId.length > 0 && !!selectedAgentId,
  });

  const generateMutation = useMutation({
    mutationFn: () => apiFetch<{ runId: string; payslips: number; totalAmount: number }>(`/api/runs/${activeRunId}/payslips`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslips", activeRunId] });
      if (selectedAgentId) qc.invalidateQueries({ queryKey: ["payslip-detail", activeRunId, selectedAgentId] });
    },
  });

  async function handleDownload() {
    setDownloadError(null);
    setIsDownloading(true);
    try {
      await downloadFile(`/api/runs/${activeRunId}/transfer-master`, `transfer-master_${activeRunId}.csv`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "다운로드에 실패했어요");
    } finally {
      setIsDownloading(false);
    }
  }

  const list = listQuery.data ?? [];
  const selected = list.find((a) => a.agentId === selectedAgentId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-axis-text-primary">지급 내역서</h1>
        <p className="text-sm text-axis-text-secondary">설계사별 롤업 · 룰별 분해 · 이체 마스터 (F-018)</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-id">정산 Run</Label>
            <RunSelect
              id="run-id"
              value={activeRunId}
              onChange={(v) => {
                setActiveRunId(v);
                setSelectedAgentId(null);
              }}
              className="w-80"
            />
          </div>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={activeRunId.length === 0 || generateMutation.isPending}
          >
            {generateMutation.isPending ? "생성 중..." : "내역서 생성"}
          </Button>
          {generateMutation.isError && (
            <span className="text-sm text-axis-text-error">
              {generateMutation.error instanceof ApiError ? generateMutation.error.message : "내역서 생성에 실패했어요"}
            </span>
          )}
          {generateMutation.isSuccess && (
            <span className="text-sm text-axis-text-success">
              {generateMutation.data.payslips}건 생성 · 총액 {formatWon(generateMutation.data.totalAmount)}
            </span>
          )}
        </CardContent>
      </Card>

      {activeRunId.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-axis-text-tertiary">
            Run ID를 입력하고 불러오기를 눌러주세요.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-axis-border-default py-3">
              <CardTitle className="text-sm">설계사별 지급액</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {listQuery.isLoading && <p className="p-4 text-sm text-axis-text-tertiary">불러오는 중...</p>}
              {listQuery.isError && (
                <p className="p-4 text-sm text-axis-text-error">
                  {listQuery.error instanceof ApiError ? listQuery.error.message : "목록을 불러오지 못했어요"}
                </p>
              )}
              {!listQuery.isLoading && !listQuery.isError && list.length === 0 && (
                <p className="p-4 text-sm text-axis-text-tertiary">아직 생성된 내역서가 없어요. "내역서 생성"을 눌러주세요.</p>
              )}
              <div className="flex flex-col">
                {list.map((a) => (
                  <button
                    key={a.agentId}
                    onClick={() => setSelectedAgentId(a.agentId)}
                    className={`flex items-center gap-3 border-b border-axis-border-default px-4 py-3 text-left transition-colors hover:bg-axis-surface-secondary ${
                      a.agentId === selectedAgentId ? "bg-axis-surface-secondary" : ""
                    }`}
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-axis-surface-info text-xs font-semibold text-axis-text-brand">
                      {initialOf(a.agentId)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs font-semibold">{a.agentId}</div>
                      <div className="truncate text-xs text-axis-text-tertiary">{a.orgUnitId}</div>
                    </div>
                    <div className="shrink-0 text-sm font-bold tabular-nums">{formatWon(a.total)}</div>
                  </button>
                ))}
              </div>
            </CardContent>
            <div className="flex gap-2 p-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleDownload}
                disabled={isDownloading}
              >
                {isDownloading ? "다운로드 중..." : "이체 마스터 CSV"}
              </Button>
            </div>
            {downloadError && <p className="px-3 pb-3 text-xs text-axis-text-error">{downloadError}</p>}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-axis-border-default py-4">
              <div>
                <CardTitle className="text-base">
                  {selected ? `${selected.agentId} 지급 내역서` : "설계사를 선택해 주세요"}
                </CardTitle>
                {selected && <CardDescription className="mt-0.5">{selected.orgUnitId}</CardDescription>}
              </div>
              {selected && (
                <div className="text-right">
                  <div className="text-xs text-axis-text-tertiary">지급 총액</div>
                  <div className="text-lg font-bold tabular-nums">{formatWon(selected.total)}</div>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {!selectedAgentId && (
                <p className="p-6 text-sm text-axis-text-tertiary">좌측 목록에서 설계사를 선택하면 룰별 분해 내역이 표시돼요.</p>
              )}
              {selectedAgentId && detailQuery.isLoading && (
                <p className="p-6 text-sm text-axis-text-tertiary">불러오는 중...</p>
              )}
              {selectedAgentId && detailQuery.isError && (
                <p className="p-6 text-sm text-axis-text-error">
                  {detailQuery.error instanceof ApiError ? detailQuery.error.message : "내역서를 불러오지 못했어요"}
                </p>
              )}
              {detailQuery.data && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>룰별 산출 분해</TableHead>
                      <TableHead className="text-right">근거</TableHead>
                      <TableHead className="text-right">금액</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailQuery.data.lines.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-axis-text-tertiary">
                          라인이 없어요.
                        </TableCell>
                      </TableRow>
                    )}
                    {detailQuery.data.lines.map((ln) => (
                      <TableRow key={ln.commissionRecordId}>
                        <TableCell>
                          <span className="mr-2 font-mono text-xs font-bold text-axis-text-brand">{ln.ruleId ?? "-"}</span>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-right text-xs text-axis-text-tertiary" title={formatBasis(ln.basis)}>
                          {formatBasis(ln.basis)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{formatWon(ln.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
