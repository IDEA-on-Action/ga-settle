import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

import { apost as post, agetJson as getJson, aget } from "./helpers";

describe("F-009 조직 + 소속 이력", () => {
  it("소속 이동 후 이전 월 재계산 시 이전 소속으로 계산 (Acceptance, FR-11)", async () => {
    await post("/api/org/units", { id: "A", name: "1본부", kind: "headquarters" });
    await post("/api/org/units", { id: "B", name: "2본부", kind: "headquarters" });
    await post("/api/agents", { id: "ag1", code: "FC001", name: "홍길동" });
    await post("/api/agents/ag1/assignments", { orgUnitId: "A", validFrom: "2026-01-01" });
    await post("/api/agents/ag1/assignments", { orgUnitId: "B", validFrom: "2026-06-01" }); // 소속 이동

    const past = (await getJson("/api/agents/ag1/org?date=2026-03-15")) as { orgUnitId: string };
    expect(past.orgUnitId).toBe("A"); // 이전 월 -> 이전 소속
    const now = (await getJson("/api/agents/ag1/org?date=2026-07-15")) as { orgUnitId: string };
    expect(now.orgUnitId).toBe("B"); // 이동 후 -> 새 소속
    // 이동 경계: 정확히 2026-06-01 은 새 소속
    expect(((await getJson("/api/agents/ag1/org?date=2026-06-01")) as { orgUnitId: string }).orgUnitId).toBe("B");
  });

  it("조직 트리 (본부 > 사업단 > 팀)", async () => {
    await post("/api/org/units", { id: "hq", name: "본부", kind: "headquarters" });
    await post("/api/org/units", { id: "div", name: "사업단", kind: "division", parentId: "hq" });
    await post("/api/org/units", { id: "team", name: "팀", kind: "team", parentId: "div" });
    const tree = (await getJson("/api/org/tree")) as { id: string; children: { children: { id: string }[] }[] }[];
    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe("hq");
    expect(tree[0]!.children[0]!.children[0]!.id).toBe("team");
  });

  it("ERP 일괄 등록 -> 설계사 + 소속 배정", async () => {
    await post("/api/org/units", { id: "A", name: "1팀", kind: "team" });
    const res = await post("/api/erp/agents", {
      agents: [
        { code: "E1", name: "김철수", orgUnitId: "A", validFrom: "2026-01-01" },
        { code: "E2", name: "이영희", orgUnitId: "A", validFrom: "2026-01-01" },
      ],
    });
    expect(res.status).toBe(201);
    expect((await res.json() as { registered: number }).registered).toBe(2);
  });

  it("없는 설계사 배정 -> 404, 잘못된 날짜 -> 400", async () => {
    expect((await post("/api/agents/nope/assignments", { orgUnitId: "A", validFrom: "2026-01-01" })).status).toBe(404);
    await post("/api/agents", { id: "ag2", code: "FC2", name: "박" });
    expect((await post("/api/agents/ag2/assignments", { orgUnitId: "A", validFrom: "2026/01/01" })).status).toBe(400);
  });
});
