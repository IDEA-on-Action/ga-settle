import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { settlementRuns, settlementLines, commissionRecords, familyFlags, reconciliations, adjustments } from "@ga-settle/schema";
import { evaluate, type CommissionInput } from "@ga-settle/rules";
import type { Env } from "../types";
import { getDb, encField, decNum, writeAudit, type Db } from "../db";
import { authUser } from "../auth";
import { resolveAssignment } from "./org";
import { loadRules } from "./rules";

// 정산/대사/마감 (F-013 실행, F-014 대사, F-016 마감 이중 잠금).
export const runsRoutes = new Hono<{ Bindings: Env }>();

// 정산 Run 목록 (F-037 REQ-053): 월/상태 라벨 선택기용. 대사·내역서에서 run UUID 손입력 제거.
runsRoutes.get("/api/runs", async (c) => {
  const rows = await getDb(c.env)
    .select({
      id: settlementRuns.id,
      settlementMonth: settlementRuns.settlementMonth,
      status: settlementRuns.status,
      closedAt: settlementRuns.closedAt,
    })
    .from(settlementRuns)
    .orderBy(desc(settlementRuns.settlementMonth))
    .limit(50);
  return c.json({ runs: rows });
});

// 월 정산 run 생성 (draft). 월당 1개(uq_run_month).
runsRoutes.post("/api/runs", async (c) => {
  const b = z.object({ settlementMonth: z.string().regex(/^\d{4}-\d{2}$/) }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "settlementMonth(YYYY-MM) 필요" }, 400);
  const db = getDb(c.env);
  const dup = await db.select({ id: settlementRuns.id }).from(settlementRuns).where(eq(settlementRuns.settlementMonth, b.data.settlementMonth)).get();
  if (dup) return c.json({ error: "해당 월 run이 이미 있어요", runId: dup.id }, 409);
  const id = crypto.randomUUID();
  await db.insert(settlementRuns).values({ id, settlementMonth: b.data.settlementMonth, status: "draft" });
  return c.json({ id, settlementMonth: b.data.settlementMonth, status: "draft" }, 201);
});

/**
 * 정산 계산 (F-013 REQ-022): 당월 commission_records -> CommissionInput(당월 소속 resolveAssignment,
 * 가족여부 family_flags confirmed) -> 시책 룰 evaluate -> settlement_lines(룰별 산출 분해).
 * 재현성(FR): 기존 라인 삭제 후 재생성 -> 동일 입력 = 동일 출력. draft/calculated에서만(마감 후 금지).
 */
// 정산 계산 코어: 당월 commission_records -> CommissionInput(당월 소속/가족/복호화 premium) ->
// evaluate. calculate(쓰기)와 parallel-verify(비교)가 공유 -> 병행 검증이 동일 로직을 재실행.
async function computeSettlement(db: Db, secret: string, run: { settlementMonth: string }) {
  const crs = await db.select().from(commissionRecords).where(eq(commissionRecords.settlementMonth, run.settlementMonth)).all();
  const confirmedFam = new Set(
    (await db.select({ contractNo: familyFlags.contractNo }).from(familyFlags).where(eq(familyFlags.status, "confirmed")).all()).map((f) => f.contractNo),
  );
  const meta = new Map<string, { agentId: string; orgUnitId: string }>();
  const inputs: CommissionInput[] = [];
  for (const cr of crs) {
    if (!cr.agentId) continue; // 설계사 미상 -> 귀속 불가
    const orgUnitId = await resolveAssignment(db, cr.agentId, `${run.settlementMonth}-15`); // 당월 소속
    if (!orgUnitId) continue;
    inputs.push({
      recordId: cr.id, insurerId: cr.insurerId, productName: cr.productName ?? "", orgUnitId,
      agentId: cr.agentId, contractDate: cr.contractDate ?? `${run.settlementMonth}-01`,
      premium: await decNum(cr.premiumEnc, secret), isFamilyContract: confirmedFam.has(cr.contractNo),
    });
    meta.set(cr.id, { agentId: cr.agentId, orgUnitId });
  }
  return { lines: evaluate(inputs, await loadRules(db)), meta }; // 순수·결정적
}

