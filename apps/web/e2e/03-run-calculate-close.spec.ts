import { test, expect } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { mockApi, json } from "./support/api-mock";

/**
 * 흐름 3 (REQ-044): 정산 Run 조회/생성 -> 계산 실행 -> 월 마감(이중 잠금 다이얼로그).
 */
test("정산 Run 계산 -> 마감", async ({ page }) => {
  const runId = "run-e2e-001";
  let status: "draft" | "calculated" | "closed" = "draft";
  let closedBy: string | null = null;
  let closedAt: string | null = null;

  await mockApi(page, {
    "POST /api/runs": (route) => json(route, { id: runId, settlementMonth: "2026-06", status: "draft" }, 201),

    "GET /api/runs/:id": (route) =>
      json(route, {
        id: runId,
        settlementMonth: "2026-06",
        status,
        snapshotR2Key: status === "closed" ? `snapshots/${runId}.json` : null,
        closedAt,
        closedBy,
        lineCount: status === "draft" ? 0 : 42,
        totalAmount: status === "draft" ? 0 : 12_345_678,
      }),

    "GET /api/runs/:id/adjustments": (route) => json(route, []),

    "POST /api/runs/:id/calculate": (route) => {
      status = "calculated";
      return json(route, { runId, status: "calculated", lines: 42, totalAmount: 12_345_678 });
    },

    "POST /api/runs/:id/close": (route) => {
      status = "closed";
      closedBy = "e2e@ga-settle.test";
      closedAt = new Date().toISOString();
      return json(route, { runId, status: "closed", closedAt, snapshotR2Key: `snapshots/${runId}.json`, lines: 42 });
    },
  });

  await seedAuth(page);
  await page.goto("/app/runs");

  // 1) Run 조회/생성
  await page.getByLabel("정산월").fill("2026-06");
  await page.getByRole("button", { name: "Run 조회 · 생성" }).click();
  await expect(page.getByText("draft", { exact: true })).toBeVisible();

  // 2) 계산 실행
  const calcButton = page.getByRole("button", { name: "계산 실행" });
  await expect(calcButton).toBeEnabled();
  await calcButton.click();
  await expect(page.getByText("calculated", { exact: true })).toBeVisible();
  await expect(page.getByText("₩12,345,678")).toBeVisible();

  // 3) 월 마감 (다이얼로그 확인)
  const closeTrigger = page.getByRole("button", { name: "월 마감" });
  await expect(closeTrigger).toBeEnabled();
  await closeTrigger.click();
  await expect(page.getByText("마감하면 스냅샷")).toBeVisible();
  await page.getByRole("button", { name: "마감 확정" }).click();

  await expect(page.getByText("closed", { exact: true })).toBeVisible();
  await expect(page.getByText(/마감된 run이에요/)).toBeVisible();
  await expect(page.getByRole("button", { name: "월 마감" })).toBeDisabled();
});
