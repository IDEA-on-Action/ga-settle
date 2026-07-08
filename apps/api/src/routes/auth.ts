import { Hono } from "hono";
import { z } from "zod";
import { and, eq, desc, isNull } from "drizzle-orm";
import { users, agentAssignments, otpCodes } from "@ga-settle/schema";
import type { Env } from "../types";
import { getDb, writeAudit } from "../db";
import { hashPassword, signToken, authUser, inScope, adminIpAllowed, ctEq } from "../auth";
import { sendEmail, genOtpCode, otpEmailHtml } from "../email";

// OTP 전용 도메인 (F-027). @이 도메인 사용자는 비밀번호 대신 이메일 코드로만 로그인.
const otpDomain = (env: Env) => (env.OTP_EMAIL_DOMAIN ?? "atasset.co.kr").toLowerCase();
const isOtpEmail = (email: string, env: Env) => email.toLowerCase().endsWith("@" + otpDomain(env));
// OTP 강제 여부. off(기본)면 @도메인 계정도 임시 비번으로 로그인(이메일 인프라 준비 전 대체 흐름).
const otpEnforced = (env: Env) => env.OTP_ENFORCED === "true" || env.OTP_ENFORCED === "1";

// 계정 + 세션 인증 + RBAC 조직 스코프 (F-017 REQ-026).
export const authRoutes = new Hono<{ Bindings: Env }>();

// 계정 생성: 첫 계정(부트스트랩)은 관리자 IP 허용목록 게이트, 이후엔 인증된 admin만.
authRoutes.post("/api/users", async (c) => {
  const db = getDb(c.env);
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length === 0) {
    if (!adminIpAllowed(c.req.raw, c.env.ADMIN_IP_ALLOWLIST ?? "")) return c.json({ error: "허용되지 않은 IP" }, 403);
  } else {
    const admin = await authUser(c.req.raw, db, c.env.SESSION_SECRET);
    if (!admin || admin.role !== "admin") return c.json({ error: "관리자만 계정을 만들 수 있어요" }, 403);
  }
  const b = z.object({
    email: z.string().email(), name: z.string().min(1),
    role: z.enum(["admin", "manager", "staff", "viewer"]),
    orgUnitId: z.string().nullable().optional(), password: z.string().min(4),
  }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "계정 검증 실패" }, 400);

  const id = crypto.randomUUID();
  await getDb(c.env).insert(users).values({
    id, email: b.data.email, name: b.data.name, role: b.data.role, orgUnitId: b.data.orgUnitId ?? null,
    passwordHash: await hashPassword(b.data.password, c.env.SESSION_SECRET), active: true, createdAt: new Date().toISOString(),
  });
  return c.json({ id, email: b.data.email, role: b.data.role, orgUnitId: b.data.orgUnitId ?? null }, 201);
});

authRoutes.post("/api/auth/login", async (c) => {
  const b = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "로그인 검증 실패" }, 400);
  // OTP 강제(OTP_ENFORCED=on) 시에만 @도메인 계정 비번 로그인 차단. off(기본)면 임시 비번 허용 (F-027 대체 흐름).
  if (isOtpEmail(b.data.email, c.env) && otpEnforced(c.env)) return c.json({ error: `@${otpDomain(c.env)} 계정은 이메일 코드(OTP)로 로그인하세요`, otp: true }, 403);
  const db = getDb(c.env);
  const u = await db.select().from(users).where(eq(users.email, b.data.email)).get();
  if (!u || !u.active || !ctEq(u.passwordHash, await hashPassword(b.data.password, c.env.SESSION_SECRET))) {
    return c.json({ error: "이메일 또는 비밀번호가 틀려요" }, 401);
  }
  await writeAudit(db, { actor: u.id, action: "auth.login", entity: "users", entityId: u.id });
  return c.json({ token: await signToken(u.id, c.env.SESSION_SECRET), role: u.role, orgUnitId: u.orgUnitId, mustChangePassword: u.mustChangePassword });
});

// OTP 코드 요청 (F-027): @도메인 계정만. 계정 존재 시에만 코드 생성/발송, 없어도 200(열거 방지).
authRoutes.post("/api/auth/otp/request", async (c) => {
  const b = z.object({ email: z.string().email() }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "이메일을 확인해주세요" }, 400);
  const email = b.data.email.toLowerCase();
  if (!isOtpEmail(email, c.env)) return c.json({ error: `OTP 로그인은 @${otpDomain(c.env)} 계정만 가능해요` }, 400);
  const db = getDb(c.env);
  const u = await db.select().from(users).where(eq(users.email, email)).get();
  const resp: Record<string, unknown> = { sent: true, ttlSeconds: 300 };
  if (u && u.active) {
    const code = genOtpCode();
    await db.delete(otpCodes).where(eq(otpCodes.email, email)); // 이전 미소비 코드 무효화
    await db.insert(otpCodes).values({
      id: crypto.randomUUID(), email, codeHash: await hashPassword(code, c.env.SESSION_SECRET),
      expiresAt: new Date(Date.now() + 300_000).toISOString(), createdAt: new Date().toISOString(),
    });
    await sendEmail(c.env, email, "ATA 로그인 인증 코드", otpEmailHtml(code));
    await writeAudit(db, { actor: u.id, action: "auth.otp_request", entity: "users", entityId: u.id });
    if (c.env.ENV !== "production") resp.devCode = code; // 비-프로덕션에서만 노출(테스트/개발)
  }
  return c.json(resp);
});

