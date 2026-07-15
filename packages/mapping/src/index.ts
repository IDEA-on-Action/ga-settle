/**
 * @ga-settle/mapping - AI 온톨로지 매핑 코어 (L0~L4, 아키텍처 문서 §5)
 * 순수 TS: 브라우저(미리보기)와 Worker(파이프라인) 양쪽에서 사용.
 * 2026-07-07 프로토타입에서 로직 검증 완료 (산식 발굴, % 스케일 감지, 오염 데이터 강등).
 * L2 LLM 호출부는 apps/api 쪽 어댑터가 담당 - 이 패키지는 프롬프트 입력(프로파일)과
 * 출력 해석/보정(신뢰도 결합)만 다룬다. LLM은 후보/근거만, 확정은 검증 또는 사람.
 */

export type FieldType = "text" | "number" | "int" | "date";
export type OntologyField = {
  key: string; required: boolean; type: FieldType;
  desc: string; unit?: string; syn: string[];
};

export const ONTOLOGY: OntologyField[] = [
  { key: "계약번호", required: true, type: "text", desc: "보험 계약(증권) 고유 번호. 회차별 반복 등장 가능", syn: ["증권번호", "계약no", "policyno", "증번", "증권no"] },
  { key: "계약일", required: false, type: "date", desc: "계약 체결(성립) 날짜", syn: ["계약일자", "청약일", "성립일", "개시일", "계약체결일"] },
  { key: "계약자명", required: false, type: "text", desc: "계약자(고객) 성명", syn: ["계약자", "고객명", "계약자성명"] },
  { key: "계약자생년월일", required: false, type: "date", desc: "계약자 생년월일 (yymmdd 6자리 흔함)", syn: ["생년월일", "계약자생년월"] },
  { key: "설계사코드", required: false, type: "text", desc: "설계사(모집인) 사번/코드", syn: ["모집인코드", "사원코드", "fc코드", "설계사번호", "모집자코드", "사번", "fc사번"] },
  { key: "설계사명", required: true, type: "text", desc: "설계사(모집인) 성명", syn: ["모집인", "모집자", "fc명", "설계사", "모집인명", "모집자명", "fc성명"] },
  { key: "상품명", required: false, type: "text", desc: "보험 상품 이름", syn: ["상품", "보험상품명", "상품명칭", "주계약명"] },
  { key: "납입회차", required: false, type: "int", desc: "보험료 납입 회차 (1 이상 정수)", syn: ["회차", "납회차", "납입차수", "수금회차"] },
  { key: "보험료", required: false, type: "number", unit: "원", desc: "납입(영수) 보험료 금액", syn: ["월보험료", "납입보험료", "초회보험료", "영수보험료", "실적보험료"] },
  { key: "수수료율", required: false, type: "number", unit: "비율(0-1) 또는 %", desc: "수수료 지급률", syn: ["지급률", "지급율", "수수료율"] },
  { key: "지급수수료", required: true, type: "number", unit: "원", desc: "설계사 지급 수수료 금액", syn: ["수수료", "지급액", "수수료금액", "커미션", "지급수수료액"] },
  { key: "환수금액", required: false, type: "number", unit: "원", desc: "해약 등 차감(환수) 수수료", syn: ["환수", "환수액", "환수수수료", "환수공제액"] },
];

export const RELATION_DESC =
  "핵심 관계: 지급수수료 ≈ 보험료 x 수수료율 (수수료율이 % 단위면 100으로 나눔). 환수금액 <= 지급수수료가 일반적.";

/**
 * 시책지급내역(시상금) 온톨로지 (F-062). 수수료와 달리 설계사명 공란이 흔해(삼성화재 실측
 * 444/933행) 필수는 계약번호+시상금만. 같은 증권번호가 시상 항목별로 반복 등장할 수 있어
 * 중복 검증도 미적용(validateRows dedupe=false).
 */
