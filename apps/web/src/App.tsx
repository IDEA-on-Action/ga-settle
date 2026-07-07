import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export function App() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => fetch(`${API}/health`).then((r) => r.json()),
  });
  return (
    <main style={{ fontFamily: "sans-serif", padding: 24 }}>
      <h1>ga-settle</h1>
      <p>API: {health.isLoading ? "확인 중..." : JSON.stringify(health.data)}</p>
      {/* 화면 구현 순서 (SPEC.md): 업로드/매핑(F-003~008) -> 룰(F-010~012) -> 대사/마감(F-013~016) -> 권한(F-017) -> 출력(F-018~019) */}
    </main>
  );
}
