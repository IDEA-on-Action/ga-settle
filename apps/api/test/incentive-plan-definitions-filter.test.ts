import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { insurers, incentivePlanDefinitions, incentivePlans } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { agetJson } from "./helpers";

// F-056/F-057: 시책안 4대 대분류로 시상정의 필터. 생보는 channel로 파생(FC/법인), 손보 xlsx는 전체.
// F-057: 손보 설계사/자체는 시책안 대분류로 연결(plan_image_key = incentive_plans.r2_key → category).
const rows = [
  { id: "d-sfc-1", lineType: "생보", channel: "FC", key: null },
  { id: "d-sfc-2", lineType: "생보", channel: "FC", key: null },
  { id: "d-scorp-1", lineType: "생보", channel: "법인", key: null },
  { id: "d-sonbo-1", lineType: "손보", channel: null, key: null }, // xlsx, 미연결
  { id: "d-sonbo-2", lineType: "손보", channel: null, key: null },
  { id: "d-sonbo-3", lineType: "손보", channel: null, key: null },
  { id: "d-sonbo-planner", lineType: "손보", channel: null, key: "incentive-plans/planner.pdf" }, // OCR, 시책안=설계사
  { id: "d-sonbo-self", lineType: "손보", channel: null, key: "incentive-plans/self.pdf" }, // OCR, 시책안=자체
];

beforeAll(async () => {
  const db = getDb(env);
  await db.insert(insurers).values({ id: "ins-f056", name: "필터테스트생명", createdAt: "2026-07-11" }).onConflictDoNothing();
  // 시책안 업로드(대장): 대분류로 연결될 원본
  await db.insert(incentivePlans).values([
    { id: "ip-planner", category: "sonbo_planner", fileName: "planner.pdf", r2Key: "incentive-plans/planner.pdf", sha256: "shaP", contentType: "application/pdf", byteSize: 1, ocrStatus: "ok", createdBy: "test-admin", createdAt: "2026-07-11" },
    { id: "ip-self", category: "sonbo_self", fileName: "self.pdf", r2Key: "incentive-plans/self.pdf", sha256: "shaS", contentType: "application/pdf", byteSize: 1, ocrStatus: "ok", createdBy: "test-admin", createdAt: "2026-07-11" },
  ]).onConflictDoNothing();
  for (const r of rows) {
    await db.insert(incentivePlanDefinitions).values({
      id: r.id, insurerId: "ins-f056", baseMonth: "202606", lineType: r.lineType, channel: r.channel,
      product: "종신", rateType: "rate", rateValue: 1, sourceType: r.key ? "ocr" : "xlsx", planImageKey: r.key,
      createdBy: "test-admin", createdAt: "2026-07-11",
    }).onConflictDoNothing();
  }
});

const countByCategory = async (cat: string): Promise<Set<string>> => {
  const res = (await agetJson(`/api/incentive-plan-definitions?insurerId=ins-f056&limit=100${cat ? `&category=${cat}` : ""}`)) as {
    items: { id: string }[];
  };
  return new Set(res.items.map((i) => i.id));
};

describe("시상정의 대분류 필터 (F-056)", () => {
  it("category=sengbo_fc → 생보+FC만", async () => {
    const ids = await countByCategory("sengbo_fc");
    expect(ids).toEqual(new Set(["d-sfc-1", "d-sfc-2"]));
  });

  it("category=sengbo_corp → 생보+법인만", async () => {
    const ids = await countByCategory("sengbo_corp");
    expect(ids).toEqual(new Set(["d-scorp-1"]));
  });

  it("category=sonbo → 손보 전체(xlsx + OCR 모두)", async () => {
    const ids = await countByCategory("sonbo");
    expect(ids).toEqual(new Set(["d-sonbo-1", "d-sonbo-2", "d-sonbo-3", "d-sonbo-planner", "d-sonbo-self"]));
  });

  it("category=sonbo_planner → 시책안 대분류=설계사 연결분만 (F-057)", async () => {
    const ids = await countByCategory("sonbo_planner");
    expect(ids).toEqual(new Set(["d-sonbo-planner"]));
  });

  it("category=sonbo_self → 시책안 대분류=자체 연결분만 (F-057)", async () => {
    const ids = await countByCategory("sonbo_self");
    expect(ids).toEqual(new Set(["d-sonbo-self"]));
  });

  it("category 없으면 전체(6건 시드 모두 포함)", async () => {
    const ids = await countByCategory("");
    for (const r of rows) expect(ids.has(r.id)).toBe(true);
  });

  it("잘못된 category는 무시(전체 반환)", async () => {
    const ids = await countByCategory("bogus");
    expect(ids.size).toBeGreaterThanOrEqual(rows.length);
  });
});
