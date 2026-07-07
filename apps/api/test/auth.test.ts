import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// 부트스트랩(POST /api/users)은 IP 게이트. cf-connecting-ip로 .dev.vars ADMIN_IP_ALLOWLIST(127.0.0.1) 통과.
const IP = { "cf-connecting-ip": "127.0.0.1" };
const post = (path: string, body: unknown, token?: string) =>
  SELF.fetch(`https://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...IP, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (path: string, token?: string) =>
  SELF.fetch(`https://x${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const login = async (email: string, password: string) =>
  ((await (await post("/api/auth/login", { email, password })).json()) as { token: string }).token;

// 첫 계정(부트스트랩) admin 생성 후 토큰
async function bootstrapAdmin(): Promise<string> {
  await post("/api/users", { email: "root@x.com", name: "root", role: "admin", password: "pw1234" });
  return login("root@x.com", "pw1234");
}

describe("F-024 인증 롤아웃 + F-017 RBAC", () => {
  it("인증 롤아웃: 무인증으로 보호 엔드포인트 접근 -> 401", async () => {
    expect((await SELF.fetch("https://x/api/rules")).status).toBe(401);
    expect((await SELF.fetch("https://x/api/stats/by-month")).status).toBe(401);
    expect((await SELF.fetch("https://x/api/org/tree")).status).toBe(401);
    // /health 는 공개
    expect((await SELF.fetch("https://x/health")).status).toBe(200);
  });

  it("팀장은 자기 팀+하위만, 타 팀 조회 403 (F-017 Acceptance)", async () => {
    const admin = await bootstrapAdmin();
    await post("/api/org/units", { id: "hq", name: "본부", kind: "headquarters" }, admin);
    await post("/api/org/units", { id: "team1", name: "1팀", kind: "team", parentId: "hq" }, admin);
    await post("/api/org/units", { id: "team2", name: "2팀", kind: "team", parentId: "hq" }, admin);
    await post("/api/org/units", { id: "sub1", name: "1팀-A", kind: "team", parentId: "team1" }, admin);
    await post("/api/users", { email: "m@x.com", name: "팀장", role: "manager", orgUnitId: "team1", password: "pw1234" }, admin);
    const mgr = await login("m@x.com", "pw1234");

    expect((await get("/api/orgs/team1/agents", mgr)).status).toBe(200);
    expect((await get("/api/orgs/sub1/agents", mgr)).status).toBe(200);
    expect((await get("/api/orgs/team2/agents", mgr)).status).toBe(403); // 타 팀 -> 403
    expect((await get("/api/orgs/team1/agents")).status).toBe(401);      // 무인증 -> 401
  });

  it("admin은 전 조직 접근", async () => {
    const admin = await bootstrapAdmin();
    await post("/api/org/units", { id: "team2", name: "2팀", kind: "team" }, admin);
    expect((await get("/api/orgs/team2/agents", admin)).status).toBe(200);
  });

  it("로그인 실패(틀린 비번) + 변조 토큰 -> 401", async () => {
    const admin = await bootstrapAdmin();
    expect((await post("/api/auth/login", { email: "root@x.com", password: "wrong" })).status).toBe(401);
    await post("/api/org/units", { id: "team1", name: "1팀", kind: "team" }, admin);
    expect((await get("/api/orgs/team1/agents", "bogus.token")).status).toBe(401);
  });

  it("계정 생성: 부트스트랩 후엔 admin 인증 필수 (missing-auth 방지)", async () => {
    const admin = await bootstrapAdmin();
    expect((await post("/api/users", { email: "b@x.com", name: "b", role: "viewer", password: "pw1234" })).status).toBe(403); // 토큰 없이
    expect((await post("/api/users", { email: "b@x.com", name: "b", role: "viewer", password: "pw1234" }, admin)).status).toBe(201); // admin
  });

  it("비밀번호 변경(본인): 현재 비번 확인 -> 새 비번으로만 로그인 (F-025)", async () => {
    const admin = await bootstrapAdmin();
    // 틀린 현재 비번 -> 401
    expect((await post("/api/auth/change-password", { currentPassword: "wrong", newPassword: "newpw12345" }, admin)).status).toBe(401);
    // 새 비번 8자 미만 -> 400
    expect((await post("/api/auth/change-password", { currentPassword: "pw1234", newPassword: "short" }, admin)).status).toBe(400);
    // 정상 변경 -> 200
    expect((await post("/api/auth/change-password", { currentPassword: "pw1234", newPassword: "newpw12345" }, admin)).status).toBe(200);
    // 기존 비번 로그인 실패, 새 비번 로그인 성공
    expect((await post("/api/auth/login", { email: "root@x.com", password: "pw1234" })).status).toBe(401);
    expect((await post("/api/auth/login", { email: "root@x.com", password: "newpw12345" })).status).toBe(200);
  });

  it("비밀번호 변경: 무인증 -> 401", async () => {
    await bootstrapAdmin();
    expect((await post("/api/auth/change-password", { currentPassword: "pw1234", newPassword: "newpw12345" })).status).toBe(401);
  });

  it("비밀번호 초기화(admin): 타 계정 초기화 -> 새 비번 로그인 (F-025)", async () => {
    const admin = await bootstrapAdmin();
    const created = (await (await post("/api/users", { email: "u@x.com", name: "u", role: "staff", password: "pw1234" }, admin)).json()) as { id: string };
    // 정상 초기화 -> 200, 새 비번 로그인 성공
    expect((await post(`/api/users/${created.id}/reset-password`, { newPassword: "resetpw12345" }, admin)).status).toBe(200);
    expect((await post("/api/auth/login", { email: "u@x.com", password: "resetpw12345" })).status).toBe(200);
    // 없는 계정 -> 404
    expect((await post("/api/users/nope/reset-password", { newPassword: "resetpw12345" }, admin)).status).toBe(404);
  });

  it("비밀번호 초기화: 비admin -> 403", async () => {
    const admin = await bootstrapAdmin();
    await post("/api/users", { email: "v@x.com", name: "v", role: "viewer", password: "pw1234" }, admin);
    const viewer = await login("v@x.com", "pw1234");
    expect((await post("/api/users/whoever/reset-password", { newPassword: "resetpw12345" }, viewer)).status).toBe(403);
  });
});

describe("F-027 이메일 OTP (@atasset.co.kr)", () => {
  it("@atasset.co.kr 계정: 비밀번호 로그인 차단 -> 403", async () => {
    const admin = await bootstrapAdmin();
    await post("/api/users", { email: "kim@atasset.co.kr", name: "김", role: "staff", password: "pw1234" }, admin);
    expect((await post("/api/auth/login", { email: "kim@atasset.co.kr", password: "pw1234" })).status).toBe(403);
  });

  it("OTP 요청->검증: 코드로 로그인 + 토큰 발급 + 재사용 방지", async () => {
    const admin = await bootstrapAdmin();
    await post("/api/users", { email: "lee@atasset.co.kr", name: "이", role: "manager", password: "pw1234" }, admin);
    const req = await post("/api/auth/otp/request", { email: "lee@atasset.co.kr" });
    expect(req.status).toBe(200);
    const devCode = ((await req.json()) as { devCode: string }).devCode;
    expect(devCode).toMatch(/^\d{6}$/);
    // 틀린 코드 -> 401
    const wrong = devCode === "111111" ? "222222" : "111111";
    expect((await post("/api/auth/otp/verify", { email: "lee@atasset.co.kr", code: wrong })).status).toBe(401);
    // 맞는 코드 -> 200 + token, 보호 엔드포인트 접근
    const v = await post("/api/auth/otp/verify", { email: "lee@atasset.co.kr", code: devCode });
    expect(v.status).toBe(200);
    const token = ((await v.json()) as { token: string }).token;
    expect((await get("/api/org/tree", token)).status).toBe(200);
    // 소비된 코드 재사용 -> 401
    expect((await post("/api/auth/otp/verify", { email: "lee@atasset.co.kr", code: devCode })).status).toBe(401);
  });

  it("도메인 밖 이메일 OTP 요청 -> 400", async () => {
    await bootstrapAdmin();
    expect((await post("/api/auth/otp/request", { email: "someone@gmail.com" })).status).toBe(400);
  });

  it("없는 계정 OTP 요청 -> 200(열거 방지) + 코드 미발급", async () => {
    await bootstrapAdmin();
    const r = await post("/api/auth/otp/request", { email: "ghost@atasset.co.kr" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { devCode?: string }).devCode).toBeUndefined();
  });
});
