import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { useRunsList } from "@/lib/pickers";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RunSelect } from "@/components/pickers/EntitySelects";
import { krw, signedKrw } from "@/screens/_close/format";
import { getLastRunId } from "@/screens/_close/run-storage";

interface InsurerReconciliation {
  insurerId: string;
  insurerTotal: number;
  calculatedTotal: number;
  diff: number;
  status: "matched" | "diff";
}

interface DiffContract {
  commissionRecordId: string;
  contractNo: string;
  insurerId: string;
  insurerAmount: number;
  calculatedAmount: number;
  diff: number;
}

interface ReconciliationResponse {
  runId: string;
  insurers: InsurerReconciliation[];
  diffContracts: DiffContract[];
}

// 시책 대사 (F-063): 보고 시상금(시책지급내역 원장) vs 시책룰 계산
interface IncentiveDiffContract {
  contractNo: string;
  insurerId: string | null;
  insurerAmount: number;
  calculatedAmount: number;
  diff: number;
}

interface IncentiveReconciliationResponse {
  runId: string;
  reportedRecords: number;
  insurers: InsurerReconciliation[];
  diffContracts: IncentiveDiffContract[];
}

interface ParallelVerifyDiff {
  commissionRecordId: string;
  ruleId: string;
  expected: number;
  stored: number;
  diff: number;
}

interface ParallelVerifyResponse {
  runId: string;
  verified: boolean;
  totalDiff: number;
  diffs: ParallelVerifyDiff[];
}

