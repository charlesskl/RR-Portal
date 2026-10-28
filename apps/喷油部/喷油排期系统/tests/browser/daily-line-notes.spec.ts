import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { SignJWT } from "jose";

let api: Server;
let notes: { date: string; lineId: number; text: string; version: number }[] = [];
let conflict = false;
let exported = "";
let failSave = false, holdOverview = false, holdPut = false;
let releaseOverview: (() => void) | null = null, releasePut: (() => void) | null = null;
let putBodies: { date: string; lineId: number; text: string; version: number }[] = [];
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
test.beforeAll(async () => {
  api = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    response.setHeader("Content-Type", "application/json");
    const url = new URL(request.url!, "http://127.0.0.1:15081");
    if (url.pathname === "/api/schedule/line-notes" && request.method === "PUT") {
      const payload = JSON.parse(body); putBodies.push(payload);
      if (failSave) { response.statusCode = 500; return response.end(JSON.stringify({ error: "备注服务暂不可用" })); }
      const current = notes.find(n => n.date === payload.date && n.lineId === payload.lineId);
      if (conflict || (current?.version ?? 0) !== payload.version) { response.statusCode = 409; return response.end(JSON.stringify({ error: "备注已被其他人更新，请刷新后重新编辑" })); }
      const note = JSON.parse(body); note.version++; notes = notes.filter(n => n.date !== note.date || n.lineId !== note.lineId).concat(note);
      if (holdPut) { holdPut = false; await new Promise<void>(resolve => { releasePut = resolve; }); }
      return response.end(JSON.stringify(note));
    }
    if (url.pathname === "/api/schedule/overview") { const snapshot = JSON.stringify({
      lines: [{ lineId: 1, name: "A拉：手喷", craftType: "手喷", dailyLimit: 200000 }, { lineId: 2, name: "B拉：自动喷", craftType: "自动喷", dailyLimit: 300000 }],
      plans: [{ id: 1, date: today, lineId: 1, orderId: 1, productNo: "15780", partName: "番茄片", itemName: "", craft: "手喷", stepNo: 1, plannedQty: 18000, machineNos: [], workerCount: 1 }],
      lineNotes: notes.filter(n => n.date >= url.searchParams.get("from")! && n.date <= url.searchParams.get("to")!),
    });
      if (holdOverview) { holdOverview = false; await new Promise<void>(resolve => { releaseOverview = resolve; }); }
      return response.end(snapshot);
    }
    if (url.pathname === "/api/recording/export") {
      exported = JSON.parse(body).date;
      response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return response.end("test-download");
    }
    return response.end(url.pathname === "/api/auth/session" ? "{}" : "[]");
  });
  await new Promise<void>(resolve => api.listen(15081, "127.0.0.1", resolve));
});
test.afterEach(() => { releaseOverview?.(); releasePut?.(); });
test.afterAll(async () => { await new Promise<void>(resolve => api.close(() => resolve())); });
test.beforeEach(async ({ context }) => {
  notes = []; conflict = false; exported = ""; failSave = false; holdOverview = false; holdPut = false; releaseOverview = null; releasePut = null; putBodies = [];
  const token = await new SignJWT({ userId: "1", username: "clerk", factoryId: "XINGXIN", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "clerk" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("order-parts-test").setExpirationTime("1h")
    .sign(new TextEncoder().encode("order-parts-test-only-key-32-characters-long"));
  await context.addCookies([{ name: "sprayplan_session", value: token, url: "http://127.0.0.1:18401" }]);
});

test("每日每拉备注位于小计下方，保存刷新仍保留，可清空并导出当日", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/schedule");
  const note = page.getByLabel(`${today} A拉：手喷 备注`);
  await note.fill("上午调机，下午开工\n注意色差");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.reload();
  await expect(note).toHaveValue("上午调机，下午开工\n注意色差");
  await expect(page.getByLabel(`${today} B拉：自动喷 备注`)).toHaveValue("");
  const cell = page.locator("td").filter({ has: note });
  const mini = await cell.locator(".sc-mini").boundingBox();
  const editor = await note.boundingBox();
  const items = await cell.locator(".sc-items").boundingBox();
  expect(editor!.y).toBeGreaterThan(mini!.y); expect(items!.y).toBeGreaterThan(editor!.y);
  await page.screenshot({ path: testInfo.outputPath("daily-line-notes.png"), fullPage: true });
  await page.getByRole("button", { name: "导出 Excel" }).click();
  await page.getByRole("button", { name: "生成并下载" }).click();
  await expect.poll(() => exported).toBe(today);
  await note.fill("");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await page.reload(); await expect(note).toHaveValue("");
  expect(errors).toEqual([]);
});

test("无排期的拉也能保存备注，冲突时保留待保存内容", async ({ page }) => {
  await page.goto("/schedule");
  const note = page.getByLabel(`${today} B拉：自动喷 备注`);
  await note.fill("等待来料"); conflict = true;
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("alert", { name: "拉别备注错误" })).toContainText("备注已被其他人更新");
  await expect(note).toHaveValue("等待来料");
  expect(notes).toEqual([]);
  conflict = false;
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await page.reload(); await expect(note).toHaveValue("等待来料");
});

