import { Hono } from "hono";
import type { Env } from "../types";
import { DELIVERABLE_DOCS } from "../portal-deliverables.gen";

// F-070: 산출물 대장 API. /api/* 전역 인증 게이트(F-024) 뒤 - 문서에 계약 금액 등 민감정보 포함.
export const deliverablesRoutes = new Hono<{ Bindings: Env }>();

// 목록 (메타만, content 제외)
deliverablesRoutes.get("/api/deliverables", (c) => {
  const items = DELIVERABLE_DOCS.map(({ content: _content, ...meta }) => meta);
  return c.json({ items, total: items.length });
});

// 마크다운 정본 다운로드
deliverablesRoutes.get("/api/deliverables/:code/file", (c) => {
  const code = c.req.param("code");
  const doc = DELIVERABLE_DOCS.find((d) => d.code === code);
  if (!doc || !doc.content) return c.json({ error: "산출물 파일 없음" }, 404);
  const filename = doc.file ?? `${doc.code}.md`;
  return new Response(doc.content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${doc.code}.md"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});
