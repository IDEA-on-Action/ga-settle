import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { familyFlags, agents } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb, encField } from "../db";
import { authUser } from "../auth";
import { findFamilyCandidates, type FamilyContract } from "../family";

// 가족계약 감지 HITL (F-011, FR-14). 자동은 candidate 생성까지만, 확정/해제는 실무자 수동.
export const familyRoutes = new Hono<{ Bindings: Env }>();

const detectSchema = z.object({
  contracts: z.array(z.object({
    contractNo: z.string().min(1), agentId: z.string().min(1),
    holderName: z.string().min(1), holderBirth: z.string().min(1),
  })).min(1),
});

// 감지: 후보(candidate)만 생성. confirmed로 가는 경로 없음.
familyRoutes.post("/api/family/detect", async (c) => {
  const b = detectSchema.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "contracts 검증 실패" }, 400);
  const db = getDb(c.env);
  const agentRows = await db.select({ id: agents.id, name: agents.name, birth: agents.birthDateEnc }).from(agents).all();
  const cands = findFamilyCandidates(b.data.contracts as FamilyContract[], agentRows);

  const now = new Date().toISOString();
  let created = 0;
  for (const cd of cands) {
    await db.insert(familyFlags).values({
      id: crypto.randomUUID(), contractNo: cd.contractNo, agentId: cd.agentId,
      matchedNameEnc: await encField(cd.matchedName, c.env.FIELD_ENCRYPTION_KEY), status: "candidate", confirmedBy: null, createdAt: now,
    });
    created++;
  }
  return c.json({ candidates: created }, 201); // 전부 candidate, confirmed 0
});

familyRoutes.get("/api/family", async (c) => {
  const status = c.req.query("status");
  const rows = await getDb(c.env).select().from(familyFlags).all();
  return c.json(status ? rows.filter((r) => r.status === status) : rows);
});

// 확정: 실무자만, candidate에서만. 자동 확정 불가.
// 확정자(confirmedBy)는 인증 사용자로 자동 기록(F-038) - 손입력 대신 로그인 사용자, 감사 무결성.
familyRoutes.post("/api/family/:id/confirm", async (c) => {
  const db = getDb(c.env);
  const confirmedBy = (await authUser(c.req.raw, db, c.env.SESSION_SECRET))?.email ?? "system";
  const flag = await db.select().from(familyFlags).where(eq(familyFlags.id, c.req.param("id"))).get();
  if (!flag) return c.json({ error: "없는 플래그예요" }, 404);
  if (flag.status !== "candidate") return c.json({ error: "candidate 상태에서만 확정해요", status: flag.status }, 409);
  await db.update(familyFlags).set({ status: "confirmed", confirmedBy }).where(eq(familyFlags.id, flag.id));
  return c.json({ id: flag.id, status: "confirmed", confirmedBy });
});

// 해제: 이력 보존(행 유지, status만 released).
familyRoutes.post("/api/family/:id/release", async (c) => {
  const db = getDb(c.env);
  const res = await db.update(familyFlags).set({ status: "released" }).where(eq(familyFlags.id, c.req.param("id")));
  return res.meta.changes === 0 ? c.json({ error: "없는 플래그예요" }, 404) : c.json({ id: c.req.param("id"), status: "released" });
});
