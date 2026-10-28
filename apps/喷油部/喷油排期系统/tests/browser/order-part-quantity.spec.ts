import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { SignJWT } from "jose";

let api: Server;
let headQty = 100;
let failSave = false;
let failReadback = false;
let malformedReadback = false;
let footQty = 50;
let orderStatus: string | null = null;
let samePartName = false;
let holdSave = false;
let releaseSave: (() => void) | undefined;
let schedulePayload: { rows: Array<{ partQtyId: number; startDate: string }> } | undefined;
let unschedules = 0;
let qtyEditable = true;
let simulateAutoSchedule = false;
let failAutoSchedule = false;
let unavailableAutoSchedule = false;
let pendingHeadQty = 40;
let pendingProduct = false;
let headers = { orderDate: "2026-10-08", deliveryDate: "2026-10-26", isMA: true, isUrgent: false, remark: "" };
let patches: Array<{ partQtys?: Array<{ id: number; qty: number }>; autoAdjustSchedule?: boolean }> = [];
const part = { id: 1, partName: "头", craft: "喷油", partGroupId: 1, unitCost: 1, laborPrice: 1, paintCost: 0, quotedPrice: 2, dailyCapacity: 50 };
const product = { id: 1, productNo: "77711", parts: [part, { ...part, id: 2, partName: "脚" }] };
function detail() {
  return { id: 1, externalOrderNo: "ZWZ2026119", productId: pendingProduct ? null : 1, product: pendingProduct ? null : product, products: pendingProduct ? [] : [product],
    ...headers, status: orderStatus ?? (headQty <= 60 ? "completed" : "in_production"),
    createdBy: "test", qtyEditable,
    partQtys: [{ id: 11, partName: "头", sourcePartId: 1, qty: headQty, partOrder: 0 }, { id: 12, partName: samePartName ? "头" : "脚", sourcePartId: 2, qty: footQty, partOrder: 1 }],
    scheduleBalances: [{ partName: "头", stepNo: 1, craft: "喷油", demandQty: headQty, recordedQty: 60, pendingQty: pendingHeadQty,
      supplementQty: Math.max(0, headQty - 60 - pendingHeadQty), reduceQty: Math.min(pendingHeadQty, Math.max(0, 60 + pendingHeadQty - headQty)), overproducedQty: Math.max(0, 60 - headQty) }],
  };
}

