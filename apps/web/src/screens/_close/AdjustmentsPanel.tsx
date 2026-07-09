import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pager } from "@/components/ui/pager";
import { ContractSelect } from "@/components/pickers/EntitySelects";
import { formatDateTime } from "./format";

const ADJ_PAGE = 10;

/**
 * GET /api/runs/:id/adjustments가 adjustments 테이블 원본 행을 그대로 반환하므로
 * amount는 amountEnc(암호화 원문)로만 내려온다 - 복호화 응답 필드가 없는 API 갭.
 * 화면은 금액을 표시하지 않고 사유/대상/승인자/등록시각만 노출한다.
 */
interface AdjustmentRow {
  id: string;
  runId: string;
  targetType: string;
  targetId: string;
  amountEnc: string;
  reason: string;
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
}

interface AdjustmentCreateResponse {
  id: string;
  runId: string;
  reason: string;
  approvedBy: string | null;
}

export function AdjustmentsPanel({ runId, closed }: { runId: string; closed: boolean }) {
  const queryClient = useQueryClient();
  const [targetType, setTargetType] = useState("contract");
  const [targetId, setTargetId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [offset, setOffset] = useState(0);

  const listQuery = useQuery({
    queryKey: ["run-adjustments", runId, offset],
    queryFn: () => apiFetch<{ items: AdjustmentRow[]; total: number }>(`/api/runs/${runId}/adjustments?limit=${ADJ_PAGE}&offset=${offset}`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<AdjustmentCreateResponse>(`/api/runs/${runId}/adjustments`, {
        method: "POST",
        body: JSON.stringify({
          targetType,
          targetId,
          amount: Number(amount),
          reason,
          approvedBy: approvedBy.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setTargetId("");
      setAmount("");
      setReason("");
      setApprovedBy("");
      void queryClient.invalidateQueries({ queryKey: ["run-adjustments", runId] });
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
  });

  const canSubmit = !closed && targetId.trim().length > 0 && reason.trim().length > 0 && amount.trim().length > 0 && !Number.isNaN(Number(amount));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-md border border-axis-border-default p-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor="adj-target-type" className="text-xs text-axis-text-tertiary">
              대상 유형
            </Label>
            <Select
              value={targetType}
              onValueChange={(v) => {
                setTargetType(v);
                setTargetId("");
              }}
              disabled={closed}
            >
              <SelectTrigger id="adj-target-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contract">계약 (contract)</SelectItem>
                <SelectItem value="line">정산 라인 (line)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label htmlFor="adj-target-id" className="text-xs text-axis-text-tertiary">
              대상 {targetType === "contract" ? "계약" : "라인 ID"}
            </Label>
            {targetType === "contract" ? (
              <ContractSelect id="adj-target-id" runId={runId} value={targetId} onChange={setTargetId} disabled={closed} />
            ) : (
              <Input id="adj-target-id" value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="정산 라인 ID" disabled={closed} />
            )}
          </div>
          <div className="w-32">
            <Label htmlFor="adj-amount" className="text-xs text-axis-text-tertiary">
              금액
            </Label>
            <Input id="adj-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="금액" inputMode="numeric" className="text-right" disabled={closed} />
          </div>
        </div>
        <div>
          <Label htmlFor="adj-reason" className="text-xs text-axis-text-tertiary">
            보정 사유 (필수)
          </Label>
          <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="보정 사유" disabled={closed} />
        </div>
        <div>
          <Label htmlFor="adj-approved-by" className="text-xs text-axis-text-tertiary">
            이중 승인자 (선택, 등록자와 다른 담당자)
          </Label>
          <Input id="adj-approved-by" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="이중 통제 시 승인자" disabled={closed} />
          <p className="mt-1 text-[11px] text-axis-text-tertiary">등록자는 로그인 사용자로 자동 기록돼요(F-038).</p>
        </div>
        {createMutation.isError && (
          <p className="text-xs font-medium text-axis-text-error">
            {createMutation.error instanceof ApiError ? createMutation.error.message : "보정 등록에 실패했어요"}
          </p>
        )}
        <Button size="sm" onClick={() => createMutation.mutate()} disabled={!canSubmit || createMutation.isPending}>
          {createMutation.isPending ? "등록 중..." : "보정 등록 - 감사 기록 동반"}
        </Button>
        {closed && <p className="text-xs text-axis-text-tertiary">마감된 run은 보정을 등록할 수 없어요.</p>}
      </div>

      {listQuery.isLoading && <p className="text-xs text-axis-text-tertiary">보정 내역 조회 중...</p>}
      {listQuery.isError && <p className="text-xs text-axis-text-error">보정 내역을 불러오지 못했어요.</p>}
      {listQuery.data && listQuery.data.total === 0 && <p className="text-xs text-axis-text-tertiary">등록된 보정이 없어요.</p>}
      {listQuery.data && listQuery.data.total > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>대상</TableHead>
              <TableHead>사유</TableHead>
              <TableHead>승인자</TableHead>
              <TableHead>등록 시각</TableHead>
              <TableHead className="text-right">감사</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.data.items.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-mono text-xs text-axis-text-brand">
                  {a.targetType}:{a.targetId}
                </TableCell>
                <TableCell className="text-sm">{a.reason}</TableCell>
                <TableCell className="text-sm text-axis-text-secondary">{a.approvedBy ?? "-"}</TableCell>
                <TableCell className="text-xs text-axis-text-tertiary">{formatDateTime(a.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline" className="border-transparent bg-axis-badge-success-bg text-axis-badge-success-text">
                    audit ok
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {listQuery.data && listQuery.data.total > ADJ_PAGE && (
        <Pager offset={offset} limit={ADJ_PAGE} total={listQuery.data.total} onOffset={setOffset} />
      )}
      <p className="text-xs text-axis-text-tertiary">
        참고: 목록 API는 금액을 amountEnc(암호화 원문)로만 반환해 화면에 복호화 금액을 표시할 수 없어요(API 갭).
      </p>
    </div>
  );
}
