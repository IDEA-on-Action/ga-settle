import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { insurers, incentivePlanDefinitions } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { apost as post, agetJson as getJson, aget } from "./helpers";

// F-050: 시책룰 삭제 시 시상정의 확정→후보 복원.
// 근본원인: DELETE /api/rules/:id는 soft-delete(active=false)라, promoted EXISTS가
// active를 필터하지 않으면 삭제 후에도 "확정"으로 고착. active 필터로 복원 보장.
async function seedDef(id: string): Promise<void> {
  const db = getDb(env);
  await db.insert(insurers).values({ id: "ins-fb4", name: "테스트생명", createdAt: "2026-07-10" }).onConflictDoNothing();
  await db.insert(incentivePlanDefinitions).values({
    id, insurerId: "ins-fb4", baseMonth: "202603", product: "종신보험",
    rateType: "rate", rateValue: 1.5, sourceType: "ocr", createdBy: "test-admin", createdAt: "2026-07-10",
  }).onConflictDoNothing();
}

async function promotedFlag(defId: string): Promise<boolean> {
  const list = (await getJson("/api/incentive-plan-definitions?limit=200")) as { items: { id: string; promoted: number }[] };
  return !!list.items.find((r) => r.id === defId)?.promoted;
}

describe("시책룰 삭제 → 시상정의 후보 복원 (F-050)", () => {
  it("승격 → promoted=true → 룰 삭제 → 후보 복원(promoted=false) → 재승격", async () => {
    const defId = "def-fb4-1";
    await seedDef(defId);

    // 승격 전: 후보
    expect(await promotedFlag(defId)).toBe(false);

    // 승격 → 확정
    expect((await post("/api/incentive-plan-definitions/promote", { definitionIds: [defId] })).status).toBe(201);
    expect(await promotedFlag(defId)).toBe(true);

    // 시책룰(rule-{defId}) 삭제 → soft-delete
    expect((await aget(`/api/rules/rule-${defId}`, { method: "DELETE" })).status).toBe(200);

    // 핵심: 삭제 후 후보로 복원되어야 한다(과거엔 active 미필터로 확정 고착)
    expect(await promotedFlag(defId)).toBe(false);

    // 재승격 → soft-delete된 룰 재활성 → 다시 확정
    const re = await post("/api/incentive-plan-definitions/promote", { definitionIds: [defId] });
    expect(re.status).toBe(201);
    expect(((await re.json()) as { reactivated: number }).reactivated).toBe(1);
    expect(await promotedFlag(defId)).toBe(true);
  });
});
