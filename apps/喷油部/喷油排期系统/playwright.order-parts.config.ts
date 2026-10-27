import { defineConfig } from "@playwright/test";

// 独立模拟 API + 本地 Next 页面；不读取或修改真实订单数据库。
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "order-part-quantity.spec.ts",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:18401", headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 18401",
    url: "http://127.0.0.1:18401/login",
    reuseExistingServer: false,
    env: {
      DOTNET_API_URL: "http://127.0.0.1:15081",
      JWT_SECRET: "order-parts-test-only-key-32-characters-long",
      JWT_ISSUER: "order-parts-test",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
