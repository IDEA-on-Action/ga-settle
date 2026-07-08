import { test, expect } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { mockApi, json } from "./support/api-mock";

/**
 * 흐름 5 (REQ-044): 지급 내역서 생성 -> 설계사별 롤업/룰별 분해 조회 -> 이체 마스터 CSV 다운로드.
 */
test("지급 내역서 생성 + 이체 마스터 CSV 다운로드", async ({ page }) => {
  const runId = "run-e2e-005";
  let generated = false;

  await mockApi(page, {
    "GET /api/runs/:id/payslips": (route) => {
      if (!generated) return json(route, []);
      return json(route, [
        { agentId: "agent-001", orgUnitId: "org-team-a", total: 300_000 },
        { agentId: "agent-002", orgUnitId: "org-team-b", total: 200_000 },
      ]);
    },
    "POST /api/runs/:id/payslips": (route) => {
      generated = true;
      return json(route, { runId, payslips: 2, totalAmount: 500_000 }, 201);
    },
    "GET /api/runs/:id/payslips/:agentId": (route) =>
      json(route, {
        agentId: "agent-001",
        orgUnitId: "org-team-a",
        total: 300_000,
        lines: [
          { commissionRecordId: "cr-p1", ruleId: "rule-base", amount: 250_000, basis: null },
          { commissionRecordId: "cr-p2", ruleId: "rule-bonus", amount: 50_000, basis: '{"note":"신규계약 인센티브"}' },
        ],
      }),
    "GET /api/runs/:id/transfer-master": (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/csv",
        body: "agentId,orgUnitId,amount\nagent-001,org-team-a,300000\nagent-002,org-team-b,200000\n",
      }),
  });

  await seedAuth(page);
  await page.goto("/app/payslips");

  // 1) Run 불러오기 -> 아직 생성 전
  await page.getByLabel("정산 Run ID").fill(runId);
  await page.getByRole("button", { name: "불러오기" }).click();
  await expect(page.getByText("아직 생성된 내역서가 없어요")).toBeVisible();

  // 2) 내역서 생성
  await page.getByRole("button", { name: "내역서 생성" }).click();
  await expect(page.getByText(/2건 생성 · 총액 ₩500,000/)).toBeVisible();
  await expect(page.getByText("agent-001")).toBeVisible();
  await expect(page.getByText("agent-002")).toBeVisible();

  // 3) 설계사 선택 -> 룰별 분해 내역
  await page.getByText("agent-001").click();
  await expect(page.getByText("rule-base")).toBeVisible();
  await expect(page.getByText("rule-bonus")).toBeVisible();
  await expect(page.getByText("₩250,000")).toBeVisible();

  // 4) 이체 마스터 CSV 다운로드
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "이체 마스터 CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`transfer-master_${runId}.csv`);
});
