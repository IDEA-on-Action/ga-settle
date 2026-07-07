import { eq } from "drizzle-orm";
import { users, orgUnits } from "@ga-settle/schema";
import type { Db } from "./db";

// 세션 인증 + RBAC 조직 스코프 (F-017). 세션 토큰은 HMAC 서명(SESSION_SECRET).
// TODO(F-020/보안): 패스워드 해시를 PBKDF2/argon2로. 현재는 salted SHA-256(합성/개발용).

const te = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const TOKEN_TTL_SEC = 8 * 3600; // 세션 만료 8시간

// 상수시간 문자열 비교 (타이밍 공격 방지).
export function ctEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// 시크릿 미설정이면 fail-closed (하드코딩 폴백 금지 - 위조 방지). 테스트/prod 모두 시크릿 주입.
function requireSecret(secret: string): string {
  if (!secret || secret.length === 0) throw new Error("SESSION_SECRET 미설정");
  return secret;
}

// TODO(F-020/보안 하드닝): 패스워드 해시를 PBKDF2/argon2로. 현재 salted SHA-256.
export async function hashPassword(pw: string, secret: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", te.encode(`${requireSecret(secret)}:${pw}`)));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", te.encode(requireSecret(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, te.encode(data)));
}

export async function signToken(userId: string, secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  const payload = btoa(`${userId}:${exp}`);
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyToken(token: string, secret: string): Promise<string | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  let expectedSig: string;
  try { expectedSig = await hmac(secret, payload); } catch { return null; }
  if (!ctEq(sig, expectedSig)) return null;
  let decoded: string;
  try { decoded = atob(payload); } catch { return null; }
  const [userId, expStr] = decoded.split(":");
  if (!userId || !expStr) return null;
  if (Number(expStr) < Math.floor(Date.now() / 1000)) return null; // 만료
  return userId;
}

export type AuthUser = typeof users.$inferSelect;

// Authorization: Bearer <token> 에서 사용자 로드. 실패 시 null(401).
export async function authUser(req: Request, db: Db, secret: string): Promise<AuthUser | null> {
  const h = req.headers.get("authorization");
  const token = h?.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return null;
  const userId = await verifyToken(token, secret);
  if (!userId) return null;
  const u = await db.select().from(users).where(eq(users.id, userId)).get();
  return u && u.active ? u : null;
}

// 조직 스코프: admin 전체, 그 외는 자기 소속(orgUnitId)이 대상 org의 조상-or-self일 때만.
export async function inScope(db: Db, user: AuthUser, orgUnitId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  if (!user.orgUnitId) return false;
  let cur: string | null = orgUnitId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === user.orgUnitId) return true;
    seen.add(cur);
    const node = await db.select({ parentId: orgUnits.parentId }).from(orgUnits).where(eq(orgUnits.id, cur)).get();
    cur = node?.parentId ?? null;
  }
  return false;
}

// 관리자 IP 허용목록 (NFR-03). 목록 미설정(dev) 시 허용.
export function adminIpAllowed(req: Request, allowlist: string): boolean {
  const list = allowlist.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  const ip = req.headers.get("cf-connecting-ip") ?? "";
  return list.includes(ip);
}
