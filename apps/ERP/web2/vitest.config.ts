import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.tsx"],
    globals: false,
    css: false,
    // 机器负载高时冷启动(jsdom+lazy 页面)会超过默认 5s(基线曾抖动超时),放宽到 20s
    testTimeout: 20000,
  },
});
