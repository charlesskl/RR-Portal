import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { SignJWT } from "jose";
let api: Server, failSave = false, failRead = false, writes = 0, previews = 0, autoCase = false, missingAddEndpoint = false, excessCase = false, missingBalances = false;
let submitted: { autoDeduct: boolean; allocationToken?: string }[] = [];
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
const initial = () => [1, 2, 3].map(id => ({ id, orderId: id, token: `token-${id}`, orderNo: `ORDER-${id}`, productNo: "77711", partName: ["果汁瓶盖", "热蜂蜜瓶身", "已报工水瓶"][id - 1], stepNo: 1, craft: "手喷", demand: 50000, goodQty: id === 3 ? 500 : null, inboundQty: id === 3 ? 450 : null, lockedReason: id === 3 ? "已录实绩" : null,
  values: { planDate: today, lineId: 1, machineNos: [], plannedQty: 10000, workerCount: 2, workHours: 8, remark: "" } }));
let rows = initial();
const allocationSources = () => [
  ...rows.filter(r => r.goodQty == null).map(r => ({ id: r.id, orderId: r.orderId, partName: r.partName, stepNo: r.stepNo, planDate: r.values.planDate, plannedQty: r.values.plannedQty, canDeduct: !r.lockedReason })),
  ...initial().filter(r => r.goodQty == null).map(r => ({ id: 1000 + r.id, orderId: r.orderId, partName: r.partName, stepNo: r.stepNo, planDate: "2040-01-01", plannedQty: 20000, canDeduct: true })),
];
function balanceOf(row: typeof rows[0], effective = rows) {
  const group = effective.filter(r => r.orderId === row.orderId && r.partName === row.partName && r.stepNo === row.stepNo);
  const produced = (row.orderId === 9 || row.orderId === 3 ? 0 : 2000) + group.reduce((sum, r) => sum + (r.goodQty ?? 0), 0);
  const unreportedPlanned = (row.orderId === 9 || row.orderId === 3 ? 0 : 20000) + group.filter(r => r.goodQty == null).reduce((sum, r) => sum + r.values.plannedQty, 0);
  return { orderId: row.orderId, partName: row.partName, stepNo: row.stepNo, demand: row.demand, produced, unreportedPlanned,
    remainingToSchedule: Math.max(0, row.demand - produced - unreportedPlanned), actualFallbackCount: 0 };
}
test.beforeAll(async () => {
  api = createServer(async (request, response) => {
    let text = ""; for await (const chunk of request) text += chunk;
    response.setHeader("Content-Type", "application/json");
    const url = new URL(request.url!, "http://127.0.0.1:15081");
    if (url.pathname === "/api/auth/session") return response.end("{}");
    if (url.pathname === "/api/plans/workbench/options") return response.end(JSON.stringify([
      { orderId: 9, orderPartQtyId: 91, sourcePartId: 901, orderNo: "TEMP-ORDER", productNo: "NEW-900", partName: "临时产品", stepNo: 1, craft: "手喷", demand: 1000, remaining: 1000, token: "option-token",
        balance: { orderId: 9, partName: "临时产品", stepNo: 1, demand: 1000, produced: 0, unreportedPlanned: 0, remainingToSchedule: 1000, actualFallbackCount: 0 }, allocationSources: [] },
    ]));
    if (url.pathname === "/api/plans/workbench/batch" && missingAddEndpoint) { response.statusCode = 404; return response.end(""); }
    if (["/api/plans/workbench", "/api/plans/workbench/batch"].includes(url.pathname) && request.method === "POST") {
      const body = JSON.parse(text);
      if (excessCase) {
        response.statusCode = 400;
        return response.end(JSON.stringify({ error: "累计排期超过订单需求，本批未保存", excessDetails: [{
          orderNo: "ORDER-1", partName: "果汁瓶盖", stepNo: 1, demand: 50000, produced: 5000, unreportedPlanned: 48000, excess: 3000,
          plans: [
            { id: 1, date: today, originalDate: today, lineName: "A拉：手喷", plannedQty: 18000, countedQty: 18000, recorded: false, adjusted: true },
            { id: 99, date: "2030-12-10", originalDate: "2030-12-09", lineName: "备用手喷拉", plannedQty: 30000, countedQty: 30000, recorded: false, adjusted: true },
            { id: 100, date: "2026-01-01", originalDate: "2026-01-01", lineName: "A拉：手喷", plannedQty: 6000, countedQty: 5000, recorded: true, actualFallback: true },
          ],
        }] }));
      }
      if (!body.preview && failSave) { response.statusCode = 409; return response.end(JSON.stringify({ error: "计划已被修改或正在报工，本批未保存；请刷新核对" })); }
      const changes = body.changes.map((c: { id: number; values: typeof rows[0]["values"] }) => ({ id: c.id, before: rows.find(r => r.id === c.id)!.values, after: c.values }));
      for (const addition of body.additions ?? []) changes.push({ id: addition.clientId, created: true, orderNo: "TEMP-ORDER", partName: "临时产品", before: { ...addition.values, plannedQty: 0 }, after: addition.values });
      const transfers = [];
      if (autoCase && body.autoDeduct) {
        const target = changes.find((c: { id: number }) => c.id === 1);
        if (target && target.after.plannedQty > target.before.plannedQty) {
          const donor = rows.find(r => r.id === 4)!;
          const quantity = target.after.plannedQty - target.before.plannedQty;
          changes.push({ id: donor.id, before: donor.values, after: { ...donor.values, plannedQty: donor.values.plannedQty - quantity }, automatic: true });
          transfers.push({ sourcePlanId: 4, sourceDate: donor.values.planDate, targetPlanId: 1, targetDate: target.after.planDate, quantity, orderNo: "ORDER-1", partName: "果汁瓶盖", stepNo: 1 });
        }
      }
      submitted.push({ autoDeduct: body.autoDeduct, allocationToken: body.allocationToken });
      const effective = rows.map(row => { const c = changes.find((c: { id: number }) => c.id === row.id); return c ? { ...row, values: c.after } : row; });
      for (const addition of body.additions ?? []) effective.push({ ...initial()[0], id: addition.clientId, orderId: 9, orderNo: "TEMP-ORDER", partName: "临时产品", demand: 1000, values: addition.values });
      const balances = missingBalances ? undefined : effective.map(row => balanceOf(row, effective));
      if (body.preview) previews++;
      else { writes++; rows = rows.map(row => { const change = changes.find((c: { id: number }) => c.id === row.id); return change ? { ...row, token: row.token + "v", values: change.after } : row; });
        for (const addition of body.additions ?? []) rows.push({ ...initial()[0], id: 100 + rows.length, orderId: 9, demand: 1000, token: "created", orderNo: "TEMP-ORDER", productNo: "NEW-900", partName: "临时产品", values: addition.values });
      }
      return response.end(JSON.stringify({ adjustedPlans: changes.length, createdPlans: (body.additions ?? []).length, preview: body.preview, changes, balances, transfers, allocationToken: "snapshot-1", warnings: ["部分订单仍需补排，请核对剩余需求"] }));
    }
    if (url.pathname === "/api/plans/workbench") {
      if (failRead && writes) { response.statusCode = 500; return response.end(JSON.stringify({ error: "模拟读取失败" })); }
      return response.end(JSON.stringify({ allocationSources: missingBalances ? undefined : allocationSources(), rows: (autoCase ? rows.filter(r => r.id !== 4) : rows).map(row => ({ ...row, balance: missingBalances ? undefined : balanceOf(row) })), lines: [
        { id: 1, name: "A拉：手喷", craftType: "手喷", isActive: true, dailyLimit: 200000, machineNos: ["1 号机 (世通)", "2 号机 (世通)"] },
        { id: 2, name: "备用手喷拉", craftType: "手喷", isActive: true, dailyLimit: 100000, machineNos: [] },
      ] }));
    }
    if (url.pathname === "/api/schedule/overview") return response.end(JSON.stringify({ lines: [], plans: [], lineNotes: [] }));
    response.end("[]");
  });
  await new Promise<void>(resolve => api.listen(15081, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>(resolve => api.close(() => resolve())); });
test.beforeEach(async ({ context }) => {
  rows = initial(); failSave = false; failRead = false; writes = 0; previews = 0; autoCase = false; missingAddEndpoint = false; excessCase = false; missingBalances = false; submitted = [];
  const token = await new SignJWT({ userId: "1", username: "clerk", factoryId: "XINGXIN", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "clerk" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("order-parts-test").setExpirationTime("1h")
    .sign(new TextEncoder().encode("order-parts-test-only-key-32-characters-long"));
  await context.addCookies([{ name: "sprayplan_session", value: token, url: "http://127.0.0.1:18401" }]);
});

test("数量随草稿即时更新，不发预览或写请求，检查后再编辑继续实时计算，保存刷新保持结果", async ({ page }) => {
  await page.goto("/schedule/table");
  await expect(page.getByRole("columnheader", { name: "订单总需求", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "已生产 / 入库（本行）", exact: true })).toBeVisible();
  await expect(page.getByLabel("计划 #1 累计已生产", { exact: true })).toHaveText("2,000");
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("30,000");
  await expect(page.getByLabel("计划 #1 尚需补排", { exact: true })).toHaveText("18,000");
  await page.getByLabel("计划 #1 计划数", { exact: true }).fill("8000");
  await expect(page.getByText("数量随草稿实时估算", { exact: false })).toBeVisible();
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("28,000");
  await expect(page.getByLabel("计划 #1 尚需补排", { exact: true })).toHaveText("20,000");
  expect(previews).toBe(0); expect(writes).toBe(0);
  await page.getByRole("button", { name: "检查改动（1）" }).click();
  await expect(page.getByLabel("计划 #1 订单总需求", { exact: true })).toHaveText("50,000");
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("28,000");
  await expect(page.getByLabel("计划 #1 尚需补排", { exact: true })).toHaveText("20,000");
  await page.getByLabel("计划 #1 计划数", { exact: true }).fill("9000");
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("29,000");
  await page.getByRole("button", { name: "检查改动（1）" }).click();
  await page.getByRole("button", { name: "确认统一保存（1）" }).click();
  await expect(page.getByLabel("计划 #1 尚需补排", { exact: true })).toHaveText("19,000");
  await page.reload();
  await expect(page.getByLabel("计划 #1 尚需补排", { exact: true })).toHaveText("19,000");
});

test("加量并自动扣减筛选外后续排期时，累计未报工计划及补排缺口保持不变", async ({ page }) => {
  autoCase = true; rows.push({ ...initial()[0], id: 4, token: "future", values: { ...initial()[0].values, planDate: "2030-12-10" } });
  await page.goto("/schedule/table");
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("40,000");
  await page.getByLabel("计划 #1 计划数", { exact: true }).fill("15000");
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("40,000");
  expect(previews).toBe(0);
  await page.getByRole("button", { name: "检查改动（1）" }).click();
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("40,000");
  await expect(page.getByLabel("计划 #1 尚需补排", { exact: true })).toHaveText("8,000");
  expect(writes).toBe(0);
});

test("输入未完成时提示，关闭自动扣减立即重算，过量不显示负补排", async ({ page }) => {
  await page.goto("/schedule/table");
  await page.getByLabel("计划 #1 计划数", { exact: true }).fill("");
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("—");
  await expect(page.getByLabel("计划 #1 尚需补排", { exact: true })).toContainText("输入中或无效");
  await expect(page.getByLabel("计划 #1 累计已生产", { exact: true })).toHaveText("2,000");
  await page.getByLabel("计划 #1 计划数", { exact: true }).fill("15000");
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("30,000");
  await page.getByRole("checkbox", { name: "增加计划数时", exact: false }).uncheck();
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("35,000");
  await expect(page.getByLabel("计划 #1 尚需补排", { exact: true })).toHaveText("13,000");
  await page.getByLabel("计划 #1 计划数", { exact: true }).fill("1000000");
  await expect(page.getByLabel("计划 #1 尚需补排", { exact: true })).toHaveText("0");
  expect(previews).toBe(0); expect(writes).toBe(0);
});

test("同组多行及筛选隐藏草稿参与实时统计，还原和放弃修改恢复数量", async ({ page }) => {
  rows.push({ ...initial()[0], id: 4, values: { ...initial()[0].values, lineId: 2, plannedQty: 5000 } });
  await page.goto("/schedule/table");
  await page.getByLabel("计划 #4 计划数", { exact: true }).fill("3000");
  await page.getByRole("combobox", { name: "筛选拉别" }).selectOption("1");
  await expect(page.getByLabel("计划 #4 计划数", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("33,000");
  await page.getByLabel("计划 #1 计划数", { exact: true }).fill("8000");
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("31,000");
  await page.getByRole("button", { name: "还原本行", exact: true }).click();
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("33,000");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "放弃全部修改" }).click();
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("35,000");
  expect(previews).toBe(0); expect(writes).toBe(0);
});

test("统计接口未就绪时显示未加载，不能把缺失统计误显示为零", async ({ page }) => {
  missingBalances = true; await page.goto("/schedule/table");
  await expect(page.getByLabel("计划 #1 订单总需求", { exact: true })).toHaveText("50,000");
  await expect(page.getByLabel("计划 #1 累计已生产", { exact: true })).toHaveText("—");
  await expect(page.getByLabel("计划 #1 尚需补排", { exact: true })).toContainText("统计未加载");
});

test("超排显示需求、实绩、草稿计划及跨日期明细，保留草稿并在再编辑后清除旧明细", async ({ page }) => {
  excessCase = true;
  await page.goto("/schedule/table");
  await page.getByLabel("计划 #1 计划数").fill("18000");
  await page.getByRole("button", { name: "检查改动（1）" }).click();
  const report = page.getByRole("region", { name: "超排数量明细" });
  await expect(report).toContainText("订单需求50,000 件");
  await expect(report).toContainText("已生产5,000 件");
  await expect(report).toContainText("调整后未报工计划48,000 件");
  await expect(report).toContainText("超出数量3,000 件");
  await expect(report).toContainText("2030-12-10");
  await expect(report).toContainText("原日期 2030-12-09");
  await expect(report).toContainText("30,000");
  await expect(report).toContainText("未填良品数");
  await expect(page.getByLabel("计划 #1 计划数")).toHaveValue("18000");
  await expect(page.getByRole("button", { name: "确认统一保存（0）" })).toBeDisabled();
  expect(writes).toBe(0);
  await page.getByLabel("计划 #1 计划数").fill("15000");
  await expect(report).toHaveCount(0);
  excessCase = false;
  await page.getByRole("button", { name: "检查改动（1）" }).click();
  await expect(page.getByRole("region", { name: "统一保存预览" })).toBeVisible();
});

test("从排期总览进入，直接编辑、批量顺延、预览后整批保存，已报工保持只读", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/schedule"); await page.getByRole("link", { name: "表格排期 · 批量调整" }).click();
  await expect(page.getByLabel("计划 #3 计划数")).toBeDisabled();
  await page.getByLabel("计划 #1 计划数").fill("8000");
  await page.getByLabel("计划 #2 人数").fill("3");
  await page.getByLabel("全选可编辑计划").check();
  await expect(page.getByLabel("选择计划 #3")).not.toBeChecked();
  await page.getByLabel("批量值").fill("1"); await page.getByRole("button", { name: "应用到草稿" }).click();
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "检查改动（2）" }).click();
  await expect(page.getByRole("region", { name: "统一保存预览" })).toContainText("计划数 10000 → 8000");
  expect(previews).toBe(1); expect(writes).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("plan-workbench.png"), fullPage: true });
  await page.getByRole("button", { name: "确认统一保存（2）" }).click();
  await expect(page.getByRole("status")).toContainText("已统一保存 2 条计划");
  expect(writes).toBe(1); expect(rows[0].values.plannedQty).toBe(8000); expect(rows[2]).toEqual(initial()[2]); expect(errors).toEqual([]);
});

