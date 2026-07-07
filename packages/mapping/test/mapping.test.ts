/**
 * 2026-07-07 프로토타입 검증 케이스 이식 (F-004~F-006 기준 테스트).
 * 시나리오: 무의미 헤더('항목A')를 산식 발굴로 지급수수료에 매핑, % 스케일 자동 감지,
 * 오염 데이터 자동 확정 강등, 온톨로지 학습 동의어 반영.
 */
import { describe, it, expect } from "vitest";
import {
  ONTOLOGY, norm, parseDate, parseNumber, maskSample, detectHeaderRow,
  profileColumns, localMap, feeFormulaCheck, runConsistency, applyEvidence,
  type Grid,
} from "../src/index";

function sampleGrid(): Grid {
  const headers = ["증권No", "계약체결일", "계약자성명", "계약자생년월", "FC사번", "FC성명", "주계약명", "수금회차", "실적보험료", "지급율(%)", "항목A", "환수공제액"];
  const g: Grid = [["B화재 2026년 6월 지급명세서"], [], headers];
  for (let i = 1; i <= 120; i++) {
    const prem = 100000 + i * 1000;
    const ratePct = [15, 20, 25, 30][i % 4]!;
    g.push(["BH" + (202600000 + i), "2026-06-" + String(1 + (i % 27)).padStart(2, "0"), "김민수", "800101",
      "FC" + (1000 + (i % 23)), "이서연", "종신보험", 1 + (i % 12), prem, ratePct, Math.round((prem * ratePct) / 100), 0]);
  }
  return g;
}

describe("파서", () => {
  it("날짜: 다양한 형식 + yymmdd 생년월일 + 잘못된 날짜 거부", () => {
    expect(parseDate("2026-06-15")).toEqual({ ok: true, value: "2026-06-15" });
    expect(parseDate("2026.6.5")).toEqual({ ok: true, value: "2026-06-05" });
    expect(parseDate("20260615")).toEqual({ ok: true, value: "2026-06-15" });
    expect(parseDate("800101")).toEqual({ ok: true, value: "1980-01-01" });
    expect(parseDate("26년6월32일").ok).toBe(false);
  });
  it("숫자: 통화 표기 허용, 텍스트 거부", () => {
    expect(parseNumber("1,234,500원")).toEqual({ ok: true, value: 1234500 });
    expect(parseNumber("십만원").ok).toBe(false);
  });
  it("마스킹: 성명/번호류", () => {
    expect(maskSample("김민수")).toBe("김**");
    expect(maskSample("19800101")).toBe("198*****");
    expect(maskSample("BH202600001")).toBe("BH202600001");
  });
});

describe("L1 프로파일링 + 헤더 감지", () => {
  it("제목/빈 행을 건너뛰고 헤더 행을 찾는다", () => {
    expect(detectHeaderRow(sampleGrid())).toBe(2);
  });
  it("열 타입 분포를 산출한다", () => {
    const { profiles } = profileColumns(sampleGrid(), 2);
    expect(profiles).toHaveLength(12);
    expect(profiles[8]!.numericRate).toBeGreaterThan(0.99); // 실적보험료
    expect(profiles[1]!.dateRate).toBeGreaterThan(0.99);    // 계약체결일
  });
});

describe("L2 규칙 엔진 -> L3 산식 발굴 -> L4 등급", () => {
  it("무의미 헤더 '항목A'는 이름으로 못 잡지만 산식 발굴로 지급수수료에 매핑된다", () => {
    const { profiles, rows } = profileColumns(sampleGrid(), 2);
    const cands = localMap(profiles);
    expect(cands["보험료"]?.ci).toBe(8);
    expect(cands["수수료율"]?.ci).toBe(9);
    expect(cands["지급수수료"]).toBeUndefined(); // 이름 기반 미매핑이 정상

    const evs = runConsistency(cands, profiles, rows);
    expect(cands["지급수수료"]?.ci).toBe(10);          // 산식 발굴
    expect(cands["지급수수료"]?.source).toBe("evidence");
    const disc = evs.find((e) => e.id === "formula-discover");
    expect(disc?.passRate).toBeGreaterThanOrEqual(0.9);

    applyEvidence(cands, evs, "local");
    expect(cands["지급수수료"]?.grade).toBe("auto");   // pass 증거로 상향
  });

  it("% 단위 지급율을 자동 감지해 /100 스케일을 적용한다", () => {
    const { rows } = profileColumns(sampleGrid(), 2);
    const r = feeFormulaCheck(8, 9, 10, rows);
    expect(r.scale).toBe(100);
    expect(r.passRate).toBeGreaterThanOrEqual(0.99);
  });

  it("오염된 수수료율 열은 자동 확정되지 않는다", () => {
    const g = sampleGrid().map((r) => r.slice());
    for (let i = 3; i < 80; i++) g[i]![9] = "이십퍼센트";
    const { profiles, rows } = profileColumns(g, 2);
    const cands = localMap(profiles);
    if (cands["수수료율"]) {
      const evs = runConsistency(cands, profiles, rows);
      applyEvidence(cands, evs, "local");
      expect(cands["수수료율"].grade).not.toBe("auto");
    }
  });

  it("온톨로지 학습 동의어가 있으면 이름만으로 즉시 매핑된다", () => {
    const { profiles } = profileColumns(sampleGrid(), 2);
    const cands = localMap(profiles, { [norm("항목A")]: "지급수수료" });
    expect(cands["지급수수료"]?.ci).toBe(10);
  });

  it("온톨로지 필수 필드 정의가 유지된다 (SPEC 정합)", () => {
    const required = ONTOLOGY.filter((f) => f.required).map((f) => f.key);
    expect(required).toEqual(["계약번호", "설계사명", "지급수수료"]);
  });
});
