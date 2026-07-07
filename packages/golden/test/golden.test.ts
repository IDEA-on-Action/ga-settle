import { describe, it, expect } from "vitest";
import { runGolden } from "../src/index";

// F-008 Acceptance: 골든 표본 변환 성공률 자동 산출. (실샘플 회귀는 F-021)
describe("골든 변환 성공률", () => {
  it("합성 표본 전체 변환 성공률 >= 99%", () => {
    const { results, overallRate } = runGolden();
    // 자동 산출 리포트 출력
    console.log("[golden]", results.map((r) => `${r.name} ${(r.rate * 100).toFixed(0)}% (${r.ok}/${r.total})`).join(" · "), `| 전체 ${(overallRate * 100).toFixed(1)}%`);
    expect(overallRate).toBeGreaterThanOrEqual(0.99);
    for (const r of results) expect(r.total).toBeGreaterThan(0);
  });
});
