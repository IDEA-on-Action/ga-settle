import { Hono } from "hono";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { incentivePlanDefinitions, insurers } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb } from "../db";
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
