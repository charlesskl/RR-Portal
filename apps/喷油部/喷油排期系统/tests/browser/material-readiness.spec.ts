import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { SignJWT } from "jose";
let api: Server;
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
let registered = false, arrived = 0, version = 0, expected: string | null = null, actual: string | null = null;
let activePlan = true, consumed = 0, failSave = false, failRead = false, writes = 0;
function row() { return { orderId: 1, externalOrderNo: "ZWYP2026145", partName: "2#番茄片", demandQty: 18000, consumedQty: consumed,
  arrivedQty: registered ? arrived : null, expectedDate: expected, actualDate: actual, remark: "", version, registered,
  status: !registered ? "未登记" : arrived >= 18000 ? "齐料" : "待料", waitingQty: registered ? 18000 - arrived : 0, finishDate: activePlan ? expected ?? today : null, canEdit: true }; }
test.beforeAll(async () => {
  api = createServer(async (request, response) => {
    let text = ""; for await (const chunk of request) text += chunk;
    response.setHeader("Content-Type", "application/json");
    const url = new URL(request.url!, "http://127.0.0.1:15081");
    if (url.pathname === "/api/auth/session") return response.end("{}");
    if (url.pathname === "/api/materials" && request.method === "PUT") {
      writes++; const payload = JSON.parse(text);
      if (failSave) { failSave = false; response.statusCode = 409; return response.end(JSON.stringify({ error: "来料记录已被更新，请重新加载后再保存" })); }
      registered = true; arrived = payload.arrivedQty; expected = payload.expectedDate; actual = arrived > 0 ? payload.actualDate ?? today : null; version++;
      activePlan = arrived > consumed || !!(expected && expected > today);
      return response.end(JSON.stringify({ message: "来料已保存，关联的未报工计划已自动重排；历史实绩和库存保持不变", reflow: { removedPlans: 1, createdPlans: activePlan ? 1 : 0, warnings: [] } }));
    }
    if (url.pathname === "/api/materials") {
      if (failRead && writes > 0) { failRead = false; response.statusCode = 500; return response.end("{}"); }
      return response.end(JSON.stringify([row()]));
    }
    if (url.pathname === "/api/schedule/overview") return response.end(JSON.stringify({ lines: [{ lineId: 1, name: "C移印拉", craftType: "移印", dailyLimit: 300000 }],
      plans: activePlan ? [{ id: 1, lineId: 1, date: expected && expected > today ? expected : today, orderId: 1, productNo: "15780", itemName: "", partName: "2#番茄片", stepNo: 1, craft: "移印", plannedQty: registered ? Math.max(0, arrived - consumed) : 18000,
        machineNos: [], workerCount: 1, goodQty: null, inboundQty: null, remark: null, externalOrderNo: "ZWYP2026145", canReschedule: true }] : [] }));
    if (url.pathname === "/api/orders") return response.end("[]");
    if (url.pathname === "/api/dashboard") return response.end(JSON.stringify({ ordersTotal: 0, inProductionQty: 0, overdue: 0, productsCount: 0 }));
    response.statusCode = 404; response.end("{}");
  });
  await new Promise<void>(resolve => api.listen(15081, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => api.close(error => error ? reject(error) : resolve())); });
test.beforeEach(async ({ context }) => {
  registered = false; arrived = 0; version = 0; expected = null; actual = null; activePlan = true; consumed = 0; failSave = false; failRead = false; writes = 0;
  const token = await new SignJWT({ userId: "1", username: "clerk", factoryId: "XINGXIN", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "clerk" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("order-parts-test").setExpirationTime("1h")
    .sign(new TextEncoder().encode("order-parts-test-only-key-32-characters-long"));
  await context.addCookies([{ name: "sprayplan_session", value: token, url: "http://127.0.0.1:18401" }]);
});

test("从计划详情登记缺料后释放排期，无计划时仍可补登到料", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/schedule");
  await page.getByRole("button", { name: "查看 2#番茄片 计划详情" }).click();
  await page.getByRole("button", { name: "登记来料 / 自动重排" }).click();
  const dialog = page.getByRole("dialog", { name: "来料管理" });
  await expect(dialog.getByLabel("累计到料数量")).toHaveValue("0");
  await dialog.getByRole("button", { name: "保存来料并自动重排" }).click();
  await expect(dialog.getByRole("status")).toContainText("已自动重排");
  await expect(dialog.getByRole("cell", { name: "待料", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭来料管理" }).click();
  await expect(page.getByRole("button", { name: "查看 2#番茄片 计划详情" })).toHaveCount(0);
  await page.getByRole("button", { name: "来料管理", exact: true }).click();
  await dialog.getByRole("button", { name: "登记", exact: true }).click();
  await dialog.getByLabel("累计到料数量").fill("18000");
  await dialog.getByRole("button", { name: "保存来料并自动重排" }).click();
  await expect(dialog.getByRole("status")).toContainText("已自动重排");
  await expect(dialog.getByRole("cell", { name: "齐料", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("material-readiness.png"), fullPage: true });
  await dialog.getByRole("button", { name: "关闭来料管理" }).click();
  await expect(page.getByRole("button", { name: "查看 2#番茄片 计划详情" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("分批登记使用累计数量，非法输入不提交，并发失败保留输入", async ({ page }) => {
  consumed = 20; await page.goto("/schedule"); await page.getByRole("button", { name: "来料管理", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "来料管理" }); await dialog.getByRole("button", { name: "登记", exact: true }).click();
  const qty = dialog.getByLabel("累计到料数量"); await expect(qty).toHaveValue("20");
  for (const value of ["", "-1", "1.5", "19"]) {
    await qty.fill(value); await dialog.getByRole("button", { name: "保存来料并自动重排" }).click();
    await expect(dialog.getByRole("alert", { name: "来料错误" })).toContainText("累计到料数量");
  }
  expect(writes).toBe(0);
  await qty.fill("1000"); failSave = true; await dialog.getByRole("button", { name: "保存来料并自动重排" }).click();
  await expect(dialog.getByRole("alert", { name: "来料错误" })).toContainText("重新加载"); await expect(qty).toHaveValue("1000");
});

test("保存成功但回读失败明确说明已保存", async ({ page }) => {
  await page.goto("/schedule"); await page.getByRole("button", { name: "来料管理", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "来料管理" }); await dialog.getByRole("button", { name: "登记", exact: true }).click();
  await dialog.getByLabel("累计到料数量").fill("1000"); failRead = true;
  await dialog.getByRole("button", { name: "保存来料并自动重排" }).click();
  await expect(dialog.getByRole("alert", { name: "来料错误" })).toContainText("登记已保存"); expect(arrived).toBe(1000);
});

test("只读账号可以查看来料但不能保存", async ({ page, context }) => {
  const token = await new SignJWT({ userId: "2", username: "viewer", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "viewer" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("order-parts-test").setExpirationTime("1h")
    .sign(new TextEncoder().encode("order-parts-test-only-key-32-characters-long"));
  await context.addCookies([{ name: "sprayplan_session", value: token, url: "http://127.0.0.1:18401" }]);
  await page.goto("/schedule"); await page.getByRole("button", { name: "来料管理", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "来料管理" }); await dialog.getByRole("button", { name: "查看", exact: true }).click();
  await expect(dialog.getByLabel("累计到料数量")).toBeDisabled(); await expect(dialog.getByRole("button", { name: "保存来料并自动重排" })).toBeDisabled();
});


test("保存已提交但来料回读失败时，仍刷新排期中已移除的计划", async ({ page }) => {
  await page.goto("/schedule");
  await expect(page.getByRole("button", { name: "查看 2#番茄片 计划详情" })).toBeVisible();
  await page.getByRole("button", { name: "来料管理", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "来料管理" });
  await dialog.getByRole("button", { name: "登记", exact: true }).click();
  failRead = true;
  await dialog.getByLabel("累计到料数量").fill("0");
  await dialog.getByRole("button", { name: "保存来料并自动重排" }).click();
  await expect(dialog.getByRole("alert", { name: "来料错误" })).toContainText("登记已保存");
  expect(writes).toBe(1);
  expect(activePlan).toBe(false);
  await dialog.getByRole("button", { name: "关闭来料管理" }).click();
  await expect(page.getByRole("button", { name: "查看 2#番茄片 计划详情" })).toHaveCount(0);
});
