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

// 암호화 필드 임시 인코딩. TODO(F-020): FIELD_ENCRYPTION_KEY로 AES-GCM 실제 암호화.
export const encField = (v: unknown): string | null => (v == null ? null : String(v));

// 감사 로그 기록 (F-015 NFR-04). audit_logs는 append-only(F-002 트리거)라 사후 변조 불가.
export async function writeAudit(
  db: Db, e: { actor: string; action: string; entity: string; entityId?: string; summary?: unknown; ip?: string },
): Promise<void> {
  await db.insert(schema.auditLogs).values({
    actor: e.actor, action: e.action, entity: e.entity, entityId: e.entityId ?? null,
    summaryJson: e.summary != null ? JSON.stringify(e.summary) : null, ip: e.ip ?? null, at: new Date().toISOString(),
  });
}
