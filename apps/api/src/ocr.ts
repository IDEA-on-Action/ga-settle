// OCR 시책안 인식 서비스 (F-043).
// 하이브리드 2단계: ① CLOVA General OCR로 이미지 → 텍스트(+토큰 신뢰도)
//                   ② Upstage Solar로 텍스트 → 시책룰 필드 구조화(후보/근거만, 금액 계산 직접 경로 아님).
// 도메인 불변식: AI(LLM/OCR) 출력은 담당자 확정 전까지 후보일 뿐이며, 금액은 결정적 코드가 계산한다.
import { PDFDocument } from "pdf-lib";
import type { Env } from "./types";

export class OcrError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export type OcrField = { text: string; confidence: number };
export type ClovaResult = { text: string; avgConfidence: number; fieldCount: number; fields: OcrField[] };

// 구조화된 시책룰 후보 필드. value=null이면 원문에서 미검출.
export type RuleField = { value: string | null; confidence: number };
export type StructuredRule = {
  insurer: RuleField;      // 보험사(원수사)
  planType: RuleField;     // 시책유형
  period: RuleField;       // 적용기간
  targetProduct: RuleField;// 대상상품
  payout: RuleField;       // 지급방식/배수
  retention: RuleField;    // 유지조건
};
// 납입기간·지급시점별 지급율 행 (F-052). 생보는 상품 납입기간(5년납/7년납)·지급시점(익월/13차월)마다
// 지급율이 달라 단일 payout 필드로는 손실 → 배열로 각 조합을 별도 행으로 추출한다.
export type PayoutRow = { payTerm: string | null; payTiming: string | null; rate: string | null };
export type OcrExtractResult = {
  ocr: { avgConfidence: number; fieldCount: number; text: string };
  rule: StructuredRule;
  payoutRows: PayoutRow[]; // 납입기간×지급시점별 지급율 (F-052, 없으면 빈 배열)
  lowConfidenceKeys: string[]; // 담당자 확인 대상(신뢰도 임계 미만 또는 미검출)
};

const RULE_KEYS: (keyof StructuredRule)[] = ["insurer", "planType", "period", "targetProduct", "payout", "retention"];
// 이 미만은 좌우 대조 화면에서 색 표시(담당자 확인 유도). blended = LLM신뢰도 × OCR평균신뢰도라
// 상용 OCR 평균(~0.96)에서도 복합/애매 필드는 이 아래로 떨어져 확인 대상이 된다.
const LOW_CONFIDENCE = 0.85;

// ArrayBuffer → base64 (Worker 런타임, 대용량 이미지 스택오버플로 방지 위해 청크 처리).
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// CLOVA General OCR는 요청당 최대 10페이지(초과 시 400 code 0011). 손보 시책안은 12+ 시상=12+p라
// 초과가 흔하므로, PDF는 ≤10p 청크로 분할해 요청을 나눈 뒤 전 페이지 필드를 병합한다(F-049).
const CLOVA_MAX_PAGES = 10;

// PDF 바이트를 chunkSize 페이지 단위로 분할. ≤chunkSize면 원본 그대로 반환(회귀 무변경).
// export: F-049 청크 로직 단위 테스트용.
export async function splitPdf(pdf: ArrayBuffer, chunkSize: number): Promise<ArrayBuffer[]> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  } catch {
    // 파싱 불가 PDF는 분할 없이 원본 1건으로(하류 CLOVA가 판정). 손상 PDF에서 크래시 방지.
    return [pdf];
  }
  const total = src.getPageCount();
  if (total <= chunkSize) return [pdf];
  const chunks: ArrayBuffer[] = [];
  for (let start = 0; start < total; start += chunkSize) {
    const out = await PDFDocument.create();
    const idxs: number[] = [];
    for (let i = start; i < Math.min(start + chunkSize, total); i++) idxs.push(i);
    const pages = await out.copyPages(src, idxs);
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    chunks.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }
  return chunks;
}

