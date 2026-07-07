/**
 * 2026-07-07 프로토타입 검증 케이스 이식 (F-004~F-006 기준 테스트).
 * 시나리오: 무의미 헤더('항목A')를 산식 발굴로 지급수수료에 매핑, % 스케일 자동 감지,
 * 오염 데이터 자동 확정 강등, 온톨로지 학습 동의어 반영.
 */
import { describe, it, expect } from "vitest";
import {
  ONTOLOGY, norm, parseDate, parseNumber, maskSample, detectHeaderRow,
  profileColumns, inferType, localMap, feeFormulaCheck, runConsistency, applyEvidence,
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

describe("L1 REQ-007 산출물 (F-004)", () => {
  const grid: Grid = [
    ["명세서 제목"],
    ["증권", "보험료", "계약일", "설계사"],
    ["A-1", "100000", "2026-06-01", "김철수"],
    ["A-2", "200000", "2026-06-02", "김철수"],
    ["A-3", "", "2026-06-03", "이영희"],   // 보험료 빈 셀 1건
    ["A-4", "400000", "bad-date", "김철수"], // 계약일 노이즈 1건
  ];
  const { profiles } = profileColumns(grid, detectHeaderRow(grid));
  const col = (h: string) => profiles.find((p) => p.header === h)!;

  it("헤더 행을 찾는다", () => expect(detectHeaderRow(grid)).toBe(1));

  it("널률: 빈 셀 비율", () => {
    expect(col("보험료").nullRate).toBeCloseTo(0.25); // 4행 중 1 빈값
    expect(col("계약일").nullRate).toBe(0);
  });

  it("유니크: distinctRatio", () => {
    expect(col("증권").distinctRatio).toBe(1);          // 전부 고유
    expect(col("설계사").distinctRatio).toBeCloseTo(0.5); // 김철수/이영희
  });

  it("수치범위: min/max/avg (빈 셀 제외)", () => {
    const p = col("보험료");
    expect(p.numMin).toBe(100000);
    expect(p.numMax).toBe(400000);
    expect(p.numAvg).toBeCloseTo((100000 + 200000 + 400000) / 3);
  });

  it("표본: distinct 최대 8개", () => {
    expect(col("설계사").samples).toEqual(["김철수", "이영희"]);
    expect(col("증권").samples.length).toBeLessThanOrEqual(8);
  });

  it("inferType: 대표 타입은 number/date/text (int 배제, 날짜 우선)", () => {
    expect(col("보험료").type).toBe("number");
    expect(col("계약일").type).toBe("date");   // dateRate 0.75, 노이즈 있어도 우세
    expect(col("설계사").type).toBe("text");
    expect(col("증권").type).toBe("text");
    expect(inferType({ numericRate: 1, dateRate: 1 })).toBe("date");  // yymmdd 겹침 -> 날짜
    expect(inferType({ numericRate: 1, dateRate: 0 })).toBe("number");
    expect(inferType({ numericRate: 0.3, dateRate: 0.2 })).toBe("text");
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
