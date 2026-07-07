import { describe, it, expect } from "vitest";
import { app } from "../src/index";

// F-001: 하네스 스모크 - /health 가 env를 반영해 200을 반환하는지 검증.
// Hono app.request는 런타임 비의존이라 바인딩 없이 ENV만 주입해 테스트한다.
describe("GET /health", () => {
  it("returns 200 with ok + env", async () => {
    const res = await app.request("/health", {}, { ENV: "test" } as never);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, env: "test" });
  });
});
