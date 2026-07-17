import { test, expect } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { mockApi, json } from "./support/api-mock";

/**
 * 흐름 2 (REQ-044): 매핑 관리 화면에서 컬럼 매핑 확정 -> TemplateVersion 저장.
 * 확정 전/후 원수사 매핑 버전 이력이 갱신되는지까지 확인한다.
 */
test("매핑 확정 -> TemplateVersion 저장 + 이력 반영", async ({ page }) => {
  const insurerId = "ins-002";
  const uploadId = "up-e2e-002";
  let confirmed = false;

  await mockApi(page, {
    // F-035/F-036: 원수사·업로드 입력이 선택기로 바뀌어 목록 API mock 필요.
    "GET /api/insurers": (route) => json(route, { insurers: [{ id: insurerId, name: "라이나생명" }] }),
    "GET /api/uploads": (route) => json(route, { uploads: [{ id: uploadId, insurerName: "라이나생명", settlementMonth: "2026-06", status: "review" }] }),

    "GET /api/insurers/:id/templates": (route) => {
      if (!confirmed) return json(route, []);
      return json(route, [
        {
          id: "tv-e2e-001",
          version: 1,
          headerSignature: "sig-abc123",
          columnMap: { 계약번호: 0, 설계사코드: 1, 상품명: 2, 계약일: 3, 보험료: 4, 지급수수료: 5 },
          validFrom: "2026-06-01",
          validTo: null,
        },
      ]);
    },
    "POST /api/uploads/:id/mapping/confirm": (route) => {
      confirmed = true;
      return json(route, { templateVersionId: "tv-e2e-001", version: 1, cached: false });
    },
  });

  await seedAuth(page);
  await page.goto("/app/mapping-admin");

  // 1) 확정 전: 원수사 선택(F-035 선택기, 조회 버튼 없이 자동 이력 조회) -> 빈 목록
  await page.locator("#ma-insurer-id").click();
  await page.getByRole("button", { name: "라이나생명" }).click();
  await expect(page.getByText("등록된 버전이 없어요.")).toBeVisible();

  // 2) 매핑 확정: 업로드 선택(F-036 선택기) + 원본 헤더(텍스트 유지). columnMap은 기본값 사용.
  await page.locator("#ma-upload-id").click();
  await page.getByRole("button", { name: "라이나생명 · 2026-06 · review" }).click();
  await page.getByLabel("원본 헤더 (콤마 구분)").fill("계약번호, 설계사코드, 상품명, 계약일, 보험료, 지급수수료");
  await page.getByRole("button", { name: "매핑 확정" }).click();

  await expect(page.getByText(/TemplateVersion v1 \(신규 등록\)/)).toBeVisible();
  await expect(page.getByText(/id: tv-e2e-001/)).toBeVisible();

  // 3) 확정 후 이력 자동 갱신(confirm이 insurer-templates invalidate -> 재선택 불필요) -> v1 노출
  await expect(page.getByText("v1", { exact: true })).toBeVisible();
  await expect(page.getByText("사용 중")).toBeVisible();
  await expect(page.getByText("sig-abc123")).toBeVisible();
});
