import { env, SELF } from "cloudflare:test";
import { users } from "@ga-settle/schema";
import { encField, getDb } from "../src/db";
import { hashPassword, signToken } from "../src/auth";

// 테스트 seed용: *Enc 컬럼에 넣을 AES-GCM 암호문 생성 (F-020).
export const enc = (v: unknown) => encField(v, env.FIELD_ENCRYPTION_KEY);

// F-024 인증 롤아웃: 전 엔드포인트가 토큰을 요구하므로 테스트용 admin 시드 + 토큰.
// 격리 스토리지가 테스트마다 리셋되므로 매 호출 idempotent 시드.
export async function authHeader(): Promise<Record<string, string>> {
  await getDb(env).insert(users).values({
    id: "test-admin", email: "admin@test.local", name: "테스트관리자", role: "admin",
    passwordHash: await hashPassword("pw", env.SESSION_SECRET), active: true, createdAt: "2026-07-07",
  }).onConflictDoNothing();
  return { authorization: `Bearer ${await signToken("test-admin", env.SESSION_SECRET)}` };
}

// 인증 포함 요청 헬퍼 (기존 테스트의 post/get/getJson 대체)
export const apost = async (path: string, body: unknown = {}) =>
  SELF.fetch(`https://x${path}`, { method: "POST", headers: { "content-type": "application/json", ...(await authHeader()) }, body: JSON.stringify(body) });
export const aget = async (path: string, init: RequestInit = {}) =>
  SELF.fetch(`https://x${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(await authHeader()) } });
export const agetJson = async (path: string) => (await aget(path)).json();
