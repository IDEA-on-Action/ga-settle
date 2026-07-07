import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { agents } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { findFamilyCandidates } from "../src/family";

const post = (path: string, body: unknown) =>
  SELF.fetch(`https://x${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const getJson = async (path: string) => (await SELF.fetch(`https://x${path}`)).json();
const seedAgent = (id: string, name: string, birth: string) =>
  getDb(env).insert(agents).values({ id, code: id, name, birthDateEnc: birth, status: "active", createdAt: "2026-07-07" });

describe("F-011 가족계약 감지 (순수)", () => {
  it("성명+생년월일 일치만 후보, 생년월일 없으면 미매칭", () => {
    const c = findFamilyCandidates(
      [
        { contractNo: "C1", agentId: "x", holderName: "김철수", holderBirth: "1980-01-01" }, // 매칭
        { contractNo: "C2", agentId: "x", holderName: "이영희", holderBirth: "1975-05-05" }, // a2 birth null
        { contractNo: "C3", agentId: "x", holderName: "박길동", holderBirth: "800101" },      // 이름 불일치
      ],
      [{ id: "a1", name: "김철수", birth: "800101" }, { id: "a2", name: "이영희", birth: null }],
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ contractNo: "C1", matchedAgentId: "a1" });
  });
});

describe("F-011 HITL 플로우", () => {
  it("감지는 candidate만 생성 - 자동 확정 경로 없음 (Acceptance)", async () => {
    await seedAgent("a1", "김철수", "800101");
    const res = await post("/api/family/detect", { contracts: [{ contractNo: "C1", agentId: "a1", holderName: "김철수", holderBirth: "800101" }] });
    expect(res.status).toBe(201);
    expect((await res.json() as { candidates: number }).candidates).toBe(1);
    const all = (await getJson("/api/family")) as { status: string }[];
    expect(all.length).toBe(1);
    expect(all.every((f) => f.status === "candidate")).toBe(true);
    expect(all.filter((f) => f.status === "confirmed")).toHaveLength(0); // 자동 확정 없음
  });

  it("확정은 실무자만(confirmedBy 필수) + candidate에서만", async () => {
    await seedAgent("a1", "김철수", "800101");
    await post("/api/family/detect", { contracts: [{ contractNo: "C1", agentId: "a1", holderName: "김철수", holderBirth: "800101" }] });
    const [flag] = (await getJson("/api/family")) as { id: string }[];

    expect((await post(`/api/family/${flag!.id}/confirm`, {})).status).toBe(400); // confirmedBy 없음
    const ok = await post(`/api/family/${flag!.id}/confirm`, { confirmedBy: "staff1" });
    expect(ok.status).toBe(200);
    expect((await ok.json() as { status: string; confirmedBy: string })).toMatchObject({ status: "confirmed", confirmedBy: "staff1" });
    expect((await post(`/api/family/${flag!.id}/confirm`, { confirmedBy: "staff1" })).status).toBe(409); // 이미 confirmed
  });

  it("해제: 이력 보존(행 유지, released)", async () => {
    await seedAgent("a1", "김철수", "800101");
    await post("/api/family/detect", { contracts: [{ contractNo: "C1", agentId: "a1", holderName: "김철수", holderBirth: "800101" }] });
    const [flag] = (await getJson("/api/family")) as { id: string }[];
    await post(`/api/family/${flag!.id}/confirm`, { confirmedBy: "staff1" });
    expect((await post(`/api/family/${flag!.id}/release`, {})).status).toBe(200);
    const all = (await getJson("/api/family")) as { id: string; status: string }[];
    expect(all).toHaveLength(1); // 삭제 아님(이력 보존)
    expect(all[0]!.status).toBe("released");
  });
});