runsRoutes.post("/api/runs/:id/calculate", async (c) => {
  const db = getDb(c.env);
  const run = await db.select().from(settlementRuns).where(eq(settlementRuns.id, c.req.param("id"))).get();
  if (!run) return c.json({ error: "없는 run이에요" }, 404);
  if (run.status === "closed") return c.json({ error: "마감된 run은 재계산 불가", status: run.status }, 409);

  const key = c.env.FIELD_ENCRYPTION_KEY;
  const { lines, meta } = await computeSettlement(db, key, run);
  const now = new Date().toISOString();
  const rows = await Promise.all(lines.map(async (l) => {
    const m = meta.get(l.recordId)!;
    return {
      id: crypto.randomUUID(), runId: run.id, commissionRecordId: l.recordId, ruleId: l.ruleId,
      agentId: m.agentId, orgUnitId: m.orgUnitId, amountEnc: (await encField(l.amount, key))!, breakdownJson: l.basis, createdAt: now,
    };
  }));

  // 멱등 재계산: 기존 라인 제거 후 재삽입
  await db.delete(settlementLines).where(eq(settlementLines.runId, run.id));
  if (rows.length) await db.batch([db.insert(settlementLines).values(rows[0]!), ...rows.slice(1).map((r) => db.insert(settlementLines).values(r))]);
  await db.update(settlementRuns).set({ status: "calculated" }).where(eq(settlementRuns.id, run.id));

  return c.json({ runId: run.id, status: "calculated", lines: rows.length, totalAmount: lines.reduce((s, l) => s + l.amount, 0) });
});

runsRoutes.get("/api/runs/:id", async (c) => {
  const db = getDb(c.env);
  const run = await db.select().from(settlementRuns).where(eq(settlementRuns.id, c.req.param("id"))).get();
  if (!run) return c.json({ error: "없는 run이에요" }, 404);
  const lines = await db.select().from(settlementLines).where(eq(settlementLines.runId, run.id)).all();
  const amts = await Promise.all(lines.map((l) => decNum(l.amountEnc, c.env.FIELD_ENCRYPTION_KEY)));
  return c.json({ ...run, lineCount: lines.length, totalAmount: amts.reduce((s, a) => s + a, 0) });
});

/**
 * 대사 (F-014 REQ-023): 원수사 보고액(commission_records.commissionEnc) vs 계산액
 * (settlement_lines 합)을 원수사별로 비교하고, 차액을 계약(commissionRecordId) 단위까지 추적.
 * 역추적 불변식 덕에 diff 계약을 원본 행까지 특정 가능(FR-17,18). reconciliations 갱신.
 */
