import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { SignJWT } from "jose";

let api: Server;
let headQty = 100;
let failSave = false;
let failReadback = false;
let patches: Array<{ partQtys?: Array<{ id: number; qty: number }> }> = [];
const part = { id: 1, partName: "头", craft: "喷油", partGroupId: 1, unitCost: 1, laborPrice: 1, paintCost: 0, quotedPrice: 2, dailyCapacity: 50 };
const product = { id: 1, productNo: "77711", parts: [part] };
function detail() {
  return { id: 1, externalOrderNo: "ZWZ2026119", productId: 1, product, products: [product],
    orderDate: "2026-10-08", deliveryDate: "2026-10-26", status: headQty <= 60 ? "completed" : "in_production",
    isMA: true, isUrgent: false, remark: "", createdBy: "test", qtyEditable: true,
    partQtys: [{ id: 11, partName: "头", sourcePartId: 1, qty: headQty, partOrder: 0 }, { id: 12, partName: "脚", sourcePartId: null, qty: 50, partOrder: 1 }],
    scheduleBalances: [{ partName: "头", stepNo: 1, craft: "喷油", demandQty: headQty, recordedQty: 60, pendingQty: 40,
      supplementQty: Math.max(0, headQty - 100), reduceQty: Math.min(40, Math.max(0, 100 - headQty)), overproducedQty: Math.max(0, 60 - headQty) }],
  };
}

test.beforeAll(async () => {
  api = createServer(async (request, response) => {
    let text = ""; for await (const chunk of request) text += chunk;
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/auth/session") return response.end("{}");
    if (request.url === "/api/lines") return response.end("[]");
    if (request.url === "/api/orders/1" && request.method === "PATCH") {
      const payload = JSON.parse(text); patches.push(payload);
      if (failSave) { failSave = false; response.statusCode = 500; return response.end(JSON.stringify({ error: "保存失败，请重试" })); }
      for (const update of payload.partQtys ?? []) if (update.id === 11) headQty = update.qty;
      return response.end(JSON.stringify({ id: 1, status: detail().status }));
    }
    if (request.url === "/api/orders/1") {
      if (failReadback && patches.length > 0) { failReadback = false; response.statusCode = 500; return response.end("{}"); }
      return response.end(JSON.stringify(detail()));
    }
    response.statusCode = 404; response.end("{}");
  });
  await new Promise<void>(resolve => api.listen(15081, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => api.close(error => error ? reject(error) : resolve())); });
test.beforeEach(async ({ context }) => {
  headQty = 100; failSave = false; failReadback = false; patches = [];
  const token = await new SignJWT({ userId: "1", username: "clerk", factoryId: "XINGXIN", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "clerk" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("order-parts-test").setExpirationTime("1h")
    .sign(new TextEncoder().encode("order-parts-test-only-key-32-characters-long"));
  await context.addCookies([{ name: "sprayplan_session", value: token, url: "http://127.0.0.1:18401" }]);
});

test("单独修改部位，保存后回读提示，刷新仍保留", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/orders/1");
  await page.getByLabel("头 数量", { exact: true }).fill("120");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  expect(patches[0].partQtys).toEqual([{ id: 11, qty: 120 }]);
  await expect(page.getByLabel("脚 数量", { exact: true })).toHaveValue("50");
  const balance = page.getByRole("region", { name: "排期调整提示" });
  await expect(balance.getByRole("cell", { name: "20", exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByLabel("头 数量", { exact: true })).toHaveValue("120");
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("part-quantity-edit.png"), fullPage: true });
});

test("减量更新完工状态，显示减排与超产提示", async ({ page }) => {
  await page.goto("/orders/1");
  await page.getByLabel("头 数量", { exact: true }).fill("30");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(page.getByText("完工", { exact: true })).toBeVisible();
  const balance = page.getByRole("region", { name: "排期调整提示" });
  const cells = balance.getByRole("row").nth(1).getByRole("cell");
  await expect(cells.nth(6)).toHaveText("40"); await expect(cells.nth(7)).toHaveText("30");
});

test("非法、空数量不提交，保存失败保留输入并可重试", async ({ page }) => {
  await page.goto("/orders/1"); const qty = page.getByLabel("头 数量", { exact: true });
  for (const value of ["-1", "1.5", ""]) {
    await qty.fill(value); await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("alert", { name: "保存错误" })).toContainText("整数");
  }
  expect(patches).toHaveLength(0);
  await qty.fill("120"); failSave = true;
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert", { name: "保存错误" })).toContainText("保存失败"); await expect(qty).toHaveValue("120");
  await page.getByRole("button", { name: "保存", exact: true }).click(); await expect(page.getByRole("status")).toContainText("已保存");
});

test("保存成功但回读失败时明确提示已保存", async ({ page }) => {
  await page.goto("/orders/1"); await page.getByLabel("头 数量", { exact: true }).fill("120"); failReadback = true;
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert", { name: "保存错误" })).toContainText("订单已保存，但页面更新失败");
  expect(headQty).toBe(120);
});


test("不能将全部部位数量设为零", async ({ page }) => {
  await page.goto("/orders/1");
  await page.getByLabel("头 数量", { exact: true }).fill("0");
  await page.getByLabel("脚 数量", { exact: true }).fill("0");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert", { name: "保存错误" })).toContainText("至少需要一个");
  expect(patches).toHaveLength(0);
});

test("只读账号不能编辑数量或保存", async ({ page, context }) => {
  const token = await new SignJWT({ userId: "2", username: "viewer", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "viewer" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("order-parts-test").setExpirationTime("1h")
    .sign(new TextEncoder().encode("order-parts-test-only-key-32-characters-long"));
  await context.addCookies([{ name: "sprayplan_session", value: token, url: "http://127.0.0.1:18401" }]);
  await page.goto("/orders/1");
  await expect(page.getByLabel("头 数量", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
});
