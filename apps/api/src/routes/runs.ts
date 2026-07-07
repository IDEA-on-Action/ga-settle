import { Hono } from "hono";
import type { Env } from "../types";

// 정산/대사/마감 (F-013 실행, F-014 대사, F-016 마감 이중 잠금).
export const runsRoutes = new Hono<{ Bindings: Env }>();

runsRoutes.post("/api/runs", async (c) => c.json({ todo: "F-013 정산 실행" }, 501));
runsRoutes.get("/api/runs/:id/reconciliation", async (c) => c.json({ todo: "F-014 대사" }, 501));
runsRoutes.post("/api/runs/:id/close", async (c) => c.json({ todo: "F-016 마감 이중 잠금" }, 501));