test("Excel 多行粘贴保留为草稿，回车向下，编辑后必须重新预览", async ({ page }) => {
  await page.goto("/schedule/table");
  const first = page.getByLabel("计划 #1 计划数");
  await first.evaluate(element => {
    const data = new DataTransfer(); data.setData("text/plain", "8000\t3\t7.5\t先做一批\n9000\t4\t8\t等待来料\n");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(first).toHaveValue("8000"); await expect(page.getByLabel("计划 #2 备注")).toHaveValue("等待来料");
  await expect(page.getByLabel("计划 #1 未报工计划", { exact: true })).toHaveText("28,000");
  await expect(page.getByLabel("计划 #2 未报工计划", { exact: true })).toHaveText("29,000");
  await first.focus(); await first.press("Enter"); await expect(page.getByLabel("计划 #2 计划数")).toBeFocused();
  await page.getByRole("button", { name: "检查改动（2）" }).click();
  await expect(page.getByRole("region", { name: "统一保存预览" })).toBeVisible();
  await page.getByLabel("计划 #2 计划数").fill("8500");
  await expect(page.getByRole("button", { name: "确认统一保存（2）" })).toHaveCount(0); expect(writes).toBe(0);
});

test("粘贴跨入锁定行时整批不应用，保存冲突保留草稿", async ({ page }) => {
  await page.goto("/schedule/table"); const first = page.getByLabel("计划 #1 计划数");
  await first.evaluate(element => { const data = new DataTransfer(); data.setData("text/plain", "8000\n9000\n1000"); element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); });
  await expect(page.getByRole("alert", { name: "排期工作台错误" })).toContainText("锁定"); await expect(first).toHaveValue("10000");
  await first.fill("8000"); await page.getByRole("button", { name: "检查改动（1）" }).click();
  failSave = true; await page.getByRole("button", { name: "确认统一保存（1）" }).click();
  await expect(page.getByRole("alert", { name: "排期工作台错误" })).toContainText("本批未保存");
  await expect(first).toHaveValue("8000"); expect(writes).toBe(0);
});

test("保存成功但刷新失败不重复提交，离开未保存草稿可取消", async ({ page }) => {
  await page.goto("/schedule/table"); await page.getByLabel("计划 #1 计划数").fill("8000");
  page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("link", { name: "返回排期总览" }).click();
  await expect(page.getByRole("heading", { name: "表格排期工作台" })).toBeVisible();
  await page.getByRole("button", { name: "检查改动（1）" }).click(); failRead = true;
  await page.getByRole("button", { name: "确认统一保存（1）" }).click();
  await expect(page.getByRole("alert", { name: "排期工作台错误" })).toContainText("保存已成功");
  await expect(page.getByRole("button", { name: "检查改动（0）" })).toBeDisabled(); expect(writes).toBe(1);
});


test("加量自动显示筛选外的扣减明细，确认携带预览版本；关闭开关后重新预览", async ({ page }, testInfo) => {
  autoCase = true;
  const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 10);
  rows.push({ ...initial()[0], id: 4, token: "token-4", values: { ...initial()[0].values, plannedQty: 2000, planDate: date.toISOString().slice(0, 10) } });
  await page.goto("/schedule/table");
  await page.getByLabel("计划 #1 计划数").fill("10500");
  await page.getByRole("button", { name: "检查改动（1）" }).click();
  await expect(page.getByLabel("自动扣减明细")).toContainText("扣减 500 件");
  await expect(page.getByLabel("自动扣减明细")).toContainText(date.toISOString().slice(0, 10));
  await expect(page.getByRole("region", { name: "统一保存预览" })).toContainText("2000 → 1500");
  expect(writes).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("automatic-deduction.png"), fullPage: true });
  await page.getByRole("checkbox", { name: "增加计划数时" }).uncheck();
  await expect(page.getByRole("region", { name: "统一保存预览" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "增加计划数时" }).check();
  await page.getByRole("button", { name: "检查改动（1）" }).click();
  await page.getByRole("button", { name: "确认统一保存（2）" }).click();
  await expect(page.getByRole("status")).toContainText("已统一保存 2 条计划");
  expect(submitted.at(-1)).toEqual({ autoDeduct: true, allocationToken: "snapshot-1" });
  expect(rows.find(r => r.id === 4)!.values.plannedQty).toBe(1500);
});

