// 생보 시상정의(xlsx) → insurers + incentive_rules SQL 생성 (F-043 후속 데이터 반영).
// 사용: node scripts/import-sisang-saengbo.mjs <시상정의_생보.xlsx> <출력디렉토리>
//   → 00_insurers.sql(신규 7개사) + 1N_rules_*.sql(9,227건, 50행/문 청크)
//   적용: wrangler d1 execute ga-settle-db --local|--remote --file <각 파일 순서대로>
//   idempotent: 규칙 첫 파일에 DELETE WHERE created_by=import:sisang-saengbo-260708 포함.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
// xlsx는 apps/api 워크스페이스에 설치돼 있어 그 기준으로 resolve.
const require = createRequire(new URL("../apps/api/", import.meta.url));
const XLSX = require("xlsx");

const SRC = process.argv[2];
const OUT = process.argv[3];
const CREATED_BY = "import:sisang-saengbo-260708";
const CREATED_AT = "2026-07-10T00:00:00.000Z";

// 파일 보험사명 → insurer id (기존 26개 매칭 + 신규 7개)
const INSURER_ID = {
  "ABL생명": "abl-life", "DB생명": "db-life", "IBK연금보험": "ibk-pension", "iM라이프": "im-life",
  "KB라이프": "kb-life", "KDB생명": "kdb-life", "NH농협생명": "nh-life", "교보생명": "kyobo-life",
  "동양생명": "dongyang-life", "라이나생명": "lina-life", "메트라이프": "metlife", "미래에셋생명": "miraeasset-life",
  "삼성생명": "samsung-life", "신한라이프": "shinhan-life", "카디프생명": "cardif-life", "하나생명": "hana-life",
  "한화생명": "hanwha-life", "흥국생명": "heungkuk-life",
  // 손보(마스터 완성용, 규칙 import 대상 아님)
  "DB손보": "db-insurance", "흥국화재": "heungkuk-fire", "MG손보": "mg-insurance", "메리츠화재": "meritz-fire",
  "롯데손보": "lotte-insurance", "현대해상": "hyundai-marine", "KB손해": "kb-insurance", "한화손보": "hanwha-general",
  "삼성화재": "samsung-fire", "농협손보": "nh-insurance", "AIG손보": "aig-general", "하나손보": "hana-insurance",
};
// 기존 26개에 없어 신규 생성할 보험사 (id → 정식명)
const NEW_INSURERS = {
  "abl-life": "ABL생명", "ibk-pension": "IBK연금보험", "im-life": "iM라이프", "kdb-life": "KDB생명",
  "cardif-life": "카디프생명", "hana-life": "하나생명", "aig-general": "AIG손해보험",
};

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const monthEnd = (y, m) => new Date(y, m, 0).getDate(); // m=1-12

// --- insurers.sql (신규 7개, INSERT OR IGNORE) ---
let insSql = "-- 신규 원수사 (기존 26개에 없는 7개사). 기존 id는 그대로 재사용.\n";
for (const [id, name] of Object.entries(NEW_INSURERS)) {
  insSql += `INSERT OR IGNORE INTO insurers (id, name, created_at) VALUES (${q(id)}, ${q(name)}, ${q(CREATED_AT)});\n`;
}
writeFileSync(`${OUT}/00_insurers.sql`, insSql);

// --- 생보 rows → incentive_rules ---
const wb = XLSX.readFile(SRC);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, blankrows: false }).slice(1);
// 컬럼: 0기준월 1손생보 2보험사 3상품1 4상품2 5납입기간 6지급시점 7채널 8지점 9조건1 10조건2 11조건3 12적용률 13비고
const nz = (v) => (v == null || v === "" ? null : String(v).trim());

const values = [];
let skipNull = 0, skipInsurer = 0, rate = 0, fixed = 0;
rows.forEach((r, i) => {
  const rateVal = r[12];
  if (rateVal == null || rateVal === "" || typeof rateVal !== "number") { skipNull++; return; }
  const insurerName = nz(r[2]);
  const insurerId = INSURER_ID[insurerName];
  if (!insurerId) { skipInsurer++; return; }
  const ym = String(r[0]);            // 202605
  const y = +ym.slice(0, 4), m = +ym.slice(4, 6);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const to = `${y}-${String(m).padStart(2, "0")}-${String(monthEnd(y, m)).padStart(2, "0")}`;
  const prod1 = nz(r[3]), prod2 = nz(r[4]);
  const payTerm = nz(r[5]), payTiming = nz(r[6]), channel = nz(r[7]), branch = nz(r[8]);
  const c1 = nz(r[9]), c2 = nz(r[10]), c3 = nz(r[11]), note = nz(r[13]);
  const product = [prod1, prod2].filter(Boolean).join(" ") || "(상품미상)";

  const action = rateVal < 100 ? { kind: "rate", rate: rateVal } : { kind: "fixed", amount: rateVal };
  if (rateVal < 100) rate++; else fixed++;

  const source = {}; // 스키마 미보유 차원 원형 보존
  for (const [k, v] of Object.entries({ payTerm, payTiming, channel, branch, cond1: c1, cond2: c2, cond3: c3, note }))
    if (v) source[k] = v;

  const condition = {
    condition: {
      period: { from, to },
      insurerIds: [insurerId],
      productPatterns: prod1 ? [prod1] : [],
    },
    overlapPolicy: "exclusive",
    _source: source,
  };
  const name = `[생보] ${insurerName} ${product}` + (payTerm ? ` ${payTerm}` : "") + (payTiming ? `/${payTiming}` : "") + (channel ? ` ${channel}` : "");
  const id = `sib-${ym}-${i + 1}`;
  values.push(
    `(${q(id)}, ${q(name)}, ${q(JSON.stringify(condition))}, ${q(JSON.stringify(action))}, 0, ${q(from)}, NULL, 1, ${q(CREATED_BY)}, ${q(CREATED_AT)})`
  );
});

// 청크 파일: 250행/INSERT, 2000행/파일
const COLS = "(id, name, condition_json, action_json, priority, valid_from, valid_to, active, created_by, created_at)";
const PER_STMT = 50, PER_FILE = 2000;
let fileIdx = 0;
for (let f = 0; f < values.length; f += PER_FILE) {
  const chunk = values.slice(f, f + PER_FILE);
  let sql = "";
  if (fileIdx === 0) sql += `DELETE FROM incentive_rules WHERE created_by = ${q(CREATED_BY)};\n`; // 재적용 idempotent
  for (let s = 0; s < chunk.length; s += PER_STMT) {
    const stmt = chunk.slice(s, s + PER_STMT);
    sql += `INSERT INTO incentive_rules ${COLS} VALUES\n${stmt.join(",\n")};\n`;
  }
  writeFileSync(`${OUT}/${String(10 + fileIdx).padStart(2, "0")}_rules_${fileIdx}.sql`, sql);
  fileIdx++;
}

console.log(JSON.stringify({ total: rows.length, loaded: values.length, skipNull, skipInsurer, rate, fixed, files: fileIdx, newInsurers: Object.keys(NEW_INSURERS).length }, null, 2));
