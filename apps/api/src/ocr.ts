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

// content 문자열에서 JSON 블록만 안전 추출(코드펜스/앞뒤 잡텍스트 방어).
function parseJsonLoose(s: string): unknown {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new OcrError("Upstage 구조화 응답에서 JSON을 찾지 못했어요", 502);
  return JSON.parse(body.slice(start, end + 1));
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

// ② Upstage Solar: OCR 텍스트 → 시책룰 필드 구조화 + 납입기간별 지급율 행. LLM 신뢰도는 CLOVA 평균과 곱해 보정.
export async function structureRule(ocrText: string, ocrAvgConfidence: number, env: Env): Promise<{ rule: StructuredRule; payoutRows: PayoutRow[] }> {
  if (!env.UPSTAGE_API_KEY) throw new OcrError("Upstage 미설정 (UPSTAGE_API_KEY)", 503);
  const base = env.UPSTAGE_BASE_URL || "https://api.upstage.ai/v1";
  const model = env.UPSTAGE_MODEL || "solar-mini";
  const sys = "너는 보험 GA 시책안 OCR 텍스트를 시책룰 필드로 구조화하는 도우미다. 반드시 JSON만 출력한다. 금액 계산은 하지 말고 원문에 있는 값만 추출한다.";
  const usr =
    "다음은 시책안 포스터 OCR 텍스트다. 아래 필드를 JSON으로 추출하라. 각 필드는 {value, confidence(0~1)}. " +
    "value는 반드시 문자열(string) 한 줄로 작성하고, 여러 값이면 ' · '로 이어 붙여라. 배열이나 중첩 객체를 value에 넣지 마라. " +
    "필드: insurer(보험사), planType(시책유형), period(적용기간), targetProduct(대상상품), payout(지급방식/배수), retention(유지조건). 원문에 없으면 value:null. " +
    "추가로, 생명보험 시책은 상품의 납입기간(예 5년납/7년납)·지급시점(예 익월/13차월)마다 지급율이 다르다. " +
    "이런 구분이 있으면 payoutRows 배열로 각 조합을 별도 행으로 추출하라. 각 원소는 {payTerm(납입기간 문자열, 예 \"5년납\"), payTiming(지급시점 문자열, 예 \"익월\"|\"13차월\"), rate(지급율/배수 문자열, 예 \"150%\"|\"0\")}. " +
    "납입기간별 구분이 없으면 payoutRows는 빈 배열([])로 둬라.\n\nOCR:\n" +
    ocrText;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.UPSTAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: "system", content: sys }, { role: "user", content: usr }] }),
  });
  if (!res.ok) throw new OcrError(`Upstage 오류 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonLoose(content) as Record<string, unknown>;
  const rule = {} as StructuredRule;
  for (const k of RULE_KEYS) {
    const f = coerceField(parsed[k]);
    // LLM 과신 보정: 구조화 신뢰도 × OCR 평균 신뢰도. 미검출은 0.
    const blended = f.value == null ? 0 : Math.round(f.confidence * ocrAvgConfidence * 1000) / 1000;
    rule[k] = { value: f.value, confidence: blended };
  }
  return { rule, payoutRows: coercePayoutRows(parsed.payoutRows) };
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
