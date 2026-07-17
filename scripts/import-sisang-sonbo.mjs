// 손보 시상정의(318열 wide) → incentive_plan_definitions SQL 생성 (F-044, B-012 손보 구조화).
// 사용: node scripts/import-sisang-sonbo.mjs "<AT에셋_시상정의(손보).xlsx>" <출력디렉토리>
//   2행 헤더(h0=시상유형·지급시점, h1=대상/기준·값라벨)를 unpivot:
//   데이터행(보험사·보종) × 시상유형 그룹(2컬럼) 중 값셀 non-null만 정의 1행으로.
//   지급율→rate, 지급액/실적기준→fixed. 시상유형→cond1, 대상→cond2, 실적/보종→cond3.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(new URL("../apps/api/", import.meta.url));
const XLSX = require("xlsx");

const SRC = process.argv[2];
const OUT = process.argv[3];
const CREATED_BY = "import:sisang-sonbo-260708";
const CREATED_AT = "2026-07-10T00:00:00.000Z";
const SOURCE_REF = "AT에셋_시상정의(손보).xlsx";

const INSURER_ID = {
  "DB손보": "db-insurance", "흥국화재": "heungkuk-fire", "MG손보": "mg-insurance", "메리츠화재": "meritz-fire",
  "롯데손보": "lotte-insurance", "현대해상": "hyundai-marine", "KB손해": "kb-insurance", "한화손보": "hanwha-general",
  "삼성화재": "samsung-fire", "농협손보": "nh-insurance", "AIG손보": "aig-general", "하나손보": "hana-insurance",
};

const q = (s) => (s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");
const nz = (v) => (v == null || v === "" ? null : String(v).trim());
const GENERIC = /^(보험료기준|실적기준|실적|금액|매월\s*구간기준)$/;

const wb = XLSX.readFile(SRC);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, blankrows: false });
const h0 = rows[0], h1 = rows[1], data = rows.slice(2);

// 시상유형 그룹(2컬럼 단위): h0 non-null 위치
const groups = [];
for (let i = 2; i < h0.length; i++) {
  if (h0[i] != null) {
    const name = String(h0[i]).trim();
    // 지급시점은 마지막 괄호 (예: "전략상품Ⅳ(1)1주(2차년)" → "2차년", "(1)" 아님)
    const parens = [...name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
    groups.push({
      col: i,
      name,                                       // "주력Ⅰ 1주차(익월)"
      timing: parens.length ? parens[parens.length - 1] : null, // 익월/2차년/익익월/익 분기
      type: name.replace(/\s*\([^)]*\)\s*/g, "").trim(),         // 모든 괄호 제거한 시상유형
      header: nz(h1[i]),                          // 대상상품/기준 라벨
      vlabel: nz(h1[i + 1]),                      // 지급율/지급액/실적기준
    });
  }
}

const values = [];
let skipInsurer = 0, rate = 0, fixed = 0;
data.forEach((r, ri) => {
  const insurerName = nz(r[1]);
  const insurerId = INSURER_ID[insurerName];
  if (!insurerId) { skipInsurer++; return; }
  const baseMonth = (String(r[0] ?? "").match(/\d+/g) || ["202401"]).join("").slice(0, 6) || "202401";
  const bojong = nz(r[2]); // 행의 보종
  for (const g of groups) {
    const val = r[g.col + 1];
    if (val == null || val === "" || typeof val !== "number") continue;
    const target = r[g.col]; // 보종(string) | 실적기준(number) | null
    const isBasic = /^(기본시상|추가시상)/.test(g.type);
    const generic = g.header ? GENERIC.test(g.header) || g.header.endsWith("실적기준") : true;
    // product: 기본/추가시상=보종, 그 외=헤더 대상상품(없으면 보종)
    const product = isBasic
      ? (typeof target === "string" ? target : null) || bojong || "(보종미상)"
      : (g.header && !generic ? g.header : bojong || "(대상미상)");
    const isRate = !!(g.vlabel && g.vlabel.includes("지급율"));
    if (isRate) rate++; else fixed++;
    const cond2 = g.header || null; // 원본 대상/기준 라벨 보존
    const cond3 = typeof target === "number" ? `실적기준:${target}` : (typeof target === "string" && target !== product ? target : null);
    const id = `def-sonbo-${baseMonth}-${ri + 1}-${g.col}`;
    values.push("(" + [
      q(id), q(insurerId), q(baseMonth), q("손보"), q(product),
      "NULL", "NULL", q(g.timing), "NULL", "NULL",
      q(g.type), q(cond2), q(cond3),
      q(isRate ? "rate" : "fixed"), val, q(g.vlabel && g.vlabel !== "지급액" && !isRate ? g.vlabel : null),
      q("xlsx"), q(SOURCE_REF), "NULL",
      q(CREATED_BY), q(CREATED_AT),
    ].join(", ") + ")");
  }
});

// insurers는 33개사 세트에 이미 포함(생보 임포터가 생성) → 여기선 정의만.
const COLS = "(id, insurer_id, base_month, line_type, product, pay_term, maturity_term, pay_timing, channel, branch, cond1, cond2, cond3, rate_type, rate_value, note, source_type, source_ref, plan_image_key, created_by, created_at)";
const PER_STMT = 50, PER_FILE = 2000;
let fileIdx = 0;
for (let f = 0; f < values.length; f += PER_FILE) {
  const chunk = values.slice(f, f + PER_FILE);
  let sql = "";
  if (fileIdx === 0) sql += `DELETE FROM incentive_plan_definitions WHERE created_by = ${q(CREATED_BY)};\n`;
  for (let s = 0; s < chunk.length; s += PER_STMT)
    sql += `INSERT INTO incentive_plan_definitions ${COLS} VALUES\n${chunk.slice(s, s + PER_STMT).join(",\n")};\n`;
  writeFileSync(`${OUT}/${String(20 + fileIdx).padStart(2, "0")}_sonbo_${fileIdx}.sql`, sql);
  fileIdx++;
}

console.log(JSON.stringify({ dataRows: data.length, groups: groups.length, loaded: values.length, skipInsurer, rate, fixed, files: fileIdx }, null, 2));
