import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { insurers, incentiveRules } from "@ga-settle/schema";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { apost, agetJson } from "./helpers";

// F-060: 시상정의 만기기간(maturity_term) 차원. 상품·납입기간 같아도 만기별 지급율 상이(ABL생명).
// write(POST) → 목록/검색(GET) → 운영룰 승격 _source 감사 역추적까지 만기기간이 관통하는지 DB 왕복으로 검증.
// vitest-pool-workers는 테스트별 스토리지 격리 → 시딩은 beforeAll에 한 번(→ [[vitest-pool-workers-gotchas]]).
describe("시상정의 만기기간 차원 (F-060)", () => {
  beforeAll(async () => {
    await getDb(env).insert(insurers).values({ id: "ins-f060", name: "ABL테스트생명", createdAt: "2026-07-17" }).onConflictDoNothing();
    const res = await apost("/api/incentive-plan-definitions", {
      insurerId: "ins-f060",
      baseMonth: "202607",
      rows: [
        { product: "무배당종신", payTerm: "5년납", maturityTerm: "20년만기", rateType: "rate", rateValue: 1.5 },
        { product: "무배당종신", payTerm: "5년납", maturityTerm: "종신", rateType: "rate", rateValue: 2.5 },
      ],
    });
    expect(res.status).toBe(201);
  });

  it("목록 API가 maturity_term을 노출하고, 상품·납입기간 같아도 만기별로 지급율이 구분된다", async () => {
    const list = (await agetJson("/api/incentive-plan-definitions?insurerId=ins-f060&limit=100")) as {
      items: { product: string; payTerm: string | null; maturityTerm: string | null; rateValue: number }[];
    };
    const byMaturity = new Map(list.items.map((i) => [i.maturityTerm, i]));
    expect(byMaturity.get("20년만기")?.rateValue).toBe(1.5);
    expect(byMaturity.get("종신")?.rateValue).toBe(2.5);
  });

  it("q 검색 대상에 만기기간이 포함된다", async () => {
    const list = (await agetJson("/api/incentive-plan-definitions?insurerId=ins-f060&q=20년만기&limit=100")) as {
      items: { maturityTerm: string | null }[];
    };
    expect(list.items.length).toBeGreaterThanOrEqual(1);
    expect(list.items.every((i) => i.maturityTerm === "20년만기")).toBe(true);
  });

  it("운영룰 승격 시 _source에 만기기간이 실려 감사 역추적된다", async () => {
    const list = (await agetJson("/api/incentive-plan-definitions?insurerId=ins-f060&q=20년만기&limit=100")) as {
      items: { id: string; maturityTerm: string | null }[];
    };
    const defId = list.items.find((i) => i.maturityTerm === "20년만기")!.id;

    const promote = await apost("/api/incentive-plan-definitions/promote", { definitionIds: [defId] });
    expect(promote.status).toBe(201);

    const rule = await getDb(env)
      .select({ conditionJson: incentiveRules.conditionJson })
      .from(incentiveRules)
      .where(eq(incentiveRules.id, `rule-${defId}`))
      .get();
    const source = (JSON.parse(rule!.conditionJson) as { _source: { maturityTerm: string | null } })._source;
    expect(source.maturityTerm).toBe("20년만기");
  });
});
