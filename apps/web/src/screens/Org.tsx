import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function Org() {
  return (
    <PagePlaceholder
      title="조직 · 계정"
      description="조직도(POST /api/org/units, GET /api/org/tree) · 설계사/소속(POST /api/agents, /:id/assignments, GET /:id/org) · ERP 일괄등록(POST /api/erp/agents) · 계정(POST /api/users)"
    />
  );
}
