import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* base 由环境变量控制：GitHub Pages 部署在 /anything-grid/ 子路径下，
   本地 dev 与 Cloudflare Worker（M2，根路径）都不需要前缀。 */
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
});
