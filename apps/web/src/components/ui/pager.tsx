import { Button } from "@/components/ui/button";

/** 테이블 페이지네이션 컨트롤 (F-042). offset/limit/total 기반 이전/다음 + 범위·페이지 표시. */
export function Pager({
  offset,
  limit,
  total,
  onOffset,
}: {
  offset: number;
  limit: number;
  total: number;
  onOffset: (offset: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pages, Math.floor(offset / limit) + 1);
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-axis-text-tertiary">
      <span>
        총 {total}건 {total > 0 && `· ${offset + 1}–${Math.min(offset + limit, total)}`}
      </span>
      <div className="flex items-center gap-2">
        <span>
          {page} / {pages}
        </span>
        <Button variant="outline" size="sm" disabled={offset <= 0} onClick={() => onOffset(Math.max(0, offset - limit))}>
          이전
        </Button>
        <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => onOffset(offset + limit)}>
          다음
        </Button>
      </div>
    </div>
  );
}
