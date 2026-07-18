import { test, expect } from "@playwright/test";
import { mockApi, json } from "./support/api-mock";
import { seedAuth } from "./support/auth";

// B-017: 시책안 OCR(F-043~F-066) E2E 커버리지.
// 특히 F-066 비동기 흐름(업로드→202 접수→job 폴링→진행률→결과 조회)은 그동안 unit만 검증됐다.
// 실 백엔드/CLOVA/Upstage 없이 page.route로 202/job/ocr-result를 mock해 UI 관통을 결정적으로 검증한다.
const PLAN_ID = "plan-e2e-001";
const JOB_ID = "job-e2e-ocr-001";
const PDF = { name: "abl-3월-시책안.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") };

const ocrResult = {
  planId: PLAN_ID,
  planImageKey: "incentive-plans/e2e.pdf",
  sha256: "sha-e2e",
  idempotentReuse: false,
  ocr: { avgConfidence: 0.873, fieldCount: 42 },
  rule: {
    insurer: { value: "ABL생명", confidence: 0.96 },
    planType: { value: "월초P", confidence: 0.9 },
    period: { value: "2026년 5월", confidence: 0.88 },
    targetProduct: { value: "우리WON더드림종신", confidence: 0.82 },
    payout: { value: "150%", confidence: 0.5 }, // 저신뢰 → '확인' 배지
    retention: { value: "13회차 유지", confidence: 0.8 },
  },
  // F-060: 납입기간·만기기간별 지급율(만기 다르면 별도 행)
  payoutRows: [
    { payTerm: "5년납", maturityTerm: "20년만기", payTiming: "익월", rate: "150%" },
    { payTerm: "5년납", maturityTerm: "종신", payTiming: "익월", rate: "250%" },
  ],
  lowConfidenceKeys: ["payout"],
};

test("B-017: 시책안 OCR 비동기 업로드 → 폴링 → 결과 (F-043/F-046/F-060/F-066)", async ({ page }) => {
  let jobPolls = 0;
  await mockApi(page, {
    "GET /api/incentive-plans": (route) => json(route, { items: [], total: 0 }), // 등록 내역(빈)
    // F-066: 즉시 202 접수
    "POST /api/incentive-plans/ocr": (route) => json(route, { planId: PLAN_ID, jobId: JOB_ID, idempotentReuse: false }, 202),
    // F-066: job 폴링 - 첫 폴은 running(진행률 0.3), 이후 done
    "GET /api/jobs/:id": (route) => {
      jobPolls += 1;
      return jobPolls < 2
        ? json(route, { id: JOB_ID, kind: "ocr-plan", refId: PLAN_ID, status: "running", progress: 0.3, message: "OCR 처리 중" })
        : json(route, { id: JOB_ID, kind: "ocr-plan", refId: PLAN_ID, status: "done", progress: 1, message: "완료" });
    },
    // F-066: 큐가 저장한 결과 조회
    "GET /api/incentive-plans/:id/ocr-result": (route) => json(route, ocrResult),
  });

  await seedAuth(page);
  await page.goto("/app/upload");

  // 시책안 문서(OCR) 탭 전환
  await page.getByRole("button", { name: "시책안 문서 (OCR)" }).click();
  // F-051: 대분류 먼저 선택
  await page.getByRole("button", { name: "생보FC시상" }).click();
  // 파일 선택(숨은 input) + 제출
  await page.locator('input[type="file"]').setInputFiles(PDF);
  await page.getByRole("button", { name: "OCR로 시책룰 후보 추출" }).click();

  // F-066 비동기: 진행률 바가 뜬다(폴링 사이 2s 대기라 확실히 노출)
  await expect(page.getByText(/대용량 시책안은 수 분/)).toBeVisible();

  // 폴링 done 후 결과 카드
  await expect(page.getByText("추출된 시책룰 후보")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("ABL생명")).toBeVisible(); // 원수사 필드
  await expect(page.getByText("87.3%")).toBeVisible(); // OCR 평균 신뢰도
  await expect(page.getByText("확인", { exact: true })).toBeVisible(); // 저신뢰(payout) 배지

  // F-060: 만기기간 payoutRows 표
  await expect(page.getByText("납입기간·만기기간별 지급율")).toBeVisible();
  await expect(page.getByText("20년만기")).toBeVisible();
  // '종신'은 targetProduct "우리WON더드림종신"에도 포함되므로 exact로 만기 셀만 특정.
  await expect(page.getByText("종신", { exact: true })).toBeVisible();

  // HITL: 시상정의 확정 링크
  await expect(page.getByRole("link", { name: "시상정의로 확정하러 가기" })).toBeVisible();
});

test("B-017: OCR job 실패 → 에러 표시, 결과 카드 미노출 (F-064)", async ({ page }) => {
  await mockApi(page, {
    "GET /api/incentive-plans": (route) => json(route, { items: [], total: 0 }),
    "POST /api/incentive-plans/ocr": (route) => json(route, { planId: PLAN_ID, jobId: JOB_ID, idempotentReuse: false }, 202),
    // 큐 consumer 실패 시나리오 (F-064: stage/사유는 대장에 기록, 화면은 일반 에러)
    "GET /api/jobs/:id": (route) => json(route, { id: JOB_ID, kind: "ocr-plan", refId: PLAN_ID, status: "failed", progress: 0, message: "OCR 처리에 실패했어요" }),
  });

  await seedAuth(page);
  await page.goto("/app/upload");
  await page.getByRole("button", { name: "시책안 문서 (OCR)" }).click();
  await page.getByRole("button", { name: "생보FC시상" }).click();
  await page.locator('input[type="file"]').setInputFiles(PDF);
  await page.getByRole("button", { name: "OCR로 시책룰 후보 추출" }).click();

  await expect(page.getByText("OCR 처리에 실패했어요")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("추출된 시책룰 후보")).toHaveCount(0);
});
