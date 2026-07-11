import { Hono } from "hono";
import type { Env, ParseJob } from "./types";
import { queueConsumer } from "./queue";
import { getDb } from "./db";
import { authUser } from "./auth";
import { uploadsRoutes } from "./routes/uploads";
import { mappingRoutes } from "./routes/mapping";
import { runsRoutes } from "./routes/runs";
import { orgRoutes } from "./routes/org";
import { rulesRoutes } from "./routes/rules";
import { familyRoutes } from "./routes/family";
import { authRoutes } from "./routes/auth";
import { payslipsRoutes } from "./routes/payslips";
import { statsRoutes } from "./routes/stats";
import { insurersRoutes } from "./routes/insurers";
import { incentivePlansRoutes } from "./routes/incentive-plans";
import { incentivePlanDefinitionsRoutes } from "./routes/incentive-plan-definitions";
import { auditRoutes } from "./routes/audit";
import { DEMO_HTML } from "./demo";
import { portalHome, portalOverview, portalStatus, portalDeliverables, portalProtected } from "./portal";

export type { Env };

export const app = new Hono<{ Bindings: Env }>();

// 루트: 고객 데모 랜딩 (사용자 요청으로 원복, 2026-07-11). 정식 SPA는 B-006.
app.get("/", (c) => c.html(DEMO_HTML));
app.get("/demo", (c) => c.html(DEMO_HTML));
// 고객 협업 포털 (F-054, IA docs/specs/portal-ia). 루트가 아닌 /portal 경로에서 서빙.
app.get("/portal", (c) => c.html(portalHome()));
app.get("/overview", (c) => c.html(portalOverview()));
app.get("/status", (c) => c.html(portalStatus()));
app.get("/deliverables", (c) => c.html(portalDeliverables()));
// 보호 영역(자료실·소통): 공개 콘텐츠 아님 → 로그인(/app) 유도 (설계 §8, 구현은 후속).
app.get("/assets", (c) => c.html(portalProtected("assets")));
app.get("/comms", (c) => c.html(portalProtected("comms")));

app.get("/health", (c) => c.json({ ok: true, env: c.env.ENV }));

// --- 인증 미들웨어 (F-024 인증 롤아웃): /api/* 전역 게이트 ---
// 공개: 로그인, 계정 생성(POST /api/users는 부트스트랩/admin 자체 게이트). 그 외 유효 토큰 필수.
const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/otp/request", "/api/auth/otp/verify"]);
app.use("/api/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (PUBLIC_API.has(path) || (path === "/api/users" && c.req.method === "POST")) return next();
  const user = await authUser(c.req.raw, getDb(c.env), c.env.SESSION_SECRET);
  if (!user) return c.json({ error: "인증이 필요해요" }, 401);
  await next();
});

// 라우트 모듈 마운트 (병렬 Sprint가 각자 파일만 만지도록 분리 - P0)
app.route("/", uploadsRoutes); // F-003 업로드/진행률
app.route("/", mappingRoutes); // F-005/F-007 매핑
app.route("/", runsRoutes);    // F-013~F-016 정산/대사/마감
app.route("/", orgRoutes);     // F-009 조직/설계사/소속 이력
app.route("/", rulesRoutes);   // F-010 시책 룰 CRUD
app.route("/", familyRoutes);  // F-011 가족계약 감지 HITL
app.route("/", authRoutes);    // F-017 계정/세션 인증/RBAC 스코프
app.route("/", payslipsRoutes); // F-018 지급 내역서/출력물
app.route("/", statsRoutes);   // F-019 통계/집계
app.route("/", insurersRoutes); // F-026 원수사 마스터 CRUD
app.route("/", incentivePlansRoutes); // F-043 시책안 OCR 인식
app.route("/", incentivePlanDefinitionsRoutes); // F-044 시상정의 카탈로그
app.route("/", auditRoutes); // F-044 감사 소명 역추적

// SPA 서빙 (B-006 단일 오리진, run_worker_first=true라 모든 요청이 Worker 경유).
// 루트=랜딩(위 app.get("/")), /api·/health는 위에서 처리. 그 외(/app, /app/*, /assets/*)는:
// assets(html_handling=none + not_found_handling=SPA)가 실제 파일이면 그대로, 미스면 index.html 셸.
app.all("*", (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/")) return c.json({ error: "찾을 수 없어요" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  queue: queueConsumer,
} satisfies ExportedHandler<Env, ParseJob>;
