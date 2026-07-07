import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function Runs() {
  return (
    <PagePlaceholder
      title="정산 Run"
      description="Run 생성/계산/조회(POST /api/runs, /:id/calculate, GET /:id) · 수동 보정(POST/GET /:id/adjustments) · 마감(POST /:id/close)"
    />
  );
}