test("切换日期后备注独立保存，导出默认日期跟随选中日期", async ({ page }) => {
  await page.goto("/schedule");
  await page.getByLabel(`${today} A拉：手喷 备注`).fill("今天备注");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  const next = new Date(`${today}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  await page.getByLabel("结束日期").fill(tomorrow);
  await page.getByLabel("起始日期").fill(tomorrow);
  await expect(page.getByLabel(`${tomorrow} A拉：手喷 备注`)).toHaveValue("");
  await page.getByLabel(`${tomorrow} A拉：手喷 备注`).fill("明天备注");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  await page.getByRole("button", { name: "导出 Excel" }).click();
  await expect(page.getByLabel("日报日期")).toHaveValue(tomorrow);
  await page.getByRole("button", { name: "生成并下载" }).click();
  await expect.poll(() => exported).toBe(tomorrow);
  expect(notes.map(n => n.text).sort()).toEqual(["今天备注", "明天备注"].sort());
});

function tomorrowDate() { const next = new Date(`${today}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); return next.toISOString().slice(0, 10); }

test("迟到的排期读取不能回退刚保存的备注及版本", async ({ page }) => {
  await page.goto("/schedule");
  const note = page.getByLabel(`${today} A拉：手喷 备注`);
  await expect(note).toHaveValue("");
  holdOverview = true;
  await page.getByLabel("结束日期").fill(tomorrowDate());
  await expect.poll(() => releaseOverview !== null).toBe(true);
  await note.fill("刚保存，不应回退");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  releaseOverview!();
  await expect(page.getByText("⏳ 加载中…")).toHaveCount(0);
  await expect(note).toHaveValue("刚保存，不应回退");
  await note.fill("下一版");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  expect(putBodies.map(n => n.version)).toEqual([0, 1]);
});

test("刷新收到他人新版本时保留本地草稿并保持原始并发版本", async ({ page }) => {
  await page.goto("/schedule");
  const note = page.getByLabel(`${today} A拉：手喷 备注`);
  await expect(note).toHaveValue("");
  notes = [{ date: today, lineId: 1, text: "其他人已保存", version: 1 }];
  holdOverview = true;
  await page.getByLabel("结束日期").fill(tomorrowDate());
  await expect.poll(() => releaseOverview !== null).toBe(true);
  await note.fill("我的未保存草稿");
  releaseOverview!();
  await expect(page.getByText("⏳ 加载中…")).toHaveCount(0);
  await expect(note).toHaveValue("我的未保存草稿");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("alert", { name: "拉别备注错误" })).toContainText("备注已被其他人更新");
  expect(putBodies[0].version).toBe(0);
  expect(notes[0].text).toBe("其他人已保存");
});

test("切换日期后旧范围响应不会清空新日期已加载备注", async ({ page }) => {
  await page.goto("/schedule");
  const tomorrow = tomorrowDate();
  await expect(page.getByLabel(`${today} A拉：手喷 备注`)).toHaveValue("");
  holdOverview = true;
  await page.getByLabel("结束日期").fill(tomorrow);
  await expect.poll(() => releaseOverview !== null).toBe(true);
  notes = [{ date: tomorrow, lineId: 1, text: "明天现有备注", version: 3 }];
  await page.getByLabel("起始日期").fill(tomorrow);
  const note = page.getByLabel(`${tomorrow} A拉：手喷 备注`);
  await expect(note).toHaveValue("明天现有备注");
  releaseOverview!();
  await page.waitForTimeout(100);
  await expect(note).toHaveValue("明天现有备注");
});

