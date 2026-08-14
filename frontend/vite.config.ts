import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Docker/局域网场景下后端不在 localhost，可用 ASKME_API_PROXY_TARGET 覆盖代理目标。
const apiProxyTarget = process.env.ASKME_API_PROXY_TARGET || "http://localhost:8001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/highlight.js")) {
            return "highlight";
          }
          if (
            id.includes("node_modules/react-markdown") ||
            id.includes("node_modules/remark-gfm") ||
            id.includes("node_modules/mdast") ||
            id.includes("node_modules/micromark") ||
            id.includes("node_modules/unist") ||
            id.includes("node_modules/hast")
          ) {
            return "markdown";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq, req) => {
            const url = req.url ?? "";
            if (url.includes("/summarize") || url.includes("/chat")) {
              proxyReq.setHeader("Accept-Encoding", "identity");
            }
          });
          proxy.on("proxyRes", (proxyRes) => {
            const contentType = proxyRes.headers["content-type"] ?? "";
            if (contentType.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
});