export const INCENTIVE_ONTOLOGY: OntologyField[] = [
  { key: "계약번호", required: true, type: "text", desc: "보험 계약(증권) 고유 번호. 시상 항목별 반복 등장 가능", syn: ["증권번호", "계약no", "policyno", "증번", "증권no"] },
  { key: "설계사코드", required: false, type: "text", desc: "설계사(모집인) 사번/코드", syn: ["모집인코드", "사원코드", "fc코드", "설계사번호", "ga설계사", "사번", "fc사번", "최종설계사"] },
  { key: "설계사명", required: false, type: "text", desc: "설계사(모집인) 성명. 공란 흔함", syn: ["모집인", "모집자", "fc명", "설계사", "모집인명", "fc성명"] },
  { key: "상품명", required: false, type: "text", desc: "보험 상품 이름", syn: ["상품", "보험상품명", "상품명칭", "주계약명"] },
  { key: "실적일자", required: false, type: "date", desc: "실적(계약/청약) 일자", syn: ["실적일", "계약일", "계약일자", "청약일", "성립일"] },
  { key: "보험료", required: false, type: "number", unit: "원", desc: "시상 산정 기준 보험료(월납/보장 보험료)", syn: ["월납p", "월납보험료", "보장p", "실적보험료", "납입보험료"] },
  { key: "시상금", required: true, type: "number", unit: "원", desc: "지급 시상금 금액(합계 우선)", syn: ["시상금액", "시상금합계", "지급시상금", "총시상금", "인센티브", "시책지급액"] },
  { key: "시상율", required: false, type: "number", unit: "비율(0-1) 또는 %", desc: "시상 지급률", syn: ["시상률", "지급률", "지급율"] },
  { key: "시상항목", required: false, type: "text", desc: "시상(시책) 항목/유형 이름", syn: ["시상명", "시상유형", "시책명", "시상구분"] },
];

export const INCENTIVE_RELATION_DESC =
  "핵심 관계: 시상금 ≈ 기준 실적(보험료) x 시상율 (시상율이 % 단위면 100으로 나눔). 시상금 합계 열이 있으면 항목별 시상금보다 합계를 우선 매핑.";

export const AUTO_TH = 0.88;
export const REVIEW_TH = 0.5;

export type Cell = string | number | Date | null | undefined;
export type Grid = Cell[][];

// 데이터에서 관측 가능한 대표 타입. int/number 구분은 온톨로지(의미)의 몫이라 여기선 제외.
export type ColumnType = "text" | "number" | "date";

export type ColumnProfile = {
  ci: number; header: string; count: number; total: number;
  nullRate: number; numericRate: number; dateRate: number; distinctRatio: number;
  numAvg: number | null; numMin: number | null; numMax: number | null;
  samples: string[]; type: ColumnType;
  groupHeader?: string; // 다단 헤더 그룹 라벨 (F-062, extractGroupHeaders 주입 시)
};

export type Candidate = {
  ci: number; confidence: number; reason: string;
  source: "cache" | "ai" | "local" | "evidence" | "manual";
  grade?: "auto" | "review" | "manual";
  judge?: "agree" | "disagree"; judgeComment?: string;
};
export type CandidateMap = Record<string, Candidate>;

export type Evidence = {
  id: string; label: string; fields: string[];
  passRate: number; n: number; verdict: "pass" | "fail" | "warn" | "skip";
};

/* ---------------- 공통 파서 ---------------- */
export const norm = (s: unknown): string =>
  String(s ?? "").toLowerCase().replace(/[\s_()\[\]\-\/.:*·,%]+/g, "");

function bigrams(s: string): Set<string> {
  const r = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) r.add(s.slice(i, i + 2));
  return r;
}

