// BOM订单制作页:对照老系统 MaterialOrderMakePage 场景。
// 重点:工作表加载(订货数量默认=需订数量)、勾选、按 生产单x供应商编号 分组逐张 POST、
// 缺供应商编号行跳过并提示、无「采购订单·保存」位时按钮禁用、价格列按「采购订单·单价」位裁剪。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import MaterialOrderMakePage from "@/pages/MaterialOrderMakePage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [
  { 组: "业务单据", 菜单: "生产制单", 打开: true, 保存: true, 单价: true },
  { 组: "物料管理", 菜单: "采购订单", 打开: true, 保存: true, 单价: true },
];
const PERMS_NO_PO_SAVE = [
  { 组: "业务单据", 菜单: "生产制单", 打开: true, 保存: true, 单价: true },
  { 组: "物料管理", 菜单: "采购订单", 打开: true, 保存: false, 单价: true },
];

const SHEET = [
  { 生产单号: "MO1", 款号: "K1", 物料编号: "M1", 物料名称: "彩盒", 规格: "大", 颜色: "红", 单位: "PCS", 总数量: 100, 库存数量: 20, 可用库存: 20, 需订数量: 80, 预算单价: 1.5, 供应商编号: "S1", 供应商名称: "供应商甲" },
  { 生产单号: "MO1", 款号: "K1", 物料编号: "M2", 物料名称: "说明书", 规格: "", 颜色: "", 单位: "PCS", 总数量: 100, 库存数量: 0, 可用库存: 0, 需订数量: 100, 预算单价: 0.5, 供应商编号: "S2", 供应商名称: "供应商乙" },
  { 生产单号: "MO2", 款号: "K2", 物料编号: "M3", 物料名称: "胶袋", 规格: "", 颜色: "", 单位: "PCS", 总数量: 50, 库存数量: 0, 可用库存: 0, 需订数量: 50, 预算单价: 0.2, 供应商编号: "", 供应商名称: "" },
];

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/production-reports/order-worksheet") return json(SHEET);
      if (p === "/api/purchase-orders" && init?.method === "POST")
        return json({ 单号: `PO-${calls.filter((c) => c.method === "POST").length}` });
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MaterialOrderMakePage", () => {
  it("工作表加载:订货数量默认=需订数量;未勾选时生成按钮禁用", async () => {
    installFetch();
    renderWithProviders(<MaterialOrderMakePage />, "/material-order-make");
    await screen.findByText("彩盒");
    expect(screen.getByLabelText("订货数量 M1")).toHaveValue(80);
    expect(screen.getByLabelText("订货数量 M2")).toHaveValue(100);
    expect(screen.getByText("共 3 条")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成采购订单" })).toBeDisabled();
    expect(screen.getByText("已选 0 行")).toBeInTheDocument();
  });

  it("勾选两行不同供应商 -> 确认弹窗文案 -> 按 生产单x供应商 分 2 组逐张 POST(数量取手改订货数量)", async () => {
    const calls = installFetch();
    renderWithProviders(<MaterialOrderMakePage />, "/material-order-make");
    await screen.findByText("彩盒");
    // 手改 M1 订货数量
    fireEvent.change(screen.getByLabelText("订货数量 M1"), { target: { value: "88" } });
    fireEvent.click(screen.getByLabelText("选择 M1"));
    fireEvent.click(screen.getByLabelText("选择 M2"));
    expect(screen.getByText("已选 2 行")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "生成采购订单" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("将按生产单×供应商分组生成 2 张采购订单（共 2 行物料）。确认生成？");
    fireEvent.click(within(dlg).getByRole("button", { name: "生成" }));

    await waitFor(() =>
      expect(calls.filter((c) => c.url === "/api/purchase-orders" && c.method === "POST")).toHaveLength(2),
    );
    const posts = calls
      .filter((c) => c.url === "/api/purchase-orders" && c.method === "POST")
      .map((c) => JSON.parse(c.body!));
    // 组1:MO1+S1(订货数量手改 88,预算数量=需订 80);组2:MO1+S2
    const g1 = posts.find((b) => b.供应商编号 === "S1")!;
    expect(g1.生产单号).toBe("MO1");
    expect(g1.明细[0]).toMatchObject({ 物料编号: "M1", 数量: 88, 单价: 1.5, 预算数量: 80 });
    const g2 = posts.find((b) => b.供应商编号 === "S2")!;
    expect(g2.明细[0]).toMatchObject({ 物料编号: "M2", 数量: 100 });
    await screen.findByText(/已生成 2 张采购订单：/);
  });

  it("勾选行均缺供应商编号 -> 拦截不发请求(文案逐字)", async () => {
    const calls = installFetch();
    renderWithProviders(<MaterialOrderMakePage />, "/material-order-make");
    await screen.findByText("胶袋");
    fireEvent.click(screen.getByLabelText("选择 M3"));
    fireEvent.click(screen.getByRole("button", { name: "生成采购订单" }));
    await screen.findByText("勾选的物料行均缺少供应商编号，无法生成采购订单");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("勾选含缺供应商行 -> 确认文案带跳过提示", async () => {
    installFetch();
    renderWithProviders(<MaterialOrderMakePage />, "/material-order-make");
    await screen.findByText("胶袋");
    fireEvent.click(screen.getByLabelText("选择 M1"));
    fireEvent.click(screen.getByLabelText("选择 M3"));
    fireEvent.click(screen.getByRole("button", { name: "生成采购订单" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("生成 1 张采购订单（共 1 行物料，另有 1 行缺供应商编号将跳过）");
  });

  it("无「采购订单·保存」位:生成按钮始终禁用", async () => {
    installFetch(PERMS_NO_PO_SAVE);
    renderWithProviders(<MaterialOrderMakePage />, "/material-order-make");
    await screen.findByText("彩盒");
    fireEvent.click(screen.getByLabelText("选择 M1"));
    expect(screen.getByRole("button", { name: "生成采购订单" })).toBeDisabled();
  });
});
