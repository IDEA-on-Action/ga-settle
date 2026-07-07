import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { insurers, uploads } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { apost, aget, agetJson } from "./helpers";

// F-026 원수사 마스터 CRUD
describe("F-026 원수사 CRUD", () => {
  it("무인증 -> 401 (인증 게이트)", async () => {
    expect((await SELF.fetch("https://x/api/insurers")).status).toBe(401);
  });

  it("생성(커스텀 id) + 중복 409 + 목록/단건", async () => {
    expect((await apost("/api/insurers", { id: "ins-a", name: "가나생명" })).status).toBe(201);
    expect((await apost("/api/insurers", { id: "ins-a", name: "중복" })).status).toBe(409); // 중복 id
    // name 누락 -> 400
    expect((await apost("/api/insurers", { id: "ins-x" })).status).toBe(400);

    const list = (await agetJson("/api/insurers")) as { insurers: { id: string }[] };
    expect(list.insurers.some((r) => r.id === "ins-a")).toBe(true);

    const one = (await agetJson("/api/insurers/ins-a")) as { name: string };
    expect(one.name).toBe("가나생명");
    expect((await aget("/api/insurers/nope")).status).toBe(404);
  });

  it("생성(id 자동, UUID)", async () => {
    const created = (await (await apost("/api/insurers", { name: "다라화재" })).json()) as { id: string };
    expect(created.id).toBeTruthy();
    expect((await apost("/api/insurers", { name: "마바생명" })).status).toBe(201); // UUID라 중복 아님
  });

  it("이름 수정 반영", async () => {
    await apost("/api/insurers", { id: "ins-p", name: "옛이름" });
    const patch = await aget("/api/insurers/ins-p", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "새이름" }),
    });
    expect(patch.status).toBe(200);
    expect(((await agetJson("/api/insurers/ins-p")) as { name: string }).name).toBe("새이름");
    // 없는 원수사 수정 -> 404
    const miss = await aget("/api/insurers/none", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) });
    expect(miss.status).toBe(404);
  });

  it("삭제: 참조 없으면 200, 참조(업로드) 있으면 409", async () => {
    // 참조 없는 원수사 -> 삭제 200 -> 이후 404
    await apost("/api/insurers", { id: "ins-del", name: "삭제대상" });
    const del = await aget("/api/insurers/ins-del", { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await aget("/api/insurers/ins-del")).status).toBe(404);

    // 업로드가 참조하는 원수사 -> 삭제 409
    await apost("/api/insurers", { id: "ins-ref", name: "참조있음" });
    await getDb(env).insert(uploads).values({
      id: "up-ref", insurerId: "ins-ref", r2Key: "k", fileHash: "hh1", status: "queued",
      settlementMonth: "2026-06", createdBy: "system", createdAt: "2026-07-08",
    });
    const blocked = await aget("/api/insurers/ins-ref", { method: "DELETE" });
    expect(blocked.status).toBe(409);
    // 여전히 존재
    expect((await aget("/api/insurers/ins-ref")).status).toBe(200);
    void insurers;
  });
});
