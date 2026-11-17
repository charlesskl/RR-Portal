import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { SignJWT } from "jose";

type Line = { matchedItemName: string; totalQty: number };
type Payload = { head: { productNo: string }; sourceFactoryId: string | null; targetFactoryId: string; lines?: Line[]; products?: { productNo: string; lines: Line[] }[] };
let api: Server, multi = false, fail = false, bodies: Payload[] = [], receipts: object[] = [];
const line = (name: string, qty: number) => ({ pdfItemName: name, totalQty: qty, mergedRows: 1, matchedItemName: name, unitPrice: 1, existingUnitCost: 1 });
test.beforeAll(async () => {
  api = createServer(async (request, response) => {
    let text = ""; for await (const chunk of request) text += chunk;
    response.setHeader("Content-Type", "application/json");
    const url = new URL(request.url!, "http://127.0.0.1:15081");
    const selected = request.headers.cookie?.includes("sprayplan_factory=HUADENG") ? "HUADENG" : "XINGXIN";
    if (url.pathname === "/api/orders/import-pdf") return response.end(JSON.stringify({
      head: { externalOrderNo: "CROSS", orderDate: "2026-11-17", deliveryDate: "2026-12-01", productNo: "11494", isMa: false },
      productFound: true, productId: 1, lines: multi ? [] : [line("头", 100), line("脚", 50)], pdfToken: "contract.pdf", availableItems: ["头", "脚"],
      sourceFactoryId: selected === "HUADENG" ? "XINGXIN" : "HUADENG", targetFactoryId: selected,
      products: multi ? [{ productNo: "11494", isMa: false, productFound: true, lines: [line("头", 100)], availableItems: ["头"] },
        { productNo: "995159", isMa: false, productFound: true, lines: [line("脚", 50)], availableItems: ["脚"] }] : undefined,
    }));
    if (url.pathname.startsWith("/api/orders/import-confirm")) {
      if (fail) { response.statusCode = 409; return response.end(JSON.stringify({ error: "当前厂区已切换，请重新上传核对后再导入" })); }
      const body = JSON.parse(text) as Payload; bodies.push(body);
      const parts = body.products?.flatMap(p => p.lines.map(l => ({ productNo: p.productNo, partName: l.matchedItemName, qty: l.totalQty })))
        ?? body.lines!.map(l => ({ productNo: body.head.productNo, partName: l.matchedItemName, qty: l.totalQty }));
      receipts.push({ id: receipts.length + 1, sourceFactoryId: body.sourceFactoryId, factoryId: selected, acceptedQty: parts.reduce((sum, p) => sum + p.qty, 0),
        pendingDetails: false, createdBy: "admin", createdAt: "2026-11-17T04:00:00Z", parts });
      return response.end(JSON.stringify({ id: 1 }));
    }
    if (url.pathname === "/api/orders/1") return response.end(JSON.stringify({
      id: 1, externalOrderNo: "CROSS", productId: 1, orderDate: "2026-11-17T00:00:00Z", deliveryDate: "2026-12-01T00:00:00Z", status: "draft", isMA: false, isUrgent: false, remark: null, createdBy: "admin", qtyEditable: true,
      product: { id: 1, productNo: "11494", parts: ["头", "脚"].map((name, i) => ({ id: i + 1, partName: name, craft: "移印", partGroupId: i + 1, unitCost: 1, laborPrice: 1, paintCost: 0, quotedPrice: 1, dailyCapacity: 1000 })) },
      partQtys: [{ id: 1, partName: "头", sourcePartId: 1, qty: 20, partOrder: 0 }], scheduleBalances: [], importReceipts: receipts,
    }));
    return response.end(url.pathname === "/api/auth/session" ? "{}" : "[]");
  });
  await new Promise<void>(resolve => api.listen(15081, "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>(resolve => api.close(() => resolve())); });
test.beforeEach(async ({ context }) => {
  multi = false; fail = false; bodies = []; receipts = [];
  const token = await new SignJWT({ userId: "1", username: "admin", factoryId: "ALL", "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "admin" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("order-parts-test").setExpirationTime("1h")
    .sign(new TextEncoder().encode("order-parts-test-only-key-32-characters-long"));
  await context.addCookies([{ name: "sprayplan_session", value: token, url: "http://127.0.0.1:18401" }]);
});
async function upload(page: import("@playwright/test").Page) {
  await page.goto("/orders/import");
  await page.locator('input[type="file"]').setInputFiles({ name: "华登合同.pdf", mimeType: "application/pdf", buffer: Buffer.from("fixture") });
  await page.getByRole("button", { name: /开始解析/ }).click();
  await expect(page.getByLabel("来源厂区", { exact: true })).toBeVisible();
}

test("华登合同在兴信核对承接部分数量，按兴信导入并在详情保留来源及明细", async ({ page }) => {
  await upload(page);
  await expect(page.getByText("导入厂区：兴信", { exact: false })).toBeVisible();
  await expect(page.getByLabel("来源厂区", { exact: true })).toHaveValue("HUADENG");
  await page.getByLabel("11494 头 本次承接数量").fill("30");
  await page.getByLabel("11494 脚 本次承接数量").fill("5");
  await expect(page.getByText("35 件", { exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "确认入库", exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);
  expect(bodies[0]).toMatchObject({ sourceFactoryId: "HUADENG", targetFactoryId: "XINGXIN", lines: [{ totalQty: 30 }, { totalQty: 5 }] });
  await page.goto("/orders/1");
  const history = page.getByRole("region", { name: "来源及承接记录" });
  await expect(history).toContainText("来源：华登 → 导入厂区：兴信");
  await expect(history).toContainText("本次承接 35 件");
  await history.locator("summary").click();
  await expect(history).toContainText("11494 · 头：30 件");
});

test("华登厂区可导入兴信来源的多款合同，来源可人工确认且数量按各款所选部位累计", async ({ page, context }) => {
  multi = true; await context.addCookies([{ name: "sprayplan_factory", value: "HUADENG", url: "http://127.0.0.1:18401" }]);
  await upload(page);
  await expect(page.getByText("导入厂区：华登", { exact: false })).toBeVisible();
  await expect(page.getByLabel("来源厂区", { exact: true })).toHaveValue("XINGXIN");
  await page.getByLabel("来源厂区", { exact: true }).selectOption("");
  await page.getByLabel("11494 头 本次承接数量").fill("20");
  await page.getByLabel("995159 脚 本次承接数量").fill("7");
  await expect(page.getByText("27 件", { exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "确认导入一张订单" }).click();
  await expect(page).toHaveURL(/\/orders$/);
  expect(bodies[0]).toMatchObject({ sourceFactoryId: null, targetFactoryId: "HUADENG", products: [{ productNo: "11494" }, { productNo: "995159" }] });
});

test("非法承接数量不发送，厂区切换冲突时保留数量和来源供重新核对", async ({ page }) => {
  await upload(page);
  await page.getByLabel("11494 头 本次承接数量").fill("-1");
  await page.getByRole("button", { name: "确认入库", exact: true }).click();
  await expect(page.getByText("本次承接数量必须为", { exact: false })).toBeVisible(); expect(bodies).toHaveLength(0);
  await page.getByLabel("11494 头 本次承接数量").fill("20"); fail = true;
  await page.getByRole("button", { name: "确认入库", exact: true }).click();
  await expect(page.getByText("当前厂区已切换，请重新上传核对后再导入", { exact: true })).toBeVisible();
  await expect(page.getByLabel("11494 头 本次承接数量")).toHaveValue("20");
  await expect(page.getByLabel("来源厂区", { exact: true })).toHaveValue("HUADENG");
});
