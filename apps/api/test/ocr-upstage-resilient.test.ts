import { describe, it, expect, afterEach, vi } from "vitest";
import { structureRule, OcrError } from "../src/ocr";
import type { Env } from "../src/types";

// F-065: Upstage 호출이 hang(무응답)하거나 fetch가 거부될 때, undici 300s까지 매달렸다 raw 예외로
// 죽던 것을(F-059 근본 원인) 타임아웃+재시도로 감싸고 최종 OcrError(stage=upstage)로 승격하는지 검증.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const env = { UPSTAGE_API_KEY: "k" } as Env;

describe("Upstage fetch 실패 견고성 (F-065)", () => {
  it("fetch가 거부(fetch failed)되면 재시도 후 stage=upstage로 승격", async () => {
    // raw 예외(stage=unknown)로 유실되던 것 → OcrError(stage=upstage) 보장.
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const err = await structureRule("텍스트", 1, env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).stage).toBe("upstage");
    expect((err as OcrError).status).toBe(502);
    // 1회 재시도 = 총 2회 호출.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("호출이 hang하면 AbortController 타임아웃이 발동해 승격 (60s 매달림 없음)", async () => {
    vi.useFakeTimers();
    // fetch가 abort signal에만 반응하고 스스로는 절대 resolve하지 않음(무응답 hang 재현).
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const p = structureRule("텍스트", 1, env).catch((e: unknown) => e);
    // 타임아웃(60s) + 백오프(1.5s) + 재타임아웃(60s)을 fake timer로 전진.
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.advanceTimersByTimeAsync(60_000);
    const err = await p;

    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).stage).toBe("upstage");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("첫 호출 실패 후 재시도가 성공하면 정상 결과 반환 (일시 장애 흡수)", async () => {
    const okJson = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ insurer: "테스트" }) } }] });
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      if (n === 1) throw new TypeError("fetch failed"); // 첫 호출만 실패
      return new Response(okJson, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await structureRule("텍스트", 1, env);
    expect(res.rule).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2); // 실패 1 + 성공 1
  });
});
