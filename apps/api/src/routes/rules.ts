import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { incentiveRules } from "@ga-settle/schema";
import { evaluate, type IncentiveRule, type CommissionInput } from "@ga-settle/rules";
import type { Env } from "../types";
import { getDb, type Db } from "../db";

// 시책 룰 CRUD (F-010 REQ-018). 평가기(@ga-settle/rules)는 순수함수라 여기선 저장/조회만.
export const rulesRoutes = new Hono<{ Bindings: Env }>();

type RuleRow = typeof incentiveRules.$inferSelect;
function toRule(row: RuleRow): IncentiveRule {
  const { condition, overlapPolicy } = JSON.parse(row.conditionJson) as Pick<IncentiveRule, "condition" | "overlapPolicy">;
  return { id: row.id, name: row.name, priority: row.priority, overlapPolicy, condition, action: JSON.parse(row.actionJson) };
}

// F-013 정산 배치가 활성 룰을 로드해 evaluate()에 넘긴다.
export async function loadRules(db: Db): Promise<IncentiveRule[]> {
  const rows = await db.select().from(incentiveRules).where(eq(incentiveRules.active, true)).all();
  return rows.map(toRule);
}

const conditionSchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  insurerIds: z.array(z.string()).optional(),
  productPatterns: z.array(z.string()).optional(),
  orgUnitIds: z.array(z.string()).optional(),
  performanceBand: z.object({ minPremium: z.number().optional(), maxPremium: z.number().optional() }).optional(),
  excludeFamilyContracts: z.boolean().optional(),
});
const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rate"), rate: z.number() }),
  z.object({ kind: z.literal("fixed"), amount: z.number() }),
]);
const ruleInput = z.object({
  name: z.string().min(1),
  priority: z.number().int(),
  overlapPolicy: z.enum(["exclusive", "stack"]),
  condition: conditionSchema,
  action: actionSchema,
});

rulesRoutes.post("/api/rules", async (c) => {
  const b = ruleInput.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "룰 검증 실패", detail: b.error.flatten() }, 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb(c.env).insert(incentiveRules).values({
    id, name: b.data.name, priority: b.data.priority,
    conditionJson: JSON.stringify({ condition: b.data.condition, overlapPolicy: b.data.overlapPolicy }),
    actionJson: JSON.stringify(b.data.action),
    validFrom: now, active: true, createdBy: "system", createdAt: now,
  });
  return c.json({ id, ...b.data }, 201);
});

rulesRoutes.get("/api/rules", async (c) => c.json(await loadRules(getDb(c.env))));

// 룰 시뮬레이션 (F-012 REQ-021): 현재 룰 vs 제안 룰로 evaluate 실행해 지급액 diff 미리보기.
// evaluate는 순수함수라 DB에 아무것도 쓰지 않는다 -> 실데이터 무영향(FR-15).
const simSchema = z.object({
  records: z.array(z.object({
    recordId: z.string(), insurerId: z.string(), productName: z.string(), orgUnitId: z.string(),
    agentId: z.string(), contractDate: z.string(), premium: z.number(), isFamilyContract: z.boolean(),
  })).min(1),
  proposedRules: z.array(z.object({
    id: z.string(), name: z.string(), priority: z.number().int(),
    overlapPolicy: z.enum(["exclusive", "stack"]), condition: conditionSchema, action: actionSchema,
  })),
});

rulesRoutes.post("/api/rules/simulate", async (c) => {
  const b = simSchema.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "시뮬레이션 입력 검증 실패", detail: b.error.flatten() }, 400);
  const records = b.data.records as CommissionInput[];
  const current = await loadRules(getDb(c.env));

  const totalBy = (rules: IncentiveRule[]) => {
    const per: Record<string, number> = {};
    for (const l of evaluate(records, rules)) per[l.recordId] = (per[l.recordId] ?? 0) + l.amount;
    return per;
  };
  const cur = totalBy(current);
  const prop = totalBy(b.data.proposedRules as IncentiveRule[]);
  const byRecord = records.map((r) => ({
    recordId: r.recordId, current: cur[r.recordId] ?? 0, proposed: prop[r.recordId] ?? 0,
    diff: (prop[r.recordId] ?? 0) - (cur[r.recordId] ?? 0),
  }));
  const totalCurrent = byRecord.reduce((s, r) => s + r.current, 0);
  const totalProposed = byRecord.reduce((s, r) => s + r.proposed, 0);
  return c.json({ totalCurrent, totalProposed, totalDiff: totalProposed - totalCurrent, byRecord });
});

rulesRoutes.delete("/api/rules/:id", async (c) => {
  const db = getDb(c.env);
  const res = await db.update(incentiveRules).set({ active: false, validTo: new Date().toISOString() })
    .where(and(eq(incentiveRules.id, c.req.param("id")), eq(incentiveRules.active, true)));
  return res.meta.changes === 0 ? c.json({ error: "없는 룰이에요" }, 404) : c.json({ id: c.req.param("id"), active: false });
});
