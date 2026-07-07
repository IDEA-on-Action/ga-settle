/**
 * @ga-settle/golden - 골든 표본 + 변환 성공률 자동 산출 (F-008 Acceptance, NFR-06).
 * 실 원수사 엑셀은 계약상 리포에 못 넣으므로(ktds 자산·인적정보 금지) 합성 표본으로
 * 파이프라인 회귀를 지킨다. 원수사별 실샘플 골든 스냅샷 회귀는 F-021.
 */
import {
  detectHeaderRow, profileColumns, localMap, runConsistency, columnMapOf, validateRows, type Grid,
} from "@ga-settle/mapping";

export type GoldenSample = { name: string; grid: Grid };

// 원수사별 서로 다른 양식(동의어 변형)을 흉내낸 합성 표본. 전부 유효 행.
function build(headers: string[], title: string, n = 12): Grid {
  const g: Grid = [[title], headers];
  for (let i = 1; i <= n; i++) {
    const prem = 100000 + i * 1000;
    const rate = [15, 20, 25, 30][i % 4]!;
    g.push([`C-${i}`, "2026-06-" + String(1 + (i % 27)).padStart(2, "0"), "김설계", prem, rate, Math.round((prem * rate) / 100)]);
  }
  return g;
}

export const GOLDEN_SAMPLES: GoldenSample[] = [
  { name: "A생명(표준)", grid: build(["증권번호", "계약일자", "모집인", "납입보험료", "지급률", "수수료"], "A생명 2026-06 명세서") },
  { name: "B화재(동의어)", grid: build(["계약no", "청약일", "fc명", "월보험료", "지급율", "커미션"], "B화재 6월 지급내역") },
];

export type GoldenResult = { name: string; total: number; ok: number; rate: number };

// 각 표본을 L1 프로파일링 -> 규칙 매핑 -> L3 산식 발굴 -> 행 검증까지 돌려 변환 성공률 산출.
export function runGolden(samples: GoldenSample[] = GOLDEN_SAMPLES): { results: GoldenResult[]; overallRate: number } {
  const results = samples.map((s) => {
    const hIdx = detectHeaderRow(s.grid);
    const { profiles, rows } = profileColumns(s.grid, hIdx);
    const cands = localMap(profiles);
    runConsistency(cands, profiles, rows); // 산식 발굴로 지급수수료 등 보강
    const { staged } = validateRows(rows, columnMapOf(cands));
    return { name: s.name, total: rows.length, ok: staged.length, rate: rows.length ? staged.length / rows.length : 0 };
  });
  const total = results.reduce((a, r) => a + r.total, 0);
  const ok = results.reduce((a, r) => a + r.ok, 0);
  return { results, overallRate: total ? ok / total : 0 };
}