runsRoutes.get("/api/runs/:id/reconciliation", async (c) => {
  const db = getDb(c.env);
  const run = await db.select().from(settlementRuns).where(eq(settlementRuns.id, c.req.param("id"))).get();
  if (!run) return c.json({ error: "없는 run이에요" }, 404);

  const crs = await db.select().from(commissionRecords).where(eq(commissionRecords.settlementMonth, run.settlementMonth)).all();
  const lines = await db.select().from(settlementLines).where(eq(settlementLines.runId, run.id)).all();
  const key = c.env.FIELD_ENCRYPTION_KEY;
  const calcByRecord = new Map<string, number>();
  for (const l of lines) calcByRecord.set(l.commissionRecordId, (calcByRecord.get(l.commissionRecordId) ?? 0) + (await decNum(l.amountEnc, key)));

  // 계약(record) 단위 diff
  const contracts = await Promise.all(crs.map(async (cr) => {
    const insurerAmount = await decNum(cr.commissionEnc, key);
    const calculatedAmount = calcByRecord.get(cr.id) ?? 0;
    return { commissionRecordId: cr.id, contractNo: cr.contractNo, insurerId: cr.insurerId, insurerAmount, calculatedAmount, diff: insurerAmount - calculatedAmount };
  }));
  const diffContracts = contracts.filter((x) => x.diff !== 0);

  // 원수사별 집계 + reconciliations 갱신(멱등)
  const byInsurer = new Map<string, { insurer: number; calc: number }>();
  for (const x of contracts) {
    const agg = byInsurer.get(x.insurerId) ?? { insurer: 0, calc: 0 };
    agg.insurer += x.insurerAmount; agg.calc += x.calculatedAmount;
    byInsurer.set(x.insurerId, agg);
  }
  const now = new Date().toISOString();
  await db.delete(reconciliations).where(eq(reconciliations.runId, run.id));
  const summary = [...byInsurer.entries()].map(([insurerId, agg]) => ({
    insurerId, insurerTotal: agg.insurer, calculatedTotal: agg.calc, diff: agg.insurer - agg.calc,
    status: agg.insurer - agg.calc === 0 ? "matched" : "diff",
  }));
  if (summary.length) {
    const rows = await Promise.all(summary.map(async (s) => ({
      id: crypto.randomUUID(), runId: run.id, insurerId: s.insurerId,
      insurerTotalEnc: (await encField(s.insurerTotal, key))!, calculatedTotalEnc: (await encField(s.calculatedTotal, key))!,
      diffEnc: (await encField(s.diff, key))!, status: s.status, createdAt: now,
    })));
    await db.batch([db.insert(reconciliations).values(rows[0]!), ...rows.slice(1).map((r) => db.insert(reconciliations).values(r))]);
  }

  return c.json({ runId: run.id, insurers: summary, diffContracts });
});

/**
 * 병행 검증 (F-022 REQ-031, §2 차액 0원): 저장된 settlement_lines vs 독립 재계산을
 * 계약(commissionRecordId, ruleId) 단위로 비교. evaluate가 순수·결정적이라 정상은 차액 0.
 * 라인 변조/드리프트 시 원인 계약을 diff로 특정(무결성 검증).
 */
runsRoutes.get("/api/runs/:id/parallel-verify", async (c) => {
  const db = getDb(c.env);
  const run = await db.select().from(settlementRuns).where(eq(settlementRuns.id, c.req.param("id"))).get();
  if (!run) return c.json({ error: "없는 run이에요" }, 404);

  const key = c.env.FIELD_ENCRYPTION_KEY;
  // 독립 재계산 (동일 로직)
  const { lines: expected } = await computeSettlement(db, key, run);
  const expMap = new Map<string, number>();
  for (const l of expected) { const k = `${l.recordId}|${l.ruleId}`; expMap.set(k, (expMap.get(k) ?? 0) + l.amount); }

  // 저장된 원장
  const stored = await db.select().from(settlementLines).where(eq(settlementLines.runId, run.id)).all();
  const storedMap = new Map<string, number>();
  for (const s of stored) { const k = `${s.commissionRecordId}|${s.ruleId}`; storedMap.set(k, (storedMap.get(k) ?? 0) + (await decNum(s.amountEnc, key))); }

  const diffs: { commissionRecordId: string; ruleId: string; expected: number; stored: number; diff: number }[] = [];
  for (const k of new Set([...expMap.keys(), ...storedMap.keys()])) {
    const exp = expMap.get(k) ?? 0;
    const sto = storedMap.get(k) ?? 0;
    if (exp !== sto) diffs.push({ commissionRecordId: k.split("|")[0]!, ruleId: k.split("|")[1]!, expected: exp, stored: sto, diff: sto - exp });
  }
  const totalDiff = diffs.reduce((s, d) => s + Math.abs(d.diff), 0);
  return c.json({ runId: run.id, verified: diffs.length === 0, totalDiff, diffs });
});

