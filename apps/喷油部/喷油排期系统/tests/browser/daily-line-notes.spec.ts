import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { SignJWT } from "jose";

let api: Server;
let notes: { date: string; lineId: number; text: string; version: number }[] = [];
let conflict = false;
let exported = "";
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
test.beforeAll(async () => {
  api = createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    response.setHeader("Content-Type", "application/json");
    const url = new URL(request.url!, "http://127.0.0.1:15081");
    if (url.pathname === "/api/schedule/line-notes" && request.method === "PUT") {
      if (conflict) { response.statusCode = 409; return response.end(JSON.stringify({ error: "备注已被其他人更新，请刷新后重新编辑" })); }
      const note = JSON.parse(body); note.version++; notes = notes.filter(n => n.date !== note.date || n.lineId !== note.lineId).concat(note);
      return response.end(JSON.stringify(note));
    }
    if (url.pathname === "/api/schedule/overview") return response.end(JSON.stringify({
      lines: [{ lineId: 1, name: "A拉：手喷", craftType: "手喷", dailyLimit: 200000 }, { lineId: 2, name: "B拉：自动喷", craftType: "自动喷", dailyLimit: 300000 }],
      plans: [{ id: 1, date: today, lineId: 1, orderId: 1, productNo: "15780", partName: "番茄片", itemName: "", craft: "手喷", stepNo: 1, plannedQty: 18000, machineNos: [], workerCount: 1 }],
      lineNotes: notes.filter(n => n.date >= url.searchParams.get("from")! && n.date <= url.searchParams.get("to")!),
    }));
    if (url.pathname === "/api/recording/export") {
      exported = JSON.parse(body).date;
      response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return response.end("test-download");
    }
    return response.end(url.pathname === "/api/auth/session" ? "{}" : "[]");
  });
  await new Promise<void>(resolve => api.listen(15081, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>(resolve => api.close(() => resolve())); });
test.beforeEach(async ({ context }) => {
  notes = []; conflict = false; exported = "";
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
