// 생보 시상정의(xlsx) → insurers + incentive_plan_definitions SQL 생성 (F-044 시상정의 카탈로그).
// 사용: node scripts/import-sisang-saengbo.mjs <시상정의_생보.xlsx> <출력디렉토리>
//   → 00_insurers.sql(33개사) + 1N_defs_*.sql(9,227건, 50행/문 청크)
//   적용: wrangler d1 execute ga-settle-db --local|--remote --file <각 파일 순서대로>
//   idempotent: 정의 첫 파일에 DELETE WHERE created_by=import:sisang-saengbo-260708 포함.
// 이력: v1은 incentive_rules(lossy)를 대상으로 했으나 F-044에서 전용 테이블로 이관(무손실).
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(new URL("../apps/api/", import.meta.url));
const XLSX = require("xlsx");

const SRC = process.argv[2];
const OUT = process.argv[3];
const CREATED_BY = "import:sisang-saengbo-260708";
const CREATED_AT = "2026-07-10T00:00:00.000Z";
const SOURCE_REF = "시상정의_생보.xlsx";

// 파일 보험사명 → insurer id (기존 26개 매칭 + 신규 7개)
const INSURER_ID = {
  "ABL생명": "abl-life", "DB생명": "db-life", "IBK연금보험": "ibk-pension", "iM라이프": "im-life",
  "KB라이프": "kb-life", "KDB생명": "kdb-life", "NH농협생명": "nh-life", "교보생명": "kyobo-life",
  "동양생명": "dongyang-life", "라이나생명": "lina-life", "메트라이프": "metlife", "미래에셋생명": "miraeasset-life",
  "삼성생명": "samsung-life", "신한라이프": "shinhan-life", "카디프생명": "cardif-life", "하나생명": "hana-life",
  "한화생명": "hanwha-life", "흥국생명": "heungkuk-life",
  "DB손보": "db-insurance", "흥국화재": "heungkuk-fire", "MG손보": "mg-insurance", "메리츠화재": "meritz-fire",
  "롯데손보": "lotte-insurance", "현대해상": "hyundai-marine", "KB손해": "kb-insurance", "한화손보": "hanwha-general",
  "삼성화재": "samsung-fire", "농협손보": "nh-insurance", "AIG손보": "aig-general", "하나손보": "hana-insurance",
};
// 원수사 마스터 33개사 (기존 26 + 신규 7), INSERT OR IGNORE (prod 기존 무영향)
const ALL_INSURERS = [
  ["aia-life", "AIA생명"], ["axa-general", "AXA손해보험"], ["db-life", "DB생명"], ["db-insurance", "DB손해보험"],
  ["kb-life", "KB라이프생명"], ["kb-insurance", "KB손해보험"], ["mg-insurance", "MG손해보험"], ["nh-life", "NH농협생명"],
  ["nh-insurance", "NH농협손해보험"], ["kyobo-life", "교보생명"], ["dongyang-life", "동양생명"], ["lina-life", "라이나생명"],
  ["lotte-insurance", "롯데손해보험"], ["meritz-fire", "메리츠화재"], ["metlife", "메트라이프생명"], ["miraeasset-life", "미래에셋생명"],
  ["samsung-life", "삼성생명"], ["samsung-fire", "삼성화재"], ["shinhan-life", "신한라이프"], ["fubon-hyundai-life", "푸본현대생명"],
  ["hana-insurance", "하나손해보험"], ["hanwha-life", "한화생명"], ["hanwha-general", "한화손해보험"], ["hyundai-marine", "현대해상"],
  ["heungkuk-life", "흥국생명"], ["heungkuk-fire", "흥국화재"],
  ["abl-life", "ABL생명"], ["ibk-pension", "IBK연금보험"], ["im-life", "iM라이프"], ["kdb-life", "KDB생명"],
  ["cardif-life", "카디프생명"], ["hana-life", "하나생명"], ["aig-general", "AIG손해보험"],
];

const q = (s) => (s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");

// --- 00_insurers.sql ---
let insSql = "-- 원수사 마스터 33개사, INSERT OR IGNORE\n";
for (const [id, name] of ALL_INSURERS)
  insSql += `INSERT OR IGNORE INTO insurers (id, name, created_at) VALUES (${q(id)}, ${q(name)}, ${q(CREATED_AT)});\n`;
writeFileSync(`${OUT}/00_insurers.sql`, insSql);

// --- 생보 rows → incentive_plan_definitions ---
const wb = XLSX.readFile(SRC);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, blankrows: false }).slice(1);
// 컬럼: 0기준월 1손생보 2보험사 3상품1 4상품2 5납입기간 6지급시점 7채널 8지점 9조건1 10조건2 11조건3 12적용률 13비고
// 만기기간(maturity_term, F-060)은 현 시트에 열이 없음 → NULL로 관통(스키마 정합). 향후 만기 열 추가 시 여기서 매핑.
const nz = (v) => (v == null || v === "" ? null : String(v).trim());

const values = [];
let skipNull = 0, skipInsurer = 0, rate = 0, fixed = 0;
rows.forEach((r, i) => {
  const rv = r[12];
  if (rv == null || rv === "" || typeof rv !== "number") { skipNull++; return; }
  const insurerName = nz(r[2]);
  const insurerId = INSURER_ID[insurerName];
  if (!insurerId) { skipInsurer++; return; }
  const baseMonth = String(r[0]); // 202605
  const lineType = nz(r[1]);
  const product = [nz(r[3]), nz(r[4])].filter(Boolean).join(" ") || "(상품미상)";
  const rateType = rv < 100 ? "rate" : "fixed";
  if (rv < 100) rate++; else fixed++;
  const id = `def-sib-${baseMonth}-${i + 1}`;
  values.push(
    "(" + [
      q(id), q(insurerId), q(baseMonth), q(lineType), q(product),
      q(nz(r[5])), "NULL", q(nz(r[6])), q(nz(r[7])), q(nz(r[8])),
      q(nz(r[9])), q(nz(r[10])), q(nz(r[11])),
      q(rateType), rv, q(nz(r[13])),
      q("xlsx"), q(SOURCE_REF), "NULL",
      q(CREATED_BY), q(CREATED_AT),
    ].join(", ") + ")",
  );
});

const COLS = "(id, insurer_id, base_month, line_type, product, pay_term, maturity_term, pay_timing, channel, branch, cond1, cond2, cond3, rate_type, rate_value, note, source_type, source_ref, plan_image_key, created_by, created_at)";
const PER_STMT = 50, PER_FILE = 2000;
let fileIdx = 0;
for (let f = 0; f < values.length; f += PER_FILE) {
  const chunk = values.slice(f, f + PER_FILE);
  let sql = "";
  if (fileIdx === 0) sql += `DELETE FROM incentive_plan_definitions WHERE created_by = ${q(CREATED_BY)};\n`;
  for (let s = 0; s < chunk.length; s += PER_STMT)
    sql += `INSERT INTO incentive_plan_definitions ${COLS} VALUES\n${chunk.slice(s, s + PER_STMT).join(",\n")};\n`;
  writeFileSync(`${OUT}/${String(10 + fileIdx).padStart(2, "0")}_defs_${fileIdx}.sql`, sql);
  fileIdx++;
}

console.log(JSON.stringify({ total: rows.length, loaded: values.length, skipNull, skipInsurer, rate, fixed, files: fileIdx }, null, 2));
