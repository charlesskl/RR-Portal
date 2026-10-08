// 原料库存统计表 + 原料库存月报表 + 原料订货入库统计:对照老系统
// PlasticRawMaterialInventoryPage / MonthlyPage / OrderReceiptStatsPage。
// 库存统计:displayMode 口径(zero/stock/all,零库存勾选禁用只显示库存数)、负数红、底部合计。
// 月报:默认本月 起/止、本期出库红/入库绿、底部六项合计。
// 订货入库统计:默认近一月、金额 2 位小数、底部合计(订货/入库/相关)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticRawMaterialInventoryPage from "@/pages/PlasticRawMaterialInventoryPage";
import PlasticRawMaterialMonthlyPage from "@/pages/PlasticRawMaterialMonthlyPage";
import PlasticRawMaterialOrderReceiptStatsPage from "@/pages/PlasticRawMaterialOrderReceiptStatsPage";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => {
    const size = opts.estimateSize();
    return {
      getTotalSize: () => opts.count * size,
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, i) => ({ index: i, start: i * size, size, key: i })),
      measure: () => {},
    };
  },
}));

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS = [
  { 组: "原料报表", 菜单: "原料库存统计表", 打开: true },
  { 组: "原料报表", 菜单: "原料库存月报表", 打开: true },
  { 组: "原料报表", 菜单: "原料订货入库统计", 打开: true },
];

type Call = { url: string; method: string };

function installFetch(perms: unknown[] = PERMS) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/plastic-raw-material-master/categories")
        return json([{ 类别: "ABS", 数量: 2 }]);
      if (p === "/api/plastic-raw-material-inventory")
        return json([
          { 原料编号: "RM-1", 原料名称: "ABS 757", 产地: "台湾", 每包重量: 25, 单位: "KG", 库存数量: 350, 物料类别: "ABS", 有发生: true },
          { 原料编号: "RM-2", 原料名称: "PP 料", 产地: "国产", 每包重量: 25, 单位: "KG", 库存数量: -10, 物料类别: "PP", 有发生: true },
        ]);
      if (p === "/api/plastic-raw-material-monthly")
        return json([
          { 原料编号: "RM-1", 原料名称: "ABS 757", 产地: "台湾", 每包重量: 25, 单位: "KG", 期初库存: 400, 本期入库: 100, 本期出库: 150, 盘点盈亏: -2, 期末库存: 348, 外发库存: 20, 物料类别: "ABS" },
        ]);
      if (p === "/api/plastic-raw-material-order-receipt-stats")
        return json([
          { 订购日期: "2026-08-15", 交货日期: "2026-09-01", 订购单号: "RPO-1", 供应商名称: "台化", 原料编号: "RM-1", 原料名称: "ABS 757", 单位: "KG", 采购单价: 12.5, 单价HKDLb: 0.567, 其他成本单价HKDLb: 0.01, 订货数量包: 4, 订货金额HKD: 1250.5, 入库数量包: 2, 入库订货金额HKD: 625.25, 入库其他费用HKD: 10, 入库金额合计HKD: 635.25, 相关数量包: 1, 相关金额HKD: 300 },
        ]);
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

describe("PlasticRawMaterialInventoryPage(原料库存统计表)", () => {
  it("默认 displayMode=stock;库存负数红;底部合计", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialInventoryPage />, "/plastic-raw-material-inventory");
    await screen.findByText("RM-1");
    const hit = calls.find((c) => c.url.includes("/plastic-raw-material-inventory?"));
    expect(hit).toBeTruthy();
    expect(new URL(hit!.url, "http://test").searchParams.get("displayMode")).toBe("stock");
    expect(screen.getByText("-10").className).toContain("text-[#dc2626]");
    expect(screen.getByText(/合计:库存数量 340/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("物料类别"));
    expect(screen.getByRole("option", { name: "ABS(2)" })).toBeInTheDocument();
  });

  it("勾「零库存」:displayMode=zero 且「只显示库存数」禁用;取消两个勾:displayMode=all", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialInventoryPage />, "/plastic-raw-material-inventory");
    await screen.findByText("RM-1");
    const boxes = screen.getAllByRole("checkbox");
    // [只显示库存数, 零库存]
    fireEvent.click(boxes[1]);
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("displayMode=zero"))).toBe(true),
    );
    expect(boxes[0]).toBeDisabled();
    fireEvent.click(boxes[1]); // 取消零库存
    fireEvent.click(boxes[0]); // 取消只显示库存数
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("displayMode=all"))).toBe(true),
    );
  });
});

describe("PlasticRawMaterialMonthlyPage(原料库存月报表)", () => {
  it("默认本月 起/止;出库红/入库绿/盈亏负红;底部六项合计", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialMonthlyPage />, "/plastic-raw-material-monthly");
    await screen.findByText("RM-1");
    const hit = calls.find((c) => c.url.includes("/plastic-raw-material-monthly?"));
    const u = new URL(hit!.url, "http://test");
    expect(u.searchParams.get("起")).toMatch(/^\d{4}-\d{2}-01$/);
    expect(screen.getByText("100").className).toContain("text-[#15803d]"); // 本期入库绿
    expect(screen.getByText("150").className).toContain("text-[#dc2626]"); // 本期出库红
    expect(screen.getByText("-2").className).toContain("text-[#dc2626]"); // 盘点盈亏负红
    expect(
      screen.getByText(/期初 400 · 入库 100 · 出库 150 · 盈亏 -2 · 期末 348 · 外发 20/),
    ).toBeInTheDocument();
  });
});

describe("PlasticRawMaterialOrderReceiptStatsPage(原料订货入库统计)", () => {
  it("默认近一月区间;金额 2 位小数;底部合计(订货/入库/相关)", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialOrderReceiptStatsPage />, "/plastic-raw-material-order-receipt-stats");
    await screen.findByText("RPO-1");
    const hit = calls.find((c) => c.url.includes("/plastic-raw-material-order-receipt-stats?"));
    const u = new URL(hit!.url, "http://test");
    expect(u.searchParams.get("起")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByText("1250.50")).toBeInTheDocument();
    expect(screen.getByText("635.25")).toBeInTheDocument();
    expect(
      screen.getByText(/订货 4 包\/1250.50 · 入库 2 包\/635.25 · 相关 1 包\/300.00/),
    ).toBeInTheDocument();
    expect(screen.getByText("入库其他费用(HK$)")).toBeInTheDocument();
  });

  it("无「打开」权限:整页无权提示", async () => {
    installFetch([]);
    renderWithProviders(<PlasticRawMaterialOrderReceiptStatsPage />, "/plastic-raw-material-order-receipt-stats");
    await screen.findByText("无权访问该页面");
  });
});