export function similarity(a: string, b: string): number {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.86;
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((g) => { if (B.has(g)) inter++; });
  return inter / (A.size + B.size - inter);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

export function parseNumber(v: Cell): Parsed<number> {
  if (v == null || v === "") return { ok: false, reason: "값 없음" };
  if (typeof v === "number") return isFinite(v) ? { ok: true, value: v } : { ok: false, reason: "숫자 아님" };
  if (v instanceof Date) return { ok: false, reason: "숫자 아님" };
  const s = String(v).replace(/[,\s원₩%]/g, "");
  if (s === "" || isNaN(Number(s))) return { ok: false, reason: "숫자 아님" };
  return { ok: true, value: Number(s) };
}

const fmtDate = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

export function parseDate(v: Cell): Parsed<string> {
  if (v == null || v === "") return { ok: false, reason: "값 없음" };
  if (v instanceof Date && !isNaN(+v))
    return { ok: true, value: fmtDate(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))) };
  if (typeof v === "number" && v > 20000 && v < 80000)
    return { ok: true, value: fmtDate(new Date(Math.round((v - 25569) * 86400 * 1000))) };
  const s = String(v).trim().replace(/[.\/년월]/g, "-").replace(/일/g, "").replace(/-+/g, "-").replace(/-$/, "");
  let m: (string | number)[] | null = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m && /^\d{8}$/.test(s)) m = [s, s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)];
  if (!m && /^\d{6}$/.test(s)) {
    const yy = +s.slice(0, 2);
    const c = yy > new Date().getFullYear() % 100 ? 1900 : 2000;
    m = [s, String(c + yy), s.slice(2, 4), s.slice(4, 6)];
  }
  if (m) {
    const y = +m[1]!, mo = +m[2]!, d = +m[3]!;
    if (y > 1900 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)
      return { ok: true, value: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  }
  return { ok: false, reason: "날짜 형식 아님" };
}

/** LLM 전송 표본 마스킹: 성명 첫 자, 번호류 부분 마스킹 (도메인 불변식 5) */
export function maskSample(v: string): string {
  const s = v.trim();
  if (/^[가-힣]{2,4}$/.test(s)) return s[0] + "*".repeat(s.length - 1);
  if (/^\d{6,}$/.test(s)) return s.slice(0, 3) + "*".repeat(Math.min(s.length - 3, 6));
  return s.length > 24 ? s.slice(0, 24) + "…" : s;
}

/* ---------------- L0: 헤더 시그니처 ---------------- */
export const signatureOf = (headers: string[]): string => norm(headers.filter(Boolean).join("|"));

