import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// F-054: 고객 협업 포털 공개 레이어. 인증 없이(공개) 200 + 기대 콘텐츠, 보호 영역은 로그인 유도.
const get = (path: string) => SELF.fetch(`https://x${path}`);

describe("고객 협업 포털 (F-054)", () => {
  it("루트 / 는 데모 랜딩(사용자 요청 원복, 200)", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(1000);
  });

  it("포털 홈은 /portal (공개, 200) - 라이프사이클 4단계 표시", async () => {
    const res = await get("/portal");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("협업 포털");
    for (const stage of ["계약", "개발", "검수", "운영"]) expect(html).toContain(stage);
  });

  it("공개 페이지(개요·진행현황·산출물) 무인증 200", async () => {
    for (const p of ["/overview", "/status", "/deliverables"]) {
      const res = await get(p);
      expect(res.status).toBe(200);
      expect((await res.text()).length).toBeGreaterThan(500);
    }
  });

  it("진행 현황은 마일스톤 타임라인 포함", async () => {
    const html = await (await get("/status")).text();
    expect(html).toContain("마일스톤");
    expect(html).toContain("피드백 5건 반영");
  });

  it("산출물은 공개 가이드 PDF 다운로드 링크 노출", async () => {
    const html = await (await get("/deliverables")).text();
    expect(html).toContain("/guide/ga-settle-guide.pdf");
  });

  it("보호 영역(자료실·소통)은 로그인 유도 CTA", async () => {
    for (const p of ["/assets", "/comms"]) {
      const html = await (await get(p)).text();
      expect(html).toContain("로그인");
      expect(html).toContain("/app");
    }
  });

  it("데모는 /demo 로 이동(기존 인터랙티브 랜딩)", async () => {
    const res = await get("/demo");
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(1000);
  });
});
