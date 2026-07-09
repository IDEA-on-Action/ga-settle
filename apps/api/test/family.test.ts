import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { agents } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { findFamilyCandidates } from "../src/family";

import { apost as post, agetJson as getJson, aget } from "./helpers";
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
    const all = ((await getJson("/api/family")) as { items: { status: string }[] }).items;
    expect(all.length).toBe(1);
    expect(all.every((f) => f.status === "candidate")).toBe(true);
    expect(all.filter((f) => f.status === "confirmed")).toHaveLength(0); // 자동 확정 없음
  });

  it("확정: candidate에서만 + 확정자는 인증 사용자 자동 기록 (F-038)", async () => {
    await seedAgent("a1", "김철수", "800101");
    await post("/api/family/detect", { contracts: [{ contractNo: "C1", agentId: "a1", holderName: "김철수", holderBirth: "800101" }] });
    const [flag] = ((await getJson("/api/family")) as { items: { id: string }[] }).items;

    // 확정자는 손입력이 아닌 로그인 사용자로 서버가 자동 기록 (본문 불필요)
    const ok = await post(`/api/family/${flag!.id}/confirm`, {});
    expect(ok.status).toBe(200);
    expect((await ok.json() as { status: string; confirmedBy: string })).toMatchObject({ status: "confirmed", confirmedBy: "admin@test.local" });
    expect((await post(`/api/family/${flag!.id}/confirm`, {})).status).toBe(409); // 이미 confirmed
  });

  it("해제: 이력 보존(행 유지, released)", async () => {
    await seedAgent("a1", "김철수", "800101");
    await post("/api/family/detect", { contracts: [{ contractNo: "C1", agentId: "a1", holderName: "김철수", holderBirth: "800101" }] });
    const [flag] = ((await getJson("/api/family")) as { items: { id: string }[] }).items;
    await post(`/api/family/${flag!.id}/confirm`, { confirmedBy: "staff1" });
    expect((await post(`/api/family/${flag!.id}/release`, {})).status).toBe(200);
    const all = ((await getJson("/api/family")) as { items: { id: string; status: string }[] }).items;
    expect(all).toHaveLength(1); // 삭제 아님(이력 보존)
    expect(all[0]!.status).toBe("released");
  });
});
