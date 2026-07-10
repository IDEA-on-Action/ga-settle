import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { incentivePlanDefinitions, insurers } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb, writeAudit } from "../db";
import { authUser } from "../auth";
import { pageParams } from "../pagination";

// 시상정의 카탈로그 조회 (F-044). 원수사가 준 시상 정의 원형(무손실).
// incentive_rules(정산 엔진)와 분리 - 정의는 참조/후보. /api/* 인증 게이트 뒤.
export const incentivePlanDefinitionsRoutes = new Hono<{ Bindings: Env }>();

// GET /api/incentive-plan-definitions?insurerId=&month=&q=&limit=&offset=
incentivePlanDefinitionsRoutes.get("/api/incentive-plan-definitions", async (c) => {
  const { q, limit, offset } = pageParams(c);
  const sp = new URL(c.req.url).searchParams;
  const insurerId = (sp.get("insurerId") ?? "").trim();
  const month = (sp.get("month") ?? "").trim(); // 기준월 YYYYMM
  const db = getDb(c.env);

  const conds = [];
  if (insurerId) conds.push(eq(incentivePlanDefinitions.insurerId, insurerId));
  if (month) conds.push(eq(incentivePlanDefinitions.baseMonth, month));
  if (q)
    conds.push(
      or(
        like(incentivePlanDefinitions.product, `%${q}%`),
        like(incentivePlanDefinitions.payTiming, `%${q}%`),
        like(incentivePlanDefinitions.payTerm, `%${q}%`),
        like(insurers.name, `%${q}%`),
      ),
    );
  const where = conds.length ? and(...conds) : undefined;

  const items = await db
    .select({
      id: incentivePlanDefinitions.id,
      insurerId: incentivePlanDefinitions.insurerId,
      insurerName: insurers.name,
      baseMonth: incentivePlanDefinitions.baseMonth,
      lineType: incentivePlanDefinitions.lineType,
      product: incentivePlanDefinitions.product,
      payTerm: incentivePlanDefinitions.payTerm,
      payTiming: incentivePlanDefinitions.payTiming,
      channel: incentivePlanDefinitions.channel,
      branch: incentivePlanDefinitions.branch,
      rateType: incentivePlanDefinitions.rateType,
      rateValue: incentivePlanDefinitions.rateValue,
      note: incentivePlanDefinitions.note,
      sourceType: incentivePlanDefinitions.sourceType,
    })
    .from(incentivePlanDefinitions)
    .leftJoin(insurers, eq(incentivePlanDefinitions.insurerId, insurers.id))
    .where(where)
    .orderBy(desc(incentivePlanDefinitions.baseMonth), incentivePlanDefinitions.insurerId)
    .limit(limit)
    .offset(offset);

  const cnt = await db
    .select({ n: sql<number>`count(*)` })
    .from(incentivePlanDefinitions)
    .leftJoin(insurers, eq(incentivePlanDefinitions.insurerId, insurers.id))
    .where(where);

  return c.json({ items, total: Number(cnt[0]?.n ?? 0) });
});

// POST /api/incentive-plan-definitions - 담당자가 확정한 시상정의 행 저장 (F-044, OCR→정의 결선).
// 도메인 불변식 #3: OCR(AI)은 후보만 - 이 write는 담당자 확정(HITL). planImageKey로 원본 이미지 역추적.
const rowSchema = z.object({
  lineType: z.string().optional(),
  product: z.string().min(1),
  payTerm: z.string().optional(),
  payTiming: z.string().optional(),
  channel: z.string().optional(),
  branch: z.string().optional(),
  cond1: z.string().optional(),
  cond2: z.string().optional(),
  cond3: z.string().optional(),
  rateType: z.enum(["rate", "fixed"]),
  rateValue: z.number(),
  note: z.string().optional(),
});
const writeSchema = z.object({
  insurerId: z.string().min(1),
  baseMonth: z.string().regex(/^\d{6}$/, "기준월은 YYYYMM 6자리"),
  planImageKey: z.string().optional(), // OCR 단계 R2 키 (역추적). 없으면 수동 입력(manual)
  sourceRef: z.string().optional(),
  rows: z.array(rowSchema).min(1).max(200),
});

incentivePlanDefinitionsRoutes.post("/api/incentive-plan-definitions", async (c) => {
  const b = writeSchema.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "시상정의 검증 실패", detail: b.error.flatten() }, 400);
  const db = getDb(c.env);

  // 원수사 존재 확인(FK 위반 대신 명확한 400).
  const insurer = await db.select({ id: insurers.id }).from(insurers).where(eq(insurers.id, b.data.insurerId)).get();
  if (!insurer) return c.json({ error: `없는 원수사예요: ${b.data.insurerId}` }, 400);

  // 확정자(createdBy)는 클라이언트 입력이 아닌 인증 사용자(F-038, 감사 무결성).
  const requester = (await authUser(c.req.raw, db, c.env.SESSION_SECRET))?.email ?? "system";
  const sourceType = b.data.planImageKey ? "ocr" : "manual";
  const now = new Date().toISOString();
  const batch = crypto.randomUUID().slice(0, 8);

  const values = b.data.rows.map((r, i) => ({
    id: `def-${sourceType}-${batch}-${i + 1}`,
    insurerId: b.data.insurerId,
    baseMonth: b.data.baseMonth,
    lineType: r.lineType ?? null,
    product: r.product,
    payTerm: r.payTerm ?? null,
    payTiming: r.payTiming ?? null,
    channel: r.channel ?? null,
    branch: r.branch ?? null,
    cond1: r.cond1 ?? null,
    cond2: r.cond2 ?? null,
    cond3: r.cond3 ?? null,
    rateType: r.rateType,
    rateValue: r.rateValue,
    note: r.note ?? null,
    sourceType,
    sourceRef: b.data.sourceRef ?? null,
    planImageKey: b.data.planImageKey ?? null,
    createdBy: requester,
    createdAt: now,
  }));
  await db.insert(incentivePlanDefinitions).values(values);
  await writeAudit(db, {
    actor: requester,
    action: "incentive_plan_def.create",
    entity: "incentive_plan_definitions",
    entityId: b.data.planImageKey ?? b.data.insurerId,
    summary: { insurerId: b.data.insurerId, baseMonth: b.data.baseMonth, count: values.length, sourceType, planImageKey: b.data.planImageKey ?? null },
  });
  return c.json({ created: values.length, sourceType, ids: values.map((v) => v.id), planImageKey: b.data.planImageKey ?? null }, 201);
});

// GET /api/incentive-plan-definitions/summary - 원수사·기준월별 건수 집계
incentivePlanDefinitionsRoutes.get("/api/incentive-plan-definitions/summary", async (c) => {
  const db = getDb(c.env);
  const byMonth = await db
    .select({ baseMonth: incentivePlanDefinitions.baseMonth, n: sql<number>`count(*)` })
    .from(incentivePlanDefinitions)
    .groupBy(incentivePlanDefinitions.baseMonth)
    .orderBy(desc(incentivePlanDefinitions.baseMonth));
  const total = byMonth.reduce((s, r) => s + Number(r.n), 0);
  return c.json({ total, byMonth: byMonth.map((r) => ({ baseMonth: r.baseMonth, count: Number(r.n) })) });
});
