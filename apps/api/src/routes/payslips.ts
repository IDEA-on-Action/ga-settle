import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { settlementRuns, settlementLines, payslips } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb, encField } from "../db";

// 지급 내역서 + 출력물 (F-018 FR-21~23): settlement_lines를 설계사별로 롤업.
// SECURITY(F-017 auth 롤아웃): payslips/transfer-master는 급여·이체 데이터라 민감.
//   현재 프로젝트 전반 미인증(신뢰 네트워크 전제). 전면 인증 롤아웃은 B-005(backlog) 우선순위.
export const payslipsRoutes = new Hono<{ Bindings: Env }>();

// CSV 필드 안전화: 수식 인젝션 방지(위험 선두문자 ' 프리픽스) + CSV 이스케이프.
export function csvField(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// 내역서 생성: settlement_lines를 설계사별 집계 -> payslips (멱등 재생성).
payslipsRoutes.post("/api/runs/:id/payslips", async (c) => {
  const db = getDb(c.env);
  const run = await db.select().from(settlementRuns).where(eq(settlementRuns.id, c.req.param("id"))).get();
  if (!run) return c.json({ error: "없는 run이에요" }, 404);

  const lines = await db.select().from(settlementLines).where(eq(settlementLines.runId, run.id)).all();
  const byAgent = new Map<string, { orgUnitId: string; total: number }>();
  for (const l of lines) {
    const agg = byAgent.get(l.agentId) ?? { orgUnitId: l.orgUnitId, total: 0 };
    agg.total += Number(l.amountEnc ?? 0) || 0;
    byAgent.set(l.agentId, agg);
  }

  const now = new Date().toISOString();
  const rows = [...byAgent.entries()].map(([agentId, a]) => ({
    id: crypto.randomUUID(), runId: run.id, agentId, orgUnitId: a.orgUnitId, totalEnc: encField(a.total)!, detailR2Key: null, createdAt: now,
  }));
  await db.delete(payslips).where(eq(payslips.runId, run.id));
  if (rows.length) await db.batch([db.insert(payslips).values(rows[0]!), ...rows.slice(1).map((r) => db.insert(payslips).values(r))]);
  return c.json({ runId: run.id, payslips: rows.length, totalAmount: [...byAgent.values()].reduce((s, a) => s + a.total, 0) }, 201);
});

// 내역서 목록 (설계사별 총액)
payslipsRoutes.get("/api/runs/:id/payslips", async (c) => {
  const rows = await getDb(c.env).select().from(payslips).where(eq(payslips.runId, c.req.param("id"))).all();
  return c.json(rows.map((r) => ({ agentId: r.agentId, orgUnitId: r.orgUnitId, total: Number(r.totalEnc ?? 0) || 0 })));
});

// 설계사별 지급 내역서 (팀장용): 총액 + 라인 상세(룰별 산출 분해)
payslipsRoutes.get("/api/runs/:id/payslips/:agentId", async (c) => {
  const db = getDb(c.env);
  const runId = c.req.param("id");
  const agentId = c.req.param("agentId");
  const slip = await db.select().from(payslips).where(and(eq(payslips.runId, runId), eq(payslips.agentId, agentId))).get();
  if (!slip) return c.json({ error: "해당 설계사 내역서가 없어요" }, 404);
  const lines = await db.select().from(settlementLines).where(and(eq(settlementLines.runId, runId), eq(settlementLines.agentId, agentId))).all();
  return c.json({
    agentId, orgUnitId: slip.orgUnitId, total: Number(slip.totalEnc ?? 0) || 0,
    lines: lines.map((l) => ({ commissionRecordId: l.commissionRecordId, ruleId: l.ruleId, amount: Number(l.amountEnc ?? 0) || 0, basis: l.breakdownJson })),
  });
});

// 급여 이체 마스터 파일 (CSV): agentId, orgUnitId, amount
payslipsRoutes.get("/api/runs/:id/transfer-master", async (c) => {
  const rows = await getDb(c.env).select().from(payslips).where(eq(payslips.runId, c.req.param("id"))).all();
  const csv = ["agentId,orgUnitId,amount", ...rows.map((r) =>
    [csvField(r.agentId), csvField(r.orgUnitId), csvField(Number(r.totalEnc ?? 0) || 0)].join(","))].join("\n");
  return c.text(csv, 200, { "content-type": "text/csv; charset=utf-8" });
});
