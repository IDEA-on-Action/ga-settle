import type { Context } from "hono";

// 목록 페이지네이션/검색 파라미터 (F-042). ?q 검색, ?limit(1~200, 기본 50), ?offset(기본 0).
export function pageParams(c: Context): { q: string; limit: number; offset: number } {
  const sp = new URL(c.req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const rawLimit = Number(sp.get("limit"));
  const rawOffset = Number(sp.get("offset"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { q, limit, offset };
}