test("旧日期保存晚返回不会串写新日期，新日期仍使用独立版本", async ({ page }) => {
  await page.goto("/schedule");
  holdPut = true;
  await page.getByLabel(`${today} A拉：手喷 备注`).fill("今天保存");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect.poll(() => releasePut !== null).toBe(true);
  const tomorrow = tomorrowDate();
  await page.getByLabel("结束日期").fill(tomorrow);
  await page.getByLabel("起始日期").fill(tomorrow);
  const note = page.getByLabel(`${tomorrow} A拉：手喷 备注`);
  await note.fill("明天草稿");
  releasePut!();
  await expect(note).toHaveValue("明天草稿");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  expect(putBodies.map(n => [n.date, n.version])).toEqual([[today, 0], [tomorrow, 0]]);
  expect(notes.map(n => n.text).sort()).toEqual(["今天保存", "明天草稿"].sort());
});

test("保存失败保留内容且不显示成功，可修复后重试", async ({ page }) => {
  await page.goto("/schedule");
  const note = page.getByLabel(`${today} A拉：手喷 备注`);
  await note.fill("服务恢复再保存"); failSave = true;
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("alert", { name: "拉别备注错误" })).toContainText("备注服务暂不可用");
  await expect(note).toHaveValue("服务恢复再保存");
  await expect(page.getByRole("status")).toHaveCount(0); expect(notes).toEqual([]);
  failSave = false;
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
});

test("只读账号仅展示每日备注而没有输入和保存按钮", async ({ page, context }) => {
  const token = await new SignJWT({ userId: "2", username: "viewer", factoryId: "XINGXIN", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "viewer" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("order-parts-test").setExpirationTime("1h")
    .sign(new TextEncoder().encode("order-parts-test-only-key-32-characters-long"));
  await context.addCookies([{ name: "sprayplan_session", value: token, url: "http://127.0.0.1:18401" }]);
  notes = [{ date: today, lineId: 1, text: "只读备注", version: 1 }];
  await page.goto("/schedule");
  await expect(page.getByText("备注：只读备注")).toBeVisible();
  await expect(page.getByLabel(`${today} A拉：手喷 备注`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存备注", exact: true })).toHaveCount(0);
  expect(putBodies).toEqual([]);
});

test("真实版本冲突不自动重试，立即刷新能读到他人已保存版本", async ({ page }) => {
  await page.goto("/schedule");
  const note = page.getByLabel(`${today} A拉：手喷 备注`);
  await note.fill("我的未提交版本");
  notes = [{ date: today, lineId: 1, text: "他人当前版本", version: 1 }];
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("alert", { name: "拉别备注错误" })).toContainText("备注已被其他人更新");
  await expect(note).toHaveValue("我的未提交版本");
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(putBodies).toHaveLength(1);
  await page.reload();
  await expect(note).toHaveValue("他人当前版本");
  expect(putBodies).toHaveLength(1);
});

test("迟到保存响应不能覆盖已读取的更高备注版本", async ({ page }) => {
  await page.goto("/schedule");
  const note = page.getByLabel(`${today} A拉：手喷 备注`);
  await note.fill("我的已提交版本"); holdPut = true;
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect.poll(() => releasePut !== null).toBe(true);
  notes = [{ date: today, lineId: 1, text: "他人最新第二版", version: 2 }];
  await page.getByLabel("结束日期").fill(tomorrowDate());
  await expect(page.getByRole("alert", { name: "拉别备注错误" })).toContainText("备注已被其他人更新");
  releasePut!();
  await expect(note).toHaveValue("他人最新第二版");
  await note.fill("基于第二版继续编辑");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存");
  expect(putBodies.map(n => n.version)).toEqual([0, 2]);
  expect(notes[0].version).toBe(3);
});
