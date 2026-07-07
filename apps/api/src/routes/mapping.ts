import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { templateVersions, uploads } from "@ga-settle/schema";
import { signatureOf } from "@ga-settle/mapping";
import type { Env } from "../types";
import { getDb, type Db } from "../db";

// 매핑 결과/확정 (F-005 L0~L4 조회, F-007 TemplateVersion + L0 시그니처 캐시).
export const mappingRoutes = new Hono<{ Bindings: Env }>();

/**
 * L0 캐시 조회 (F-007): 원수사 + 헤더 시그니처로 확정된 TemplateVersion을 찾는다.
 * 재업로드 시 F-008 파서가 이걸 먼저 조회해 적중하면 AI 매핑을 건너뛴다.
 */
export async function resolveTemplate(db: Db, insurerId: string, headers: string[]) {
  const sig = signatureOf(headers);
  const tv = await db.select().from(templateVersions)
    .where(and(eq(templateVersions.insurerId, insurerId), eq(templateVersions.headerSignature, sig)))
    .get();
  return tv
    ? { templateVersionId: tv.id, version: tv.version, columnMap: JSON.parse(tv.columnMapJson) as Record<string, number> }
    : null;
}

// 매핑 결과 조회 (F-008 파싱 후): 확정용 columnMap + 검증 카운트
mappingRoutes.get("/api/uploads/:id/mapping", async (c) => {
  const up = await getDb(c.env).select().from(uploads).where(eq(uploads.id, c.req.param("id"))).get();
  if (!up) return c.json({ error: "없는 업로드예요" }, 404);
  const stagedObj = await c.env.UPLOADS.get(`${up.r2Key}.staged.json`);
  if (!stagedObj) return c.json({ error: "아직 파싱 전이에요", status: up.status }, 409);
  const { columnMap } = JSON.parse(await stagedObj.text()) as { columnMap: Record<string, number> };
  return c.json({ columnMap, rowCount: up.rowCount, okCount: up.okCount, errorCount: up.errorCount, templateVersionId: up.templateVersionId });
});

// 매핑 확정 -> TemplateVersion 저장 (REQ-013). 같은 시그니처면 재사용(멱등),
// 다른 시그니처(양식 변경)면 새 버전 등록 (REQ-014, 개발자 개입 없음).
mappingRoutes.post("/api/uploads/:id/mapping/confirm", async (c) => {
  const body = await c.req.json<{ headers?: string[]; columnMap?: Record<string, number> }>().catch(() => null);
  if (!body?.headers?.length || !body.columnMap) return c.json({ error: "headers, columnMap가 필요해요" }, 400);

  const db = getDb(c.env);
  const up = await db.select().from(uploads).where(eq(uploads.id, c.req.param("id"))).get();
  if (!up) return c.json({ error: "없는 업로드예요" }, 404);

  const sig = signatureOf(body.headers);

  // 동일 시그니처 기존 버전이 있으면 재사용 (L0 캐시 적중)
  const existing = await db.select().from(templateVersions)
    .where(and(eq(templateVersions.insurerId, up.insurerId), eq(templateVersions.headerSignature, sig)))
    .get();
  if (existing) {
    await db.update(uploads).set({ templateVersionId: existing.id }).where(eq(uploads.id, up.id));
    return c.json({ templateVersionId: existing.id, version: existing.version, cached: true });
  }

  // 새 버전 = 해당 원수사 max(version)+1 (양식 변경 감지)
  const vers = await db.select({ v: templateVersions.version }).from(templateVersions)
    .where(eq(templateVersions.insurerId, up.insurerId)).all();
  const version = vers.reduce((m, r) => Math.max(m, r.v), 0) + 1;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(templateVersions).values({
    id, insurerId: up.insurerId, version, headerSignature: sig,
    columnMapJson: JSON.stringify(body.columnMap), validFrom: now,
  });
  await db.update(uploads).set({ templateVersionId: id }).where(eq(uploads.id, up.id));
  return c.json({ templateVersionId: id, version, cached: false }, 201);
});

// 원수사별 매핑 버전 이력 (매핑 관리 화면용)
mappingRoutes.get("/api/insurers/:id/templates", async (c) => {
  const rows = await getDb(c.env).select().from(templateVersions)
    .where(eq(templateVersions.insurerId, c.req.param("id"))).all();
  return c.json(
    rows
      .sort((a, b) => b.version - a.version)
      .map((r) => ({
        id: r.id, version: r.version, headerSignature: r.headerSignature,
        columnMap: JSON.parse(r.columnMapJson) as Record<string, number>,
        validFrom: r.validFrom, validTo: r.validTo,
      })),
  );
});
