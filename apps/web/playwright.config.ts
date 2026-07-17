import { defineConfig, devices } from "@playwright/test";

/**
 * 브라우저 Playwright E2E (F-030). apps/api/D1/Queue 없이 실행 - 모든 API는
 * e2e/support/api-mock.ts로 page.route mock. SPA는 vite dev 서버로 서빙한다
 * (F-021 API-level E2E를 보완하는 브라우저 레벨 커버리지).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4319",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec vite --port 4319 --strictPort",
    url: "http://127.0.0.1:4319",
    reuseExistingServer: !process.env.CI,
    // B-016: CI(GitHub 러너)는 vite 콜드 스타트 시 의존성 사전 번들링으로 60s를 넘겨 타임아웃났다.
    // 로컬은 즉시 뜨므로 120s 상향은 로컬 영향 없이 CI 콜드 스타트 여유만 확보.
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
