import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Caramel server (bun run server) listens on 8787. Proxying keeps the browser on one origin,
// so the session cookie and the server's Origin check work in development as they do in production.
const server = process.env.CARAMEL_SERVER ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@core": fileURLToPath(new URL("../src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: server, changeOrigin: false },
      "/auth": { target: server, changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
