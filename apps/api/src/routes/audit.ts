import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { settlementLines, commissionRecords, uploads, incentiveRules, incentivePlanDefinitions, insurers } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb, decNum } from "../db";

// 감사 소명 역추적 (F-044, B-012). 금감원 감사 대응:
// 지급건(settlement_line) → 실적원본(commission_record: upload+row) + 운영룰(incentive_rule)
//   → 시상정의(incentive_plan_definition) → 원본 시책안(이미지/xlsx).
// /api/* 인증 게이트 뒤. 앵커는 lineId | ruleId | definitionId 중 하나 이상.
export const auditRoutes = new Hono<{ Bindings: Env }>();

// settlement_lines.breakdown_json은 이름과 달리 룰 엔진 basis(사람이 읽는 산출 근거 문자열,
// 예 "[정의] 상품 · 익월: 보험료 200000 x 1.5 = 300000")를 담는다 - JSON이 아니다.
// 과거 데이터에 JSON이 섞였을 수 있어 방어적으로: 파싱되면 그 값, 아니면 원문 문자열 반환.
// (JSON.parse를 무방비로 부르면 비-JSON basis에서 throw → lineId 역추적 500.)
function parseBreakdown(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

auditRoutes.get("/api/audit/incentive-trace", async (c) => {
  const db = getDb(c.env);
  const sp = new URL(c.req.url).searchParams;
  const lineId = sp.get("lineId")?.trim() || null;
  let ruleId = sp.get("ruleId")?.trim() || null;
  let definitionId = sp.get("definitionId")?.trim() || null;

  const out: Record<string, unknown> = {};

  // 1) 지급건 앵커 → rule + 실적원본(commission record → upload)
  if (lineId) {
    const line = await db.select().from(settlementLines).where(eq(settlementLines.id, lineId)).get();
    if (!line) return c.json({ error: "없는 지급건이에요" }, 404);
    out.line = {
      id: line.id, runId: line.runId, agentId: line.agentId,
      amount: await decNum(line.amountEnc, c.env.FIELD_ENCRYPTION_KEY),
      breakdown: parseBreakdown(line.breakdownJson),
    };
    ruleId = ruleId ?? line.ruleId;
    const cr = await db.select().from(commissionRecords).where(eq(commissionRecords.id, line.commissionRecordId)).get();
    if (cr) {
      out.commissionRecord = { id: cr.id, uploadId: cr.uploadId, rowNo: cr.rowNo, contractNo: cr.contractNo, productName: cr.productName, insurerId: cr.insurerId };
      const up = await db
        .select({ id: uploads.id, insurerId: uploads.insurerId, settlementMonth: uploads.settlementMonth, r2Key: uploads.r2Key })
        .from(uploads).where(eq(uploads.id, cr.uploadId)).get();
      if (up) out.upload = up;
    }
  }

  // 2) 운영룰 → 시상정의 id (conditionJson._source.definitionId, 없으면 rule-{defId} 규약)
  if (ruleId) {
    const rule = await db.select().from(incentiveRules).where(eq(incentiveRules.id, ruleId)).get();
    if (rule) {
      let src: { definitionId?: string } | undefined;
      try { src = (JSON.parse(rule.conditionJson) as { _source?: { definitionId?: string } })._source; } catch { src = undefined; }
      out.rule = {
        id: rule.id, name: rule.name, action: JSON.parse(rule.actionJson),
        validFrom: rule.validFrom, validTo: rule.validTo, active: rule.active, createdBy: rule.createdBy,
      };
      definitionId = definitionId ?? src?.definitionId ?? (rule.id.startsWith("rule-") ? rule.id.slice(5) : null);
    }
  }

  // 3) 시상정의 → 원본 시책안
  if (definitionId) {
    const d = await db
      .select().from(incentivePlanDefinitions)
      .leftJoin(insurers, eq(incentivePlanDefinitions.insurerId, insurers.id))
      .where(eq(incentivePlanDefinitions.id, definitionId)).get();
    if (d) {
      out.definition = { ...d.incentive_plan_definitions, insurerName: d.insurers?.name ?? null };
      out.imageAvailable = !!d.incentive_plan_definitions.planImageKey;
    }
    if (!out.rule) {
      // F-050: 활성 룰만 promoted로 취급(soft-delete된 룰은 후보로 복원된 것).
      const promoted = await db.select({ id: incentiveRules.id }).from(incentiveRules).where(and(eq(incentiveRules.id, `rule-${definitionId}`), eq(incentiveRules.active, true))).get();
      if (promoted) out.promotedRuleId = promoted.id;
    }
  }

  if (!out.line && !out.rule && !out.definition) return c.json({ error: "역추적 대상을 찾지 못했어요" }, 404);
  return c.json({ anchor: { lineId, ruleId, definitionId }, ...out });
});
