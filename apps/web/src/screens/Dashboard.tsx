import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RunDetail, ReconciliationResult, StatsByInsurer, StatsByOrg, StatsByMonth, UploadDetail } from "./_pipeline/types";
import { currentMonth, formatCurrency, formatNumber, formatPercent, StatusBadge, StepDot, type StepState } from "./_pipeline/shared";

/**
 * 대시보드 (F-026): KPI + 파이프라인 5단계 현황.
 * 실 API 제약: run/upload 목록 조회 엔드포인트가 없어(GET /api/runs, GET /api/uploads 부재)
 * 정산월 집계(stats/by-month·by-insurer·by-org)는 자동 조회하되, run/upload 단위 KPI(대사 차액·오류 행)는
 * 사용자가 Run ID/Upload ID를 직접 입력해 조회한다 (API 계약 불일치 항목, 최종 보고에 기재).
 */
export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [monthInput, setMonthInput] = useState(currentMonth());
  const [runId, setRunId] = useState("");
  const [runIdInput, setRunIdInput] = useState("");
  const [uploadId, setUploadId] = useState("");
  const [uploadIdInput, setUploadIdInput] = useState("");

  function handleQuerySubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMonth(monthInput);
    setRunId(runIdInput.trim());
    setUploadId(uploadIdInput.trim());
  }

  const byMonthQuery = useQuery({
    queryKey: ["stats-by-month"],
    queryFn: () => apiFetch<StatsByMonth>("/api/stats/by-month"),
  });
  const byInsurerQuery = useQuery({
    queryKey: ["stats-by-insurer", month],
    queryFn: () => apiFetch<StatsByInsurer>(`/api/stats/by-insurer?month=${encodeURIComponent(month)}`),
    enabled: month.length > 0,
  });
  const byOrgQuery = useQuery({
    queryKey: ["stats-by-org", month],
    queryFn: () => apiFetch<StatsByOrg>(`/api/stats/by-org?month=${encodeURIComponent(month)}`),
    enabled: month.length > 0,
  });
  const runQuery = useQuery({
    queryKey: ["run-detail", runId],
    queryFn: () => apiFetch<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`),
    enabled: runId.length > 0,
    retry: false,
  });
  const reconQuery = useQuery({
    queryKey: ["run-reconciliation", runId],
    queryFn: () => apiFetch<ReconciliationResult>(`/api/runs/${encodeURIComponent(runId)}/reconciliation`),
    enabled: runId.length > 0,
    retry: false,
  });
  const uploadQuery = useQuery({
    queryKey: ["upload-detail", uploadId],
    queryFn: () => apiFetch<UploadDetail>(`/api/uploads/${encodeURIComponent(uploadId)}`),
    enabled: uploadId.length > 0,
    retry: false,
  });

  const monthTotal = byMonthQuery.data?.byMonth.find((m) => m.month === month)?.total ?? 0;
  const diffTotal = reconQuery.data?.insurers.reduce((s, i) => s + Math.abs(i.diff), 0) ?? null;

  // 파이프라인 5단계: 수집(업로드 상태) -> 매핑(TemplateVersion 확정) -> 계산(run.status) -> 대사(diff 여부) -> 마감(closed)
  const steps: { label: string; state: StepState; meta: string }[] = [
    {
      label: "수집",
      state: uploadQuery.data ? "done" : "pending",
      meta: uploadQuery.data ? uploadQuery.data.status : "Upload ID 미입력",
    },
    {
      label: "매핑",
      state: uploadQuery.data?.templateVersionId ? "done" : uploadQuery.data ? "active" : "pending",
      meta: uploadQuery.data?.templateVersionId ? "TemplateVersion 확정" : uploadQuery.data ? "검토 대기" : "-",
    },
    {
      label: "계산",
      state: runQuery.data?.status === "calculated" || runQuery.data?.status === "closed" ? "done" : runQuery.data ? "active" : "pending",
      meta: runQuery.data?.status ?? "-",
    },
    {
      label: "대사",
      state: diffTotal === 0 ? "done" : diffTotal != null && diffTotal > 0 ? "error" : "pending",
      meta: diffTotal != null ? `차액 ${formatCurrency(diffTotal)}` : "-",
    },
    {
      label: "마감",
      state: runQuery.data?.status === "closed" ? "done" : "pending",
      meta: runQuery.data?.status === "closed" ? (runQuery.data.closedAt ?? "완료") : "미마감",
    },
  ];

  return (
    <div className="flex max-w-[1200px] flex-col gap-5">
      <Card>
        <CardContent className="pt-6">
          <form className="flex flex-wrap items-end gap-3" onSubmit={handleQuerySubmit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dash-month">정산월</Label>
              <Input id="dash-month" value={monthInput} onChange={(e) => setMonthInput(e.target.value)} placeholder="2026-06" className="w-32" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dash-run">Run ID (대사 · 마감 KPI)</Label>
              <Input id="dash-run" value={runIdInput} onChange={(e) => setRunIdInput(e.target.value)} placeholder="run id" className="w-56" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dash-upload">Upload ID (수집 · 오류 행 KPI)</Label>
              <Input id="dash-upload" value={uploadIdInput} onChange={(e) => setUploadIdInput(e.target.value)} placeholder="upload id" className="w-56" />
            </div>
            <Button type="submit">조회</Button>
          </form>
          <p className="mt-2 text-xs text-axis-text-tertiary">
            Run/Upload 목록 조회 API가 아직 없어(GET /api/runs, GET /api/uploads 부재) ID를 직접 입력해 조회해요. 업로드 화면에서 발급된 ID를 붙여넣으세요.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-0 pt-6">
          {steps.map((s, i) => (
            <div key={s.label} className="flex flex-1 items-center gap-0 last:flex-none">
              <div className="flex flex-none items-center gap-2">
                <StepDot state={s.state} index={i + 1} />
                <span className="text-sm font-semibold">{s.label}</span>
                <span className="text-xs text-axis-text-tertiary">{s.meta}</span>
              </div>
              {i < steps.length - 1 && <div className="mx-3.5 h-0.5 flex-1 bg-axis-border-default" />}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1.5 pt-6">
            <div className="text-xs font-medium text-axis-text-tertiary">당월 계산 지급액</div>
            <div className="text-2xl font-bold tracking-tight tabular-nums">{formatCurrency(monthTotal)}</div>
            <div className="text-xs text-axis-text-secondary">{month} · stats/by-month</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1.5 pt-6">
            <div className="text-xs font-medium text-axis-text-tertiary">변환 성공률</div>
            <div className="text-2xl font-bold tracking-tight tabular-nums">
              {uploadQuery.data?.rowCount ? formatPercent((uploadQuery.data.okCount ?? 0) / uploadQuery.data.rowCount) : "-"}
            </div>
            <div className="text-xs text-axis-text-secondary">
              {uploadQuery.data ? `${formatNumber(uploadQuery.data.okCount ?? 0)} / ${formatNumber(uploadQuery.data.rowCount ?? 0)}행` : "Upload ID 필요"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1.5 pt-6">
            <div className="text-xs font-medium text-axis-text-tertiary">대사 차액</div>
            <div className={`text-2xl font-bold tracking-tight tabular-nums ${diffTotal ? "text-axis-text-error" : ""}`}>
              {diffTotal != null ? formatCurrency(diffTotal) : "-"}
            </div>
            <div className="text-xs text-axis-text-secondary">{reconQuery.data ? `${reconQuery.data.diffContracts.length}건 차액 계약` : "Run ID 필요"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1.5 pt-6">
            <div className="text-xs font-medium text-axis-text-tertiary">오류 행</div>
            <div className="text-2xl font-bold tracking-tight tabular-nums">{uploadQuery.data ? formatNumber(uploadQuery.data.errorCount ?? 0) : "-"}</div>
            <div className="text-xs text-axis-text-secondary">{uploadQuery.data ? `총 ${formatNumber(uploadQuery.data.rowCount ?? 0)}행 중` : "Upload ID 필요"}</div>
          </CardContent>
        </Card>
      </div>

      {(runQuery.error || uploadQuery.error) && (
        <p className="text-sm text-axis-text-error">
          {runQuery.error instanceof ApiError ? `Run 조회 실패: ${runQuery.error.message}` : null}
          {uploadQuery.error instanceof ApiError ? ` Upload 조회 실패: ${uploadQuery.error.message}` : null}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">월별 계산 지급액 추이</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {byMonthQuery.data?.byMonth.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonthQuery.data.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v: number) => formatNumber(v)} width={70} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v ?? 0))} />
                  <Bar dataKey="total" fill="var(--axis-color-blue-500)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-axis-text-tertiary">아직 계산된 run이 없어요.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">원수사별 계산 지급액 ({month})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>원수사 ID</TableHead>
                  <TableHead className="text-right">지급액</TableHead>
                  <TableHead className="text-right">건수</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byInsurerQuery.data?.byInsurer.length ? (
                  byInsurerQuery.data.byInsurer.map((row) => (
                    <TableRow key={row.insurerId}>
                      <TableCell className="font-medium">{row.insurerId}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(row.total)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.count)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-axis-text-tertiary">
                      {month} 데이터가 없어요.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">조직별 계산 지급액 ({month})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>조직 유닛 ID</TableHead>
                <TableHead className="text-right">지급액</TableHead>
                <TableHead className="text-right">건수</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byOrgQuery.data?.byOrg.length ? (
                byOrgQuery.data.byOrg.map((row) => (
                  <TableRow key={row.orgUnitId}>
                    <TableCell className="font-medium">{row.orgUnitId}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(row.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.count)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-axis-text-tertiary">
                    {month} run이 없거나 계산 전이에요.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {runQuery.data && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6 text-sm">
            <span className="font-medium">Run {runQuery.data.id}</span>
            <StatusBadge status={runQuery.data.status} />
            <span className="text-axis-text-secondary">
              라인 {formatNumber(runQuery.data.lineCount)}건 · 총 {formatCurrency(runQuery.data.totalAmount)}
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
