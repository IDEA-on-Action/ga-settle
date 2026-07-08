import { test, expect } from "@playwright/test";
import { mockApi, json } from "./support/api-mock";

/**
 * 흐름 6 (F-027): OTP 강제(OTP_ENFORCED) 시 @도메인 계정의 이메일 OTP 로그인.
 * UI는 비번-우선이고, 서버가 비번 로그인에 403 {otp:true}로 응답하면 OTP 코드 흐름으로 폴백 전환한다.
 * 실 백엔드 없이 login/otp/request/verify를 mock해 브라우저 흐름을 관통 검증한다.
 */

test("비번 로그인 403{otp:true} → OTP 폴백 → 코드 검증 → 대시보드", async ({ page }) => {
  const devCode = "246813";
  let otpRequested = false;

  await mockApi(page, {
    // OTP 강제 상황: @도메인 비번 로그인은 403 {otp:true}
    "POST /api/auth/login": (route) =>
      json(route, { error: "@atasset.co.kr 계정은 이메일 코드(OTP)로 로그인하세요", otp: true }, 403),
    "POST /api/auth/otp/request": (route) => {
      otpRequested = true;
      return json(route, { sent: true, ttlSeconds: 300, devCode });
    },
    "POST /api/auth/otp/verify": (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (body.code === devCode) return json(route, { token: "otp-e2e-token", role: "manager", orgUnitId: null });
      return json(route, { error: "코드가 틀려요" }, 401);
    },
  });

  await page.goto("/app/login");
  await page.getByLabel("이메일").fill("agent@atasset.co.kr");
  await page.getByLabel("비밀번호").fill("whatever");
  await page.getByRole("button", { name: "로그인" }).click();

  // 403 {otp:true} 폴백 → OTP 단계 전환 + devCode 자동 채움
  await expect(page.getByText(/6자리 인증 코드를 보냈어요/)).toBeVisible();
  expect(otpRequested).toBe(true);
  await expect(page.getByLabel("인증 코드")).toHaveValue(devCode);

  await page.getByRole("button", { name: "코드 확인 후 로그인" }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
});

test("틀린 OTP 코드 → 에러 노출, 로그인 미진입", async ({ page }) => {
  await mockApi(page, {
    "POST /api/auth/login": (route) => json(route, { error: "OTP 필요", otp: true }, 403),
    "POST /api/auth/otp/request": (route) => json(route, { sent: true, ttlSeconds: 300 }),
    "POST /api/auth/otp/verify": (route) => json(route, { error: "코드가 틀려요" }, 401),
  });

  await page.goto("/app/login");
  await page.getByLabel("이메일").fill("agent@atasset.co.kr");
  await page.getByLabel("비밀번호").fill("whatever");
  await page.getByRole("button", { name: "로그인" }).click();

  await expect(page.getByText(/6자리 인증 코드를 보냈어요/)).toBeVisible();
  await page.getByLabel("인증 코드").fill("000000");
  await page.getByRole("button", { name: "코드 확인 후 로그인" }).click();

  await expect(page.getByText("코드가 틀려요")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/login$/);
});
