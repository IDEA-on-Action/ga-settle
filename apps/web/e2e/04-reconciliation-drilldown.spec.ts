import { test, expect } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { mockApi, json } from "./support/api-mock";

/**
 * 흐름 4 (REQ-044): 대사(원수사 보고액 vs 계산액) 조회 -> 원수사별 차액 드릴다운 -> 병행 검증.
 */
test("대사 차액 드릴다운 + 병행 검증", async ({ page }) => {
  const runId = "run-e2e-004";

  await mockApi(page, {
    // F-037/F-042: Run 입력이 텍스트에서 RunSelect 선택기로 바뀌어 목록 API를 mock해야 옵션이 뜬다.
    "GET /api/runs": (route) => json(route, { runs: [{ id: runId, settlementMonth: "2026-06", status: "draft" }] }),
    // F-063: 화면이 시책 대사도 조회 - 미mock이면 {} 폴백이라 무해하나 명시.
    "GET /api/runs/:id/incentive-reconciliation": (route) => json(route, { runId, insurers: [] }),

    "GET /api/runs/:id/reconciliation": (route) =>
      json(route, {
        runId,
        insurers: [
          { insurerId: "ins-matched", insurerTotal: 1_000_000, calculatedTotal: 1_000_000, diff: 0, status: "matched" },
          { insurerId: "ins-diff", insurerTotal: 2_000_000, calculatedTotal: 1_950_000, diff: 50_000, status: "diff" },
        ],
        diffContracts: [
          {
            commissionRecordId: "cr-e2e-1",
            contractNo: "CT-2026-0099",
            insurerId: "ins-diff",
            insurerAmount: 500_000,
            calculatedAmount: 450_000,
            diff: 50_000,
          },
        ],
      }),

    "GET /api/runs/:id/parallel-verify": (route) =>
      json(route, {
        runId,
        verified: false,
        totalDiff: 50_000,
        diffs: [{ commissionRecordId: "cr-e2e-1", ruleId: "rule-base", expected: 450_000, stored: 500_000, diff: -50_000 }],
      }),
  });

  await seedAuth(page);
  await page.goto("/app/reconciliation");

  // F-037/F-042: 텍스트 입력 + "조회" 버튼 → RunSelect 선택기. 트리거 클릭 후 옵션 선택 시 자동 조회.
  await page.locator("#recon-run-id").click();
  await page.getByRole("button", { name: "2026-06 · draft" }).click();

  // 1) 합계 카드
  await expect(page.getByText("₩3,000,000")).toBeVisible(); // 원수사 보고 총액
  await expect(page.getByText("₩2,950,000")).toBeVisible(); // 시스템 계산 총액
  await expect(page.getByText("1개 원수사 불일치")).toBeVisible();

  // 2) 원수사별 대사 - 차액 있는 행만 드릴다운 가능
  await expect(page.getByText("일치", { exact: true })).toBeVisible();
  const diffRow = page.getByText("ins-diff");
  await expect(diffRow).toBeVisible();
  await diffRow.click();

  await expect(page.getByText("CT-2026-0099")).toBeVisible();
  await expect(page.getByText("record cr-e2e-1")).toBeVisible();

  // 3) 병행 검증 - 차액 발견
  await expect(page.getByText("차액 발견")).toBeVisible();
  await expect(page.getByText("총 차액 ₩50,000")).toBeVisible();
  await expect(page.getByText("rule-base")).toBeVisible();
});
