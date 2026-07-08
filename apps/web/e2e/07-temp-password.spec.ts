import { test, expect } from "@playwright/test";
import { mockApi, json } from "./support/api-mock";

/**
 * 흐름 7 (F-027 대체): 임시 비밀번호 로그인 + 첫 로그인 강제 변경.
 * admin이 임시 비번을 발급하면 로그인 응답의 mustChangePassword=true → ProtectedLayout이
 * /change-password로 강제 이동시키고, 변경 성공 전까지 앱 진입을 막는다.
 */

test("임시 비번 로그인 → 강제 비번변경 → 앱 진입", async ({ page }) => {
  let changed = false;

  await mockApi(page, {
    "POST /api/auth/login": (route) => {
      // 변경 전: mustChangePassword=true, 변경 후: false
      return json(route, { token: "temp-e2e-token", role: "staff", orgUnitId: null, mustChangePassword: !changed });
    },
    "POST /api/auth/change-password": (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (body.currentPassword === "temp1234" && String(body.newPassword).length >= 8) {
        changed = true;
        return json(route, { ok: true });
      }
      return json(route, { error: "현재 비밀번호가 틀려요" }, 401);
    },
  });

  await page.goto("/app/login");
  await page.getByLabel("이메일").fill("staff@atasset.co.kr");
  await page.getByLabel("비밀번호").fill("temp1234");
  await page.getByRole("button", { name: "로그인" }).click();

  // mustChangePassword=true → 강제 비번변경 화면으로 이동
  await expect(page).toHaveURL(/\/app\/change-password$/);
  await expect(page.getByText(/임시 비밀번호로 로그인했어요/)).toBeVisible();

  // 변경 실행
  await page.getByLabel("현재 비밀번호").fill("temp1234");
  await page.getByLabel("새 비밀번호 (8자 이상)").fill("newpass12345");
  await page.getByLabel("새 비밀번호 확인").fill("newpass12345");
  await page.getByRole("button", { name: "비밀번호 변경" }).click();

  // 변경 성공 → 앱(대시보드) 진입, 더는 change-password로 튕기지 않음
  await expect(page).toHaveURL(/\/app\/?$/);
});

test("새 비번 확인 불일치 → 클라이언트 검증 에러", async ({ page }) => {
  await mockApi(page, {
    "POST /api/auth/login": (route) =>
      json(route, { token: "temp-e2e-token", role: "staff", orgUnitId: null, mustChangePassword: true }),
    "POST /api/auth/change-password": (route) => json(route, { ok: true }),
  });

  await page.goto("/app/login");
  await page.getByLabel("이메일").fill("staff@atasset.co.kr");
  await page.getByLabel("비밀번호").fill("temp1234");
  await page.getByRole("button", { name: "로그인" }).click();

  await expect(page).toHaveURL(/\/app\/change-password$/);
  await page.getByLabel("현재 비밀번호").fill("temp1234");
  await page.getByLabel("새 비밀번호 (8자 이상)").fill("newpass12345");
  await page.getByLabel("새 비밀번호 확인").fill("mismatch12345");
  await page.getByRole("button", { name: "비밀번호 변경" }).click();

  await expect(page.getByText("새 비밀번호가 확인과 일치하지 않아요")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/change-password$/);
});
