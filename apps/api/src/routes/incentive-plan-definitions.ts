import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { incentivePlanDefinitions, incentiveRules, insurers } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb, writeAudit } from "../db";
import { authUser } from "../auth";
import { pageParams } from "../pagination";

// 시상정의 카탈로그 조회 (F-044). 원수사가 준 시상 정의 원형(무손실).
// incentive_rules(정산 엔진)와 분리 - 정의는 참조/후보. /api/* 인증 게이트 뒤.
export const incentivePlanDefinitionsRoutes = new Hono<{ Bindings: Env }>();

// D1은 쿼리당 바운드 변수 100개 제한 → drizzle .values([...])는 행수×컬럼수 변수 생성.
// 컬럼수 기준으로 안전 청크(≤90 변수/쿼리)해 다중 insert.
async function insertChunked<R>(run: (rows: R[]) => Promise<unknown>, rows: R[], cols: number): Promise<void> {
  const per = Math.max(1, Math.floor(90 / cols));
  for (let i = 0; i < rows.length; i += per) await run(rows.slice(i, i + per));
}

// 시책안 4대 대분류 → 시상정의 필터(F-056). 생보는 channel로 정확히 파생되나,
// 손보 시상정의는 원본 xlsx가 설계사/자체를 구분하지 않아(channel=null) '손보 전체'로만 필터한다.
// (사용자 결정: 파생 3-way. 손보 설계사/자체 세분화는 원본 데이터 확보 시 후속.)
const CATEGORY_FILTER: Record<string, () => ReturnType<typeof and>> = {
  sengbo_fc: () => and(eq(incentivePlanDefinitions.lineType, "생보"), eq(incentivePlanDefinitions.channel, "FC")),
  sengbo_corp: () => and(eq(incentivePlanDefinitions.lineType, "생보"), eq(incentivePlanDefinitions.channel, "법인")),
  sonbo: () => eq(incentivePlanDefinitions.lineType, "손보"),
};

// GET /api/incentive-plan-definitions?insurerId=&month=&category=&q=&limit=&offset=
incentivePlanDefinitionsRoutes.get("/api/incentive-plan-definitions", async (c) => {
  const { q, limit, offset } = pageParams(c);
  const sp = new URL(c.req.url).searchParams;
  const insurerId = (sp.get("insurerId") ?? "").trim();
  const month = (sp.get("month") ?? "").trim(); // 기준월 YYYYMM
  const category = (sp.get("category") ?? "").trim(); // sengbo_fc|sengbo_corp|sonbo (F-056)
  const db = getDb(c.env);

  const conds = [];
  if (insurerId) conds.push(eq(incentivePlanDefinitions.insurerId, insurerId));
  if (month) conds.push(eq(incentivePlanDefinitions.baseMonth, month));
  const catCond = category ? CATEGORY_FILTER[category]?.() : undefined;
  if (catCond) conds.push(catCond);
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
      cond1: incentivePlanDefinitions.cond1,
      rateType: incentivePlanDefinitions.rateType,
      rateValue: incentivePlanDefinitions.rateValue,
      note: incentivePlanDefinitions.note,
      sourceType: incentivePlanDefinitions.sourceType,
      // 이 정의가 이미 운영룰로 승격됐는지(rule-{defId}가 활성 상태로 존재). 0/1.
      // F-050: DELETE /api/rules/:id는 soft-delete(active=false)라 active 필터 필수 -
      // 미필터 시 삭제된 룰도 promoted로 잡혀 시상정의가 "확정"에 고착(후보 복원 불가).
      promoted: sql<number>`EXISTS(SELECT 1 FROM incentive_rules ir WHERE ir.id = 'rule-' || incentive_plan_definitions.id AND ir.active = 1)`,
    })
    .from(incentivePlanDefinitions)
    .leftJoin(insurers, eq(incentivePlanDefinitions.insurerId, insurers.id))
    .where(where)
    .orderBy(desc(incentivePlanDefinitions.baseMonth), incentivePlanDefinitions.insurerId, incentivePlanDefinitions.id)
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
  // 전역 /api/* 게이트가 이미 인증을 강제하지만, 감사 필수 write라 핸들러에서도 명시적으로 확인
  // (defense-in-depth: 폴백으로 "system" 오기록 방지, 확정자는 반드시 실제 사용자).
  const user = await authUser(c.req.raw, db, c.env.SESSION_SECRET);
  if (!user) return c.json({ error: "인증이 필요해요" }, 401);
  const requester = user.email;
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
  // incentivePlanDefinitions 20컬럼 → D1 100변수 한도 위해 청크 insert.
  await insertChunked((rows) => db.insert(incentivePlanDefinitions).values(rows), values, 20);
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

// GET /api/incentive-plan-definitions/:id/image - 원본 시책안 이미지 스트림(감사 소명, F-044).
// OCR 출처(planImageKey 있음)만. xlsx 출처는 404.
incentivePlanDefinitionsRoutes.get("/api/incentive-plan-definitions/:id/image", async (c) => {
  const row = await getDb(c.env)
    .select({ key: incentivePlanDefinitions.planImageKey })
    .from(incentivePlanDefinitions)
    .where(eq(incentivePlanDefinitions.id, c.req.param("id")))
    .get();
  if (!row?.key) return c.json({ error: "원본 이미지가 없어요(엑셀 출처이거나 미연결)" }, 404);
  const obj = await c.env.UPLOADS.get(row.key);
  if (!obj) return c.json({ error: "원본 이미지를 찾을 수 없어요" }, 404);
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType ?? "image/png", "Cache-Control": "private, max-age=300" },
  });
});

