import { describe, it, expect, vi, afterEach } from "vitest";
import { profileColumns, type Grid } from "@ga-settle/mapping";
import { resolveMapping } from "../src/llm";
import type { Env } from "../src/types";

// 헤더: 증권No(0) 계약체결일(1) FC성명(2) 실적보험료(3) 지급율%(4) 항목A(5)
// 항목A는 이름으론 못 잡지만 산식(보험료 x 수수료율)으로 지급수수료에 발굴 매핑됨.
function grid(): Grid {
  const headers = ["증권No", "계약체결일", "FC성명", "실적보험료", "지급율(%)", "항목A"];
  const g: Grid = [["B화재 명세서"], headers];
  for (let i = 1; i <= 60; i++) {
    const prem = 100000 + i * 1000;
    const rate = [15, 20, 25, 30][i % 4]!;
    g.push(["BH" + i, "2026-06-" + String(1 + (i % 27)).padStart(2, "0"), "이서연", prem, rate, Math.round((prem * rate) / 100)]);
  }
  return g;
}
const env = (key: string) => ({ ANTHROPIC_API_KEY: key }) as Env;

afterEach(() => vi.unstubAllGlobals());

describe("F-005 L2 매핑 어댑터", () => {
  it("API 키 없으면 규칙 엔진 폴백 (engine=local), 항목A는 산식 발굴로 지급수수료 매핑", async () => {
    const { profiles, rows } = profileColumns(grid(), 1);
    const r = await resolveMapping(profiles, rows, env("")); // 키 없음 -> 폴백
    expect(r.engine).toBe("local");
    expect(r.candidates["보험료"]?.ci).toBe(3);
    expect(r.candidates["수수료율"]?.ci).toBe(4);
    expect(r.candidates["지급수수료"]?.ci).toBe(5);          // 값 기반 발굴
    expect(r.candidates["지급수수료"]?.source).toBe("evidence");
  });

  it("AI 성공 경로: tool_use 응답을 후보로 파싱 (engine=ai, source=ai)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: "tool_use", name: "map", input: { mappings: [
        { field: "보험료", ci: 3, confidence: 0.95, reason: "숫자 100% + 헤더 유사" },
        { field: "수수료율", ci: 4, confidence: 0.9 },
        { field: "지급수수료", ci: 5, confidence: 0.88 },
      ] } }],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const { profiles, rows } = profileColumns(grid(), 1);
    const r = await resolveMapping(profiles, rows, env("sk-test"));
    expect(r.engine).toBe("ai");
    expect(r.candidates["보험료"]?.source).toBe("ai");
    expect(r.candidates["보험료"]?.ci).toBe(3);
  });

  it("AI API 5xx면 규칙 엔진으로 강등 (engine=local)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream error", { status: 500 })));
    const { profiles, rows } = profileColumns(grid(), 1);
    const r = await resolveMapping(profiles, rows, env("sk-test"));
    expect(r.engine).toBe("local");
    expect(r.candidates["보험료"]?.ci).toBe(3);
  });

  it("전송 프로파일 표본은 마스킹된다 (인적정보 보호, REQ-010)", async () => {
    let sentBody = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sentBody = String(init.body);
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "map", input: { mappings: [{ field: "보험료", ci: 3, confidence: 0.9 }] } }] }), { status: 200 });
    }));
    const { profiles, rows } = profileColumns(grid(), 1);
    await resolveMapping(profiles, rows, env("sk-test"));
    expect(sentBody).toContain("이*");     // FC성명 '이서연' -> 마스킹
    expect(sentBody).not.toContain("이서연");
  });
});
