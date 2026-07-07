import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

// 실제 D1(F-002 마이그레이션 적용)+R2+Queue 바인딩을 miniflare로 재현해 통합 테스트.
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(dir, "migrations"));
  return {
    test: {
      testTimeout: 30000, // workerd에서 XLSX 파싱이 느려 여유 (F-008 parse.test)
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            // setupFile 이 이 바인딩을 읽어 각 테스트 D1 에 스키마 적용
            bindings: { TEST_MIGRATIONS: migrations },
            // 큐 소비자 자동 실행 억제(격리 스토리지 경계 침범 방지). maxBatchTimeout 을
            // 테스트 실행시간보다 길게 두어 테스트 중 배치가 배달되지 않게 한다.
            // producer send 는 그대로 동작하고, consumer 는 queueConsumer() 직접 호출로 테스트.
            queueConsumers: { "ga-settle-parse": { maxBatchTimeout: 30, maxBatchSize: 100 } },
          },
        },
      },
    },
  };
});
