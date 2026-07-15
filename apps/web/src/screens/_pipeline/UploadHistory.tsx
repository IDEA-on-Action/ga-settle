import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, StatusBadge } from "./shared";

interface UploadRow {
  id: string;
  insurerId: string;
  insurerName: string | null;
  settlementMonth: string;
  status: string;
  docType?: "commission" | "incentive"; // F-062 문서유형

  rowCount: number | null;
  okCount: number | null;
  errorCount: number | null;
  createdAt: string;
}
interface UploadList {
  uploads: UploadRow[];
  total: number;
}
interface DeleteResult {
  ok: boolean;
  id: string;
  deleted: { commissionRecords: number; settlementLines: number; uploadErrors: number; jobs: number };
}

/**
 * 업로드 내역 목록 + 삭제 (F-047, 260710 데모 피드백 AI-4).
 * DELETE /api/uploads/:id - 마감된 정산월은 서버가 409 차단(불변식 #2), 그 외는 원장·정산라인까지
 * cascade 삭제 후 삭제 카운트 반환. 삭제는 감사로그 동반(불변식 #4).
 */
export function UploadHistory() {
  const qc = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["uploads-history"],
    queryFn: () => apiFetch<UploadList>("/api/uploads?limit=20"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<DeleteResult>(`/api/uploads/${id}`, { method: "DELETE" }),
    onSuccess: (res) => {
      setConfirmId(null);
      setError(null);
      const d = res.deleted;
      setNotice(`삭제 완료 - 원장 ${formatNumber(d.commissionRecords)} · 정산라인 ${formatNumber(d.settlementLines)} · 검증오류 ${formatNumber(d.uploadErrors)}`);
      qc.invalidateQueries({ queryKey: ["uploads-history"] });
    },
    onError: (err) => {
      setConfirmId(null);
      setError(err instanceof ApiError ? err.message : "삭제에 실패했어요");
    },
  });

  const rows = listQuery.data?.uploads ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-3.5">
        <CardTitle className="text-sm">업로드 내역</CardTitle>
        <span className="text-xs text-axis-text-tertiary">최근 {rows.length}건</span>
      </CardHeader>
      <CardContent className="p-0">
        {notice && <p className="px-4 pt-3 text-xs font-medium text-axis-text-info">{notice}</p>}
        {error && <p className="px-4 pt-3 text-xs font-medium text-axis-text-error">{error}</p>}
        {listQuery.isLoading && <p className="p-6 text-sm text-axis-text-tertiary">불러오는 중...</p>}
        {listQuery.isError && (
          <p className="p-6 text-sm text-axis-text-error">
            {listQuery.error instanceof ApiError ? listQuery.error.message : "업로드 내역을 불러오지 못했어요"}
          </p>
        )}
        {!listQuery.isLoading && !listQuery.isError && rows.length === 0 && (
          <p className="p-6 text-sm text-axis-text-tertiary">업로드 내역이 없어요.</p>
        )}
        {rows.map((u) => (
          <div key={u.id} className="flex items-center gap-3 border-b border-axis-border-default px-4 py-2.5 last:border-b-0">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{u.insurerName ?? u.insurerId}</span>
                <span className="shrink-0 text-xs text-axis-text-tertiary">{u.settlementMonth}</span>
                {u.docType === "incentive" && (
                  <span className="shrink-0 rounded bg-axis-surface-info px-1.5 py-0.5 text-[10px] font-semibold text-axis-text-brand">시책</span>
                )}
                <StatusBadge status={u.status} />
              </div>
              <span className="text-xs text-axis-text-tertiary">
                행 {formatNumber(u.rowCount ?? 0)} · 정상 {formatNumber(u.okCount ?? 0)} · 오류 {formatNumber(u.errorCount ?? 0)}
              </span>
            </div>
            {confirmId === u.id ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-xs text-axis-text-error">원장·정산라인 포함 삭제</span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(u.id)}
                >
                  {deleteMutation.isPending ? "삭제 중..." : "삭제 확인"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                  취소
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="shrink-0"
                aria-label="업로드 삭제"
                onClick={() => {
                  setConfirmId(u.id);
                  setNotice(null);
                  setError(null);
                }}
              >
                <Trash2 className="size-4 text-axis-text-error" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
