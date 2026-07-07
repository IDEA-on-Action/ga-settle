import { defineConfig } from "drizzle-kit";

// 스키마(SoT)에서 D1 마이그레이션 SQL 생성 → apps/api/migrations (wrangler가 적용).
// 마감 잠금 / audit append-only 트리거는 스키마로 표현 불가 → 0001_triggers.sql 수동 유지.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/index.ts",
  out: "../../apps/api/migrations",
});
