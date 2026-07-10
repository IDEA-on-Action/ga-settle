// OCR 시책안 인식 서비스 (F-043).
// 하이브리드 2단계: ① CLOVA General OCR로 이미지 → 텍스트(+토큰 신뢰도)
//                   ② Upstage Solar로 텍스트 → 시책룰 필드 구조화(후보/근거만, 금액 계산 직접 경로 아님).
// 도메인 불변식: AI(LLM/OCR) 출력은 담당자 확정 전까지 후보일 뿐이며, 금액은 결정적 코드가 계산한다.
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
export type OcrExtractResult = {
  ocr: { avgConfidence: number; fieldCount: number; text: string };
  rule: StructuredRule;
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

// ① CLOVA General OCR (V2). 이미지 바이트 → 텍스트 + 필드별 신뢰도.
export async function clovaOcr(image: ArrayBuffer, format: string, env: Env): Promise<ClovaResult> {
  if (!env.CLOVA_OCR_INVOKE_URL || !env.CLOVA_OCR_SECRET) {
    throw new OcrError("CLOVA OCR 미설정 (CLOVA_OCR_INVOKE_URL / CLOVA_OCR_SECRET)", 503);
  }
  const body = {
    version: "V2",
    requestId: crypto.randomUUID(),
    timestamp: Date.now(),
    images: [{ format: format.toLowerCase() === "jpg" ? "jpg" : format.toLowerCase(), name: "sichaek", data: toBase64(image) }],
  };
  const res = await fetch(env.CLOVA_OCR_INVOKE_URL, {
    method: "POST",
    headers: { "X-OCR-SECRET": env.CLOVA_OCR_SECRET, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new OcrError(`CLOVA OCR 오류 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { images?: { fields?: { inferText: string; inferConfidence: number }[] }[] };
  const raw = json.images?.[0]?.fields ?? [];
  const fields: OcrField[] = raw.map((f) => ({ text: f.inferText, confidence: f.inferConfidence }));
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

// ② Upstage Solar: OCR 텍스트 → 시책룰 필드 구조화. LLM 신뢰도는 CLOVA 평균 신뢰도와 곱해 보정(과신 방지).
export async function structureRule(ocrText: string, ocrAvgConfidence: number, env: Env): Promise<StructuredRule> {
  if (!env.UPSTAGE_API_KEY) throw new OcrError("Upstage 미설정 (UPSTAGE_API_KEY)", 503);
  const base = env.UPSTAGE_BASE_URL || "https://api.upstage.ai/v1";
  const model = env.UPSTAGE_MODEL || "solar-mini";
  const sys = "너는 보험 GA 시책안 OCR 텍스트를 시책룰 필드로 구조화하는 도우미다. 반드시 JSON만 출력한다. 금액 계산은 하지 말고 원문에 있는 값만 추출한다.";
  const usr =
    "다음은 시책안 포스터 OCR 텍스트다. 아래 필드를 JSON으로 추출하라. 각 필드는 {value, confidence(0~1)}. " +
    "value는 반드시 문자열(string) 한 줄로 작성하고, 여러 값이면 ' · '로 이어 붙여라. 배열이나 중첩 객체를 value에 넣지 마라. " +
    "필드: insurer(보험사), planType(시책유형), period(적용기간), targetProduct(대상상품), payout(지급방식/배수), retention(유지조건). 원문에 없으면 value:null.\n\nOCR:\n" +
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
  return rule;
}

// 파이프라인: 이미지 → CLOVA OCR → Upstage 구조화 → 저신뢰 필드 표시.
export async function extractIncentivePlan(image: ArrayBuffer, format: string, env: Env): Promise<OcrExtractResult> {
  const ocr = await clovaOcr(image, format, env);
  if (!ocr.fieldCount) throw new OcrError("이미지에서 텍스트를 찾지 못했어요(빈 결과)", 422);
  const rule = await structureRule(ocr.text, ocr.avgConfidence, env);
  const lowConfidenceKeys = RULE_KEYS.filter((k) => rule[k].value == null || rule[k].confidence < LOW_CONFIDENCE);
  return {
    ocr: { avgConfidence: Math.round(ocr.avgConfidence * 1000) / 1000, fieldCount: ocr.fieldCount, text: ocr.text },
    rule,
    lowConfidenceKeys,
  };
}