test("机台选择使用启用机台的完整登记名称，可多选而不重复", async ({ page }) => {
  await page.goto("/schedule/table");
  const cell = page.locator("td").filter({ has: page.getByLabel("计划 #1 机台", { exact: true }) });
  await cell.getByText("可用机台（2）", { exact: true }).click();
  await cell.getByRole("button", { name: "1 号机 (世通)", exact: true }).click();
  await expect(page.getByLabel("计划 #1 机台", { exact: true })).toHaveValue("1 号机 (世通)");
  await cell.getByRole("button", { name: "2 号机 (世通)", exact: true }).click();
  await cell.getByRole("button", { name: "1 号机 (世通)", exact: true }).click();
  await expect(page.getByLabel("计划 #1 机台", { exact: true })).toHaveValue("1 号机 (世通)、2 号机 (世通)");
  expect(writes).toBe(0);
});


test("筛选栏增加临时产品排期，与原有修改统一预览和保存，保存栏始终固定", async ({ page }, testInfo) => {
  await page.goto("/schedule/table");
  await expect(page.getByRole("button", { name: "确认统一保存（0）" })).toBeDisabled();
  await page.getByLabel("计划 #1 计划数").fill("8000");
  await page.getByRole("button", { name: "增加排期", exact: false }).click();
  const dialog = page.getByRole("dialog", { name: "增加排期", exact: true });
  await dialog.getByLabel("搜索订单 / 货号 / 部位").fill("NEW-900");
  await dialog.getByLabel("订单产品与工序").selectOption("91:1");
  await dialog.getByLabel("新增计划数量").fill("100");
  await dialog.getByRole("button", { name: "加入排期草稿" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("新增排期 1 计划数")).toHaveValue("100");
  await expect(page.getByLabel("新增排期 1 尚需补排", { exact: true })).toHaveText("900");
  expect(writes).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const footer = page.getByRole("region", { name: "排期保存操作", exact: true });
  const viewport = page.viewportSize()!;
  const before = await footer.boundingBox(); expect(before!.y + before!.height).toBeLessThanOrEqual(viewport.height + 1);
  await expect(footer.getByRole("button", { name: "检查改动（2）" })).toBeVisible();
  await footer.getByRole("button", { name: "检查改动（2）" }).click();
  await expect(page.getByRole("region", { name: "统一保存预览" })).toContainText("临时产品");
  await expect(page.getByLabel("新增排期 1 未报工计划", { exact: true })).toHaveText("100");
  await expect(page.getByLabel("新增排期 1 尚需补排", { exact: true })).toHaveText("900");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const after = await footer.boundingBox(); expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath("add-plan-fixed-footer.png"), fullPage: true });
  await footer.getByRole("button", { name: "确认统一保存（2）" }).click();
  await expect(page.getByRole("status")).toContainText("已统一保存 2 条计划");
  expect(writes).toBe(1); expect(rows.some(r => r.productNo === "NEW-900")).toBe(true);
});

