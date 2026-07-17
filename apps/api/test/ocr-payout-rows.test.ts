import { describe, it, expect } from "vitest";
import { coercePayoutRows } from "../src/ocr";

// F-052/F-060: 생보 납입기간·만기기간별 지급율 다중행 정규화(LLM payoutRows[] → {payTerm,maturityTerm,payTiming,rate}).
describe("coercePayoutRows (F-052/F-060 생보 납입기간·만기기간별 지급율)", () => {
  it("ABL생명 예시: 5년납/7년납 × 익월/13차월 4행 정규화 (만기 미검출 → null)", () => {
    const rows = coercePayoutRows([
      { payTerm: "5년납", payTiming: "익월", rate: "150%" },
      { payTerm: "5년납", payTiming: "13차월", rate: "0" },
      { payTerm: "7년납", payTiming: "익월", rate: "250%" },
      { payTerm: "7년납", payTiming: "13차월", rate: "100%" },
    ]);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual({ payTerm: "5년납", maturityTerm: null, payTiming: "13차월", rate: "0" });
    expect(rows[2]!.rate).toBe("250%");
  });

  it("F-060: 만기기간이 있으면 추출(20년만기/종신), 상품·납입기간 같아도 만기별 별도 행", () => {
    const rows = coercePayoutRows([
      { payTerm: "5년납", maturityTerm: "20년만기", payTiming: "익월", rate: "150%" },
      { payTerm: "5년납", maturityTerm: "종신", payTiming: "익월", rate: "250%" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ payTerm: "5년납", maturityTerm: "20년만기", payTiming: "익월", rate: "150%" });
    expect(rows[1]!.maturityTerm).toBe("종신");
  });

  it("F-060: 만기기간만 있고 납입기간 없는 행도 유지(부분값)", () => {
    const rows = coercePayoutRows([{ maturityTerm: "20년만기", payTiming: null, rate: "120%" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ payTerm: null, maturityTerm: "20년만기", payTiming: null, rate: "120%" });
  });

  it("배열 아니면 빈 배열(구분 없는 손보 등)", () => {
    expect(coercePayoutRows(null)).toEqual([]);
    expect(coercePayoutRows("x")).toEqual([]);
    expect(coercePayoutRows([])).toEqual([]);
  });

  it("셋 다 빈 행은 제거, 부분값은 유지", () => {
    const rows = coercePayoutRows([
      { payTerm: "", payTiming: "", rate: "" },
      { payTerm: "5년납", payTiming: null, rate: null },
      { foo: "bar" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ payTerm: "5년납", maturityTerm: null, payTiming: null, rate: null });
  });

  it("중첩/배열 값도 문자열로 평탄화", () => {
    const rows = coercePayoutRows([{ payTerm: "5년납", payTiming: "익월", rate: ["150%", "160%"] }]);
    expect(rows[0]!.rate).toBe("150% · 160%");
  });
});
