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
    // B-016: CI에선 vite dev 서버가 ready 신호를 못 내 타임아웃(콜드 스타트/의존성 번들링).
    // verify 잡이 E2E 앞에서 이미 build하므로 CI에선 preview(dist 정적 서빙, 즉시 기동)로 전환.
    // 로컬은 dev 유지(빌드 없이 편하게). preview는 --host 명시로 playwright url(127.0.0.1)과 정렬.
    command: process.env.CI
      ? "pnpm exec vite preview --port 4319 --strictPort --host 127.0.0.1"
      : "pnpm exec vite --port 4319 --strictPort",
    url: "http://127.0.0.1:4319",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
