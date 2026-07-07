import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-axis-badge-info-bg text-axis-badge-info-text",
  calculated: "bg-axis-badge-warning-bg text-axis-badge-warning-text",
  closed: "bg-axis-badge-success-bg text-axis-badge-success-text",
};

/** 정산 Run 상태(draft/calculated/closed) 배지 - Runs/Reconciliation 화면 공유. */
export function RunStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent font-semibold", STATUS_STYLE[status] ?? "bg-secondary text-secondary-foreground", className)}>
      {status}
    </Badge>
  );
}
