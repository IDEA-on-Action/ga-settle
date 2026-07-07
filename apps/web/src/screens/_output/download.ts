import { getStoredAuth } from "@/lib/auth-storage";

/**
 * CSV 등 비-JSON 응답 다운로드 헬퍼.
 * lib/api.ts의 apiFetch는 content-type이 application/json이 아니면 undefined를 반환하므로
 * (F-018 transfer-master는 text/csv) 별도 fetch로 Authorization 헤더만 재현해 사용한다.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const base = import.meta.env.VITE_API_BASE ?? "";
  const auth = getStoredAuth();
  const headers = new Headers();
  if (auth?.token) headers.set("Authorization", `Bearer ${auth.token}`);

  const res = await fetch(`${base}${path}`, { headers });
  if (!res.ok) throw new Error(`다운로드가 실패했어요 (${res.status})`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
