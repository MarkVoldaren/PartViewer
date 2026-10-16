import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.APP_BASE_PATH || "/",
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
});
