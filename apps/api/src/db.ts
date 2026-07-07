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
