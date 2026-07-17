import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./lib/api";
import { App } from "./App";
import "./index.css";

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx(401 인증·404 미존재 등)는 서버 상태가 안 바뀌어 재시도해도 똑같이 실패 → 즉시 중단.
      // 5xx·네트워크 오류만 최대 2회 재시도. stale runId로의 404 스팸(기본 retry=3×3엔드포인트=12) 방지.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