test.beforeAll(async () => {
  api = createServer(async (request, response) => {
    let text = ""; for await (const chunk of request) text += chunk;
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/auth/session") return response.end("{}");
    // 正式构建的 Link 会预取相邻页；这些只读接口同样留在本地模拟服务。
    if (request.url === "/api/orders") return response.end("[]");
    if (request.url === "/api/dashboard") return response.end(JSON.stringify({ ordersTotal: 0, inProductionQty: 0, overdue: 0, productsCount: 0 }));
    if (request.url === "/api/lines") return response.end(JSON.stringify([{ id: 1, name: "测试拉", craftType: "喷油", isActive: true }]));
    if (request.url === "/api/schedule/orders/1/unschedule") {
      unschedules++; orderStatus = "received"; return response.end("{}");
    }
    if (request.url === "/api/orders/1/process-schedule") {
      schedulePayload = JSON.parse(text); response.statusCode = 400;
      return response.end(JSON.stringify({ error: "测试已接收排期，不写数据库" }));
    }
    if (request.url === "/api/orders/1" && request.method === "PATCH") {
      const payload = JSON.parse(text); patches.push(payload);
      if (failSave) { failSave = false; response.statusCode = 500; return response.end(JSON.stringify({ error: "保存失败，请重试" })); }
      if (failAutoSchedule && payload.autoAdjustSchedule) {
        failAutoSchedule = false; response.statusCode = 400;
        return response.end(JSON.stringify({ error: "未来 600 个工作日内无法补齐，请检查产能与上游供给" }));
      }
      for (const update of payload.partQtys ?? []) {
        if (update.id === 11) headQty = update.qty;
        if (update.id === 12) footQty = update.qty;
      }
      headers = { ...headers, orderDate: payload.orderDate, deliveryDate: payload.deliveryDate, remark: payload.remark, isMA: payload.isMA, isUrgent: payload.isUrgent };
      if (holdSave) await new Promise<void>(resolve => { releaseSave = resolve; });
      let scheduleAdjustment;
      if (simulateAutoSchedule && payload.autoAdjustSchedule) {
        const target = Math.max(0, headQty - 60);
        scheduleAdjustment = unavailableAutoSchedule
          ? { addedQty: 0, reducedQty: 0, createdPlans: 0, warnings: ["头 第1道原拉别不可用，未自动补排"] }
          : { addedQty: Math.max(0, target - pendingHeadQty), reducedQty: Math.max(0, pendingHeadQty - target), createdPlans: 1, warnings: [] };
        if (!unavailableAutoSchedule) pendingHeadQty = target;
      }
      return response.end(JSON.stringify({ id: 1, status: detail().status, scheduleAdjustment }));
    }
    if (request.url === "/api/orders/1") {
      if (malformedReadback && patches.length > 0) { malformedReadback = false; return response.end("{}"); }
      if (failReadback && patches.length > 0) { failReadback = false; response.statusCode = 500; return response.end("{}"); }
      return response.end(JSON.stringify(detail()));
    }
    response.statusCode = 404; response.end("{}");
  });
  await new Promise<void>(resolve => api.listen(15081, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => api.close(error => error ? reject(error) : resolve())); });
test.beforeEach(async ({ context }) => {
  headQty = 100; footQty = 50; orderStatus = null; samePartName = false;
  simulateAutoSchedule = false; pendingHeadQty = 40;
  failAutoSchedule = false; unavailableAutoSchedule = false;
  failSave = false; failReadback = false; malformedReadback = false; patches = [];
  holdSave = false; releaseSave = undefined; schedulePayload = undefined; unschedules = 0;
  qtyEditable = true; pendingProduct = false;
  headers = { orderDate: "2026-10-08", deliveryDate: "2026-10-26", isMA: true, isUrgent: false, remark: "" };
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
  for (const value of ["-1", "1.5", "", "2147483648"]) {
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
  await expect(page.getByRole("checkbox", { name: /保存时自动补排/ })).toHaveCount(0);
  expect(patches).toHaveLength(0);
});


test("同名部位需求相加后显示整单总数，仍只提交变更行", async ({ page }) => {
  headQty = 50; footQty = 50; samePartName = true;
  await page.goto("/orders/1");
  const total = page.getByText("订单总数", { exact: false });
  await expect(total).toHaveText("订单总数 100");
  await page.getByLabel("头 数量", { exact: true }).first().fill("80");
  await expect(total).toHaveText("订单总数 130");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  expect(patches[0].partQtys).toEqual([{ id: 11, qty: 80 }]);
});

test("数量从零恢复时立即出现可填写的工序行", async ({ page }) => {
  footQty = 0; orderStatus = "received";
  await page.goto("/orders/1");
  await page.getByLabel("脚 数量", { exact: true }).fill("20");
  const footRow = page.locator("tr").filter({ has: page.getByRole("cell", { name: "脚", exact: true }) }).filter({ has: page.locator('input[type="date"]') });
  await expect(footRow).toHaveCount(1);
  await footRow.locator('input[type="date"]').fill("2026-10-28");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(footRow.locator('input[type="date"]')).toHaveValue("2026-10-28");
});

test("清零部位不阻塞其他部位排期，并保留已填工序草稿", async ({ page }) => {
  orderStatus = "received";
  await page.goto("/orders/1");
  const footRow = page.locator("tr").filter({ has: page.getByRole("cell", { name: "脚", exact: true }) }).filter({ has: page.locator('input[type="date"]') });
  await footRow.locator('input[type="date"]').fill("2026-10-28");
  await page.getByLabel("头 数量", { exact: true }).fill("0");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(footRow.locator('input[type="date"]')).toHaveValue("2026-10-28");
  await page.getByRole("button", { name: "保存并生成生产计划", exact: true }).click();
  await expect.poll(() => schedulePayload?.rows).toEqual([expect.objectContaining({ partQtyId: 12, startDate: "2026-10-28" })]);
});

test("保存成功但回读内容异常时保留页面与输入，不崩溃且可重试", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/orders/1"); malformedReadback = true;
  await page.getByLabel("头 数量", { exact: true }).fill("120");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert", { name: "保存错误" })).toContainText("订单已保存，但页面更新失败");
  await expect(page.getByLabel("头 数量", { exact: true })).toHaveValue("120");
  expect(headQty).toBe(120); expect(errors).toEqual([]);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
});

test("保存未结束时不能同时撤销排期", async ({ page }) => {
  await page.goto("/orders/1"); holdSave = true;
  await page.getByLabel("头 数量", { exact: true }).fill("120");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => patches.length).toBe(1);
  try {
    await expect(page.getByRole("button", { name: "撤销排期", exact: true })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /保存时自动补排/ })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /保存时自动补排/ })).toBeChecked();
    expect(patches).toHaveLength(1);
  }
  finally { releaseSave?.(); }
  await expect(page.getByRole("status")).toContainText("已保存"); expect(unschedules).toBe(0);
});

