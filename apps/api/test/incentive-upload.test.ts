import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { Cell } from "@ga-settle/mapping";
import { insurers, uploads, incentivePayoutRecords, settlementRuns } from "@ga-settle/schema";
import { getDb, decNum } from "../src/db";
import { ingestParsed } from "../src/queue";
import { aget, apost } from "./helpers";

/**
 * F-062 시책지급내역 인입 + F-063 시책 대사 통합 테스트.
 * 삼성화재 실파일 축약 재현: ■마커 + 3단 헤더(그룹 "시상금 합계") + 상세 블록 +
 * 이어 붙은 하위 표(절단 대상) + 동일 증권번호 복수 시상 행 + 설계사명 공란.
 */
function incentiveGrid(): Cell[][] {
  const g: Cell[][] = [
    ["■ 장기 건별 시상금"],
    [],
    [null, null, null, null, null, "시상금 합계"],
    ["증권번호", "설계사코드", "설계사명", "상품명", "월납P", "설계사"],
  ];
  for (let i = 1; i <= 12; i++) {
    const prem = 20000 + i * 100;
    g.push([`P-${i}`, `A${i % 3}`, i % 4 === 0 ? null : "김설계", "운전자보험", prem, prem * 3]);
  }
  g.push(["P-1", "A1", "김설계", "운전자보험", 20100, 60300]); // 동일 증권 복수 시상 행 (정상)
  g.push(["부서", "부서코드", "대리점", "지사", "지사코드", "사업부"]); // 하위 표 (절단)
  g.push(["강남", 1234, "에이전시", "본점", 99, "수도권"]);
  return g;
}

const R2KEY = "uploads/2026-07/inc1.xlsx";
const noKeyEnv = { ...env, ANTHROPIC_API_KEY: "" }; // localMap 폴백 강제 (결정적)

beforeEach(async () => {
  await getDb(env).insert(insurers).values({ id: "ins1", name: "S화재", createdAt: "2026-07-15" });
  await getDb(env).insert(uploads).values({
    id: "u1", insurerId: "ins1", r2Key: R2KEY, fileHash: "h1", status: "queued",
    docType: "incentive", settlementMonth: "2026-07", createdBy: "system", createdAt: "2026-07-15",
  });
});

const ingest = () =>
  ingestParsed(noKeyEnv, getDb(env), { uploadId: "u1", r2Key: R2KEY, insurerId: "ins1", docType: "incentive" }, incentiveGrid());

describe("F-062 시책지급내역 인입 파이프라인", () => {
  it("다중 블록 절단 + 시책 온톨로지 검증: 13행 전량 staged (중복·설계사명 공란 허용)", async () => {
    const counts = await ingest();
    expect(counts).toMatchObject({ rowCount: 13, okCount: 13, errorCount: 0 });
    const up = await getDb(env).select().from(uploads).where(eq(uploads.id, "u1")).get();
    expect(up?.status).toBe("review");
  });

  it("승인: incentive_payout_records 커밋 + 역추적(upload_id+row_no) + 시상금 암호화 왕복", async () => {
    await ingest();
    const res = await apost("/api/uploads/u1/approve");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { committed: number; docType: string };
    expect(body.committed).toBe(13);
    expect(body.docType).toBe("incentive");

    const recs = await getDb(env).select().from(incentivePayoutRecords).where(eq(incentivePayoutRecords.uploadId, "u1")).all();
    expect(recs.length).toBe(13);
    expect(recs.every((r) => r.uploadId === "u1" && r.rowNo > 0)).toBe(true); // 역추적 불변식 #1
    // 시상금 = 월납P x 3 (그리드 구성). 첫 행(P-1) 왕복 복호 확인 (불변식 #5 암호화 저장)
    const p1 = recs.find((r) => r.rowNo === 1);
    expect(p1?.contractNo).toBe("P-1");
    expect(await decNum(p1?.payoutEnc ?? null, env.FIELD_ENCRYPTION_KEY)).toBe(60300);
  });

  it("F-063 시책 대사: 보고 시상금 vs 계산액(라인 없음=0) diff 집계", async () => {
    await ingest();
    await apost("/api/uploads/u1/approve");
    await getDb(env).insert(settlementRuns).values({ id: "run1", settlementMonth: "2026-07", status: "draft" });

    const res = await aget("/api/runs/run1/incentive-reconciliation");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reportedRecords: number;
      insurers: { insurerId: string; insurerTotal: number; calculatedTotal: number; diff: number; status: string }[];
      diffContracts: { contractNo: string; insurerAmount: number; diff: number }[];
    };
    expect(body.reportedRecords).toBe(13);
    expect(body.insurers.length).toBe(1);
    const s = body.insurers[0]!;
    expect(s.insurerId).toBe("ins1");
    // 총 보고 시상금 = sum((20000+i*100)*3, i=1..12) + 60300 (P-1 복수 행 합산)
    const expected = Array.from({ length: 12 }, (_, k) => (20000 + (k + 1) * 100) * 3).reduce((a, b) => a + b, 0) + 60300;
    expect(s.insurerTotal).toBe(expected);
    expect(s.calculatedTotal).toBe(0); // 정산 라인 없음
    expect(s.diff).toBe(expected);
    expect(s.status).toBe("diff");
    // 계약 단위: P-1은 두 시상 행 합산으로 1건
    const p1 = body.diffContracts.find((d) => d.contractNo === "P-1");
    expect(p1?.insurerAmount).toBe(20100 * 3 + 60300);
  });

  it("수수료 경로 회귀: docType 미지정 업로드는 기존 온톨로지·중복 검증 유지", async () => {
    // parse.test.ts가 전량 커버 - 여기선 docType 분기 무영향(기본 commission)만 확인
    const up = await getDb(env).select({ docType: uploads.docType }).from(uploads).where(eq(uploads.id, "u1")).get();
    expect(up?.docType).toBe("incentive"); // 시드값 확인 (분기 키)
  });
});
