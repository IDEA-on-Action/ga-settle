import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { insurers, orgUnits, agents, agentAssignments, uploads, commissionRecords, settlementLines, settlementRuns, auditLogs } from "@ga-settle/schema";
import { getDb, decNum } from "../src/db";
import { enc, apost as post, agetJson as getJson, aget } from "./helpers";




const now = "2026-07-07";

beforeEach(async () => {
  const db = getDb(env);
  await db.insert(insurers).values({ id: "ins1", name: "A생명", createdAt: now });
  await db.insert(orgUnits).values({ id: "team1", name: "1팀", kind: "team", createdAt: now });
  await db.insert(agents).values({ id: "ag1", code: "FC1", name: "홍길동", status: "active", createdAt: now });
  await db.insert(agentAssignments).values({ id: "as1", agentId: "ag1", orgUnitId: "team1", validFrom: "2026-01-01", validTo: null });
  await db.insert(uploads).values({ id: "up1", insurerId: "ins1", r2Key: "k", fileHash: "h", status: "approved", settlementMonth: "2026-06", createdBy: "system", createdAt: now });
  for (let i = 1; i <= 3; i++) {
    await db.insert(commissionRecords).values({
      id: `cr${i}`, uploadId: "up1", rowNo: i, settlementMonth: "2026-06", insurerId: "ins1",
      contractNo: `C${i}`, agentId: "ag1", productName: "종신보험", contractDate: "2026-06-10", premiumEnc: await enc("100000"),
      // 원수사 보고액: C1/C2는 계산액(10000)과 일치, C3만 9000으로 의도적 차액
      commissionEnc: await enc(i === 3 ? "9000" : "10000"),
    });
  }
  // 6월 시책: 보험료 x 10%
  await post("/api/rules", { name: "6월시책", priority: 10, overlapPolicy: "stack", condition: { period: { from: "2026-06-01", to: "2026-06-30" }, insurerIds: ["ins1"] }, action: { kind: "rate", rate: 0.1 } });
});

// 재현성은 복호화된 금액으로 비교 (AES-GCM은 IV 랜덤이라 암호문 자체는 매번 다름)
const lineTuples = async (runId: string) => {
  const rows = await getDb(env).select().from(settlementLines).where(eq(settlementLines.runId, runId)).all();
  const t = await Promise.all(rows.map(async (l) => `${l.commissionRecordId}|${l.ruleId}|${await decNum(l.amountEnc, env.FIELD_ENCRYPTION_KEY)}|${l.orgUnitId}`));
  return t.sort();
};

