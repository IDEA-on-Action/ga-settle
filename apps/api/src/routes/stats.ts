import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { settlementRuns, settlementLines, commissionRecords } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb, decNum } from "../db";

// 통계/집계 (F-019 FR-24): 조직/원수사/기간별. 새 저장 없이 기존 원천에서 파생.
// 금액은 AES-GCM 암호화(F-020)라 복호화 후 집계.
export const statsRoutes = new Hono<{ Bindings: Env }>();

async function aggregate<T>(rows: T[], keyFn: (r: T) => string, encFn: (r: T) => string | null, secret: string) {
  const pairs = await Promise.all(rows.map(async (r) => ({ k: keyFn(r), v: await decNum(encFn(r), secret) })));
  const m = new Map<string, { total: number; count: number }>();
  for (const p of pairs) {
    const g = m.get(p.k) ?? { total: 0, count: 0 };
    g.total += p.v; g.count += 1;
    m.set(p.k, g);
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
  const g = await aggregate(lines, (l) => l.orgUnitId, (l) => l.amountEnc, c.env.FIELD_ENCRYPTION_KEY);
  return c.json({ month, byOrg: [...g.entries()].map(([orgUnitId, s]) => ({ orgUnitId, ...s })) });
});

// 원수사별 지급 총액 (해당 월 commission_records)
statsRoutes.get("/api/stats/by-insurer", async (c) => {
  const month = c.req.query("month");
  if (!month) return c.json({ error: "month(YYYY-MM) 쿼리 필요" }, 400);
  const crs = await getDb(c.env).select().from(commissionRecords).where(eq(commissionRecords.settlementMonth, month)).all();
  const g = await aggregate(crs, (r) => r.insurerId, (r) => r.commissionEnc, c.env.FIELD_ENCRYPTION_KEY);
  return c.json({ month, byInsurer: [...g.entries()].map(([insurerId, s]) => ({ insurerId, ...s })) });
});

// 기간별(월별) 계산 지급 총액
statsRoutes.get("/api/stats/by-month", async (c) => {
  const db = getDb(c.env);
  const runs = await db.select().from(settlementRuns).all();
  const runMonth = new Map(runs.map((r) => [r.id, r.settlementMonth]));
  const lines = await db.select().from(settlementLines).all();
  const g = await aggregate(lines, (l) => runMonth.get(l.runId) ?? "unknown", (l) => l.amountEnc, c.env.FIELD_ENCRYPTION_KEY);
  return c.json({ byMonth: [...g.entries()].map(([month, s]) => ({ month, ...s })).sort((a, b) => a.month.localeCompare(b.month)) });
});
