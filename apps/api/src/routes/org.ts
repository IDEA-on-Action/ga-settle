import { Hono } from "hono";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { orgUnits, agents, agentAssignments } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb, type Db } from "../db";

// 조직도(본부>사업단>팀) + 설계사 + 시점별 소속 이력 (F-009, FR-09~11).
export const orgRoutes = new Hono<{ Bindings: Env }>();

/**
 * 당월 소속 해석 (FR-11): date 시점에 유효한 배정의 org_unit.
 * [validFrom, validTo) 구간 -> 소속 이동 후 이전 월 재계산 시 그 시점의 이전 소속 반환.
 */
export async function resolveAssignment(db: Db, agentId: string, dateISO: string): Promise<string | null> {
  const rows = await db.select().from(agentAssignments).where(eq(agentAssignments.agentId, agentId)).all();
  const active = rows
    .filter((a) => a.validFrom <= dateISO && (a.validTo == null || dateISO < a.validTo))
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  return active[0]?.orgUnitId ?? null;
}

const unitSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  kind: z.enum(["headquarters", "division", "team"]),
  parentId: z.string().nullable().optional(),
});

orgRoutes.post("/api/org/units", async (c) => {
  const b = unitSchema.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "org unit 검증 실패", detail: b.error.flatten().fieldErrors }, 400);
  const id = b.data.id ?? crypto.randomUUID();
  await getDb(c.env).insert(orgUnits).values({
    id, name: b.data.name, kind: b.data.kind, parentId: b.data.parentId ?? null, createdAt: new Date().toISOString(),
  });
  return c.json({ id, ...b.data }, 201);
});

// 조직 트리 (parentId로 중첩)
orgRoutes.get("/api/org/tree", async (c) => {
  const rows = await getDb(c.env).select().from(orgUnits).all();
  type Node = { id: string; name: string; kind: string; children: Node[] };
  const byId = new Map<string, Node>(rows.map((r) => [r.id, { id: r.id, name: r.name, kind: r.kind, children: [] }]));
  const roots: Node[] = [];
  for (const r of rows) {
    const node = byId.get(r.id)!;
    if (r.parentId && byId.has(r.parentId)) byId.get(r.parentId)!.children.push(node);
    else roots.push(node);
  }
  return c.json(roots);
});

orgRoutes.post("/api/agents", async (c) => {
  const b = z.object({ id: z.string().optional(), code: z.string().min(1), name: z.string().min(1) })
    .safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "agent 검증 실패" }, 400);
  const id = b.data.id ?? crypto.randomUUID();
  await getDb(c.env).insert(agents).values({ id, code: b.data.code, name: b.data.name, status: "active", createdAt: new Date().toISOString() });
  return c.json({ id, code: b.data.code, name: b.data.name }, 201);
});

// 소속 배정 (소속 이동): 기존 열린 배정(validTo null)을 validFrom으로 닫고 새 배정 오픈.
orgRoutes.post("/api/agents/:id/assignments", async (c) => {
  const agentId = c.req.param("id");
  const b = z.object({ orgUnitId: z.string().min(1), validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "assignment 검증 실패(orgUnitId, validFrom YYYY-MM-DD)" }, 400);
  const db = getDb(c.env);
  const ag = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId)).get();
  if (!ag) return c.json({ error: "없는 설계사예요" }, 404);

  await db.update(agentAssignments).set({ validTo: b.data.validFrom })
    .where(and(eq(agentAssignments.agentId, agentId), isNull(agentAssignments.validTo)));
  const id = crypto.randomUUID();
  await db.insert(agentAssignments).values({ id, agentId, orgUnitId: b.data.orgUnitId, validFrom: b.data.validFrom, validTo: null });
  return c.json({ id, agentId, orgUnitId: b.data.orgUnitId, validFrom: b.data.validFrom }, 201);
});

// 특정 시점(월) 소속 조회
orgRoutes.get("/api/agents/:id/org", async (c) => {
  const date = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
  const orgUnitId = await resolveAssignment(getDb(c.env), c.req.param("id"), date);
  return orgUnitId ? c.json({ agentId: c.req.param("id"), date, orgUnitId }) : c.json({ error: "해당 시점 소속 없음", date }, 404);
});

// ERP 일괄 등록 (FR-10): 설계사 + 소속 배정 일괄. (xlsx는 sheetToGrid로 파싱해 이 형태로 투입)
orgRoutes.post("/api/erp/agents", async (c) => {
  const b = z.object({
    agents: z.array(z.object({
      code: z.string().min(1), name: z.string().min(1), orgUnitId: z.string().min(1),
      validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })).min(1),
  }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "ERP 일괄 등록 검증 실패" }, 400);

  const db = getDb(c.env);
  const now = new Date().toISOString();
  let registered = 0;
  for (const a of b.data.agents) {
    const agentId = crypto.randomUUID();
    await db.batch([
      db.insert(agents).values({ id: agentId, code: a.code, name: a.name, status: "active", createdAt: now }),
      db.insert(agentAssignments).values({ id: crypto.randomUUID(), agentId, orgUnitId: a.orgUnitId, validFrom: a.validFrom, validTo: null }),
    ]);
    registered++;
  }
  return c.json({ registered }, 201);
});
