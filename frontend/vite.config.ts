import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8001",
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
