import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import {
  insurers, orgUnits, agents, uploads, commissionRecords,
  settlementRuns, settlementLines, incentiveRules, incentivePlanDefinitions,
} from "@ga-settle/schema";
import { getDb } from "../src/db";
import { aget, enc } from "./helpers";

// F-044 감사 소명 역추적: 지급건(settlement_line) → 실적원본(commission_record: upload+row)
//   → 운영룰(incentive_rule) → 시상정의(incentive_plan_definition) 체인.
// 회귀 방지: settlement_lines.breakdown_json은 룰 엔진 basis(사람이 읽는 문자열, JSON 아님)를
// 담는데, audit이 무방비로 JSON.parse하면 lineId 앵커가 500. parseBreakdown 방어 검증.
// (vitest-pool-workers 테스트별 스토리지 격리 → 시딩은 beforeAll 한 번, [[vitest-pool-workers-gotchas]])
const RUN = "run-audit", CR = "cr-audit", LINE_STR = "line-audit-str", LINE_JSON = "line-audit-json";
const DEF = "def-audit-1", RULE = "rule-def-audit-1";
const BREAKDOWN_STR = "[정의] (무)우리WON더드림종신 · 익월: 보험료 200000 x 1.5 = 300000";

interface Trace {
  line?: { amount: number; breakdown: unknown };
  commissionRecord?: { uploadId: string; rowNo: number; contractNo: string };
  upload?: { id: string; settlementMonth: string };
  rule?: { id: string };
  definition?: { id: string; maturityTerm: string | null };
}

describe("감사 역추적 incentive-trace (F-044)", () => {
  beforeAll(async () => {
    const db = getDb(env);
    const now = "2026-07-17T00:00:00.000Z";
    await db.insert(insurers).values({ id: "ins-audit", name: "감사테스트생명", createdAt: now }).onConflictDoNothing();
    await db.insert(orgUnits).values({ id: "ou-audit", name: "감사팀", kind: "team", createdAt: now }).onConflictDoNothing();
    await db.insert(agents).values({ id: "ag-audit", code: "AUD1", name: "감사설계사", status: "active", createdAt: now }).onConflictDoNothing();
    await db.insert(uploads).values({
      id: "up-audit", insurerId: "ins-audit", r2Key: "uploads/2026-05/up-audit.xlsx",
      fileHash: "hash-audit", status: "approved", settlementMonth: "2026-05", createdBy: "tester", createdAt: now,
    }).onConflictDoNothing();
    await db.insert(commissionRecords).values({
      id: CR, uploadId: "up-audit", rowNo: 7, settlementMonth: "2026-05", insurerId: "ins-audit",
      contractNo: "AUD-C-1", agentId: "ag-audit", productName: "(무)우리WON더드림종신",
    }).onConflictDoNothing();
    await db.insert(settlementRuns).values({ id: RUN, settlementMonth: "2026-05", status: "calculated" }).onConflictDoNothing();
    await db.insert(incentivePlanDefinitions).values({
      id: DEF, insurerId: "ins-audit", baseMonth: "202605", product: "(무)우리WON더드림종신",
      payTerm: "5년납", maturityTerm: "20년만기", rateType: "rate", rateValue: 1.5, sourceType: "xlsx",
      createdBy: "tester", createdAt: now,
    }).onConflictDoNothing();
    await db.insert(incentiveRules).values({
      id: RULE, name: "[정의] 우리WON더드림종신",
      conditionJson: JSON.stringify({
        condition: { period: { from: "2026-05-01", to: "2026-05-31" }, insurerIds: ["ins-audit"] },
        overlapPolicy: "exclusive", _source: { definitionId: DEF, payTerm: "5년납", maturityTerm: "20년만기" },
      }),
      actionJson: JSON.stringify({ kind: "rate", rate: 1.5 }),
      priority: 0, validFrom: "2026-05-01", validTo: "2026-05-31", active: true, createdBy: "tester", createdAt: now,
    }).onConflictDoNothing();
    // 핵심 회귀: breakdown_json에 비-JSON 문자열(실제 calculate가 basis를 이렇게 저장). JSON.parse 시 throw.
    await db.insert(settlementLines).values({
      id: LINE_STR, runId: RUN, commissionRecordId: CR, ruleId: RULE, agentId: "ag-audit",
      orgUnitId: "ou-audit", amountEnc: (await enc(300000))!, breakdownJson: BREAKDOWN_STR, createdAt: now,
    }).onConflictDoNothing();
    // 방어 경로: breakdown_json이 (구/미래 데이터로) JSON이면 객체로 파싱돼야 함.
    await db.insert(settlementLines).values({
      id: LINE_JSON, runId: RUN, commissionRecordId: CR, ruleId: RULE, agentId: "ag-audit",
      orgUnitId: "ou-audit", amountEnc: (await enc(300000))!, breakdownJson: JSON.stringify({ rate: 1.5, base: 200000 }), createdAt: now,
    }).onConflictDoNothing();
  });

  it("lineId 앵커: 비-JSON breakdown이어도 200 + 전체 체인 역추적 (500 회귀 방지)", async () => {
    const res = await aget(`/api/audit/incentive-trace?lineId=${LINE_STR}`);
    expect(res.status).toBe(200);
    const t = (await res.json()) as Trace;
    // breakdown은 원문 문자열 그대로(파싱 실패 → 폴백). 과거엔 여기서 JSON.parse가 throw → 500.
    expect(t.line?.breakdown).toBe(BREAKDOWN_STR);
    expect(t.line?.amount).toBe(300000);
    // 역추적 불변식 #1: upload_id + row_no로 원본 행 특정.
    expect(t.commissionRecord).toMatchObject({ uploadId: "up-audit", rowNo: 7, contractNo: "AUD-C-1" });
    expect(t.upload).toMatchObject({ id: "up-audit", settlementMonth: "2026-05" });
    // 운영룰 → 시상정의 체인 + F-060 만기기간 관통.
    expect(t.rule?.id).toBe(RULE);
    expect(t.definition?.id).toBe(DEF);
    expect(t.definition?.maturityTerm).toBe("20년만기");
  });

  it("breakdown_json이 JSON이면 객체로 파싱 (방어 경로)", async () => {
    const res = await aget(`/api/audit/incentive-trace?lineId=${LINE_JSON}`);
    expect(res.status).toBe(200);
    const t = (await res.json()) as Trace;
    expect(t.line?.breakdown).toEqual({ rate: 1.5, base: 200000 });
  });

  it("ruleId 앵커: 룰 → 시상정의 해소", async () => {
    const res = await aget(`/api/audit/incentive-trace?ruleId=${RULE}`);
    expect(res.status).toBe(200);
    const t = (await res.json()) as Trace;
    expect(t.rule?.id).toBe(RULE);
    expect(t.definition?.id).toBe(DEF);
  });

  it("없는 lineId는 404", async () => {
    const res = await aget(`/api/audit/incentive-trace?lineId=does-not-exist`);
    expect(res.status).toBe(404);
  });
});
