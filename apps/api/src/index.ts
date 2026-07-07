import { Hono } from "hono";
import type { Env, ParseJob } from "./types";
import { queueConsumer } from "./queue";
import { uploadsRoutes } from "./routes/uploads";
import { mappingRoutes } from "./routes/mapping";
import { runsRoutes } from "./routes/runs";
import { orgRoutes } from "./routes/org";
import { rulesRoutes } from "./routes/rules";

export type { Env };

export const app = new Hono<{ Bindings: Env }>();

// --- 미들웨어 (F-017에서 확장: 세션 인증, RBAC 스코프, 감사 로그) ---
app.use("*", async (c, next) => {
  await next();
  // TODO(F-015/F-017): 쓰기 요청 감사 로그 기록
});

app.get("/health", (c) => c.json({ ok: true, env: c.env.ENV }));

// 라우트 모듈 마운트 (병렬 Sprint가 각자 파일만 만지도록 분리 - P0)
app.route("/", uploadsRoutes); // F-003 업로드/진행률
app.route("/", mappingRoutes); // F-005/F-007 매핑
app.route("/", runsRoutes);    // F-013~F-016 정산/대사/마감
app.route("/", orgRoutes);     // F-009 조직/설계사/소속 이력
app.route("/", rulesRoutes);   // F-010 시책 룰 CRUD

export default {
  fetch: app.fetch,
  queue: queueConsumer,
} satisfies ExportedHandler<Env, ParseJob>;
