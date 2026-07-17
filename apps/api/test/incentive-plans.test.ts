import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { incentivePlans, jobs } from "@ga-settle/schema";
import { getDb } from "../src/db";
import { queueConsumer, type ParseJob } from "../src/queue";
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

// F-066: OCR이 큐로 이관됨. POST는 202로 job만 접수하고 실제 OCR은 consumer에서 실행되므로,
// 실패 단계/사유 검증은 consumer를 직접 돌려야 한다(엑셀 uploads.test.ts 선례).
function batchOf(body: ParseJob, spies: { ack: () => void; retry: () => void }) {
  return { messages: [{ id: "m", timestamp: new Date(0), attempts: 1, body, ack: spies.ack, retry: spies.retry }] } as unknown as MessageBatch<ParseJob>;
}

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
  it("업로드하면 즉시 대장에 레코드가 남는다(pending, 업로드 즉시 등록 + F-066 큐 접수)", async () => {
    const filename = `registry-${Date.now()}.pdf`;
    const res = await post(ocrForm(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf", filename));
    // F-066: 동기 OCR 대신 202로 job 접수.
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId?: string; status?: string };
    expect(body.status).toBe("queued");
    const list = (await (await aget("/api/incentive-plans?limit=50")).json()) as {
      items: { fileName: string; ocrStatus: string; sha256: string }[];
      total: number;
    };
    const row = list.items.find((r) => r.fileName === filename);
    expect(row).toBeTruthy();
    // OCR은 아직 큐에서 실행 전 → pending. 실제 실행/실패는 consumer 테스트에서 검증.
    expect(row?.ocrStatus).toBe("pending");
  });

  it("OCR 실패 시 단계+사유가 대장에 저장·노출된다 (F-064, 큐 consumer)", async () => {
    const filename = `stage-${Date.now()}.pdf`;
    await post(ocrForm(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf", filename));
    // 방금 접수된 plan + queued job 조회 후 consumer를 직접 실행(F-066: OCR은 consumer에서).
    const db = getDb(env);
    const plan = (await db.select().from(incentivePlans).where(eq(incentivePlans.fileName, filename)).get())!;
    const job = (await db.select().from(jobs).where(eq(jobs.refId, plan.id)).get())!;
    let retried = false;
    // 테스트 env는 CLOVA 미설정 → clovaOcr이 먼저 실패 → stage=clova. 큐는 retry(상류 일시장애 흡수).
    await queueConsumer(batchOf({ kind: "ocr-plan", planId: plan.id, jobId: job.id, r2Key: plan.r2Key, ext: "pdf" }, { ack: () => {}, retry: () => { retried = true; } }), env as never);
    expect(retried).toBe(true);
    const row = (await db.select().from(incentivePlans).where(eq(incentivePlans.id, plan.id)).get())!;
    expect(row.ocrStatus).toBe("failed");
    expect(row.ocrErrorStage).toBe("clova");
    expect(row.ocrErrorMessage).toContain("CLOVA");
  });

  it("OCR 성공 시 결과가 R2에 저장되고 GET /:id/ocr-result로 조회된다 (F-066)", async () => {
    // extractIncentivePlan을 mock하지 않고, consumer가 결과를 R2에 put하는 경로를 직접 시드해 검증.
    // (실 OCR은 외부 API라 CI 미실행 - 여기선 결과 저장→조회 계약만 확인)
    const db = getDb(env);
    const now = new Date().toISOString();
    const planId = `p-${Date.now()}`;
    const r2Key = `incentive-plans/${planId}.pdf`;
    await db.insert(incentivePlans).values({
      id: planId, category: "sonbo_self", fileName: "ok.pdf", r2Key, sha256: `s-${planId}`,
      contentType: "application/pdf", byteSize: 4, ocrStatus: "ok", createdBy: "system", createdAt: now,
    });
    // consumer가 저장하는 결과 형태를 R2에 직접 배치.
    const result = { ocr: { avgConfidence: 0.9, fieldCount: 10 }, rule: { insurer: { value: "A", confidence: 0.9 } }, payoutRows: [], lowConfidenceKeys: [] };
    await env.UPLOADS.put(`${r2Key}.ocr.json`, JSON.stringify(result));
    const res = await aget(`/api/incentive-plans/${planId}/ocr-result`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof result;
    expect(body.rule.insurer.value).toBe("A");
    // 결과 미존재 시 404 + 현재 상태.
    const missing = await aget(`/api/incentive-plans/${planId}-none/ocr-result`);
    expect(missing.status).toBe(404);
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
