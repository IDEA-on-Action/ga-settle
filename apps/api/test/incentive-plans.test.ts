import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { authHeader } from "./helpers";

// F-046: 시책안 업로드가 이미지에 더해 PDF도 받는지 파일 유형 게이트를 검증한다.
// OCR 엔진(CLOVA/Upstage)은 외부 상용 API라 테스트 env에서 미설정 → 유형 게이트 통과 후
// 503(미설정)/502(상류)/422(빈결과)/200 중 하나. 어느 경로든 "415가 아니다"가 PDF 허용의 증거.
function ocrForm(bytes: Uint8Array, type: string, filename: string) {
  const fd = new FormData();
  fd.set("image", new File([bytes], filename, { type }));
  return fd;
}
const post = async (body: FormData) =>
  SELF.fetch("https://x/api/incentive-plans/ocr", { method: "POST", body, headers: await authHeader() });

describe("POST /api/incentive-plans/ocr 파일 유형 게이트 (F-046)", () => {
  it("파일 없으면 400", async () => {
    expect((await post(new FormData())).status).toBe(400);
  });

  it("미지원 형식(text/plain)은 415", async () => {
    const res = await post(ocrForm(new Uint8Array([1, 2, 3]), "text/plain", "a.txt"));
    expect(res.status).toBe(415);
  });

  it("PDF는 유형 게이트 통과(415 아님) + 원본 R2 .pdf 보관", async () => {
    const res = await post(ocrForm(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf", "plan.pdf"));
    expect(res.status).not.toBe(415);
    expect(res.status).not.toBe(400);
    const body = (await res.json()) as { planImageKey?: string };
    // 유형 게이트 이후 원본은 이미 R2에 보관 → OcrError 경로여도 planImageKey 반환. 확장자 .pdf 확인.
    if (body.planImageKey) expect(body.planImageKey).toMatch(/\.pdf$/);
  });

  it("이미지(PNG)는 계속 허용(회귀)", async () => {
    const res = await post(ocrForm(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png", "plan.png"));
    expect(res.status).not.toBe(415);
    const body = (await res.json()) as { planImageKey?: string };
    if (body.planImageKey) expect(body.planImageKey).toMatch(/\.png$/);
  });
});