// CLOVA General OCR (V2) 단일 요청. 이미지 또는 ≤10p PDF 바이트 → 텍스트 + 필드별 신뢰도.
// url/secret은 clovaOcr에서 미설정 가드 후 전달(타입 narrowing 전파).
async function clovaOcrSingle(bytes: ArrayBuffer, format: string, url: string, secret: string): Promise<OcrField[]> {
  const body = {
    version: "V2",
    requestId: crypto.randomUUID(),
    timestamp: Date.now(),
    images: [{ format: format.toLowerCase() === "jpg" ? "jpg" : format.toLowerCase(), name: "sichaek", data: toBase64(bytes) }],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-OCR-SECRET": secret, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new OcrError(`CLOVA OCR 오류 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { images?: { fields?: { inferText: string; inferConfidence: number }[] }[] };
  // PDF는 페이지별 images[] 반환(F-046). 전 페이지 필드를 합쳐야 다중 페이지 시책안도 온전히 인식된다.
  const raw = (json.images ?? []).flatMap((im) => im.fields ?? []);
  return raw.map((f) => ({ text: f.inferText, confidence: f.inferConfidence }));
}

// ① CLOVA General OCR (V2). 이미지/PDF 바이트 → 텍스트 + 필드별 신뢰도.
// PDF가 10p를 넘으면 ≤10p 청크로 분할해 순차 호출 후 필드 병합(F-049 손보 다중 시상 대응).
export async function clovaOcr(image: ArrayBuffer, format: string, env: Env): Promise<ClovaResult> {
  if (!env.CLOVA_OCR_INVOKE_URL || !env.CLOVA_OCR_SECRET) {
    throw new OcrError("CLOVA OCR 미설정 (CLOVA_OCR_INVOKE_URL / CLOVA_OCR_SECRET)", 503);
  }
  const isPdf = format.toLowerCase() === "pdf";
  const parts = isPdf ? await splitPdf(image, CLOVA_MAX_PAGES) : [image];
  const fields: OcrField[] = [];
  for (const part of parts) {
    fields.push(...(await clovaOcrSingle(part, format, env.CLOVA_OCR_INVOKE_URL, env.CLOVA_OCR_SECRET)));
  }
  const avgConfidence = fields.length ? fields.reduce((s, f) => s + f.confidence, 0) / fields.length : 0;
  return { text: fields.map((f) => f.text).join(" "), avgConfidence, fieldCount: fields.length, fields };
}

// 상류(LLM) 비결정 실패는 파일 문제가 아니라 재시도로 풀리는 경우가 많아 안내를 붙인다(F-059).
// 같은 파일 재업로드는 sha 멱등이라 대장 원 레코드에 이어서 재처리된다(F-048).
const RETRY_HINT = "같은 파일을 다시 업로드하면 재시도할 수 있어요.";

// content 문자열에서 JSON 블록만 안전 추출(코드펜스/앞뒤 잡텍스트 방어).
function parseJsonLoose(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new OcrError(`Upstage 구조화 응답에서 JSON을 찾지 못했어요. ${RETRY_HINT}`, 502);
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    // 중괄호는 있으나 절단/손상된 JSON (max output 초과 등). SyntaxError를 500으로 흘리지 않는다.
    throw new OcrError(`Upstage 구조화 응답 JSON이 손상됐어요. ${RETRY_HINT}`, 502);
  }
}

// LLM이 값 자리에 배열/중첩 객체를 넣어도 사람이 읽는 한 줄로 평탄화(‑ "[object Object]" 방지).
function flattenValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map((e) => flattenValue(e && typeof e === "object" && "value" in (e as object) ? (e as { value: unknown }).value : e)).filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (typeof v === "object") {
    if ("value" in (v as object)) return flattenValue((v as { value: unknown }).value);
    const parts = Object.values(v as Record<string, unknown>).map(flattenValue).filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
}

function coerceField(v: unknown): RuleField {
  if (v && typeof v === "object" && "value" in v) {
    const o = v as { value: unknown; confidence?: unknown };
    return { value: flattenValue(o.value), confidence: typeof o.confidence === "number" ? o.confidence : 0.5 };
  }
  return { value: flattenValue(v), confidence: 0.5 };
}

// LLM payoutRows[] 원소를 {payTerm, payTiming, rate} 문자열 행으로 정규화(F-052).
// export: 파싱 견고성 단위 테스트용.
export function coercePayoutRows(v: unknown): PayoutRow[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const o = e as Record<string, unknown>;
      const row: PayoutRow = { payTerm: flattenValue(o.payTerm), payTiming: flattenValue(o.payTiming), rate: flattenValue(o.rate) };
      // 셋 다 비면 무의미 행 → 제거.
      return row.payTerm || row.payTiming || row.rate ? row : null;
    })
    .filter((r): r is PayoutRow => r !== null);
}

