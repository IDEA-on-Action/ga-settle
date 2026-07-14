import { describe, it, expect, afterEach, vi } from "vitest";
import { splitTextForStructure, mergeStructured, structureRule, OcrError } from "../src/ocr";
import type { StructuredRule, PayoutRow } from "../src/ocr";
import type { Env } from "../src/types";

// F-059: 손보 다중 시상 PDF의 긴 OCR 텍스트에서 Upstage 구조화가 깨지던 결함 보강.
// ① 청크 분할 ② 병합 ③ JSON 모드 400 fallback + 파싱 실패 1회 재시도.

const field = (value: string | null, confidence = 0.9) => ({ value, confidence });
const emptyRule = (): StructuredRule => ({
  insurer: field(null, 0), planType: field(null, 0), period: field(null, 0),
  targetProduct: field(null, 0), payout: field(null, 0), retention: field(null, 0),
});

describe("splitTextForStructure (F-059 청크 분할)", () => {
  it("maxChars 이하는 원본 1건 그대로(짧은 문서 회귀 무변경)", () => {
    const chunks = splitTextForStructure("짧은 텍스트", 8000);
    expect(chunks).toEqual(["짧은 텍스트"]);
  });

  it("긴 텍스트는 maxChars 이하 청크로, 내용 손실 없음(공백 경계)", () => {
    const words = Array.from({ length: 500 }, (_, i) => `단어${i}`);
    const text = words.join(" ");
    const chunks = splitTextForStructure(text, 300);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(300);
    // 공백 경계 분할이라 join(" ")으로 원문 복원
    expect(chunks.join(" ")).toBe(text);
  });

  it("공백 없는 병리 입력은 하드 컷(청크 수 폭증 방지)", () => {
    const text = "가".repeat(1000);
    const chunks = splitTextForStructure(text, 300);
    expect(chunks.length).toBe(4); // 300*3 + 100
    expect(chunks.join("")).toBe(text);
  });
});

describe("mergeStructured (F-059 청크 병합)", () => {
  it("단일 파트는 동일 반환(회귀 무변경)", () => {
    const part = { rule: emptyRule(), payoutRows: [] as PayoutRow[] };
    expect(mergeStructured([part])).toBe(part);
  });

  it("rule 필드는 non-null 중 신뢰도 최고값, 한쪽만 있으면 그 값", () => {
    const a = { rule: { ...emptyRule(), insurer: field("ABL생명", 0.7), payout: field("150%", 0.9) }, payoutRows: [] };
    const b = { rule: { ...emptyRule(), insurer: field("ABL 생명보험", 0.95), retention: field("13회차 유지", 0.8) }, payoutRows: [] };
    const merged = mergeStructured([a, b]);
    expect(merged.rule.insurer).toEqual(field("ABL 생명보험", 0.95)); // 높은 신뢰도 승
    expect(merged.rule.payout).toEqual(field("150%", 0.9));           // a에만 존재
    expect(merged.rule.retention).toEqual(field("13회차 유지", 0.8)); // b에만 존재
    expect(merged.rule.planType.value).toBeNull();                    // 둘 다 없음
  });

  it("payoutRows는 concat + 완전 중복 제거", () => {
    const r1: PayoutRow = { payTerm: "5년납", payTiming: "익월", rate: "150%" };
    const r2: PayoutRow = { payTerm: "7년납", payTiming: "익월", rate: "250%" };
    const merged = mergeStructured([
      { rule: emptyRule(), payoutRows: [r1, r2] },
      { rule: emptyRule(), payoutRows: [{ ...r1 }, { payTerm: "7년납", payTiming: "13차월", rate: "100%" }] },
    ]);
    expect(merged.payoutRows).toHaveLength(3);
    expect(merged.payoutRows.filter((r) => r.payTerm === "5년납")).toHaveLength(1);
  });
});

describe("structureRule 상류 견고성 (F-059 fetch 모킹)", () => {
  const env = { UPSTAGE_API_KEY: "test-key" } as Env;
  const okJson = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  const ruleContent = JSON.stringify({
    insurer: { value: "KB손해보험", confidence: 0.9 }, planType: { value: null }, period: { value: null },
    targetProduct: { value: null }, payout: { value: null }, retention: { value: null }, payoutRows: [],
  });

  afterEach(() => vi.unstubAllGlobals());

  it("JSON 모드 400(미지원 모델) → response_format 없이 fallback 성공", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = String(init.body);
      bodies.push(body);
      if (body.includes("response_format")) return new Response("unsupported", { status: 400 });
      return okJson(ruleContent);
    }));
    const out = await structureRule("텍스트", 1, env);
    expect(out.rule.insurer.value).toBe("KB손해보험");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain("response_format"); // 1차는 JSON 강제 시도
    expect(bodies[1]).not.toContain("response_format");
  });

  it("비-JSON 응답 1회 → 재시도로 성공", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      return calls === 1 ? okJson("죄송하지만 JSON을 만들 수 없어요") : okJson(ruleContent);
    }));
    const out = await structureRule("텍스트", 1, env);
    expect(out.rule.insurer.value).toBe("KB손해보험");
    expect(calls).toBe(2);
  });

  it("재시도까지 비-JSON이면 502 OcrError + 재시도 안내 포함", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson("여전히 JSON 아님")));
    const err = await structureRule("텍스트", 1, env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).status).toBe(502);
    expect((err as OcrError).message).toContain("다시 업로드");
  });

  it("긴 텍스트는 청크별 구조화 후 병합(호출 수 = 청크 수)", async () => {
    const fetchMock = vi.fn(async () => okJson(ruleContent));
    vi.stubGlobal("fetch", fetchMock);
    const longText = Array.from({ length: 4000 }, (_, i) => `시상${i}`).join(" "); // > 8000자
    const out = await structureRule(longText, 1, env);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(out.rule.insurer.value).toBe("KB손해보험");
  });
});