test("保存未结束时不能同时生成生产计划", async ({ page }) => {
  orderStatus = "received"; await page.goto("/orders/1"); holdSave = true;
  await page.getByLabel("头 数量", { exact: true }).fill("120");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => patches.length).toBe(1);
  try { await expect(page.getByRole("button", { name: "保存并生成生产计划", exact: true })).toBeDisabled(); }
  finally { releaseSave?.(); }
  await expect(page.getByRole("status")).toContainText("已保存"); expect(schedulePayload).toBeUndefined();
});

test("仅修改抬头时不携带部位更新，成功回读保持已保存的日期与备注", async ({ page }) => {
  await page.goto("/orders/1");
  const fields = page.locator("fieldset").first().locator("input");
  await fields.nth(0).fill("2026-10-09"); await fields.nth(1).fill("2026-11-01");
  await fields.nth(2).fill("更改交期");
  await page.getByRole("checkbox", { name: "急单", exact: true }).check();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  expect(patches[0]).not.toHaveProperty("partQtys");
  await expect(fields.nth(0)).toHaveValue("2026-10-09"); await expect(fields.nth(1)).toHaveValue("2026-11-01");
  await expect(fields.nth(2)).toHaveValue("更改交期");
  await expect(page.getByRole("checkbox", { name: "急单", exact: true })).toBeChecked();
});

test("归档订单不提供部位数量编辑", async ({ page }) => {
  orderStatus = "archived"; qtyEditable = false;
  await page.goto("/orders/1");
  await expect(page.getByLabel("头 数量", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "工序排期", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /保存时自动补排/ })).toHaveCount(0);
  await page.locator("fieldset").first().locator("input").nth(2).fill("归档备注");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  expect(patches).toHaveLength(1);
  expect(patches[0].autoAdjustSchedule).toBe(false);
  expect(patches[0].partQtys).toBeUndefined();
});

