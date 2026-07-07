import { test, expect } from "@playwright/test";
import { mockApi, json } from "./support/api-mock";

/**
 * 흐름 1 (REQ-044): 로그인 -> 업로드 -> 파싱 진행률 폴링 -> AI 매핑 검토 -> 승인(원장 커밋).
 * 로그인은 실 UI(폼 제출)를 거쳐 나머지 4흐름(2~5)의 storageState 주입 방식과 다르게
 * 실제 인증 경로 1개는 브라우저로 관통 검증한다.
 */
test("업로드 -> 진행률 폴링 -> 매핑 검토 -> 승인", async ({ page }) => {
  const uploadId = "up-e2e-001";
  const jobId = "job-e2e-001";
  let jobPolls = 0;
  let approved = false;

  await mockApi(page, {
    "POST /api/auth/login": (route) => json(route, { token: "e2e-token", role: "admin", orgUnitId: null }),

    "GET /api/stats/by-month": (route) => json(route, { byMonth: [] }),
    "GET /api/stats/by-insurer": (route) => json(route, { month: "2026-06", byInsurer: [] }),
    "GET /api/stats/by-org": (route) => json(route, { month: "2026-06", byOrg: [] }),

    "POST /api/uploads": (route) => json(route, { uploadId, jobId, status: "queued" }, 202),

    "GET /api/jobs/:id": (route) => {
      jobPolls += 1;
      if (jobPolls < 2) {
        return json(route, { id: jobId, kind: "parse", refId: uploadId, status: "running", progress: 0.4, message: "파싱 중", updatedAt: new Date().toISOString() });
      }
      return json(route, { id: jobId, kind: "parse", refId: uploadId, status: "done", progress: 1, message: "완료", updatedAt: new Date().toISOString() });
    },

    "GET /api/uploads/:id": (route) => {
      const status = approved ? "approved" : jobPolls >= 2 ? "review" : "parsing";
      return json(route, {
        id: uploadId,
        insurerId: "ins-001",
        templateVersionId: null,
        r2Key: "raw/ins-001/2026-06/x.xlsx",
        fileHash: "deadbeef",
        status,
        settlementMonth: "2026-06",
        rowCount: status === "parsing" ? null : 100,
        okCount: status === "parsing" ? null : 95,
        errorCount: status === "parsing" ? null : 5,
        createdBy: "e2e",
        createdAt: new Date().toISOString(),
      });
    },

    "GET /api/uploads/:id/mapping": (route) =>
      json(route, {
        columnMap: { 계약번호: 0, 설계사코드: 1, 보험료: 4, 지급수수료: 5 },
        rowCount: 100,
        okCount: 95,
        errorCount: 5,
        templateVersionId: null,
      }),

    "GET /api/uploads/:id/errors": (route) =>
      json(route, [
        { id: 1, uploadId, rowNo: 12, field: "보험료", reason: "숫자 아님", rawValue: "N/A" },
        { id: 2, uploadId, rowNo: 47, field: "계약번호", reason: "빈 값", rawValue: null },
      ]),

    "POST /api/uploads/:id/approve": (route) => {
      approved = true;
      return json(route, { committed: 95, status: "approved" });
    },
  });

  // 1) 로그인
  await page.goto("/login");
  await page.getByLabel("이메일").fill("e2e@ga-settle.test");
  await page.getByLabel("비밀번호").fill("password123");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/$/);

  // 2) 업로드 화면 진입 + 업로드
  await page.getByRole("link", { name: "업로드" }).click();
  await expect(page).toHaveURL(/\/upload$/);

  await page.getByLabel("원수사 ID").fill("ins-001");
  await page.getByLabel("정산월").fill("2026-06");
  await page.locator('input[type="file"]').setInputFiles({
    name: "commission-2026-06.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("dummy excel bytes for e2e"),
  });
  await page.getByRole("button", { name: "업로드" }).click();

  // 3) 파싱 진행률 폴링 -> review 상태까지 대기
  await expect(page.getByText("commission-2026-06.xlsx")).toBeVisible();
  // 사이드바 nav("AI 매핑 검토")와 구분하기 위해 정확한 라벨("매핑 검토 →")로 매칭
  const reviewLink = page.getByRole("link", { name: "매핑 검토 →" });
  await expect(reviewLink).toBeVisible({ timeout: 15_000 });

  // 4) 매핑 검토 화면으로 이동
  await reviewLink.click();
  await expect(page).toHaveURL(/\/mapping-review\?uploadId=up-e2e-001/);

  await expect(page.getByText("지급수수료")).toBeVisible(); // columnMap 표준필드 (오류 행 field와 안 겹치는 값)
  await expect(page.getByText("2건")).toBeVisible(); // 오류 행 리포트 카운트 (errors 배열 길이)
  await expect(page.getByText("숫자 아님")).toBeVisible();

  // 5) 승인 -> 원장 커밋
  const approveButton = page.getByRole("button", { name: "승인 → 원장 커밋" });
  await expect(approveButton).toBeEnabled();
  await approveButton.click();
  await expect(page.getByText(/95건 원장 커밋 완료/)).toBeVisible();
});
