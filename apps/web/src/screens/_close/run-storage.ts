/**
 * Run 조회 이력 (브라우저 localStorage 전용, F-028).
 * GET /api/runs(목록) 엔드포인트가 없어 화면 간 runId 전달 + "최근 조회" 표시를
 * 이 로컬 저장소로 대체한다. lib/auth-storage.ts와는 별개 키를 사용.
 */

export interface RecentRun {
  runId: string;
  settlementMonth: string;
  touchedAt: string;
}

const KEY = "ga_settle_recent_runs";
const MAX_ENTRIES = 6;

export function getRecentRuns(): RecentRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is RecentRun =>
        !!x && typeof x === "object" && typeof (x as RecentRun).runId === "string" && typeof (x as RecentRun).settlementMonth === "string",
    );
  } catch {
    return [];
  }
}

export function touchRecentRun(runId: string, settlementMonth: string): void {
  if (typeof window === "undefined") return;
  const rest = getRecentRuns().filter((r) => r.runId !== runId);
  const next = [{ runId, settlementMonth, touchedAt: new Date().toISOString() }, ...rest].slice(0, MAX_ENTRIES);
  window.localStorage.setItem(KEY, JSON.stringify(next));
}

export function getLastRunId(): string | null {
  return getRecentRuns()[0]?.runId ?? null;
}
