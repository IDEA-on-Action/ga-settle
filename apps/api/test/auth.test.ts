import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// cf-connecting-ip: 127.0.0.1 -> .dev.vars ADMIN_IP_ALLOWLIST(127.0.0.1) 통과(관리자 IP)
const post = (path: string, body: unknown, token?: string) =>
  SELF.fetch(`https://x${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json", "cf-connecting-ip": "127.0.0.1",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
const get = (path: string, token?: string) =>
  SELF.fetch(`https://x${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const login = async (email: string, password: string) =>
  ((await (await post("/api/auth/login", { email, password })).json()) as { token: string }).token;

describe("F-017 RBAC + 세션 인증", () => {
  it("팀장은 자기 팀+하위만, 타 팀 조회 403 (Acceptance)", async () => {
    await post("/api/org/units", { id: "hq", name: "본부", kind: "headquarters" });
    await post("/api/org/units", { id: "team1", name: "1팀", kind: "team", parentId: "hq" });
    await post("/api/org/units", { id: "team2", name: "2팀", kind: "team", parentId: "hq" });
    await post("/api/org/units", { id: "sub1", name: "1팀-A", kind: "team", parentId: "team1" });
    await post("/api/users", { email: "m@x.com", name: "팀장", role: "manager", orgUnitId: "team1", password: "pw1234" });
    const token = await login("m@x.com", "pw1234");

    expect((await get("/api/orgs/team1/agents", token)).status).toBe(200); // 자기 팀
    expect((await get("/api/orgs/sub1/agents", token)).status).toBe(200);  // 하위 팀
    expect((await get("/api/orgs/team2/agents", token)).status).toBe(403); // 타 팀 -> 403
    expect((await get("/api/orgs/team1/agents")).status).toBe(401);        // 무인증 -> 401
  });

  it("admin은 전 조직 접근", async () => {
    await post("/api/org/units", { id: "team2", name: "2팀", kind: "team" });
    await post("/api/users", { email: "a@x.com", name: "관리자", role: "admin", password: "pw1234" });
    const token = await login("a@x.com", "pw1234");
    expect((await get("/api/orgs/team2/agents", token)).status).toBe(200);
  });

  it("로그인 실패(틀린 비번) -> 401", async () => {
    await post("/api/users", { email: "u@x.com", name: "u", role: "viewer", password: "pw1234" });
    expect((await post("/api/auth/login", { email: "u@x.com", password: "wrong" })).status).toBe(401);
  });

  it("변조 토큰 -> 401", async () => {
    await post("/api/org/units", { id: "team1", name: "1팀", kind: "team" });
    expect((await get("/api/orgs/team1/agents", "bogus.token")).status).toBe(401);
  });
});
