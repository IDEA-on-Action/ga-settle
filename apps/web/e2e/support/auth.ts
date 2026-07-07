import type { Page } from "@playwright/test";

/**
 * localStorage 인증 저장 규약 (apps/web/src/lib/auth-storage.ts)과 동일한 shape.
 * 매 flow마다 로그인 UI를 반복하지 않고 보호된 라우트로 바로 진입하기 위한 storageState 대체 주입.
 */
export const TEST_AUTH = {
  token: "e2e-test-token",
  email: "e2e@ga-settle.test",
  role: "admin" as const,
  orgUnitId: null as string | null,
};

const STORAGE_KEY = "ga_settle_auth";

/** 다음 페이지 로드 전에 localStorage에 인증 토큰을 심어 ProtectedLayout 가드를 통과시킨다. */
export async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, auth]) => {
      window.localStorage.setItem(key as string, JSON.stringify(auth));
    },
    [STORAGE_KEY, TEST_AUTH] as const,
  );
}
