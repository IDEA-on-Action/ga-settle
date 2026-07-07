import { drizzle } from "drizzle-orm/d1";
import * as schema from "@ga-settle/schema";

// D1 바인딩을 Drizzle 클라이언트로 감싼다. 스키마(@ga-settle/schema)가 단일 진실원천.
export const getDb = (env: { DB: D1Database }) => drizzle(env.DB, { schema });
export type Db = ReturnType<typeof getDb>;

// SHA-256 hex (파일 멱등 키). Web Crypto - Worker/브라우저 공용.
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 필드 암호화 (F-020 NFR-02): AES-GCM. 키는 FIELD_ENCRYPTION_KEY(Workers Secret)에서
// SHA-256으로 AES-256 키 유도. 포맷: base64(iv[12] + ciphertext+tag). 빈 키는 fail-closed.
async function aesKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length === 0) throw new Error("FIELD_ENCRYPTION_KEY 미설정");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encField(v: unknown, secret: string): Promise<string | null> {
  if (v == null) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(String(v))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

export async function decField(enc: string | null, secret: string): Promise<string | null> {
  if (enc == null) return null;
  const bytes = Uint8Array.from(atob(enc), (ch) => ch.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await aesKey(secret), bytes.slice(12));
  return new TextDecoder().decode(pt);
}

// 복호화 후 숫자 (금액 집계용). null/실패는 0.
export async function decNum(enc: string | null, secret: string): Promise<number> {
  const s = await decField(enc, secret).catch(() => null);
  return Number(s ?? 0) || 0;
}

// 감사 로그 기록 (F-015 NFR-04). audit_logs는 append-only(F-002 트리거)라 사후 변조 불가.
export async function writeAudit(
  db: Db, e: { actor: string; action: string; entity: string; entityId?: string; summary?: unknown; ip?: string },
): Promise<void> {
  await db.insert(schema.auditLogs).values({
    actor: e.actor, action: e.action, entity: e.entity, entityId: e.entityId ?? null,
    summaryJson: e.summary != null ? JSON.stringify(e.summary) : null, ip: e.ip ?? null, at: new Date().toISOString(),
  });
}
