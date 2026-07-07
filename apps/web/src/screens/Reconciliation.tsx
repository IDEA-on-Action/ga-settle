import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function Reconciliation() {
  return (
    <PagePlaceholder
      title="대사 · 차액"
      description="대사 드릴다운(GET /api/runs/:id/reconciliation) · 병행 검증(GET /api/runs/:id/parallel-verify)"
    />
  );
}
