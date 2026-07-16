import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { authHeader, aget } from "./helpers";

// F-046: 시책안 업로드가 이미지에 더해 PDF도 받는지 파일 유형 게이트를 검증한다.
// OCR 엔진(CLOVA/Upstage)은 외부 상용 API라 테스트 env에서 미설정 → 유형 게이트 통과 후
// 503(미설정)/502(상류)/422(빈결과)/200 중 하나. 어느 경로든 "415가 아니다"가 PDF 허용의 증거.
function ocrForm(bytes: Uint8Array, type: string, filename: string, category = "sonbo_self") {
  const fd = new FormData();
  fd.set("image", new File([bytes], filename, { type }));
  if (category) fd.set("category", category); // F-051 대분류 필수
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

// F-048: 업로드 즉시 대장 등록 + 목록 조회.
// OCR 엔진 미설정이라 추출은 실패(OcrError)하지만, 업로드 즉시 등록 정책상 레코드는 남아야 한다(status=failed).
describe("시책안 등록 대장 (F-048)", () => {
  it("업로드하면 OCR 실패여도 대장에 레코드가 남는다(업로드 즉시 등록)", async () => {
    const filename = `registry-${Date.now()}.pdf`;
    await post(ocrForm(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf", filename));
    const list = (await (await aget("/api/incentive-plans?limit=50")).json()) as {
      items: { fileName: string; ocrStatus: string; r2Key?: string; sha256: string }[];
      total: number;
    };
    const row = list.items.find((r) => r.fileName === filename);
    expect(row).toBeTruthy();
    // 엔진 미설정 → OCR 실패로 기록되지만 대장 레코드는 존재.
    expect(row?.ocrStatus).toBe("failed");
  });

  it("OCR 실패 시 단계+사유가 대장에 저장·노출된다 (F-064)", async () => {
    const filename = `stage-${Date.now()}.pdf`;
    await post(ocrForm(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf", filename));
    const list = (await (await aget("/api/incentive-plans?limit=50")).json()) as {
      items: { fileName: string; ocrStatus: string; ocrErrorStage: string | null; ocrErrorMessage: string | null }[];
    };
    const row = list.items.find((r) => r.fileName === filename);
    expect(row?.ocrStatus).toBe("failed");
    // 테스트 env는 CLOVA_OCR_INVOKE_URL/SECRET 미설정 - clovaOcr이 가장 먼저 실행돼 stage=clova로 끊긴다.
    expect(row?.ocrErrorStage).toBe("clova");
    expect(row?.ocrErrorMessage).toContain("CLOVA");
  });

  it("같은 파일 재업로드는 sha 멱등 - 대장 레코드가 중복 생성되지 않는다", async () => {
    const filename = `idem-${Date.now()}.png`;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x11, 0x22]);
    await post(ocrForm(bytes, "image/png", filename));
    await post(ocrForm(bytes, "image/png", filename));
    const list = (await (await aget("/api/incentive-plans?limit=100")).json()) as {
      items: { sha256: string }[];
    };
    // 같은 바이트 → 같은 sha → unique index로 1건만.
    const first = list.items[0]?.sha256;
    const dupes = list.items.filter((r) => r.sha256 === first).length;
    expect(dupes).toBe(1);
  });

  it("대분류(category) 미선택은 400 (F-051)", async () => {
    const res = await post(ocrForm(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf", "nocat.pdf", ""));
    expect(res.status).toBe(400);
  });

  it("대분류가 대장에 저장·조회된다 (F-051)", async () => {
    const filename = `cat-${Date.now()}.pdf`;
    await post(ocrForm(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf", filename, "sengbo_fc"));
    const list = (await (await aget("/api/incentive-plans?limit=100")).json()) as {
      items: { fileName: string; category: string | null }[];
    };
    expect(list.items.find((r) => r.fileName === filename)?.category).toBe("sengbo_fc");
  });

  it("같은 파일 재업로드 시 대분류는 최신 선택으로 갱신 (F-051 upsert)", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x99, 0x88]);
    const fn = `recat-${Date.now()}.pdf`;
    await post(ocrForm(bytes, "application/pdf", fn, "sonbo_planner"));
    await post(ocrForm(bytes, "application/pdf", fn, "sengbo_corp")); // 재업로드, 다른 대분류
    const list = (await (await aget("/api/incentive-plans?limit=100")).json()) as {
      items: { fileName: string; category: string | null; sha256: string }[];
    };
    const rows = list.items.filter((r) => r.fileName === fn);
    expect(rows).toHaveLength(1); // sha 멱등 - 1건
    expect(rows[0]!.category).toBe("sengbo_corp"); // 최신 대분류로 갱신
  });

  it("목록은 {items,total} 형태 + 인증 필요", async () => {
    const res = await aget("/api/incentive-plans");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe("number");
    // 무인증은 전역 게이트가 401.
    const noauth = await SELF.fetch("https://x/api/incentive-plans");
    expect(noauth.status).toBe(401);
  });
});
