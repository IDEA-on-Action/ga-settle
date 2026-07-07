import { Hono } from "hono";
import { queueConsumer, type ParseJob } from "./queue";

export type Env = {
  DB: D1Database;
  UPLOADS: R2Bucket;
  PARSE_QUEUE: Queue<ParseJob>;
  ANTHROPIC_API_KEY: string;
  FIELD_ENCRYPTION_KEY: string;
  SESSION_SECRET: string;
  ADMIN_IP_ALLOWLIST: string;
  ENV: string;
};

export const app = new Hono<{ Bindings: Env }>();

// --- 미들웨어 (F-017에서 확장: 세션 인증, RBAC 스코프, 감사 로그) ---
app.use("*", async (c, next) => {
  await next();
  // TODO(F-015/F-017): 쓰기 요청 감사 로그 기록
});

app.get("/health", (c) => c.json({ ok: true, env: c.env.ENV }));

// --- 업로드 (F-003): 해시 멱등 -> R2 -> Queue ---
app.post("/api/uploads", async (c) => {
  // TODO(F-003): multipart 수신 -> SHA-256 해시 -> uploads UNIQUE 충돌 시 409
  // -> R2 put(불변) -> PARSE_QUEUE.send -> jobs 레코드 반환
  return c.json({ todo: "F-003" }, 501);
});

// --- 매핑 (F-005~F-007) ---
app.get("/api/uploads/:id/mapping", async (c) => c.json({ todo: "F-005 L0~L4 결과" }, 501));
app.post("/api/uploads/:id/mapping/confirm", async (c) => c.json({ todo: "F-007 TemplateVersion 저장" }, 501));

// --- 정산/대사 (F-013~F-016) ---
app.post("/api/runs", async (c) => c.json({ todo: "F-013 정산 실행" }, 501));
app.get("/api/runs/:id/reconciliation", async (c) => c.json({ todo: "F-014 대사" }, 501));
app.post("/api/runs/:id/close", async (c) => c.json({ todo: "F-016 마감 이중 잠금" }, 501));

export default {
  fetch: app.fetch,
  queue: queueConsumer,
} satisfies ExportedHandler<Env, ParseJob>;