test("待补产品订单仅显示补全提示，不提供数量或排期编辑", async ({ page }) => {
  pendingProduct = true; qtyEditable = false;
  await page.goto("/orders/1");
  await expect(page.getByText("该订单尚未关联产品核价", { exact: false })).toBeVisible();
  await expect(page.getByLabel("头 数量", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
  expect(patches).toHaveLength(0);
});


test("默认自动补排，保存后缺口清零并显示调整数量", async ({ page }, testInfo) => {
  simulateAutoSchedule = true;
  await page.goto("/orders/1");
  await expect(page.getByRole("checkbox", { name: /保存时自动补排/ })).toBeChecked();
  await page.getByLabel("头 数量", { exact: true }).fill("120");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已自动补排 20 件、减排 0 件");
  expect(patches[0].autoAdjustSchedule).toBe(true);
  await expect(page.getByRole("region", { name: "排期调整提示" })).toContainText("当前无需补排或减排");
  await page.screenshot({ path: testInfo.outputPath("auto-adjust-schedule.png"), fullPage: true });
});

test("自动减排只减未报工数量，超产仍保留提示", async ({ page }) => {
  simulateAutoSchedule = true;
  await page.goto("/orders/1");
  await page.getByLabel("头 数量", { exact: true }).fill("30");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已自动补排 0 件、减排 40 件");
  const cells = page.getByRole("region", { name: "排期调整提示" }).getByRole("row").nth(1).getByRole("cell");
  await expect(cells.nth(6)).toHaveText("0"); await expect(cells.nth(7)).toHaveText("30");
});

test("已保存缺口可以直接保存自动补齐，也可取消自动调整", async ({ page }) => {
  simulateAutoSchedule = true; headQty = 120;
  await page.goto("/orders/1");
  await page.getByRole("checkbox", { name: /保存时自动补排/ }).uncheck();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  expect(patches[0].autoAdjustSchedule).toBe(false); expect(pendingHeadQty).toBe(40);
  await page.getByRole("checkbox", { name: /保存时自动补排/ }).check();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已自动补排 20 件");
  expect(patches[1].partQtys).toBeUndefined(); expect(pendingHeadQty).toBe(60);
});

test("自动调整失败保留需求输入，取消自动调整后可以仅保存需求", async ({ page }) => {
  simulateAutoSchedule = true; failAutoSchedule = true;
  await page.goto("/orders/1");
  await page.getByLabel("头 数量", { exact: true }).fill("120");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert", { name: "保存错误" })).toContainText("600 个工作日");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByLabel("头 数量", { exact: true })).toHaveValue("120");
  expect(headQty).toBe(100); expect(pendingHeadQty).toBe(40);
  expect(patches[0]).toMatchObject({ autoAdjustSchedule: true, partQtys: [{ id: 11, qty: 120 }] });
  await page.getByRole("checkbox", { name: /保存时自动补排/ }).uncheck();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  expect(patches[1]).toMatchObject({ autoAdjustSchedule: false, partQtys: [{ id: 11, qty: 120 }] });
  expect(headQty).toBe(120); expect(pendingHeadQty).toBe(40);
});

test("自动调整配置不可用时显示服务器警告与回读后的剩余缺口", async ({ page }) => {
  simulateAutoSchedule = true; unavailableAutoSchedule = true;
  await page.goto("/orders/1");
  await page.getByLabel("头 数量", { exact: true }).fill("120");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已自动补排 0 件、减排 0 件");
  await expect(page.getByRole("status")).toContainText("未自动处理：头 第1道原拉别不可用，未自动补排");
  const cells = page.getByRole("region", { name: "排期调整提示" }).getByRole("row").nth(1).getByRole("cell");
  await expect(cells.nth(5)).toHaveText("20");
  expect(headQty).toBe(120); expect(pendingHeadQty).toBe(40);
});

test("自动补齐后直接重复保存只发送开关并回读零调整", async ({ page }) => {
  simulateAutoSchedule = true; headQty = 120;
  await page.goto("/orders/1");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已自动补排 20 件");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已自动补排 0 件、减排 0 件");
  expect(patches).toHaveLength(2);
  expect(patches.every(patch => patch.autoAdjustSchedule === true && patch.partQtys === undefined)).toBe(true);
  expect(headQty).toBe(120); expect(pendingHeadQty).toBe(60);
});
