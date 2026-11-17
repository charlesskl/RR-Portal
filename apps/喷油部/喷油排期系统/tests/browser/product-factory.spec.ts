import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { SignJWT } from "jose";

let api: Server;
test.beforeAll(async () => {
  api = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/products") {
      const huadeng = request.headers.cookie?.includes("sprayplan_factory=HUADENG");
      const prefix = huadeng ? "HD" : "XX";
      return response.end(JSON.stringify([false, true].map((archived, index) => ({
        id: (huadeng ? 10 : 1) + index, productNo: `${prefix}-${archived ? "ARCHIVED" : "ONLY"}`, status: archived ? "archived" : "active",
        partCount: 1, totalUnitCost: huadeng ? 9 : 1, totalPaintCost: 0, totalQuotedPrice: 0, lastUpdatedBy: prefix, updatedAt: "2026-11-17T00:00:00Z",
      }))));
    }
    response.end("{}");
  });
  await new Promise<void>(resolve => api.listen(15081, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>(resolve => api.close(() => resolve())); });

test("核价表切换厂区重新取数，正常列表与回收站分别显示当前厂区", async ({ page, context }) => {
  const token = await new SignJWT({ userId: "1", username: "admin", factoryId: "ALL", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "admin" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("order-parts-test").setExpirationTime("1h")
    .sign(new TextEncoder().encode("order-parts-test-only-key-32-characters-long"));
  await context.addCookies([{ name: "sprayplan_session", value: token, url: "http://127.0.0.1:18401" }]);
  await page.goto("/products");
  await expect(page.getByText("当前厂区：兴信", { exact: false })).toBeVisible();
  await expect(page.getByRole("cell", { name: "XX-ONLY", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "HD-ONLY", exact: true })).toHaveCount(0);
  await page.getByLabel("当前厂区").selectOption("HUADENG");
  await expect(page.getByText("当前厂区：华登", { exact: false })).toBeVisible();
  await expect(page.getByRole("cell", { name: "HD-ONLY", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "XX-ONLY", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /回收站/ }).click();
  await expect(page.getByRole("cell", { name: "HD-ARCHIVED", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "XX-ARCHIVED", exact: true })).toHaveCount(0);
  await page.getByLabel("当前厂区").selectOption("XINGXIN");
  await expect(page.getByRole("cell", { name: "XX-ONLY", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /回收站/ }).click();
  await expect(page.getByRole("cell", { name: "XX-ARCHIVED", exact: true })).toBeVisible();
});
