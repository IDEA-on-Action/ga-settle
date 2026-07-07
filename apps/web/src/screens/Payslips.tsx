import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function Payslips() {
  return (
    <PagePlaceholder
      title="지급 내역서"
      description="내역서 생성/조회(POST·GET /api/runs/:id/payslips, GET /:agentId) · 이체 마스터 CSV(GET /transfer-master)"
    />
  );
}
