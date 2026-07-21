import { test, expect } from "@playwright/test";

// P0 验收 E2E：跨 middleware + 页面鉴权 + API 鉴权三层防御纵深
// 数据依赖：dev.db 已 seed 三个种子账号 admin/clerk/viewer
test.describe("P0 验收：登录 → Dashboard → 退出", () => {
  test("admin 完整流程", async ({ page }) => {
    // 未登录访问根路径 → middleware 重定向到 /login
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);

    // 登录
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: /登录/ }).click();

    // 登录成功 → 跳回根（Dashboard）
    await expect(page).toHaveURL("http://localhost:8400/");
    // 仪表盘 h1 带 emoji "📊 仪表盘"，用模糊匹配
    await expect(page.getByRole("heading", { name: /仪表盘/ })).toBeVisible();
    // TopNav 右上角显示 "admin (admin)"——锁定 header 避免和侧栏/表格里的 admin 冲突
    await expect(page.locator("header").getByText(/admin \(admin\)/)).toBeVisible();

    // 通过侧栏跳转到用户管理
    await page.getByRole("link", { name: /用户管理/ }).click();
    await expect(page).toHaveURL("http://localhost:8400/users");
    // 三个种子用户应都在表格内（cell name 精确匹配只含用户名的格子）
    await expect(page.getByRole("cell", { name: "admin" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "clerk" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "viewer" })).toBeVisible();

    // 退出（TopNav form POST /api/auth/logout → API 返回 303 redirect → 浏览器自动跳 /login）
    await page.getByRole("button", { name: "退出" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("viewer 看不到用户管理菜单", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("viewer");
    await page.getByLabel("密码").fill("viewer123");
    await page.getByRole("button", { name: /登录/ }).click();
    await expect(page).toHaveURL("http://localhost:8400/");
    // 防御纵深第一层：侧栏过滤掉 admin 专属菜单
    await expect(page.getByRole("link", { name: /用户管理/ })).toHaveCount(0);
  });

  test("clerk 直接访问 /users API 被禁", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("clerk");
    await page.getByLabel("密码").fill("clerk123");
    await page.getByRole("button", { name: /登录/ }).click();
    await expect(page).toHaveURL("http://localhost:8400/");
    // 防御纵深第三层：即使绕过 UI 直接 fetch API，也应被 403 拒绝
    const res = await page.request.get("/api/users");
    expect(res.status()).toBe(403);
  });
});
