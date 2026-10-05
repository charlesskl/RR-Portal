import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { docsApi } from "./vite-plugin-docs-api"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react(), docsApi()],
  server: {
    port: 3100,
    host: true, // 监听 0.0.0.0，允许局域网内其他电脑访问
  },
  preview: {
    port: 3100,
    host: true, // 生产模式同样对局域网开放
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
