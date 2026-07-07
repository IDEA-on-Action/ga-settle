import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function MappingReview() {
  return (
    <PagePlaceholder
      title="AI 매핑 검토"
      description="컬럼 매핑 + 검증 카운트(GET /api/uploads/:id/mapping) · 오류 행 리포트(GET /api/uploads/:id/errors) · 승인(POST /api/uploads/:id/approve)"
    />
  );
}
