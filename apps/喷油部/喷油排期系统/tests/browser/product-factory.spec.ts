import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { SignJWT } from "jose";

let api: Server;
let moved = false, failMove = false, blocked = false, writes = 0;
test.beforeAll(async () => {
  api = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/products/factory-move") {
      let text = ""; for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      if (!body.preview && failMove) { response.statusCode = 409; return response.end(JSON.stringify({ error: "核价表已变化，请重新检查。本批未修改" })); }
      if (!body.preview) { moved = true; writes++; return response.end(JSON.stringify({ moved: body.ids.length })); }
      return response.end(JSON.stringify({ previewToken: "move-snapshot", canSave: !blocked, items: body.ids.map((id: number) => ({ id, productNo: id === 1 ? "XX-ONLY" : "XX-ARCHIVED", canMove: !blocked, reasons: blocked ? ["目标厂区已有同货号，不能覆盖"] : [] })) }));
    }
    if (request.url === "/api/products") {
      const huadeng = request.headers.cookie?.includes("sprayplan_factory=HUADENG");
      const prefix = huadeng ? "HD" : "XX";
      const rows = [false, true].map((archived, index) => ({
        id: (huadeng ? 10 : 1) + index, productNo: `${prefix}-${archived ? "ARCHIVED" : "ONLY"}`, status: archived ? "archived" : "active",
        partCount: 1, totalUnitCost: huadeng ? 9 : 1, totalPaintCost: 0, totalQuotedPrice: 0, lastUpdatedBy: prefix, updatedAt: "2026-11-17T00:00:00Z",
      }));
      if (moved && !huadeng) rows.splice(0, 1);
      if (moved && huadeng) rows.push({ ...rows[0], id: 1, productNo: "XX-ONLY", totalUnitCost: 1 });
      return response.end(JSON.stringify(rows));
    }
    response.end("{}");
  });
  await new Promise<void>(resolve => api.listen(15081, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>(resolve => api.close(() => resolve())); });
test.beforeEach(() => { moved = false; failMove = false; blocked = false; writes = 0; });

async function login(context: import("@playwright/test").BrowserContext, role = "admin") {
  const token = await new SignJWT({ userId: "1", username: role, factoryId: role === "admin" ? "ALL" : "XINGXIN", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": role })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("order-parts-test").setExpirationTime("1h")
    .sign(new TextEncoder().encode("order-parts-test-only-key-32-characters-long"));
  await context.addCookies([{ name: "sprayplan_session", value: token, url: "http://127.0.0.1:18401" }]);
}

test("管理员勾选预览后批量移至华登，刷新列表并在目标厂区查看", async ({ page, context }) => {
  await login(context); await page.goto("/products");
  await page.getByLabel("选择产品 XX-ONLY", { exact: true }).check();
  await page.getByRole("button", { name: "批量修改所属厂区（1）" }).click();
  await page.getByRole("button", { name: "检查所属厂区调整" }).click();
  await expect(page.getByRole("region", { name: "批量修改所属厂区" })).toContainText("XX-ONLY：可调整");
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "确认移至华登（1）" }).click();
  await expect(page.getByRole("status")).toContainText("已将 1 个产品核价表移至华登");
  await expect(page.getByRole("cell", { name: "XX-ONLY", exact: true })).toHaveCount(0);
  expect(writes).toBe(1);
  await page.getByLabel("当前厂区").selectOption("HUADENG");
  await expect(page.getByRole("cell", { name: "XX-ONLY", exact: true })).toBeVisible();
});

test("冲突时不保存，选择改变清除预览，并发失败保留勾选以便重新检查", async ({ page, context }) => {
  await login(context); blocked = true; await page.goto("/products");
  await page.getByLabel("全选当前显示产品").check();
  await page.getByRole("button", { name: "批量修改所属厂区（1）" }).click();
  await page.getByRole("button", { name: "检查所属厂区调整" }).click();
  await expect(page.getByRole("region", { name: "批量修改所属厂区" })).toContainText("目标厂区已有同货号");
  await expect(page.getByRole("button", { name: "确认移至华登（1）" })).toBeDisabled();
  await page.getByLabel("全选当前显示产品").uncheck();
  await expect(page.getByRole("button", { name: "确认移至华登（1）" })).toHaveCount(0);
  blocked = false; failMove = true;
  await page.getByLabel("全选当前显示产品").check();
  await page.getByRole("button", { name: "检查所属厂区调整" }).click();
  await page.getByRole("button", { name: "确认移至华登（1）" }).click();
  await expect(page.getByRole("region", { name: "批量修改所属厂区" }).getByRole("alert")).toContainText("核价表已变化");
  await expect(page.getByLabel("选择产品 XX-ONLY", { exact: true })).toBeChecked();
  expect(writes).toBe(0);
});

test("主管看不到管理员厂区调整入口", async ({ page, context }) => {
  await login(context, "manager"); await page.goto("/products");
  await expect(page.getByRole("button", { name: /批量修改所属厂区/ })).toHaveCount(0);
  await expect(page.getByLabel("全选当前显示产品")).toHaveCount(0);
});

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
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("当前厂区：华登", { exact: false })).toBeVisible();
  await expect(page.getByRole("cell", { name: "HD-ONLY", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "XX-ONLY", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /回收站/ }).click();
  await expect(page.getByRole("cell", { name: "HD-ARCHIVED", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "XX-ARCHIVED", exact: true })).toHaveCount(0);
  await page.getByLabel("当前厂区").selectOption("XINGXIN");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("cell", { name: "XX-ONLY", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /回收站/ }).click();
  await expect(page.getByRole("cell", { name: "XX-ARCHIVED", exact: true })).toBeVisible();
});