export default function Reconciliation() {
  const [appliedRunId, setAppliedRunId] = useState<string | null>(() => getLastRunId());
  const [expandedInsurer, setExpandedInsurer] = useState<string | null>(null);

  // localStorage에 지속된 last runId가 현재 run 목록에 없으면(DB 리셋·run 삭제·환경 전환 등) 클리어.
  // 죽은 id로 reconciliation/verify/incentive 3개 쿼리가 발사돼 404 스팸이 나던 것을 원천 차단.
  const { data: runsList } = useRunsList();
  useEffect(() => {
    if (appliedRunId && runsList && !runsList.some((r) => r.id === appliedRunId)) {
      setAppliedRunId(null);
    }
  }, [appliedRunId, runsList]);

  // 쿼리는 run이 실제 목록에 있을 때만 발사(마운트 레이스로 stale id가 한 번 새는 것까지 차단).
  // 목록 로드 전엔 대기 → 유효 run은 목록 도착 후 즉시 조회, stale run은 아예 요청 안 함.
  const runValid = !!appliedRunId && !!runsList && runsList.some((r) => r.id === appliedRunId);

  const reconQuery = useQuery({
    queryKey: ["reconciliation", appliedRunId],
    queryFn: () => apiFetch<ReconciliationResponse>(`/api/runs/${appliedRunId}/reconciliation`),
    enabled: runValid,
  });

  const verifyQuery = useQuery({
    queryKey: ["parallel-verify", appliedRunId],
    queryFn: () => apiFetch<ParallelVerifyResponse>(`/api/runs/${appliedRunId}/parallel-verify`),
    enabled: runValid,
  });

  const incentiveQuery = useQuery({
    queryKey: ["incentive-reconciliation", appliedRunId],
    queryFn: () => apiFetch<IncentiveReconciliationResponse>(`/api/runs/${appliedRunId}/incentive-reconciliation`),
    enabled: runValid,
  });

  const insurers = reconQuery.data?.insurers ?? [];
  const insurerTotal = insurers.reduce((s, i) => s + i.insurerTotal, 0);
  const calculatedTotal = insurers.reduce((s, i) => s + i.calculatedTotal, 0);
  const totalDiff = insurerTotal - calculatedTotal;
  const diffInsurerCount = insurers.filter((i) => i.status === "diff").length;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Run 선택</CardTitle>
          <CardDescription>
            대사·병행 검증은 정산 Run 기준으로 조회해요. 아래에서 정산월 Run을 선택하세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="recon-run-id" className="text-xs text-axis-text-tertiary">
              정산 Run
            </Label>
            <RunSelect id="recon-run-id" value={appliedRunId ?? ""} onChange={(v) => setAppliedRunId(v || null)} />
          </div>
        </CardContent>
      </Card>

      {appliedRunId && (
        <>
          {reconQuery.isLoading && <p className="text-sm text-axis-text-tertiary">대사 데이터 조회 중...</p>}
          {reconQuery.isError && (
            <p className="text-sm font-medium text-axis-text-error">
              {reconQuery.error instanceof ApiError ? reconQuery.error.message : "대사 데이터를 불러오지 못했어요"}
            </p>
          )}

          {reconQuery.data && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-axis-text-tertiary">원수사 보고 총액</div>
                    <div className="mt-1 text-xl font-bold tabular-nums">{krw(insurerTotal)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-axis-text-tertiary">시스템 계산 총액</div>
                    <div className="mt-1 text-xl font-bold tabular-nums">{krw(calculatedTotal)}</div>
                  </CardContent>
                </Card>
                <Card className={totalDiff === 0 ? "border-l-4 border-l-axis-border-success" : "border-l-4 border-l-axis-border-error"}>
                  <CardContent className="p-4">
                    <div className="text-xs text-axis-text-tertiary">차액</div>
                    <div className={`mt-1 text-xl font-bold tabular-nums ${totalDiff === 0 ? "text-axis-text-success" : "text-axis-text-error"}`}>
                      {signedKrw(totalDiff)}
                    </div>
                    <div className="mt-1 text-[11px] text-axis-text-secondary">
                      {diffInsurerCount === 0 ? "전 원수사 일치" : `${diffInsurerCount}개 원수사 불일치`}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">원수사별 대사</CardTitle>
                  <span className="text-xs text-axis-text-tertiary">차액은 upload_id + row_no 역추적으로 계약 단위까지 특정해요</span>
                </CardHeader>
                <CardContent>
                  {insurers.length === 0 && <p className="text-sm text-axis-text-tertiary">대사 대상 데이터가 없어요.</p>}
                  {insurers.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>원수사</TableHead>
                          <TableHead className="text-right">보고액</TableHead>
                          <TableHead className="text-right">계산액</TableHead>
                          <TableHead className="text-right">차액</TableHead>
                          <TableHead>상태</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {insurers.map((i) => {
                          const contracts = (reconQuery.data?.diffContracts ?? []).filter((c) => c.insurerId === i.insurerId);
                          const isOpen = expandedInsurer === i.insurerId;
                          return (
                            <Fragment key={i.insurerId}>
                              <TableRow
                                className={i.status === "diff" ? "cursor-pointer" : ""}
                                onClick={() => i.status === "diff" && setExpandedInsurer(isOpen ? null : i.insurerId)}
                              >
                                <TableCell className="font-mono text-xs">
                                  {i.insurerId}
                                  {i.status === "diff" && <span className="ml-2 text-xs font-medium text-axis-text-brand">{isOpen ? "접기 ▲" : "드릴다운 ▼"}</span>}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{i.insurerTotal.toLocaleString("ko-KR")}</TableCell>
                                <TableCell className="text-right tabular-nums">{i.calculatedTotal.toLocaleString("ko-KR")}</TableCell>
                                <TableCell
                                  className={`text-right font-semibold tabular-nums ${i.diff === 0 ? "text-axis-text-tertiary" : "text-axis-text-error"}`}
                                >
                                  {i.diff === 0 ? "0" : signedKrw(i.diff)}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={
                                      i.status === "matched"
                                        ? "border-transparent bg-axis-badge-success-bg text-axis-badge-success-text"
                                        : "border-transparent bg-axis-badge-error-bg text-axis-badge-error-text"
                                    }
                                  >
                                    {i.status === "matched" ? "일치" : "차액"}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                              {isOpen && (
                                <TableRow>
                                  <TableCell colSpan={5} className="bg-axis-surface-secondary p-0">
                                    <div className="flex flex-col gap-2 p-4">
                                      <div className="text-xs font-semibold text-axis-text-secondary">계약 단위 드릴다운 - diff ≠ 0</div>
                                      {contracts.length === 0 && <p className="text-xs text-axis-text-tertiary">차액 계약이 없어요.</p>}
                                      {contracts.map((c) => (
                                        <div key={c.commissionRecordId} className="rounded-md border border-axis-border-default bg-axis-surface-default">
                                          <div className="flex items-center gap-3 border-b border-axis-border-default px-4 py-2">
                                            <span className="font-mono text-xs font-bold text-axis-text-brand">{c.contractNo}</span>
                                            <span className="ml-auto font-mono text-[10px] text-axis-text-tertiary">record {c.commissionRecordId}</span>
                                          </div>
                                          <div className="grid grid-cols-3 divide-x divide-axis-border-default">
                                            <div className="p-3">
                                              <div className="text-[10px] text-axis-text-tertiary">원수사 보고</div>
                                              <div className="mt-1 text-sm font-semibold tabular-nums">{krw(c.insurerAmount)}</div>
                                            </div>
                                            <div className="p-3">
                                              <div className="text-[10px] text-axis-text-tertiary">시스템 계산</div>
                                              <div className="mt-1 text-sm font-semibold tabular-nums">{krw(c.calculatedAmount)}</div>
                                            </div>
                                            <div className="p-3">
                                              <div className="text-[10px] text-axis-text-tertiary">차액</div>
                                              <div className="mt-1 text-sm font-bold tabular-nums text-axis-text-error">{signedKrw(c.diff)}</div>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">시책 대사</CardTitle>
              <CardDescription>
                원수사 보고 시상금(시책지급내역 업로드) vs 시책룰 계산액 - 계약(증권) 단위 차액 드릴다운.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {incentiveQuery.isLoading && <p className="text-sm text-axis-text-tertiary">시책 대사 조회 중...</p>}
              {incentiveQuery.isError && (
                <p className="text-sm font-medium text-axis-text-error">
                  {incentiveQuery.error instanceof ApiError ? incentiveQuery.error.message : "시책 대사를 불러오지 못했어요"}
                </p>
              )}
              {incentiveQuery.data && incentiveQuery.data.reportedRecords === 0 && (
                <p className="text-sm text-axis-text-tertiary">
                  이 정산월에 업로드·승인된 시책지급내역이 없어요. 업로드 화면에서 문서유형을 "시책지급내역"으로 올리면 여기서 대사돼요.
                </p>
              )}
              {incentiveQuery.data && incentiveQuery.data.reportedRecords > 0 && (
                <>
                  <div className="text-xs text-axis-text-tertiary">보고 시상 행 {incentiveQuery.data.reportedRecords.toLocaleString("ko-KR")}건</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>원수사</TableHead>
                        <TableHead className="text-right">보고 시상금</TableHead>
                        <TableHead className="text-right">계산액</TableHead>
                        <TableHead className="text-right">차액</TableHead>
                        <TableHead>상태</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {incentiveQuery.data.insurers.map((i) => (
                        <TableRow key={i.insurerId}>
                          <TableCell className="font-mono text-xs">{i.insurerId}</TableCell>
                          <TableCell className="text-right tabular-nums">{i.insurerTotal.toLocaleString("ko-KR")}</TableCell>
                          <TableCell className="text-right tabular-nums">{i.calculatedTotal.toLocaleString("ko-KR")}</TableCell>
                          <TableCell className={`text-right font-semibold tabular-nums ${i.diff === 0 ? "text-axis-text-tertiary" : "text-axis-text-error"}`}>
                            {i.diff === 0 ? "0" : signedKrw(i.diff)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                i.status === "matched"
                                  ? "border-transparent bg-axis-badge-success-bg text-axis-badge-success-text"
                                  : "border-transparent bg-axis-badge-error-bg text-axis-badge-error-text"
                              }
                            >
                              {i.status === "matched" ? "일치" : "차액"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {incentiveQuery.data.diffContracts.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <div className="text-xs font-semibold text-axis-text-secondary">계약 단위 차액 (상위 20건)</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>증권번호</TableHead>
                            <TableHead className="text-right">보고 시상금</TableHead>
                            <TableHead className="text-right">계산액</TableHead>
                            <TableHead className="text-right">차액</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {incentiveQuery.data.diffContracts.slice(0, 20).map((d) => (
                            <TableRow key={d.contractNo}>
                              <TableCell className="font-mono text-xs">{d.contractNo}</TableCell>
                              <TableCell className="text-right tabular-nums">{d.insurerAmount.toLocaleString("ko-KR")}</TableCell>
                              <TableCell className="text-right tabular-nums">{d.calculatedAmount.toLocaleString("ko-KR")}</TableCell>
                              <TableCell className="text-right font-semibold tabular-nums text-axis-text-error">{signedKrw(d.diff)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">병행 검증</CardTitle>
              <CardDescription>저장된 settlement_lines vs 독립 재계산 - 정상은 차액 0원(무결성 기준).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {verifyQuery.isLoading && <p className="text-sm text-axis-text-tertiary">병행 검증 중...</p>}
              {verifyQuery.isError && (
                <p className="text-sm font-medium text-axis-text-error">
                  {verifyQuery.error instanceof ApiError ? verifyQuery.error.message : "병행 검증을 불러오지 못했어요"}
                </p>
              )}
              {verifyQuery.data && (
                <>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className={
                        verifyQuery.data.verified
                          ? "border-transparent bg-axis-badge-success-bg text-axis-badge-success-text"
                          : "border-transparent bg-axis-badge-error-bg text-axis-badge-error-text"
                      }
                    >
                      {verifyQuery.data.verified ? "무결성 확인" : "차액 발견"}
                    </Badge>
                    <span className="text-sm font-semibold tabular-nums">총 차액 {krw(verifyQuery.data.totalDiff)}</span>
                  </div>
                  {verifyQuery.data.diffs.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>계약(record)</TableHead>
                          <TableHead>룰</TableHead>
                          <TableHead className="text-right">기대값</TableHead>
                          <TableHead className="text-right">저장값</TableHead>
                          <TableHead className="text-right">차액</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {verifyQuery.data.diffs.map((d) => (
                          <TableRow key={`${d.commissionRecordId}-${d.ruleId}`}>
                            <TableCell className="font-mono text-xs">{d.commissionRecordId}</TableCell>
                            <TableCell className="font-mono text-xs">{d.ruleId}</TableCell>
                            <TableCell className="text-right tabular-nums">{d.expected.toLocaleString("ko-KR")}</TableCell>
                            <TableCell className="text-right tabular-nums">{d.stored.toLocaleString("ko-KR")}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums text-axis-text-error">{signedKrw(d.diff)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