test("新增草稿可以移除，校验冲突后保留新增及已有输入", async ({ page }) => {
  await page.goto("/schedule/table"); await page.getByRole("button", { name: "增加排期" }).click();
  const dialog = page.getByRole("dialog", { name: "增加排期", exact: true });
  await dialog.getByLabel("订单产品与工序").selectOption("91:1");
  await dialog.getByLabel("新增计划数量").fill("0"); await dialog.getByRole("button", { name: "加入排期草稿" }).click();
  await expect(dialog.getByRole("alert", { name: "增加排期错误" })).toBeVisible();
  await dialog.getByLabel("新增计划数量").fill("50"); await dialog.getByRole("button", { name: "加入排期草稿" }).click();
  await page.getByRole("button", { name: "检查改动（1）" }).click(); failSave = true;
  await page.getByRole("button", { name: "确认统一保存（1）" }).click();
  await expect(page.getByRole("alert", { name: "排期工作台错误" })).toContainText("本批未保存");
  await expect(page.getByLabel("新增排期 1 计划数")).toHaveValue("50");
  await page.getByRole("button", { name: "移除新增", exact: true }).click();
  await expect(page.getByLabel("新增排期 1 计划数")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "检查改动（0）" })).toBeDisabled(); expect(writes).toBe(0);
});


test("新增接口尚未部署时保留草稿，不能仅保存原有修改而遗漏新增", async ({ page }) => {
  await page.goto("/schedule/table"); await page.getByLabel("计划 #1 计划数").fill("8000");
  await page.getByRole("button", { name: "增加排期" }).click();
  const dialog = page.getByRole("dialog", { name: "增加排期", exact: true });
  await dialog.getByLabel("订单产品与工序").selectOption("91:1"); await dialog.getByLabel("新增计划数量").fill("50");
  await dialog.getByRole("button", { name: "加入排期草稿" }).click(); missingAddEndpoint = true;
  await page.getByRole("button", { name: "检查改动（2）" }).click();
  await expect(page.getByRole("alert", { name: "排期工作台错误" })).toContainText("新增排期接口尚未就绪");
  await expect(page.getByLabel("新增排期 1 计划数")).toHaveValue("50"); await expect(page.getByLabel("计划 #1 计划数")).toHaveValue("8000");
  await expect(page.getByRole("button", { name: "确认统一保存（0）" })).toBeDisabled(); expect(writes).toBe(0);
});
