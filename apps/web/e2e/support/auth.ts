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
// F-034 첫 로그인 온보딩 투어(Tour.tsx)는 aria-modal 오버레이로 클릭을 가로챈다.
// E2E에선 완료 플래그를 미리 심어 투어를 띄우지 않는다(실 UI 검증엔 무관, 상호작용만 방해).
const TOUR_DONE_KEY = "ga-settle-tour-done-v1";

/** 다음 페이지 로드 전에 localStorage에 인증 토큰 + 투어 완료 플래그를 심는다. */
export async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, auth, tourKey]) => {
      window.localStorage.setItem(key as string, JSON.stringify(auth));
      window.localStorage.setItem(tourKey as string, "1");
    },
    [STORAGE_KEY, TEST_AUTH, TOUR_DONE_KEY] as const,
  );
}
