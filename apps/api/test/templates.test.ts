import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { insurers, uploads } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { resolveTemplate } from "../src/routes/mapping";

const H1 = ["증권No", "계약일", "실적보험료", "항목A"];
const CM1 = { 계약번호: 0, 계약일: 1, 보험료: 2, 지급수수료: 3 };
const H2 = ["policyNo", "date", "premium", "commission"]; // 다른 양식(시그니처 상이)

beforeEach(async () => {
  await getDb(env).insert(insurers).values({ id: "ins1", name: "A생명", createdAt: "2026-07-07" });
});

async function seedUpload(id: string) {
  await getDb(env).insert(uploads).values({
    id, insurerId: "ins1", r2Key: "k/" + id, fileHash: "h-" + id, status: "review",
    settlementMonth: "2026-07", createdBy: "system", createdAt: "2026-07-07",
  });
}
const confirm = (uploadId: string, headers: string[], columnMap: Record<string, number>) =>
  SELF.fetch(`https://x/api/uploads/${uploadId}/mapping/confirm`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ headers, columnMap }),
  });

describe("F-007 TemplateVersion + L0 캐시", () => {
  it("확정 -> TemplateVersion v1 저장 + L0 시그니처 캐시 적중 (REQ-013)", async () => {
    await seedUpload("u1");
    const res = await confirm("u1", H1, CM1);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { version: number; cached: boolean };
    expect(body.version).toBe(1);
    expect(body.cached).toBe(false);

    // 재업로드 시나리오: 같은 헤더 시그니처 -> L0 캐시 적중
    const hit = await resolveTemplate(getDb(env), "ins1", H1);
    expect(hit?.version).toBe(1);
    expect(hit?.columnMap).toEqual(CM1);
    // 시그니처는 열 순서/표기 정규화라 대소문자/공백 무시
    expect(await resolveTemplate(getDb(env), "ins1", ["증권 No", "계약일", "실적보험료", "항목A"])).not.toBeNull();
  });

  it("같은 시그니처 재확정은 새 버전 안 만들고 재사용 (cached=true)", async () => {
    await seedUpload("u1");
    await confirm("u1", H1, CM1);
    await seedUpload("u2");
    const res = await confirm("u2", H1, CM1);
    const body = (await res.json()) as { version: number; cached: boolean };
    expect(body.cached).toBe(true);
    expect(body.version).toBe(1);
  });

  it("다른 양식(시그니처 변경) 확정 -> 새 버전 v2 (REQ-014)", async () => {
    await seedUpload("u1");
    await confirm("u1", H1, CM1);
    await seedUpload("u2");
    const res = await confirm("u2", H2, { 계약번호: 0, 계약일: 1, 보험료: 2, 지급수수료: 3 });
    const body = (await res.json()) as { version: number };
    expect(body.version).toBe(2);

    // 관리 화면용 이력: 2개 버전 최신순
    const list = (await (await SELF.fetch("https://x/api/insurers/ins1/templates")).json()) as { version: number }[];
    expect(list.map((t) => t.version)).toEqual([2, 1]);
  });

  it("없는 업로드 확정 -> 404, 본문 누락 -> 400", async () => {
    expect((await confirm("nope", H1, CM1)).status).toBe(404);
    await seedUpload("u9");
    const bad = await SELF.fetch("https://x/api/uploads/u9/mapping/confirm", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(bad.status).toBe(400);
  });
});
