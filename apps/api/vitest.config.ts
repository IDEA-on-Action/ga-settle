import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

// 실제 D1(F-002 마이그레이션 적용)+R2+Queue 바인딩을 miniflare로 재현해 통합 테스트.
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(dir, "migrations"));
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            // setupFile 이 이 바인딩을 읽어 각 테스트 D1 에 스키마 적용
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
