import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // TODO(F-001): Tailwind 4 (@tailwindcss/vite) + shadcn/ui 셋업
});