// 손보 다중 시상(12+p) PDF는 OCR 텍스트가 수만 자에 달해 단일 구조화 요청이 깨진다(F-059,
// 고객 재현: "JSON을 찾지 못했어요" 502). 이 이하로 청크를 잘라 각각 구조화 후 병합한다.
// solar-mini 32k 컨텍스트 기준 프롬프트+응답 여유를 둔 보수치.
const STRUCTURE_CHUNK_CHARS = 8000;

// OCR 텍스트를 maxChars 이하 청크로 분할. 공백 경계 우선(단어 절단 회피), 공백이 없으면 하드 컷.
// ≤maxChars면 원본 1건 그대로(짧은 문서 회귀 무변경). export: F-059 단위 테스트용.
export function splitTextForStructure(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const cut = window.lastIndexOf(" ");
    // 공백이 너무 앞이면(청크의 절반 미만) 하드 컷 - 병리적 무공백 입력에서 청크 수 폭증 방지.
    const at = cut >= maxChars / 2 ? cut : maxChars;
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^ /, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// 청크별 구조화 결과 병합: rule 필드는 non-null 중 신뢰도 최고값, payoutRows는 concat + 완전 중복 제거.
// export: F-059 단위 테스트용.
export function mergeStructured(parts: { rule: StructuredRule; payoutRows: PayoutRow[] }[]): { rule: StructuredRule; payoutRows: PayoutRow[] } {
  if (parts.length === 1) return parts[0]!;
  const rule = {} as StructuredRule;
  for (const k of RULE_KEYS) {
    let best: RuleField = { value: null, confidence: 0 };
    for (const p of parts) {
      const f = p.rule[k];
      if (f.value != null && (best.value == null || f.confidence > best.confidence)) best = f;
    }
    rule[k] = best;
  }
  const seen = new Set<string>();
  const payoutRows: PayoutRow[] = [];
  for (const r of parts.flatMap((p) => p.payoutRows)) {
    const key = `${r.payTerm ?? ""}|${r.payTiming ?? ""}|${r.rate ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      payoutRows.push(r);
    }
  }
  return { rule, payoutRows };
}

const STRUCTURE_SYS = "너는 보험 GA 시책안 OCR 텍스트를 시책룰 필드로 구조화하는 도우미다. 반드시 JSON만 출력한다. 금액 계산은 하지 말고 원문에 있는 값만 추출한다.";

function buildStructurePrompt(ocrText: string): string {
  return (
    "다음은 시책안 포스터 OCR 텍스트다. 아래 필드를 JSON으로 추출하라. 각 필드는 {value, confidence(0~1)}. " +
    "value는 반드시 문자열(string) 한 줄로 작성하고, 여러 값이면 ' · '로 이어 붙여라. 배열이나 중첩 객체를 value에 넣지 마라. " +
    "필드: insurer(보험사), planType(시책유형), period(적용기간), targetProduct(대상상품), payout(지급방식/배수), retention(유지조건). 원문에 없으면 value:null. " +
    "추가로, 생명보험 시책은 상품의 납입기간(예 5년납/7년납)·지급시점(예 익월/13차월)마다 지급율이 다르다. " +
    "이런 구분이 있으면 payoutRows 배열로 각 조합을 별도 행으로 추출하라. 각 원소는 {payTerm(납입기간 문자열, 예 \"5년납\"), payTiming(지급시점 문자열, 예 \"익월\"|\"13차월\"), rate(지급율/배수 문자열, 예 \"150%\"|\"0\")}. " +
    "납입기간별 구분이 없으면 payoutRows는 빈 배열([])로 둬라.\n\nOCR:\n" +
    ocrText
  );
}

// Upstage chat/completions 1회 호출. jsonMode=true면 response_format으로 JSON 출력을 강제한다.
// response_format은 solar-pro-2 이상만 지원 - solar-mini 등 미지원 모델은 400을 반환하므로 호출부에서 fallback.
async function callUpstage(env: Env, usr: string, jsonMode: boolean): Promise<Response> {
  const base = env.UPSTAGE_BASE_URL || "https://api.upstage.ai/v1";
  const model = env.UPSTAGE_MODEL || "solar-mini";
  return fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.UPSTAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: "system", content: STRUCTURE_SYS }, { role: "user", content: usr }],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
}

function extractContent(json: unknown): string {
  return (json as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
}

// 청크 1개 구조화: JSON 강제 → 미지원 모델(400) fallback → 파싱 실패 1회 재시도.
async function structureChunk(text: string, env: Env): Promise<Record<string, unknown>> {
  const usr = buildStructurePrompt(text);
  let res = await callUpstage(env, usr, true);
  // 400은 response_format 미지원 모델(solar-mini 등)일 가능성 - JSON 모드 없이 재시도.
  if (res.status === 400) res = await callUpstage(env, usr, false);
  if (!res.ok) throw new OcrError(`Upstage 오류 ${res.status}: ${(await res.text()).slice(0, 200)}. ${RETRY_HINT}`);
  try {
    return parseJsonLoose(extractContent(await res.json())) as Record<string, unknown>;
  } catch {
    // temperature 0이어도 상류 비결정으로 비-JSON/절단 응답이 관찰됨(고객 재현) - 1회 재시도.
    const retry = await callUpstage(env, usr, false);
    if (!retry.ok) throw new OcrError(`Upstage 오류 ${retry.status}: ${(await retry.text()).slice(0, 200)}. ${RETRY_HINT}`);
    return parseJsonLoose(extractContent(await retry.json())) as Record<string, unknown>;
  }
}

// LLM 파싱 결과 → 필드별 blended 신뢰도 rule. 과신 보정: 구조화 신뢰도 × OCR 평균, 미검출은 0.
function buildRule(parsed: Record<string, unknown>, ocrAvgConfidence: number): { rule: StructuredRule; payoutRows: PayoutRow[] } {
  const rule = {} as StructuredRule;
  for (const k of RULE_KEYS) {
    const f = coerceField(parsed[k]);
    const blended = f.value == null ? 0 : Math.round(f.confidence * ocrAvgConfidence * 1000) / 1000;
    rule[k] = { value: f.value, confidence: blended };
  }
  return { rule, payoutRows: coercePayoutRows(parsed.payoutRows) };
}

// ② Upstage Solar: OCR 텍스트 → 시책룰 필드 구조화 + 납입기간별 지급율 행. LLM 신뢰도는 CLOVA 평균과 곱해 보정.
// 긴 텍스트(손보 다중 시상)는 청크 분할 구조화 후 병합(F-059). 청크는 순차 호출(상류 rate limit 배려).
export async function structureRule(ocrText: string, ocrAvgConfidence: number, env: Env): Promise<{ rule: StructuredRule; payoutRows: PayoutRow[] }> {
  if (!env.UPSTAGE_API_KEY) throw new OcrError("Upstage 미설정 (UPSTAGE_API_KEY)", 503);
  const chunks = splitTextForStructure(ocrText, STRUCTURE_CHUNK_CHARS);
  const parts: { rule: StructuredRule; payoutRows: PayoutRow[] }[] = [];
  for (const chunk of chunks) {
    parts.push(buildRule(await structureChunk(chunk, env), ocrAvgConfidence));
  }
  return mergeStructured(parts);
}

// 파이프라인: 이미지 → CLOVA OCR → Upstage 구조화 → 저신뢰 필드 표시.
export async function extractIncentivePlan(image: ArrayBuffer, format: string, env: Env): Promise<OcrExtractResult> {
  const ocr = await clovaOcr(image, format, env);
  if (!ocr.fieldCount) throw new OcrError("이미지에서 텍스트를 찾지 못했어요(빈 결과)", 422);
  const { rule, payoutRows } = await structureRule(ocr.text, ocr.avgConfidence, env);
  const lowConfidenceKeys = RULE_KEYS.filter((k) => rule[k].value == null || rule[k].confidence < LOW_CONFIDENCE);
  return {
    ocr: { avgConfidence: Math.round(ocr.avgConfidence * 1000) / 1000, fieldCount: ocr.fieldCount, text: ocr.text },
    rule,
    payoutRows,
    lowConfidenceKeys,
  };
}
