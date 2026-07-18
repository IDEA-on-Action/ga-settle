import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { aget } from "./helpers";

// F-070: 산출물 대장 API - 목록(메타만)/다운로드, /api/* 인증 게이트 확인.
describe("F-070 deliverables", () => {
  it("무인증 요청은 401", async () => {
    const res = await SELF.fetch("https://x/api/deliverables");
    expect(res.status).toBe(401);
  });

  it("목록은 메타만 반환 (content 미노출)", async () => {
    const res = await aget("/api/deliverables");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[]; total: number };
    expect(body.total).toBeGreaterThanOrEqual(5);
    const rpt = body.items.find((d) => d.code === "GS-RPT-001");
    expect(rpt).toBeDefined();
    expect(rpt).not.toHaveProperty("content");
    expect(rpt?.title).toBe("착수보고서");
  });

  it("문서 파일 다운로드 (마크다운 attachment)", async () => {
    const res = await aget("/api/deliverables/GS-RPT-001/file");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    expect(text).toContain("착수보고서");
  });

  it("미존재 코드는 404", async () => {
    const res = await aget("/api/deliverables/GS-XXX-999/file");
    expect(res.status).toBe(404);
  });
});
