import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

type TemplateVersion = {
  id: string;
  version: number;
  headerSignature: string;
  columnMap: Record<string, number>;
  validFrom: string;
  validTo: string | null;
};

// F-007 매핑 관리 화면: 원수사별 확정 매핑(TemplateVersion) 버전 이력.
// 재업로드 시 L0 시그니처 캐시로 재사용되는 확정본을 관리자가 확인한다.
export function MappingAdmin() {
  const [insurerId, setInsurerId] = useState("");
  const q = useQuery({
    queryKey: ["templates", insurerId],
    enabled: insurerId.length > 0,
    queryFn: (): Promise<TemplateVersion[]> =>
      fetch(`${API}/api/insurers/${encodeURIComponent(insurerId)}/templates`).then((r) => r.json()),
  });

  return (
    <section style={{ marginTop: 24 }}>
      <h2>매핑 관리 (TemplateVersion)</h2>
      <input
        placeholder="원수사 ID"
        value={insurerId}
        onChange={(e) => setInsurerId(e.target.value)}
        style={{ padding: 6 }}
      />
      {q.isLoading && <p>불러오는 중...</p>}
      {q.data?.length === 0 && <p>확정된 매핑 버전이 없어요.</p>}
      <ul>
        {q.data?.map((t) => (
          <li key={t.id}>
            <strong>v{t.version}</strong> · 필드 {Object.keys(t.columnMap).length}개 ·{" "}
            <code>{t.headerSignature.slice(0, 20)}…</code> · {t.validFrom.slice(0, 10)}
            {t.validTo ? " (만료)" : " (활성)"}
          </li>
        ))}
      </ul>
    </section>
  );
}