describe("F-013 정산 계산 배치", () => {
  it("당월 records -> 룰 evaluate -> settlement_lines (룰별 산출 분해)", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    const calc = (await (await post(`/api/runs/${id}/calculate`)).json()) as { status: string; lines: number; totalAmount: number };
    expect(calc.status).toBe("calculated");
    expect(calc.lines).toBe(3);
    expect(calc.totalAmount).toBe(30000); // 3 x (100000 x 0.1)

    const run = (await (await aget(`/api/runs/${id}`)).json()) as { status: string; lineCount: number };
    expect(run.status).toBe("calculated");
    expect(run.lineCount).toBe(3);
  });

  it("동일 입력 재실행 시 동일 출력 (재현성, REQ-022)", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    const c1 = (await (await post(`/api/runs/${id}/calculate`)).json()) as { totalAmount: number };
    const first = await lineTuples(id);
    const c2 = (await (await post(`/api/runs/${id}/calculate`)).json()) as { lines: number; totalAmount: number };
    const second = await lineTuples(id);
    expect(second).toEqual(first);       // id 제외 동일 튜플
    expect(c2.lines).toBe(3);            // 재계산해도 3개(중복 누적 없음, 멱등)
    expect(c2.totalAmount).toBe(c1.totalAmount);
  });

  it("병행 검증: 저장 라인 vs 재계산 차액 0, 라인 변조 시 원인 계약 검출 (F-022 REQ-031)", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    await post(`/api/runs/${id}/calculate`);

    const v1 = (await getJson(`/api/runs/${id}/parallel-verify`)) as { verified: boolean; totalDiff: number; diffs: unknown[] };
    expect(v1.verified).toBe(true);    // §2 차액 0원
    expect(v1.totalDiff).toBe(0);
    expect(v1.diffs).toHaveLength(0);

    // 저장된 라인 하나를 변조
    const lines = await getDb(env).select().from(settlementLines).where(eq(settlementLines.runId, id)).all();
    const tampered = lines[0]!;
    await getDb(env).update(settlementLines).set({ amountEnc: await enc("999999") }).where(eq(settlementLines.id, tampered.id));

    const v2 = (await getJson(`/api/runs/${id}/parallel-verify`)) as { verified: boolean; diffs: { commissionRecordId: string }[] };
    expect(v2.verified).toBe(false);
    expect(v2.diffs.some((d) => d.commissionRecordId === tampered.commissionRecordId)).toBe(true);
  });

  it("월당 run 1개 (중복 -> 409)", async () => {
    await post("/api/runs", { settlementMonth: "2026-06" });
    expect((await post("/api/runs", { settlementMonth: "2026-06" })).status).toBe(409);
  });

  it("대사: 원수사 보고액 vs 계산액, 의도적 차액 계약 특정 (F-014 REQ-023)", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    await post(`/api/runs/${id}/calculate`); // 계산액 각 10000

    const recon = (await (await aget(`/api/runs/${id}/reconciliation`)).json()) as {
      insurers: { insurerId: string; insurerTotal: number; calculatedTotal: number; diff: number; status: string }[];
      diffContracts: { contractNo: string; diff: number }[];
    };
    // 원수사 총액 29000(10000+10000+9000) vs 계산 30000 -> diff -1000
    expect(recon.insurers).toHaveLength(1);
    expect(recon.insurers[0]).toMatchObject({ insurerTotal: 29000, calculatedTotal: 30000, diff: -1000, status: "diff" });
    // 드릴다운: C3만 원인 계약
    expect(recon.diffContracts).toHaveLength(1);
    expect(recon.diffContracts[0]).toMatchObject({ contractNo: "C3", diff: -1000 });
  });

  it("보정: reason 필수 + adjustments/audit_logs 동반 (F-015 REQ-024)", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    // reason 없이 -> 400 (도메인 불변식4)
    expect((await post(`/api/runs/${id}/adjustments`, { targetType: "line", targetId: "cr1", amount: 5000 })).status).toBe(400);
    // 정상(이중 승인 approvedBy 포함)
    const res = await post(`/api/runs/${id}/adjustments`, { targetType: "line", targetId: "cr1", amount: 5000, reason: "과소지급 보정", approvedBy: "manager1" });
    expect(res.status).toBe(201);
    const { id: adjId } = (await res.json()) as { id: string };

    const list = ((await getJson(`/api/runs/${id}/adjustments`)) as { items: { reason: string; approvedBy: string }[] }).items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: "과소지급 보정", approvedBy: "manager1" });

    // 감사 로그 동반
    const audits = await getDb(env).select().from(auditLogs).all();
    expect(audits.some((a) => a.action === "adjustment.create" && a.entityId === adjId)).toBe(true);
  });

  it("마감: 이중 잠금 - 마감 후 API/DB 양쪽 쓰기 거부 + 스냅샷 (F-016 REQ-025)", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    await post(`/api/runs/${id}/calculate`);
    const close = await post(`/api/runs/${id}/close`, { closedBy: "admin" });
    expect(close.status).toBe(200);
    const body = (await close.json()) as { status: string; snapshotR2Key: string };
    expect(body.status).toBe("closed");
    // 마감 스냅샷 R2 보관 (head = 스트림 없음, 격리 스토리지 안전)
    expect(await env.UPLOADS.head(body.snapshotR2Key)).not.toBeNull();

    // (1) API 잠금: 재계산/보정/재마감 -> 409
    expect((await post(`/api/runs/${id}/calculate`)).status).toBe(409);
    expect((await post(`/api/runs/${id}/adjustments`, { targetType: "line", targetId: "cr1", amount: 1, reason: "x" })).status).toBe(409);
    expect((await post(`/api/runs/${id}/close`, { closedBy: "admin" })).status).toBe(409);

    // (2) DB 트리거 잠금(우회 불가): 마감 run에 직접 settlement_lines insert / run UPDATE -> ABORT
    const db = getDb(env);
    await expect(db.insert(settlementLines).values({
      id: "hack1", runId: id, commissionRecordId: "cr1", agentId: "ag1", orgUnitId: "team1", amountEnc: "1", createdAt: "2026-07-07",
    })).rejects.toThrow();
    await expect(db.update(settlementRuns).set({ closedBy: "hacker" }).where(eq(settlementRuns.id, id))).rejects.toThrow();
  });
});

