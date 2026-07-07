import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function Stats() {
  return (
    <PagePlaceholder
      title="통계"
      description="조직 · 원수사 · 기간별 집계(GET /api/stats/by-org, by-insurer, by-month)"
    />
  );
}
