import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function UploadScreen() {
  return (
    <PagePlaceholder
      title="업로드"
      description="엑셀 업로드(POST /api/uploads) · 파싱 진행률(GET /api/jobs/:id) · 업로드 상태(GET /api/uploads/:id)"
    />
  );
}