// OTP 코드 검증 (F-027): 유효 시 세션 토큰 발급. 5회 시도 제한, 5분 만료.
authRoutes.post("/api/auth/otp/verify", async (c) => {
  const b = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "6자리 코드를 확인해주세요" }, 400);
  const email = b.data.email.toLowerCase();
  const db = getDb(c.env);
  const rec = await db.select().from(otpCodes).where(eq(otpCodes.email, email)).orderBy(desc(otpCodes.createdAt)).get();
  const now = new Date().toISOString();
  if (!rec || rec.consumedAt || rec.expiresAt < now || rec.attempts >= 5) {
    return c.json({ error: "코드가 유효하지 않거나 만료됐어요. 다시 요청해주세요" }, 401);
  }
  if (!ctEq(rec.codeHash, await hashPassword(b.data.code, c.env.SESSION_SECRET))) {
    await db.update(otpCodes).set({ attempts: rec.attempts + 1 }).where(eq(otpCodes.id, rec.id));
    return c.json({ error: "코드가 틀려요" }, 401);
  }
  const u = await db.select().from(users).where(eq(users.email, email)).get();
  if (!u || !u.active) return c.json({ error: "계정을 찾을 수 없어요" }, 401);
  await db.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, rec.id));
  await writeAudit(db, { actor: u.id, action: "auth.otp_login", entity: "users", entityId: u.id });
  return c.json({ token: await signToken(u.id, c.env.SESSION_SECRET), role: u.role, orgUnitId: u.orgUnitId });
});

// 비밀번호 변경 (본인, 현재 비번 확인) - F-025 REQ-034
authRoutes.post("/api/auth/change-password", async (c) => {
  const db = getDb(c.env);
  const user = await authUser(c.req.raw, db, c.env.SESSION_SECRET);
  if (!user) return c.json({ error: "인증이 필요해요" }, 401);
  const b = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
    .safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "비밀번호 검증 실패 (currentPassword 필수, newPassword 8자+)" }, 400);
  if (!ctEq(user.passwordHash, await hashPassword(b.data.currentPassword, c.env.SESSION_SECRET))) {
    return c.json({ error: "현재 비밀번호가 틀려요" }, 401);
  }
  if (b.data.newPassword === b.data.currentPassword) return c.json({ error: "새 비밀번호가 기존과 같아요" }, 400);
  await db.update(users).set({ passwordHash: await hashPassword(b.data.newPassword, c.env.SESSION_SECRET), mustChangePassword: false }).where(eq(users.id, user.id));
  await writeAudit(db, { actor: user.id, action: "auth.change_password", entity: "users", entityId: user.id });
  return c.json({ ok: true });
});

// 비밀번호 초기화 (admin이 타 계정 - 분실 대응) - F-025 REQ-034
authRoutes.post("/api/users/:id/reset-password", async (c) => {
  const db = getDb(c.env);
  const admin = await authUser(c.req.raw, db, c.env.SESSION_SECRET);
  if (!admin || admin.role !== "admin") return c.json({ error: "관리자만 비밀번호를 초기화할 수 있어요" }, 403);
  const b = z.object({ newPassword: z.string().min(8) }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "비밀번호 검증 실패 (newPassword 8자+)" }, 400);
  const targetId = c.req.param("id");
  const target = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).get();
  if (!target) return c.json({ error: "없는 계정이에요" }, 404);
  // 임시 비번 발급 → 다음 로그인에서 변경 강제 (mustChangePassword=true)
  await db.update(users).set({ passwordHash: await hashPassword(b.data.newPassword, c.env.SESSION_SECRET), mustChangePassword: true }).where(eq(users.id, targetId));
  await writeAudit(db, { actor: admin.id, action: "auth.reset_password", entity: "users", entityId: targetId, summary: { by: admin.id } });
  return c.json({ ok: true, userId: targetId });
});

// 조직 스코프 보호 조회: 해당 org의 현재 소속 설계사. 스코프 밖이면 403 (Acceptance).
authRoutes.get("/api/orgs/:orgUnitId/agents", async (c) => {
  const db = getDb(c.env);
  const user = await authUser(c.req.raw, db, c.env.SESSION_SECRET);
  if (!user) return c.json({ error: "인증이 필요해요" }, 401);
  const orgUnitId = c.req.param("orgUnitId");
  if (!(await inScope(db, user, orgUnitId))) return c.json({ error: "조직 스코프 밖 데이터예요" }, 403);
  const asgs = await db.select().from(agentAssignments).where(and(eq(agentAssignments.orgUnitId, orgUnitId), isNull(agentAssignments.validTo))).all();
  return c.json({ orgUnitId, agentIds: asgs.map((a) => a.agentId) });
});
