import { applyD1Migrations, env } from "cloudflare:test";

// 각 테스트 워커의 격리 D1 에 F-002 스키마(테이블 + 트리거)를 적용한다.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    UPLOADS: R2Bucket;
    PARSE_QUEUE: Queue;
    TEST_MIGRATIONS: D1Migration[];
  }
}
