import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function Family() {
  return (
    <PagePlaceholder
      title="가족계약 HITL"
      description="후보 감지/확정/해제(POST /api/family/detect, /:id/confirm, /:id/release) · 목록(GET /api/family)"
    />
  );
}
