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
 * 열별 대표 타입 판정 (REQ-007 "타입 분포"의 소비 가능한 산출).
 * 날짜/숫자는 겹칠 수 있어(yymmdd 생년월일 등) 우세율로 판정, 임계 미만이면 text.
 * int vs number 는 데이터로 구별 불가(정수형 금액 흔함) -> 온톨로지에서 정제.
 */
export function inferType(p: Pick<ColumnProfile, "numericRate" | "dateRate">): ColumnType {
  if (p.dateRate >= 0.7 && p.dateRate >= p.numericRate) return "date";
  if (p.numericRate >= 0.7) return "number";
  return "text";
}

export function profileColumns(g: Grid, hIdx: number): { profiles: ColumnProfile[]; rows: Cell[][] } {
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

export function localMap(profiles: ColumnProfile[], learned: Record<string, string> = {}): CandidateMap {
  const cand: { fi: string; ci: number; score: number }[] = [];
  ONTOLOGY.forEach((f) => profiles.forEach((p) => {
    if (!p.header) return;
    let s = similarity(f.key, p.header);
    for (const syn of f.syn) s = Math.max(s, similarity(syn, p.header) * 0.98);
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

export function runConsistency(cands: CandidateMap, profiles: ColumnProfile[], rows: Cell[][]): Evidence[] {
  const ev: Evidence[] = [];
  const get = (k: string) => (cands[k] ? cands[k].ci : -1);
  const prem = get("보험료"), rate = get("수수료율"), fee = get("지급수수료");

  if (prem >= 0 && rate >= 0 && fee >= 0) {
    const r = feeFormulaCheck(prem, rate, fee, rows);
    ev.push({
      id: "formula", label: `지급수수료 ≈ 보험료 x 수수료율${r.scale === 100 ? " (% 감지)" : ""}`,
      fields: ["보험료", "수수료율", "지급수수료"], passRate: r.passRate, n: r.n,
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
      cands["지급수수료"] = {
        ci: best.p.ci, confidence: 0.85, source: "evidence",
        reason: `데이터 증거 발굴: '${best.p.header}' 값이 산식과 ${Math.round(best.passRate * 100)}% 일치`,
      };
      ev.push({ id: "formula-discover", label: `발굴: '${best.p.header}' -> 지급수수료`, fields: ["지급수수료"], passRate: best.passRate, n: best.n, verdict: "pass" });
    }
  }

  ONTOLOGY.forEach((f) => {
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
const MONEY_FIELDS = new Set(["보험료", "지급수수료", "환수금액"]);

export function applyEvidence(cands: CandidateMap, evs: Evidence[], engineMode: "ai" | "local" | "cache"): void {
  evs.forEach((e) => e.fields.forEach((fk) => {
    const c = cands[fk]; if (!c) return;
    if (e.verdict === "pass") c.confidence = Math.min(0.99, c.confidence + 0.08);
    else if (e.verdict === "fail") c.confidence = Math.max(0.05, c.confidence - 0.3);
    else if (e.verdict === "warn") c.confidence = Math.max(0.05, c.confidence - 0.1);
  }));
  ONTOLOGY.forEach((f) => {
    const c = cands[f.key]; if (!c) return;
    // 금액 필드는 오매핑 비용 비대칭 -> 정합성 pass 증거 없으면 임계 상향 (보수적)
    const hasPass = evs.some((e) => e.verdict === "pass" && e.fields.includes(f.key));
    const th = MONEY_FIELDS.has(f.key) && !hasPass ? AUTO_TH + 0.05 : AUTO_TH;
    c.grade = engineMode === "cache" ? "auto" : c.confidence >= th ? "auto" : c.confidence >= REVIEW_TH ? "review" : "manual";
  });
}

/* ---------------- L2 프롬프트 입력 생성 (LLM 어댑터용) ---------------- */
export function buildProfilePrompt(profiles: ColumnProfile[], mask = true): string {
  return profiles.map((p) => {
    const samples = p.samples.map((v) => (mask ? maskSample(v) : v)).join(", ");
    return `- "${p.header || `(무제 ${p.ci + 1}열)`}" [열${p.ci}]: 추정타입 ${p.type} / 숫자 ${Math.round(p.numericRate * 100)}% / 날짜형 ${Math.round(p.dateRate * 100)}% / 널 ${Math.round(p.nullRate * 100)}% / 유니크 ${Math.round(p.distinctRatio * 100)}%\n  표본: ${samples}`;
  }).join("\n");
}
