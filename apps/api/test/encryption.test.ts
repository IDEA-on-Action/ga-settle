import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { encField, decField, decNum } from "../src/db";

const KEY = () => env.FIELD_ENCRYPTION_KEY;

describe("F-020 필드 암호화 (AES-GCM)", () => {
  it("왕복: 암호문은 평문이 아니고, 복호화하면 원값 (NFR-02)", async () => {
    const ct = await encField("1234500", KEY());
    expect(ct).not.toBe("1234500");           // 평문 미저장
    expect(ct).toMatch(/^[A-Za-z0-9+/=]+$/);   // base64
    expect(await decField(ct, KEY())).toBe("1234500");
    expect(await decNum(ct, KEY())).toBe(1234500);
  });

  it("null 통과", async () => {
    expect(await encField(null, KEY())).toBeNull();
    expect(await decField(null, KEY())).toBeNull();
    expect(await decNum(null, KEY())).toBe(0);
  });

  it("같은 값도 매번 다른 암호문 (IV 랜덤)", async () => {
    const a = await encField("x", KEY());
    const b = await encField("x", KEY());
    expect(a).not.toBe(b);
    expect(await decField(a, KEY())).toBe("x");
  });

  it("빈 키는 fail-closed (하드코딩 폴백 없음)", async () => {
    await expect(encField("x", "")).rejects.toThrow();
  });
});
