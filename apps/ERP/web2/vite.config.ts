import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  // 云端经 nginx 部署在 /erp/ 子路径(仅影响生产构建;dev 服务器不受 base 影响)
  base: "/erp/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // macOS 5000 端口会被 AirPlay 接收(ControlCenter)抢占,开发后端固定 5050
      "/api": { target: "http://localhost:5050", changeOrigin: true },
      // 图片备注的静态文件(老系统 web/vite.config.ts 同样代理 /uploads)
      "/uploads": { target: "http://localhost:5050", changeOrigin: true },
    },
  },
});