/* ---------------- L1: 데이터 프로파일링 ---------------- */
export function detectHeaderRow(g: Grid): number {
  let best = 0, bestScore = -1;
  for (let r = 0; r < Math.min(g.length, 15); r++) {
    const row = g[r] ?? [];
    let strs = 0, filled = 0;
    row.forEach((c) => { if (c != null && c !== "") { filled++; if (typeof c === "string") strs++; } });
    const score = strs * 2 + filled - r * 0.3;
    if (strs >= 3 && score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

/**
 * 다중 블록 시트 절단 (F-062): 실무 시책지급내역 엑셀은 서로 다른 헤더의 하위 표 여러 개를
 * 한 시트에 이어 붙이는 경우가 흔함(삼성화재 실측 9개+). 헤더(hIdx) 이후 "새 헤더성 행"
 * (문자열 위주 + 숫자 없음) 또는 ■ 섹션 마커를 만나면 그 앞까지만 남긴다(첫 블록 = 상세).
 * 수수료 경로는 기존 동작 유지(호출부에서 incentive 유형만 적용).
 */
export function truncateAtBlockBoundary(g: Grid, hIdx: number): Grid {
  for (let r = hIdx + 1; r < g.length; r++) {
    const row = g[r] ?? [];
    const filled = row.filter((c) => c != null && c !== "");
    if (!filled.length) continue; // 빈 행은 경계 아님 (블록 내 공백 허용)
    const first = filled[0];
    if (typeof first === "string" && first.trim().startsWith("■")) return g.slice(0, r);
    const strs = filled.filter((c) => typeof c === "string").length;
    const nums = filled.filter((c) => typeof c === "number").length;
    // 헤더성 행: 채워진 셀 4+ 전부 문자열 위주(숫자 ≤1) -> 다음 하위 표의 헤더로 판정
    if (filled.length >= 4 && nums <= 1 && strs / filled.length >= 0.8) return g.slice(0, r);
  }
  return g;
}

/**
 * 다단 헤더 그룹 라벨 추출 (F-062): 헤더 행 위 1~2행에서 열별로 가장 가까운 비공백 문자열을
 * 그룹 라벨로 취한다(병합 셀은 좌측 열에만 값이 남으므로 좌측으로 전파). 시책지급내역의
 * "시상금 합계" 그룹 아래 "설계사" 리프처럼 리프 헤더만으로 의미가 안 잡히는 열을 보강.
 */
export function extractGroupHeaders(g: Grid, hIdx: number): string[] {
  const width = Math.max(...[hIdx - 2, hIdx - 1, hIdx].filter((r) => r >= 0).map((r) => (g[r] ?? []).length), 0);
  const out: string[] = new Array(width).fill("");
  for (const r of [hIdx - 1, hIdx - 2]) {
    if (r < 0) break;
    let carry = "";
    for (let ci = 0; ci < width; ci++) {
      const v = (g[r] ?? [])[ci];
      if (typeof v === "string" && v.trim()) carry = v.trim();
      else if (v != null && v !== "") carry = ""; // 숫자 등 비라벨 값은 전파 중단
      if (!out[ci] && carry) out[ci] = carry;
    }
  }
  return out;
}

/**
 * 열별 대표 타입 판정 (REQ-007 "타입 분포"의 소비 가능한 산출).
 * 날짜/숫자는 겹칠 수 있어(yymmdd 생년월일 등) 우세율로 판정, 임계 미만이면 text.
 * int vs number 는 데이터로 구별 불가(정수형 금액 흔함) -> 온톨로지에서 정제.
 */
export function inferType(p: Pick<ColumnProfile, "numericRate" | "dateRate">): ColumnType {
  if (p.dateRate >= 0.7 && p.dateRate >= p.numericRate) return "date";
  if (p.numericRate >= 0.7) return "number";
  return "text";
}

export function profileColumns(
  g: Grid, hIdx: number, opts?: { groupHeaders?: string[] },
): { profiles: ColumnProfile[]; rows: Cell[][] } {
  const headers = (g[hIdx] ?? []).map((h) => (h == null ? "" : String(h)));
  const rows = g.slice(hIdx + 1).filter((r) => r && r.some((c) => c != null && c !== ""));
  const profiles = headers.map((h, ci) => {
    const vals = rows.map((r) => r[ci]).filter((v) => v != null && v !== "");
    const n = vals.length || 1;
    let num = 0, date = 0, numN = 0, sum = 0, min = Infinity, max = -Infinity;
    const distinct = new Set<string>();
    vals.forEach((v) => {
      const p = parseNumber(v);
      if (p.ok) { num++; numN++; sum += p.value; min = Math.min(min, p.value); max = Math.max(max, p.value); }
      if (parseDate(v).ok) date++;
      distinct.add(String(v));
    });
    const numericRate = num / n, dateRate = date / n;
    return {
      ci, header: h, count: vals.length, total: rows.length,
      nullRate: 1 - vals.length / (rows.length || 1),
      numericRate, dateRate, distinctRatio: distinct.size / n,
      numAvg: numN ? sum / numN : null, numMin: numN ? min : null, numMax: numN ? max : null,
      samples: [...distinct].slice(0, 8), type: inferType({ numericRate, dateRate }),
      ...(opts?.groupHeaders?.[ci] ? { groupHeader: opts.groupHeaders[ci] } : {}),
    };
  }).filter((p) => p.header || p.count > 0);
  return { profiles, rows };
}

/* ---------------- L2 폴백: 규칙 기반 엔진 ---------------- */
function typeCompat(f: OntologyField, p: ColumnProfile): number {
  if (f.type === "number" || f.type === "int") return p.numericRate >= 0.8 ? 0.08 : p.numericRate < 0.3 ? -0.35 : 0;
  if (f.type === "date") return p.dateRate >= 0.8 ? 0.08 : p.dateRate < 0.3 ? -0.35 : 0;
  return p.numericRate > 0.9 ? -0.15 : 0.03;
}

export function localMap(
  profiles: ColumnProfile[], learned: Record<string, string> = {}, ontology: OntologyField[] = ONTOLOGY,
): CandidateMap {
  const cand: { fi: string; ci: number; score: number }[] = [];
  ontology.forEach((f) => profiles.forEach((p) => {
    if (!p.header) return;
    let s = similarity(f.key, p.header);
    for (const syn of f.syn) s = Math.max(s, similarity(syn, p.header) * 0.98);
    // 다단 헤더: 그룹 라벨 결합 매칭 (리프 "설계사" + 그룹 "시상금 합계" -> 시상금 후보)
    if (p.groupHeader) {
      const combined = `${p.groupHeader} ${p.header}`;
      s = Math.max(s, similarity(f.key, combined) * 0.95, similarity(f.key, p.groupHeader) * 0.9);
      for (const syn of f.syn) s = Math.max(s, similarity(syn, combined) * 0.93, similarity(syn, p.groupHeader) * 0.88);
    }
    if (learned[norm(p.header)] === f.key) s = Math.max(s, 0.95);
    s = Math.min(0.99, s + typeCompat(f, p));
    if (s > 0.3) cand.push({ fi: f.key, ci: p.ci, score: s });
  }));
  cand.sort((a, b) => b.score - a.score);
  const out: CandidateMap = {};
  const usedCol = new Set<number>(), usedField = new Set<string>();
  for (const c of cand) {
    if (c.score < 0.45) break;
    if (usedCol.has(c.ci) || usedField.has(c.fi)) continue;
    out[c.fi] = { ci: c.ci, confidence: +c.score.toFixed(2), reason: "헤더 유사도 + 타입 적합도 (규칙 기반)", source: "local" };
    usedCol.add(c.ci); usedField.add(c.fi);
  }
  return out;
}

/* ---------------- L3: 정합성 교차검증 ---------------- */
export function feeFormulaCheck(premCi: number, rateCi: number, feeCi: number, rows: Cell[][], limit = 300) {
  let rateSum = 0, rateN = 0;
  for (const r of rows) { const p = parseNumber(r[rateCi]); if (p.ok) { rateSum += p.value; rateN++; } }
  const scale = (rateN ? rateSum / rateN : 0) > 1.5 ? 100 : 1; // % 단위 자동 감지
  let n = 0, pass = 0;
  for (const r of rows) {
    if (n >= limit) break;
    const a = parseNumber(r[premCi]), b = parseNumber(r[rateCi]), c = parseNumber(r[feeCi]);
    if (!a.ok || !b.ok || !c.ok) continue;
    n++;
    const expect = a.value * (b.value / scale);
    if (Math.abs(expect - c.value) <= Math.max(2, Math.abs(expect) * 0.02)) pass++;
  }
  return { n, passRate: n ? pass / n : 0, scale };
}

export function runConsistency(
  cands: CandidateMap, profiles: ColumnProfile[], rows: Cell[][], ontology: OntologyField[] = ONTOLOGY,
): Evidence[] {
  const ev: Evidence[] = [];
  const get = (k: string) => (cands[k] ? cands[k].ci : -1);
  // 산식 필드: 수수료(지급수수료=보험료x수수료율) / 시책(시상금=보험료x시상율) 온톨로지별 대응
  const feeKey = ontology.some((f) => f.key === "시상금") ? "시상금" : "지급수수료";
  const rateKey = feeKey === "시상금" ? "시상율" : "수수료율";
  const prem = get("보험료"), rate = get(rateKey), fee = get(feeKey);

  if (prem >= 0 && rate >= 0 && fee >= 0) {
    const r = feeFormulaCheck(prem, rate, fee, rows);
    ev.push({
      id: "formula", label: `${feeKey} ≈ 보험료 x ${rateKey}${r.scale === 100 ? " (% 감지)" : ""}`,
      fields: ["보험료", rateKey, feeKey], passRate: r.passRate, n: r.n,
      verdict: r.n < 10 ? "skip" : r.passRate >= 0.9 ? "pass" : r.passRate <= 0.6 ? "fail" : "warn",
    });
  } else if (prem >= 0 && rate >= 0 && fee < 0) {
    // 산식 기반 미매핑 필드 발굴 (데이터 증거)
    const used = new Set(Object.values(cands).map((c) => c.ci));
    let best: { p: ColumnProfile; n: number; passRate: number } | null = null;
    for (const p of profiles) {
      if (used.has(p.ci) || p.numericRate < 0.8) continue;
      const r = feeFormulaCheck(prem, rate, p.ci, rows);
      if (r.n >= 10 && r.passRate >= 0.9 && (!best || r.passRate > best.passRate)) best = { p, n: r.n, passRate: r.passRate };
    }
    if (best) {
      cands[feeKey] = {
        ci: best.p.ci, confidence: 0.85, source: "evidence",
        reason: `데이터 증거 발굴: '${best.p.header}' 값이 산식과 ${Math.round(best.passRate * 100)}% 일치`,
      };
      ev.push({ id: "formula-discover", label: `발굴: '${best.p.header}' -> ${feeKey}`, fields: [feeKey], passRate: best.passRate, n: best.n, verdict: "pass" });
    }
  }

  ontology.forEach((f) => {
    const c = cands[f.key]; if (!c) return;
    const p = profiles.find((x) => x.ci === c.ci); if (!p) return;
    if ((f.type === "number" || f.type === "int") && p.numericRate < 0.7)
      ev.push({ id: `type-${f.key}`, label: `${f.key}: 숫자 비율 ${Math.round(p.numericRate * 100)}%`, fields: [f.key], passRate: p.numericRate, n: p.count, verdict: "fail" });
    if (f.type === "date" && p.dateRate < 0.7)
      ev.push({ id: `type-${f.key}`, label: `${f.key}: 날짜 해석률 ${Math.round(p.dateRate * 100)}%`, fields: [f.key], passRate: p.dateRate, n: p.count, verdict: "fail" });
  });
  return ev;
}

/* ---------------- L4: 신뢰도 결합 + 등급 ---------------- */
const MONEY_FIELDS = new Set(["보험료", "지급수수료", "환수금액", "시상금"]);

export function applyEvidence(
  cands: CandidateMap, evs: Evidence[], engineMode: "ai" | "local" | "cache", ontology: OntologyField[] = ONTOLOGY,
): void {
  evs.forEach((e) => e.fields.forEach((fk) => {
    const c = cands[fk]; if (!c) return;
    if (e.verdict === "pass") c.confidence = Math.min(0.99, c.confidence + 0.08);
    else if (e.verdict === "fail") c.confidence = Math.max(0.05, c.confidence - 0.3);
    else if (e.verdict === "warn") c.confidence = Math.max(0.05, c.confidence - 0.1);
  }));
  ontology.forEach((f) => {
    const c = cands[f.key]; if (!c) return;
    // 금액 필드는 오매핑 비용 비대칭 -> 정합성 pass 증거 없으면 임계 상향 (보수적)
    const hasPass = evs.some((e) => e.verdict === "pass" && e.fields.includes(f.key));
    const th = MONEY_FIELDS.has(f.key) && !hasPass ? AUTO_TH + 0.05 : AUTO_TH;
    c.grade = engineMode === "cache" ? "auto" : c.confidence >= th ? "auto" : c.confidence >= REVIEW_TH ? "review" : "manual";
  });
}

/* ---------------- 매핑 -> 컬럼맵 + 행 검증 (F-008) ---------------- */
export const columnMapOf = (cands: CandidateMap): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [field, c] of Object.entries(cands)) out[field] = c.ci;
  return out;
};

export type StagedRow = { rowNo: number; fields: Record<string, string | number | null> };
export type RowError = { rowNo: number; field: string; reason: string; rawValue?: string };

/**
 * 행 검증 (F-008 REQ-015): 타입/필수/중복 검증. 오류 행은 전량 rowNo+사유로 수집.
 * 통과 행만 staged. 확정된 columnMap(field->ci) 기준으로 파싱/표준화한다. 순수 함수(재현성).
 */
export function validateRows(
  rows: Cell[][], columnMap: Record<string, number>,
  ontology: OntologyField[] = ONTOLOGY, opts?: { dedupe?: boolean },
): { staged: StagedRow[]; errors: RowError[] } {
  const dedupe = opts?.dedupe ?? true; // 시책지급내역은 false (동일 증권번호 복수 시상 행 정상)
  const staged: StagedRow[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>(); // 중복: 계약번호 + 납입회차

  rows.forEach((r, i) => {
    const rowNo = i + 1;
    const fields: Record<string, string | number | null> = {};
    let ok = true;

    for (const f of ontology) {
      const ci = columnMap[f.key];
      if (ci == null) {
        if (f.required) { errors.push({ rowNo, field: f.key, reason: "필수 필드 미매핑" }); ok = false; }
        continue;
      }
      const raw = r[ci];
      if (raw == null || raw === "") {
        if (f.required) { errors.push({ rowNo, field: f.key, reason: "필수 값 누락" }); ok = false; }
        fields[f.key] = null;
        continue;
      }
      if (f.type === "number" || f.type === "int") {
        const p = parseNumber(raw);
        if (!p.ok) { errors.push({ rowNo, field: f.key, reason: `숫자 아님`, rawValue: String(raw).slice(0, 32) }); ok = false; }
        else fields[f.key] = f.type === "int" ? Math.round(p.value) : p.value;
      } else if (f.type === "date") {
        const p = parseDate(raw);
        if (!p.ok) { errors.push({ rowNo, field: f.key, reason: `날짜 아님`, rawValue: String(raw).slice(0, 32) }); ok = false; }
        else fields[f.key] = p.value;
      } else {
        fields[f.key] = String(raw);
      }
    }

    const contract = fields["계약번호"];
    if (dedupe && contract != null) {
      const key = `${contract}|${fields["납입회차"] ?? ""}`;
      if (seen.has(key)) { errors.push({ rowNo, field: "계약번호", reason: "중복 행(계약번호+납입회차)" }); ok = false; }
      else seen.add(key);
    }

    if (ok) staged.push({ rowNo, fields });
  });

  return { staged, errors };
}

/* ---------------- L2 프롬프트 입력 생성 (LLM 어댑터용) ---------------- */
export function buildProfilePrompt(profiles: ColumnProfile[], mask = true): string {
  return profiles.map((p) => {
    const samples = p.samples.map((v) => (mask ? maskSample(v) : v)).join(", ");
    const group = p.groupHeader ? ` (상위 그룹: "${p.groupHeader}")` : "";
    return `- "${p.header || `(무제 ${p.ci + 1}열)`}" [열${p.ci}]${group}: 추정타입 ${p.type} / 숫자 ${Math.round(p.numericRate * 100)}% / 날짜형 ${Math.round(p.dateRate * 100)}% / 널 ${Math.round(p.nullRate * 100)}% / 유니크 ${Math.round(p.distinctRatio * 100)}%\n  표본: ${samples}`;
  }).join("\n");
}
