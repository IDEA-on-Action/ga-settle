import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import type { Cell } from "@ga-settle/mapping";
import { insurers } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { ingestParsed } from "../src/queue";

// F-021 핵심 흐름 E2E (API 레벨): 업로드/파싱 -> 매핑확정 -> 승인원장 -> 정산 -> 대사 -> 내역서 -> 마감.
// (브라우저 Playwright E2E는 SPA 화면 필요 -> B-006 backlog. 로직 관통은 여기서 실측.)
const post = (path: string, body: unknown = {}) =>
  SELF.fetch(`https://x${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const getJson = async (path: string) => (await SELF.fetch(`https://x${path}`)).json();

// 12 valid 행. FC사번 -> 설계사코드(=agentId), 항목A -> 지급수수료(산식 발굴).
function grid(): Cell[][] {
  const g: Cell[][] = [["A생명 2026-06 명세서"], ["증권No", "계약일", "FC사번", "FC성명", "실적보험료", "지급율", "항목A"]];
  for (let i = 1; i <= 12; i++) {
    const prem = 100000 + i * 1000;
    const rate = [15, 20, 25, 30][i % 4]!;
    g.push([`P-${i}`, "2026-06-" + String(i).padStart(2, "0"), "F1", "홍길동", prem, rate, Math.round((prem * rate) / 100)]);
  }
  return g;
}

beforeEach(async () => {
  await getDb(env).insert(insurers).values({ id: "ins1", name: "A생명", createdAt: "2026-07-07" });
  await post("/api/org/units", { id: "team1", name: "1팀", kind: "team" });
  await post("/api/agents", { id: "F1", code: "F1", name: "홍길동" });
  await post("/api/agents/F1/assignments", { orgUnitId: "team1", validFrom: "2026-01-01" });
  await post("/api/rules", { name: "6월시책", priority: 10, overlapPolicy: "stack", condition: { period: { from: "2026-06-01", to: "2026-06-30" }, insurerIds: ["ins1"] }, action: { kind: "rate", rate: 0.1 } });
});

describe("F-021 핵심 흐름 E2E (API 관통)", () => {
  it("업로드→파싱→매핑확정→승인→정산→대사→내역서→마감", async () => {
    const db = getDb(env);
    const r2Key = "uploads/2026-06/u1.xlsx";
    // (1) 업로드 + 파싱: upload 레코드 + ingestParsed(파서 시뮬)
    await db.insert((await import("@ga-settle/schema")).uploads).values({ id: "u1", insurerId: "ins1", r2Key, fileHash: "h1", status: "queued", settlementMonth: "2026-06", createdBy: "system", createdAt: "2026-07-07" });
    const counts = await ingestParsed(env, db, { uploadId: "u1", r2Key, insurerId: "ins1" }, grid());
    expect(counts).toMatchObject({ rowCount: 12, okCount: 12, errorCount: 0 });
    expect(((await getJson("/api/uploads/u1")) as { status: string }).status).toBe("review");

    // (2) 매핑 확정 -> TemplateVersion
    const headers = grid()[1] as string[];
    const confirm = await post("/api/uploads/u1/mapping/confirm", { headers, columnMap: { 계약번호: 0 } });
    expect(confirm.status).toBe(201);

    // (3) 승인 -> 원장 커밋
    expect((await post("/api/uploads/u1/approve")).status).toBe(200);

    // (4) 정산 run + 계산
    const { id: runId } = (await (await post("/api/runs", { settlementMonth: "2026-06" })).json()) as { id: string };
    const calc = (await (await post(`/api/runs/${runId}/calculate`)).json()) as { lines: number; totalAmount: number };
    expect(calc.lines).toBe(12);
    expect(calc.totalAmount).toBeGreaterThan(0);

    // (5) 대사
    const recon = (await getJson(`/api/runs/${runId}/reconciliation`)) as { insurers: unknown[] };
    expect(recon.insurers.length).toBeGreaterThanOrEqual(1);

    // (6) 지급 내역서 (설계사 F1 롤업)
    await post(`/api/runs/${runId}/payslips`);
    const slip = (await getJson(`/api/runs/${runId}/payslips/F1`)) as { total: number; lines: unknown[] };
    expect(slip.total).toBe(calc.totalAmount);
    expect(slip.lines).toHaveLength(12);

    // (7) 마감 -> 이중 잠금(재계산 409)
    expect((await post(`/api/runs/${runId}/close`, { closedBy: "admin" })).status).toBe(200);
    expect((await post(`/api/runs/${runId}/calculate`)).status).toBe(409);
  });
});
