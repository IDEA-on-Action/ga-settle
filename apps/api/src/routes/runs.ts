import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { settlementRuns, settlementLines, commissionRecords, familyFlags } from "@ga-settle/schema";
import { evaluate, type CommissionInput } from "@ga-settle/rules";
import type { Env } from "../types";
import { getDb, encField } from "../db";
import { resolveAssignment } from "./org";
import { loadRules } from "./rules";

// 정산/대사/마감 (F-013 실행, F-014 대사, F-016 마감 이중 잠금).
export const runsRoutes = new Hono<{ Bindings: Env }>();

// 월 정산 run 생성 (draft). 월당 1개(uq_run_month).
runsRoutes.post("/api/runs", async (c) => {
  const b = z.object({ settlementMonth: z.string().regex(/^\d{4}-\d{2}$/) }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "settlementMonth(YYYY-MM) 필요" }, 400);
  const db = getDb(c.env);
  const dup = await db.select({ id: settlementRuns.id }).from(settlementRuns).where(eq(settlementRuns.settlementMonth, b.data.settlementMonth)).get();
  if (dup) return c.json({ error: "해당 월 run이 이미 있어요", runId: dup.id }, 409);
  const id = crypto.randomUUID();
  await db.insert(settlementRuns).values({ id, settlementMonth: b.data.settlementMonth, status: "draft" });
  return c.json({ id, settlementMonth: b.data.settlementMonth, status: "draft" }, 201);
});

/**
 * 정산 계산 (F-013 REQ-022): 당월 commission_records -> CommissionInput(당월 소속 resolveAssignment,
 * 가족여부 family_flags confirmed) -> 시책 룰 evaluate -> settlement_lines(룰별 산출 분해).
 * 재현성(FR): 기존 라인 삭제 후 재생성 -> 동일 입력 = 동일 출력. draft/calculated에서만(마감 후 금지).
 */
runsRoutes.post("/api/runs/:id/calculate", async (c) => {
  const db = getDb(c.env);
  const run = await db.select().from(settlementRuns).where(eq(settlementRuns.id, c.req.param("id"))).get();
  if (!run) return c.json({ error: "없는 run이에요" }, 404);
  if (run.status === "closed") return c.json({ error: "마감된 run은 재계산 불가", status: run.status }, 409);

  const crs = await db.select().from(commissionRecords).where(eq(commissionRecords.settlementMonth, run.settlementMonth)).all();
  const confirmedFam = new Set(
    (await db.select({ contractNo: familyFlags.contractNo }).from(familyFlags).where(eq(familyFlags.status, "confirmed")).all()).map((f) => f.contractNo),
  );

  const meta = new Map<string, { agentId: string; orgUnitId: string }>();
  const inputs: CommissionInput[] = [];
  for (const cr of crs) {
    if (!cr.agentId) continue; // 설계사 미상 -> 귀속 불가
    const orgUnitId = await resolveAssignment(db, cr.agentId, `${run.settlementMonth}-15`); // 당월 소속
    if (!orgUnitId) continue;
    inputs.push({
      recordId: cr.id, insurerId: cr.insurerId, productName: cr.productName ?? "", orgUnitId,
      agentId: cr.agentId, contractDate: cr.contractDate ?? `${run.settlementMonth}-01`,
      premium: Number(cr.premiumEnc ?? 0) || 0, isFamilyContract: confirmedFam.has(cr.contractNo),
    });
    meta.set(cr.id, { agentId: cr.agentId, orgUnitId });
  }

  const rules = await loadRules(db);
  const lines = evaluate(inputs, rules); // 순수·결정적
  const now = new Date().toISOString();
  const rows = lines.map((l) => {
    const m = meta.get(l.recordId)!;
    return {
      id: crypto.randomUUID(), runId: run.id, commissionRecordId: l.recordId, ruleId: l.ruleId,
      agentId: m.agentId, orgUnitId: m.orgUnitId, amountEnc: encField(l.amount)!, breakdownJson: l.basis, createdAt: now,
    };
  });

  // 멱등 재계산: 기존 라인 제거 후 재삽입
  await db.delete(settlementLines).where(eq(settlementLines.runId, run.id));
  if (rows.length) await db.batch([db.insert(settlementLines).values(rows[0]!), ...rows.slice(1).map((r) => db.insert(settlementLines).values(r))]);
  await db.update(settlementRuns).set({ status: "calculated" }).where(eq(settlementRuns.id, run.id));

  return c.json({ runId: run.id, status: "calculated", lines: rows.length, totalAmount: lines.reduce((s, l) => s + l.amount, 0) });
});

runsRoutes.get("/api/runs/:id", async (c) => {
  const db = getDb(c.env);
  const run = await db.select().from(settlementRuns).where(eq(settlementRuns.id, c.req.param("id"))).get();
  if (!run) return c.json({ error: "없는 run이에요" }, 404);
  const lines = await db.select().from(settlementLines).where(eq(settlementLines.runId, run.id)).all();
  const totalAmount = lines.reduce((s, l) => s + (Number(l.amountEnc ?? 0) || 0), 0);
  return c.json({ ...run, lineCount: lines.length, totalAmount });
});

// F-014 대사 / F-016 마감 (후속)
runsRoutes.get("/api/runs/:id/reconciliation", async (c) => c.json({ todo: "F-014 대사" }, 501));
runsRoutes.post("/api/runs/:id/close", async (c) => c.json({ todo: "F-016 마감 이중 잠금" }, 501));
