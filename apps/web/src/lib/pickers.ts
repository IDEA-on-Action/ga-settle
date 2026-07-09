import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";

/**
 * 선택기용 목록 조회 훅 (F-035~F-037).
 * 화면 간에 불투명 ID(insurerId/uploadId/runId)를 손으로 옮기지 않도록,
 * 목록 API를 드롭다운 데이터 소스로 캐시한다.
 */

export interface InsurerRow {
  id: string;
  name: string;
}

export interface UploadListRow {
  id: string;
  insurerId: string;
  insurerName: string | null;
  settlementMonth: string;
  status: string;
  rowCount: number | null;
  okCount: number | null;
  errorCount: number | null;
  createdAt: string;
}

export interface RunListRow {
  id: string;
  settlementMonth: string;
  status: string;
  closedAt: string | null;
}

export function useInsurers() {
  return useQuery({
    queryKey: ["insurers"],
    queryFn: () => apiFetch<{ insurers: InsurerRow[] }>("/api/insurers").then((r) => r.insurers),
    staleTime: 60_000,
  });
}

export function useUploadsList() {
  return useQuery({
    queryKey: ["uploads-list"],
    queryFn: () => apiFetch<{ uploads: UploadListRow[] }>("/api/uploads").then((r) => r.uploads),
    staleTime: 15_000,
  });
}

export function useRunsList() {
  return useQuery({
    queryKey: ["runs-list"],
    queryFn: () => apiFetch<{ runs: RunListRow[] }>("/api/runs").then((r) => r.runs),
    staleTime: 15_000,
  });
}

/** 선택기 라벨 헬퍼 - 사용자가 알아볼 수 있는 라벨(원수사/월/상태). */
export function uploadLabel(u: UploadListRow): string {
  return `${u.insurerName ?? u.insurerId} · ${u.settlementMonth} · ${u.status}`;
}

export function runLabel(r: RunListRow): string {
  return `${r.settlementMonth} · ${r.status}`;
}
