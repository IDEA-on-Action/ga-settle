import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { incentiveRules } from "@ga-settle/schema";
import type { IncentiveRule } from "@ga-settle/rules";
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

const ruleInput = z.object({
  name: z.string().min(1),
  priority: z.number().int(),
  overlapPolicy: z.enum(["exclusive", "stack"]),
  condition: z.object({
    period: z.object({ from: z.string(), to: z.string() }),
    insurerIds: z.array(z.string()).optional(),
    productPatterns: z.array(z.string()).optional(),
    orgUnitIds: z.array(z.string()).optional(),
    performanceBand: z.object({ minPremium: z.number().optional(), maxPremium: z.number().optional() }).optional(),
    excludeFamilyContracts: z.boolean().optional(),
  }),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("rate"), rate: z.number() }),
    z.object({ kind: z.literal("fixed"), amount: z.number() }),
  ]),
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

rulesRoutes.delete("/api/rules/:id", async (c) => {
  const db = getDb(c.env);
  const res = await db.update(incentiveRules).set({ active: false, validTo: new Date().toISOString() })
    .where(and(eq(incentiveRules.id, c.req.param("id")), eq(incentiveRules.active, true)));
  return res.meta.changes === 0 ? c.json({ error: "없는 룰이에요" }, 404) : c.json({ id: c.req.param("id"), active: false });
});
