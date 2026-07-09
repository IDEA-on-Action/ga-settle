import { Hono } from "hono";
import { z } from "zod";
import { asc, eq, like, or, sql } from "drizzle-orm";
import { insurers, uploads, commissionRecords, templateVersions } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb, writeAudit } from "../db";
import { authUser } from "../auth";
import { pageParams } from "../pagination";

// 원수사(보험사) 마스터 CRUD (F-026). 업로드가 insurerId 선행 등록을 요구 - 이 라우트로 등록.
// 조회/변경 참조: mapping.ts GET /api/insurers/:id/templates (버전 이력).
export const insurersRoutes = new Hono<{ Bindings: Env }>();

const actorOf = async (c: { req: { raw: Request }; env: Env }, db: ReturnType<typeof getDb>) =>
  (await authUser(c.req.raw, db, c.env.SESSION_SECRET))?.id ?? "system";

// 생성: id는 커스텀 코드 허용(미지정 시 UUID), name 필수. 중복 id 409.
insurersRoutes.post("/api/insurers", async (c) => {
  const db = getDb(c.env);
  const b = z.object({ id: z.string().min(1).max(64).optional(), name: z.string().min(1) })
    .safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "원수사 검증 실패 (name 필수)" }, 400);
  const id = b.data.id ?? crypto.randomUUID();
  const dup = await db.select({ id: insurers.id }).from(insurers).where(eq(insurers.id, id)).get();
  if (dup) return c.json({ error: "이미 있는 원수사 id예요", id }, 409);
  await db.insert(insurers).values({ id, name: b.data.name, createdAt: new Date().toISOString() });
  await writeAudit(db, { actor: await actorOf(c, db), action: "insurer.create", entity: "insurers", entityId: id, summary: { name: b.data.name } });
  return c.json({ id, name: b.data.name }, 201);
});

// 목록. F-042: ?q(이름/id)·?limit·?offset + total (선택기 검색).
insurersRoutes.get("/api/insurers", async (c) => {
  const { q, limit, offset } = pageParams(c);
  const db = getDb(c.env);
  const where = q ? or(like(insurers.name, `%${q}%`), like(insurers.id, `%${q}%`)) : undefined;
  const rows = await db.select().from(insurers).where(where).orderBy(asc(insurers.name)).limit(limit).offset(offset);
  const cnt = await db.select({ n: sql<number>`count(*)` }).from(insurers).where(where);
  return c.json({ insurers: rows, total: Number(cnt[0]?.n ?? 0) });
});

// 단건
insurersRoutes.get("/api/insurers/:id", async (c) => {
  const row = await getDb(c.env).select().from(insurers).where(eq(insurers.id, c.req.param("id"))).get();
  if (!row) return c.json({ error: "없는 원수사예요" }, 404);
  return c.json(row);
});

// 이름 수정
insurersRoutes.patch("/api/insurers/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const b = z.object({ name: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "원수사 검증 실패 (name 필수)" }, 400);
  const row = await db.select({ id: insurers.id }).from(insurers).where(eq(insurers.id, id)).get();
  if (!row) return c.json({ error: "없는 원수사예요" }, 404);
  await db.update(insurers).set({ name: b.data.name }).where(eq(insurers.id, id));
  await writeAudit(db, { actor: await actorOf(c, db), action: "insurer.update", entity: "insurers", entityId: id, summary: { name: b.data.name } });
  return c.json({ id, name: b.data.name });
});

// 삭제: 업로드/원장/템플릿 참조가 있으면 409 (역추적 불변식 + FK 보호). 참조 없을 때만 삭제.
insurersRoutes.delete("/api/insurers/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const row = await db.select({ id: insurers.id }).from(insurers).where(eq(insurers.id, id)).get();
  if (!row) return c.json({ error: "없는 원수사예요" }, 404);
  const refUpload = await db.select({ id: uploads.id }).from(uploads).where(eq(uploads.insurerId, id)).limit(1).get();
  const refRec = await db.select({ id: commissionRecords.id }).from(commissionRecords).where(eq(commissionRecords.insurerId, id)).limit(1).get();
  const refTpl = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.insurerId, id)).limit(1).get();
  if (refUpload || refRec || refTpl) return c.json({ error: "업로드/원장/템플릿이 있는 원수사는 삭제할 수 없어요", id }, 409);
  await db.delete(insurers).where(eq(insurers.id, id));
  await writeAudit(db, { actor: await actorOf(c, db), action: "insurer.delete", entity: "insurers", entityId: id });
  return c.json({ ok: true, id });
});
