import { describe, it, expect, afterEach, vi } from "vitest";
import { clovaOcr, structureRule, extractIncentivePlan, OcrError } from "../src/ocr";
import type { Env } from "../src/types";

// F-064: OcrError에 실패 단계(stage)가 태깅되는지 검증. 단계를 알아야 "CLOVA 인식 문제인지
// Upstage 구조화 문제인지" 재현/원인 규명(F-059)이 가능해진다.

afterEach(() => vi.unstubAllGlobals());

describe("clova 단계 실패는 stage=clova (F-064)", () => {
  it("CLOVA 미설정이면 stage=clova", async () => {
    const err = await clovaOcr(new ArrayBuffer(4), "png", {} as Env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).stage).toBe("clova");
  });

  it("CLOVA 응답 오류(!ok)면 stage=clova", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 500 })));
    const env = { CLOVA_OCR_INVOKE_URL: "https://clova.example", CLOVA_OCR_SECRET: "s" } as Env;
    const err = await clovaOcr(new ArrayBuffer(4), "png", env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).stage).toBe("clova");
  });

  it("CLOVA 빈 결과(fieldCount=0)면 stage=clova", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ images: [{ fields: [] }] }), { status: 200 })));
    const env = { CLOVA_OCR_INVOKE_URL: "https://clova.example", CLOVA_OCR_SECRET: "s" } as Env;
    const err = await extractIncentivePlan(new ArrayBuffer(4), "png", env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).stage).toBe("clova");
  });
});

describe("upstage 단계 실패는 stage=upstage (F-064)", () => {
  it("Upstage 미설정이면 stage=upstage", async () => {
    const err = await structureRule("텍스트", 1, {} as Env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).stage).toBe("upstage");
  });

  it("Upstage 응답 오류(!ok)면 stage=upstage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    const err = await structureRule("텍스트", 1, { UPSTAGE_API_KEY: "k" } as Env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).stage).toBe("upstage");
  });
});

describe("parse 단계 실패는 stage=parse (F-064)", () => {
  const okJson = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  it("재시도까지 JSON을 찾지 못하면 stage=parse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson("JSON이 아닌 응답")));
    const err = await structureRule("텍스트", 1, { UPSTAGE_API_KEY: "k" } as Env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).stage).toBe("parse");
  });

  it("재시도까지 JSON이 손상돼있으면 stage=parse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson("{손상된 json")));
    const err = await structureRule("텍스트", 1, { UPSTAGE_API_KEY: "k" } as Env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).stage).toBe("parse");
  });
});