describe("F-036/037 목록 API (선택기 데이터)", () => {
  it("GET /api/runs: Run 목록(월/상태) 반환", async () => {
    await post("/api/runs", { settlementMonth: "2026-06" });
    const { runs } = (await getJson("/api/runs")) as { runs: { id: string; settlementMonth: string; status: string }[] };
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.some((r) => r.settlementMonth === "2026-06" && r.status === "draft")).toBe(true);
  });

  it("GET /api/uploads: 원수사명 조인 + 민감정보(r2Key/해시) 제외", async () => {
    const { uploads: rows } = (await getJson("/api/uploads")) as { uploads: Record<string, unknown>[] };
    const up = rows.find((u) => u.id === "up1");
    expect(up).toBeTruthy();
    expect(up!.insurerName).toBe("A생명");
    expect(up!.settlementMonth).toBe("2026-06");
    expect("r2Key" in up!).toBe(false);
    expect("fileHash" in up!).toBe(false);
  });

  it("GET /api/uploads?q= 검색 + total (F-042)", async () => {
    const hit = (await getJson("/api/uploads?q=A생명")) as { uploads: unknown[]; total: number };
    expect(hit.uploads.length).toBeGreaterThanOrEqual(1);
    expect(hit.total).toBeGreaterThanOrEqual(1);
    const miss = (await getJson("/api/uploads?q=없는원수사zzz")) as { uploads: unknown[]; total: number };
    expect(miss.uploads).toHaveLength(0);
    expect(miss.total).toBe(0);
  });

  it("GET /api/runs?limit=1&offset=0 페이지네이션 total (F-042)", async () => {
    await post("/api/runs", { settlementMonth: "2026-06" });
    const page = (await getJson("/api/runs?limit=1&offset=0")) as { runs: unknown[]; total: number };
    expect(page.runs.length).toBeLessThanOrEqual(1);
    expect(page.total).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/runs/:id/contracts: 계약 목록(금액 제외) (F-041)", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    const { contracts } = (await getJson(`/api/runs/${id}/contracts`)) as {
      contracts: { contractNo: string; agentId: string | null; productName: string | null }[];
    };
    const nos = contracts.map((c) => c.contractNo).sort();
    expect(nos).toEqual(["C1", "C2", "C3"]);
    expect(contracts[0]!.agentId).toBe("ag1");
    // 금액(암호화) 필드 미노출
    expect("premiumEnc" in contracts[0]!).toBe(false);
    expect("commissionEnc" in contracts[0]!).toBe(false);
  });
});

describe("F-038 승인자·확정자 인증 사용자 자동 기록", () => {
  it("close: closedBy는 본문이 아닌 인증 사용자로 기록", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    await post(`/api/runs/${id}/calculate`);
    // 본문에 다른 이름을 넣어도 무시하고 인증 사용자(admin@test.local)로 기록
    await post(`/api/runs/${id}/close`, { closedBy: "spoofed" });
    const run = (await getJson(`/api/runs/${id}`)) as { closedBy: string };
    expect(run.closedBy).toBe("admin@test.local");
  });

  it("adjustment: createdBy·audit actor는 인증 사용자", async () => {
    const { id } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    await post(`/api/runs/${id}/calculate`);
    const res = await post(`/api/runs/${id}/adjustments`, { targetType: "line", targetId: "cr1", amount: 100, reason: "테스트 보정" });
    expect(res.status).toBe(201);
    const rows = ((await getJson(`/api/runs/${id}/adjustments`)) as { items: { createdBy: string }[] }).items;
    expect(rows[0]!.createdBy).toBe("admin@test.local");
    const audits = await getDb(env).select().from(auditLogs).all();
    expect(audits.some((a) => a.action === "adjustment.create" && a.actor === "admin@test.local")).toBe(true);
  });
});
