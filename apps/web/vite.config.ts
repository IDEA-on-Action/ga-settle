import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // 로컬 dev 동일 출처화: .env.local이 VITE_API_BASE를 비우면 앱이 상대경로 /api를 호출하고,
    // 이 프록시가 :8787(wrangler dev)로 넘겨 CORS를 없앤다. 프로덕션은 .env.production 절대 URL 사용.
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/health": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
