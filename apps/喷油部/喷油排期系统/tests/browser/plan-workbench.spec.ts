import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { SignJWT } from "jose";
let api: Server, failSave = false, failRead = false, writes = 0, previews = 0;
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
const initial = () => [1, 2, 3].map(id => ({ id, token: `token-${id}`, orderNo: `ORDER-${id}`, productNo: "77711", partName: ["果汁瓶盖", "热蜂蜜瓶身", "已报工水瓶"][id - 1], stepNo: 1, craft: "手喷", demand: 50000, goodQty: id === 3 ? 500 : null, inboundQty: id === 3 ? 450 : null, lockedReason: id === 3 ? "已录实绩" : null,
  values: { planDate: today, lineId: 1, machineNos: [], plannedQty: 10000, workerCount: 2, workHours: 8, remark: "" } }));
let rows = initial();
test.beforeAll(async () => {
  api = createServer(async (request, response) => {
    let text = ""; for await (const chunk of request) text += chunk;
    response.setHeader("Content-Type", "application/json");
    const url = new URL(request.url!, "http://127.0.0.1:15081");
    if (url.pathname === "/api/auth/session") return response.end("{}");
    if (url.pathname === "/api/plans/workbench" && request.method === "POST") {
      const body = JSON.parse(text);
      if (!body.preview && failSave) { response.statusCode = 409; return response.end(JSON.stringify({ error: "计划已被修改或正在报工，本批未保存；请刷新核对" })); }
      const changes = body.changes.map((c: { id: number; values: typeof rows[0]["values"] }) => ({ id: c.id, before: rows.find(r => r.id === c.id)!.values, after: c.values }));
      if (body.preview) previews++;
      else { writes++; rows = rows.map(row => { const change = changes.find((c: { id: number }) => c.id === row.id); return change ? { ...row, token: row.token + "v", values: change.after } : row; }); }
      return response.end(JSON.stringify({ adjustedPlans: changes.length, preview: body.preview, changes, warnings: ["部分订单仍需补排，请核对剩余需求"] }));
    }
    if (url.pathname === "/api/plans/workbench") {
      if (failRead && writes) { response.statusCode = 500; return response.end(JSON.stringify({ error: "模拟读取失败" })); }
      return response.end(JSON.stringify({ rows, lines: [
        { id: 1, name: "A拉：手喷", craftType: "手喷", isActive: true, dailyLimit: 200000, machineNos: [] },
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
  rows = initial(); failSave = false; failRead = false; writes = 0; previews = 0;
  const token = await new SignJWT({ userId: "1", username: "clerk", factoryId: "XINGXIN", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "clerk" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("order-parts-test").setExpirationTime("1h")
    .sign(new TextEncoder().encode("order-parts-test-only-key-32-characters-long"));
  await context.addCookies([{ name: "sprayplan_session", value: token, url: "http://127.0.0.1:18401" }]);
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
