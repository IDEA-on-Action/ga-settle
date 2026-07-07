import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function MappingAdmin() {
  return (
    <PagePlaceholder
      title="매핑 관리"
      description="원수사 매핑 버전 이력(GET /api/insurers/:id/templates) · 매핑 확정(POST /api/uploads/:id/mapping/confirm)"
    />
  );
}
