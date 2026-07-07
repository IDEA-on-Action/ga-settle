import type { Page, Route } from "@playwright/test";

export type ApiHandler = (route: Route) => Promise<void> | void;

/** "METHOD /path/:param" 형태 키. `:param`은 임의 세그먼트, 끝의 `*`는 prefix 매칭. */
export type ApiRoutes = Record<string, ApiHandler>;

function pathMatches(pattern: string, pathname: string): boolean {
  if (pattern.endsWith("*")) {
    return pathname.startsWith(pattern.slice(0, -1));
  }
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((p, i) => p.startsWith(":") || p === pathParts[i]);
}

/**
 * apps/api(Hono)를 `page.route`로 mock한다. 실 백엔드/D1/큐 없이 결정적으로 5흐름을 검증하기 위함.
 * `routes`에 없는 GET은 빈 객체 200(대시보드 등 부수 조회 무해화), 그 외는 404를 기본 반환한다.
 */
export async function mockApi(page: Page, routes: ApiRoutes): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    for (const [pattern, handler] of Object.entries(routes)) {
      const spaceIdx = pattern.indexOf(" ");
      const method = pattern.slice(0, spaceIdx);
      const pathPattern = pattern.slice(spaceIdx + 1);
      if (method !== req.method()) continue;
      if (pathMatches(pathPattern, url.pathname)) {
        await handler(route);
        return;
      }
    }
    if (req.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "e2e mock: unhandled route" }),
    });
  });
}

export function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
