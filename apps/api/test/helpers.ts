import { env } from "cloudflare:test";
import { encField } from "../src/db";

// 테스트 seed용: *Enc 컬럼에 넣을 AES-GCM 암호문 생성 (F-020).
export const enc = (v: unknown) => encField(v, env.FIELD_ENCRYPTION_KEY);
