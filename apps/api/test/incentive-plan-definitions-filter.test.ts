import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { insurers, incentivePlanDefinitions, incentivePlans } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { agetJson } from "./helpers";

// F-056/F-057: 시책안 4대 대분류로 시상정의 필터. 생보는 channel로 파생(FC/법인), 손보 xlsx는 전체.
// F-057: 손보 설계사/자체는 시책안 대분류로 연결(plan_image_key = incentive_plans.r2_key → category).
const rows = [
  { id: "d-sfc-1", lineType: "생보", channel: "FC", key: null, cond1: null },
  { id: "d-sfc-2", lineType: "생보", channel: "FC", key: null, cond1: null },
  { id: "d-scorp-1", lineType: "생보", channel: "법인", key: null, cond1: null },
  // xlsx 손보 소급(F-058): cond1 시상유형 규칙. 설계사=가동·주간·기본·연속·브릿지, 자체=그 외.
  { id: "d-sonbo-gadong", lineType: "손보", channel: null, key: null, cond1: "월간연속가동 시상" }, // →설계사
  { id: "d-sonbo-jugan", lineType: "손보", channel: null, key: null, cond1: "주간 3주차" }, // →설계사
  { id: "d-sonbo-julyeok", lineType: "손보", channel: null, key: null, cond1: "주력상품Ⅰ1주차" }, // →자체
  { id: "d-sonbo-nullcond", lineType: "손보", channel: null, key: null, cond1: null }, // →자체(기타/잔여)
  { id: "d-sonbo-planner", lineType: "손보", channel: null, key: "incentive-plans/planner.pdf", cond1: "주력상품" }, // OCR 링크=설계사(링크 우선, cond1 무시)
  { id: "d-sonbo-self", lineType: "손보", channel: null, key: "incentive-plans/self.pdf", cond1: "가동" }, // OCR 링크=자체(링크 우선)
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
      id: r.id, insurerId: "ins-f056", baseMonth: "202606", lineType: r.lineType, channel: r.channel, cond1: r.cond1,
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
    expect(ids).toEqual(new Set(["d-sonbo-gadong", "d-sonbo-jugan", "d-sonbo-julyeok", "d-sonbo-nullcond", "d-sonbo-planner", "d-sonbo-self"]));
  });

  it("category=sonbo_planner → OCR 링크(설계사) + xlsx 시상유형 설계사 소급 (F-057/F-058)", async () => {
    const ids = await countByCategory("sonbo_planner");
    // 가동·주간(xlsx 소급) + 링크=설계사(OCR). d-sonbo-self는 cond1=가동이지만 링크=자체라 제외(링크 우선).
    expect(ids).toEqual(new Set(["d-sonbo-gadong", "d-sonbo-jugan", "d-sonbo-planner"]));
  });

  it("category=sonbo_self → OCR 링크(자체) + xlsx 시상유형 자체 소급(그 외+null) (F-057/F-058)", async () => {
    const ids = await countByCategory("sonbo_self");
    // 주력상품·null(xlsx 소급) + 링크=자체(OCR). d-sonbo-planner는 cond1=주력이지만 링크=설계사라 제외.
    expect(ids).toEqual(new Set(["d-sonbo-julyeok", "d-sonbo-nullcond", "d-sonbo-self"]));
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