// 수동 보정 (F-015 REQ-024): reason 필수(불변식4), 이중 승인(옵션 approvedBy),
// 모든 보정 쓰기는 audit_logs 동반(append-only). 마감 run은 보정 불가.
runsRoutes.post("/api/runs/:id/adjustments", async (c) => {
  const b = z.object({
    targetType: z.string().min(1), targetId: z.string().min(1),
    amount: z.number(), reason: z.string().min(1), approvedBy: z.string().optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "보정 검증 실패 (targetType/targetId/amount/reason 필수)" }, 400);

  const db = getDb(c.env);
  // 등록자(createdBy)는 클라이언트 입력이 아닌 인증 사용자로 기록(F-038, 감사 무결성).
  // approvedBy는 이중 통제의 별도 승인자(선택) - 요청자와 역할 구분 유지.
  const requester = (await authUser(c.req.raw, db, c.env.SESSION_SECRET))?.email ?? "system";
  const run = await db.select().from(settlementRuns).where(eq(settlementRuns.id, c.req.param("id"))).get();
  if (!run) return c.json({ error: "없는 run이에요" }, 404);
  if (run.status === "closed") return c.json({ error: "마감된 run은 보정 불가" }, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(adjustments).values({
    id, runId: run.id, targetType: b.data.targetType, targetId: b.data.targetId,
    amountEnc: (await encField(b.data.amount, c.env.FIELD_ENCRYPTION_KEY))!, reason: b.data.reason, createdBy: requester,
    approvedBy: b.data.approvedBy ?? null, createdAt: now,
  });
  await writeAudit(db, {
    actor: requester, action: "adjustment.create", entity: "adjustments", entityId: id,
    summary: { runId: run.id, targetType: b.data.targetType, targetId: b.data.targetId, amount: b.data.amount, reason: b.data.reason },
  });
  return c.json({ id, runId: run.id, reason: b.data.reason, approvedBy: b.data.approvedBy ?? null }, 201);
});

runsRoutes.get("/api/runs/:id/adjustments", async (c) => {
  const rows = await getDb(c.env).select().from(adjustments).where(eq(adjustments.runId, c.req.param("id"))).all();
  return c.json(rows);
});

/**
 * 월 마감 (F-016 REQ-025): calculated -> closed. 마감 스냅샷 R2 불변 보관(NFR-05).
 * 이중 잠금: API가 closed run 쓰기를 거부하고, DB 트리거(F-002)가 마감 run/종속 테이블
 * INSERT/UPDATE/DELETE를 RAISE(ABORT)로 차단(우회 불가).
 */
runsRoutes.post("/api/runs/:id/close", async (c) => {
  const db = getDb(c.env);
  // 마감자(closedBy)는 인증 사용자로 자동 기록(F-038) - 클라이언트 입력 신뢰 안 함.
  const closedBy = (await authUser(c.req.raw, db, c.env.SESSION_SECRET))?.email ?? "system";
  const run = await db.select().from(settlementRuns).where(eq(settlementRuns.id, c.req.param("id"))).get();
  if (!run) return c.json({ error: "없는 run이에요" }, 404);
  if (run.status === "closed") return c.json({ error: "이미 마감된 run이에요", status: "closed" }, 409);
  if (run.status !== "calculated") return c.json({ error: "계산 완료(calculated) run만 마감해요", status: run.status }, 409);

  const now = new Date().toISOString();
  const lines = await db.select().from(settlementLines).where(eq(settlementLines.runId, run.id)).all();
  const recon = await db.select().from(reconciliations).where(eq(reconciliations.runId, run.id)).all();
  const snapshotR2Key = `snapshots/${run.settlementMonth}/${run.id}.json`;
  await c.env.UPLOADS.put(snapshotR2Key, JSON.stringify({ run, lines, reconciliations: recon, closedAt: now, closedBy }));

  // 낙관적 락: calculated -> closed 전환 선점(동시 마감 중 진 쪽 409). 이후 트리거가 재쓰기 차단.
  const claim = await db.update(settlementRuns).set({ status: "closed", closedAt: now, closedBy, snapshotR2Key })
    .where(and(eq(settlementRuns.id, run.id), eq(settlementRuns.status, "calculated")));
  if (claim.meta.changes === 0) return c.json({ error: "이미 마감됐거나 상태가 바뀌었어요" }, 409);

  await writeAudit(db, { actor: closedBy, action: "run.close", entity: "settlement_runs", entityId: run.id, summary: { month: run.settlementMonth, lines: lines.length, snapshotR2Key } });
  return c.json({ runId: run.id, status: "closed", closedAt: now, snapshotR2Key, lines: lines.length });
});