// POST /api/incentive-plan-definitions/promote - 선택 정의를 정산 엔진 운영룰(incentive_rules)로 확정 승격.
// 담당자 HITL(불변식 #3). 룰 id=rule-{defId}로 결정적 → 재승격 idempotent(이미 있으면 skip).
const promoteSchema = z.object({ definitionIds: z.array(z.string().min(1)).min(1).max(200) });
function monthEndDay(ym: string): number {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(4, 6));
  return new Date(y, m, 0).getDate();
}

incentivePlanDefinitionsRoutes.post("/api/incentive-plan-definitions/promote", async (c) => {
  const b = promoteSchema.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "승격 입력 검증 실패", detail: b.error.flatten() }, 400);
  const db = getDb(c.env);
  const user = await authUser(c.req.raw, db, c.env.SESSION_SECRET);
  if (!user) return c.json({ error: "인증이 필요해요" }, 401);
  const requester = user.email;

  const defs = await db.select().from(incentivePlanDefinitions).where(inArray(incentivePlanDefinitions.id, b.data.definitionIds)).all();
  const foundIds = new Set(defs.map((d) => d.id));
  const notFound = b.data.definitionIds.filter((id) => !foundIds.has(id));

  // 이미 승격된 룰 조회(active 구분). F-050: soft-delete(active=false)된 룰은
  // "후보로 복원"된 상태이므로 재승격 시 재활성해야 한다(과거엔 존재만으로 skip → 재확정 불가).
  const ruleIds = defs.map((d) => `rule-${d.id}`);
  const existingRows = ruleIds.length
    ? await db.select({ id: incentiveRules.id, active: incentiveRules.active }).from(incentiveRules).where(inArray(incentiveRules.id, ruleIds)).all()
    : [];
  const activeSet = new Set(existingRows.filter((r) => r.active).map((r) => r.id));   // 이미 활성 → skip(idempotent)
  const inactiveSet = new Set(existingRows.filter((r) => !r.active).map((r) => r.id)); // soft-delete됨 → 재활성

  const now = new Date().toISOString();
  const monthEnd = (ym: string) => `${ym.slice(0, 4)}-${ym.slice(4, 6)}-${String(monthEndDay(ym)).padStart(2, "0")}`;

  // 삭제됐던 룰 재활성(F-050 재확정 경로).
  const toReactivate = defs.filter((d) => inactiveSet.has(`rule-${d.id}`));
  for (const d of toReactivate) {
    await db.update(incentiveRules)
      .set({ active: true, validTo: monthEnd(d.baseMonth), createdBy: requester, createdAt: now })
      .where(eq(incentiveRules.id, `rule-${d.id}`));
  }

  const toInsert = defs
    .filter((d) => !activeSet.has(`rule-${d.id}`) && !inactiveSet.has(`rule-${d.id}`))
    .map((d) => {
      const ym = d.baseMonth;
      const from = `${ym.slice(0, 4)}-${ym.slice(4, 6)}-01`;
      const to = `${ym.slice(0, 4)}-${ym.slice(4, 6)}-${String(monthEndDay(ym)).padStart(2, "0")}`;
      const condition = {
        condition: { period: { from, to }, insurerIds: [d.insurerId], productPatterns: d.product ? [d.product] : [] },
        overlapPolicy: "exclusive" as const,
        _source: { definitionId: d.id, payTerm: d.payTerm, payTiming: d.payTiming, channel: d.channel, branch: d.branch, cond1: d.cond1, cond2: d.cond2, cond3: d.cond3 },
      };
      const action = d.rateType === "rate" ? { kind: "rate", rate: d.rateValue } : { kind: "fixed", amount: d.rateValue };
      const name = `[정의] ${d.product}${d.payTiming ? ` · ${d.payTiming}` : ""}${d.cond1 ? ` · ${d.cond1}` : ""}`.slice(0, 200);
      return {
        id: `rule-${d.id}`, name, conditionJson: JSON.stringify(condition), actionJson: JSON.stringify(action),
        priority: 0, validFrom: from, validTo: to, active: true, createdBy: requester, createdAt: now,
      };
    });

  // incentiveRules 10컬럼 → D1 100변수 한도 위해 청크 insert.
  if (toInsert.length) await insertChunked((rows) => db.insert(incentiveRules).values(rows), toInsert, 10);
  const promotedCount = toInsert.length + toReactivate.length;
  await writeAudit(db, {
    actor: requester, action: "incentive_rule.promote", entity: "incentive_rules",
    summary: { requested: b.data.definitionIds.length, inserted: toInsert.length, reactivated: toReactivate.length, skipped: activeSet.size, notFound: notFound.length },
  });
  return c.json({
    promoted: promotedCount, reactivated: toReactivate.length, skipped: activeSet.size, notFound,
    ruleIds: [...toInsert.map((r) => r.id), ...toReactivate.map((d) => `rule-${d.id}`)],
  }, 201);
});
