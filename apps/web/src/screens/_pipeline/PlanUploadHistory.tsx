import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PlanRow {
  id: string;
  insurerId: string | null;
  insurerName: string | null;
  settlementMonth: string | null;
  fileName: string;
  sha256: string;
  ocrStatus: string;
  ocrAvgConfidence: number | null;
  ocrFieldCount: number | null;
  lowConfidenceCount: number | null;
  createdBy: string;
  createdAt: string;
}
interface PlanList {
  items: PlanRow[];
  total: number;
}

// OCR 상태별 배지 (F-048). pending=처리중, ok=정상, low_confidence=확인필요, failed=실패.
const OCR_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "처리중", cls: "bg-axis-surface-secondary text-axis-text-tertiary" },
  ok: { label: "정상", cls: "bg-axis-surface-success text-axis-text-success" },
  low_confidence: { label: "확인필요", cls: "bg-axis-surface-warning text-axis-text-warning" },
  failed: { label: "OCR 실패", cls: "bg-axis-surface-error text-axis-text-error" },
};

function OcrBadge({ status }: { status: string }) {
  const b = OCR_BADGE[status] ?? { label: status, cls: "bg-axis-surface-secondary text-axis-text-tertiary" };
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`}>{b.label}</span>;
}

/**
 * 시책안 등록 대장 목록 (F-048).
 * GET /api/incentive-plans - 업로드된 시책안 파일의 영속 레코드(누가·언제·무엇을·OCR결과).
 * 업로드 화면 '시책안 문서(OCR)' 탭 하단 섹션. 엑셀 UploadHistory 대칭.
 */
export function PlanUploadHistory() {
  const listQuery = useQuery({
    queryKey: ["incentive-plans"],
    queryFn: () => apiFetch<PlanList>("/api/incentive-plans?limit=20"),
  });

  const rows = listQuery.data?.items ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-3.5">
        <CardTitle className="text-sm">시책안 등록 내역</CardTitle>
        <span className="text-xs text-axis-text-tertiary">최근 {rows.length}건{listQuery.data ? ` · 총 ${listQuery.data.total}건` : ""}</span>
      </CardHeader>
      <CardContent className="p-0">
        {listQuery.isLoading && <p className="p-6 text-sm text-axis-text-tertiary">불러오는 중...</p>}
        {listQuery.isError && (
          <p className="p-6 text-sm text-axis-text-error">
            {listQuery.error instanceof ApiError ? listQuery.error.message : "시책안 등록 내역을 불러오지 못했어요"}
          </p>
        )}
        {!listQuery.isLoading && !listQuery.isError && rows.length === 0 && (
          <p className="p-6 text-sm text-axis-text-tertiary">등록된 시책안이 없어요. 위에서 PDF·이미지를 업로드하면 여기에 대장으로 기록돼요.</p>
        )}
        {rows.map((p) => (
          <div key={p.id} className="flex items-center gap-3 border-b border-axis-border-default px-4 py-2.5 last:border-b-0">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{p.fileName}</span>
                <OcrBadge status={p.ocrStatus} />
              </div>
              <span className="text-xs text-axis-text-tertiary">
                {p.insurerName ?? "원수사 미지정"} · {p.settlementMonth ?? "월 미지정"}
                {p.ocrAvgConfidence != null && ` · 신뢰도 ${(p.ocrAvgConfidence * 100).toFixed(1)}%`}
                {p.ocrFieldCount != null && ` · ${p.ocrFieldCount}필드`}
                {p.lowConfidenceCount ? ` · 저신뢰 ${p.lowConfidenceCount}` : ""}
              </span>
            </div>
            <span className="shrink-0 text-xs text-axis-text-tertiary">{p.createdAt.slice(0, 10)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
