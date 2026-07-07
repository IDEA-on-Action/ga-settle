import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { settlementRuns, settlementLines, commissionRecords } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb } from "../db";

// 통계/집계 (F-019 FR-24): 조직/원수사/기간별. 새 저장 없이 기존 원천에서 파생.
export const statsRoutes = new Hono<{ Bindings: Env }>();

const num = (v: string | null) => Number(v ?? 0) || 0;
function groupSum<T>(rows: T[], key: (r: T) => string, val: (r: T) => number) {
  const m = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? { total: 0, count: 0 };
    g.total += val(r); g.count += 1;
    m.set(k, g);
  }
  return m;
}

// 조직별 계산 지급액 (해당 월 run의 settlement_lines)
statsRoutes.get("/api/stats/by-org", async (c) => {
  const month = c.req.query("month");
  if (!month) return c.json({ error: "month(YYYY-MM) 쿼리 필요" }, 400);
  const db = getDb(c.env);
  const run = await db.select().from(settlementRuns).where(eq(settlementRuns.settlementMonth, month)).get();
  if (!run) return c.json({ month, byOrg: [] });
  const lines = await db.select().from(settlementLines).where(eq(settlementLines.runId, run.id)).all();
  const g = groupSum(lines, (l) => l.orgUnitId, (l) => num(l.amountEnc));
  return c.json({ month, byOrg: [...g.entries()].map(([orgUnitId, s]) => ({ orgUnitId, ...s })) });
});

// 원수사별 지급 총액 (해당 월 commission_records)
statsRoutes.get("/api/stats/by-insurer", async (c) => {
  const month = c.req.query("month");
  if (!month) return c.json({ error: "month(YYYY-MM) 쿼리 필요" }, 400);
  const crs = await getDb(c.env).select().from(commissionRecords).where(eq(commissionRecords.settlementMonth, month)).all();
  const g = groupSum(crs, (r) => r.insurerId, (r) => num(r.commissionEnc));
  return c.json({ month, byInsurer: [...g.entries()].map(([insurerId, s]) => ({ insurerId, ...s })) });
});

// 기간별(월별) 계산 지급 총액
statsRoutes.get("/api/stats/by-month", async (c) => {
  const db = getDb(c.env);
  const runs = await db.select().from(settlementRuns).all();
  const runMonth = new Map(runs.map((r) => [r.id, r.settlementMonth]));
  const lines = await db.select().from(settlementLines).all();
  const g = groupSum(lines, (l) => runMonth.get(l.runId) ?? "unknown", (l) => num(l.amountEnc));
  return c.json({ byMonth: [...g.entries()].map(([month, s]) => ({ month, ...s })).sort((a, b) => a.month.localeCompare(b.month)) });
});
