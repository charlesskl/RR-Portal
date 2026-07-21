import { defineConfig } from "@playwright/test";

// Playwright E2E 配置
// - 端口走项目实际的 8400（不是 Playwright 默认 3000）
// - webServer 自动起 `npm run dev`，跑完自动收
// - reuseExistingServer=true 在本地复用已起服务；CI 上每次重启
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:8400",
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8400",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
