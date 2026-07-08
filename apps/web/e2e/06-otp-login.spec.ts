import { test, expect } from "@playwright/test";
import { mockApi, json } from "./support/api-mock";

/**
 * 흐름 6 (F-027): @atasset.co.kr 계정의 이메일 OTP 로그인.
 * 도메인 계정은 비밀번호 대신 6자리 코드로만 로그인한다 (서버 OTP_EMAIL_DOMAIN).
 * 실 백엔드 없이 /api/auth/otp/request·verify를 mock해 브라우저 흐름을 관통 검증한다.
 */

test("@atasset.co.kr 이메일 입력 → OTP 요청 → 코드 검증 → 대시보드 진입", async ({ page }) => {
  const devCode = "246813";
  let requested = false;

  await mockApi(page, {
    "POST /api/auth/otp/request": async (route) => {
      requested = true;
      // dev/e2e 환경 규약: 서버가 devCode를 응답에 실어줌 → 폼이 자동 채움
      return json(route, { sent: true, ttlSeconds: 300, devCode });
    },
    "POST /api/auth/otp/verify": async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (body.code === devCode) {
        return json(route, { token: "otp-e2e-token", role: "manager", orgUnitId: null });
      }
      return json(route, { error: "코드가 틀려요" }, 401);
    },
  });

  await page.goto("/app/login");

  // @atasset.co.kr 도메인 감지 → 비밀번호칸 대신 "인증 코드 받기"가 노출된다
  await page.getByLabel("이메일").fill("agent@atasset.co.kr");
  await expect(page.getByText("@atasset.co.kr 계정은 이메일 인증 코드로 로그인해요.")).toBeVisible();
  await expect(page.getByLabel("비밀번호")).toHaveCount(0);

  await page.getByRole("button", { name: "인증 코드 받기" }).click();

  // OTP 단계 전환 + devCode 자동 채움 확인
  await expect(page.getByText(/6자리 인증 코드를 보냈어요/)).toBeVisible();
  expect(requested).toBe(true);
  await expect(page.getByLabel("인증 코드")).toHaveValue(devCode);

  await page.getByRole("button", { name: "코드 확인 후 로그인" }).click();

  // 인증 성공 → 보호 라우트(대시보드) 진입
  await expect(page).toHaveURL(/\/app\/?$/);
});

test("틀린 OTP 코드 입력 시 에러 메시지 노출, 로그인 미진입", async ({ page }) => {
  await mockApi(page, {
    // devCode 미포함 → 폼 자동 채움 없음(수동 입력 시나리오)
    "POST /api/auth/otp/request": (route) => json(route, { sent: true, ttlSeconds: 300 }),
    "POST /api/auth/otp/verify": (route) => json(route, { error: "코드가 틀려요" }, 401),
  });

  await page.goto("/app/login");
  await page.getByLabel("이메일").fill("agent@atasset.co.kr");
  await page.getByRole("button", { name: "인증 코드 받기" }).click();

  await expect(page.getByText(/6자리 인증 코드를 보냈어요/)).toBeVisible();
  await page.getByLabel("인증 코드").fill("000000");
  await page.getByRole("button", { name: "코드 확인 후 로그인" }).click();

  await expect(page.getByText("코드가 틀려요")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/login$/);
});
