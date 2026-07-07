import { Badge } from "@/components/ui/badge";

/**
 * 정산 파이프라인 화면(F-026) 공용 포맷터 + 소품.
 * screens/{Dashboard,Upload,MappingReview,MappingAdmin}.tsx가 공유한다.
 */

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(amount);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("ko-KR").format(n);
}

export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "-";
  return `${(ratio * 100).toFixed(2)}%`;
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** upload/job/run 상태 문자열 -> Badge variant 매핑 (axis 배지 토큰 재사용). */
const STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "info" | "secondary"> = {
  queued: "secondary",
  parsing: "info",
  running: "info",
  review: "warning",
  approved: "success",
  rejected: "error",
  done: "success",
  failed: "error",
  draft: "secondary",
  calculated: "info",
  reconciled: "info",
  adjusted: "info",
  closed: "success",
  matched: "success",
  diff: "error",
  resolved: "success",
  candidate: "warning",
  confirmed: "success",
  released: "secondary",
};

export function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANT[status] ?? "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

/** 값 기반 얇은 진행률 바 (radix progress 미설치 - div 폭 제어로 대체). */
export function ProgressBar({ ratio, colorClassName = "bg-axis-surface-brand" }: { ratio: number; colorClassName?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * 100;
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-axis-surface-secondary">
      <div className={`h-full rounded-full transition-[width] duration-300 ${colorClassName}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 파이프라인 5단계 스텝 상태. */
export type StepState = "done" | "active" | "error" | "pending";

export function StepDot({ state, index }: { state: StepState; index: number }) {
  const base = "flex size-[22px] flex-none items-center justify-center rounded-full text-[11px] font-bold";
  if (state === "done") {
    return (
      <div className={`${base} bg-axis-color-green-500 text-white`}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (state === "error") {
    return <div className={`${base} bg-axis-color-red-500 text-white`}>!</div>;
  }
  if (state === "active") {
    return <div className={`${base} bg-axis-surface-brand text-white`}>{index}</div>;
  }
  return <div className={`${base} bg-axis-surface-secondary text-axis-text-tertiary`}>{index}</div>;
}
