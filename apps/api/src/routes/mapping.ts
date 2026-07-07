import { Hono } from "hono";
import type { Env } from "../types";

// 매핑 결과/확정 (F-005 L0~L4 조회, F-007 TemplateVersion 저장).
export const mappingRoutes = new Hono<{ Bindings: Env }>();

mappingRoutes.get("/api/uploads/:id/mapping", async (c) => c.json({ todo: "F-005 L0~L4 결과" }, 501));
mappingRoutes.post("/api/uploads/:id/mapping/confirm", async (c) => c.json({ todo: "F-007 TemplateVersion 저장" }, 501));
