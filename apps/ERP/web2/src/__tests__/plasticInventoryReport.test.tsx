// 塑胶库存统计表/塑胶库存月报表页:对照老系统 PlasticInventoryPage + PlasticMonthlyReportPage。
// 场景:类别树点击带 物料类别 参数、库存负数红/已加工徽章、价格列按「单价」位显隐、合计;
// 月报:月份参数(YYYY-MM-01)、上/下月跳转、合计行、关键字「查询」触发、无权访问。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticInventoryPage from "@/pages/PlasticInventoryPage";
import PlasticMonthlyReportPage from "@/pages/PlasticMonthlyReportPage";

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

const CATS = [
  { 类别: "胶件", 数量: 3 },
  { 类别: "水口料", 数量: 1 },
];

const STOCK = [
  { 物料编号: "P-001", 工模编号: "MJ-1", 物料名称: "胶壳", 规格: "S", 颜色: "黑", 物料类别: "胶件", 塑胶货号: "PH-1", 已加工工序: "喷油", 仓位号: "A1", 单位: "个", 仓库: "塑胶仓", 库存数量: -5, 单价: 1.5, 金额: -7.5 },
  { 物料编号: "P-002", 物料名称: "胶盖", 物料类别: "胶件", 单位: "个", 仓库: "塑胶仓", 库存数量: 100, 单价: 2, 金额: 200 },
];

const MONTHLY = [
  { 物料编号: "P-001", 物料名称: "胶壳", 规格: "S", 颜色: "黑", 物料类别: "胶件", 单位: "个", 期初数量: 10, 本期入库: 20, 本期出库: 5, 期末数量: 25 },
  { 物料编号: "P-002", 物料名称: "胶盖", 物料类别: "胶件", 单位: "个", 期初数量: 0, 本期入库: 100, 本期出库: 0, 期末数量: 100 },
];

type Call = { url: string; method: string };

function installFetch(perms: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/plastic-material-master/categories") return json(CATS);
      if (p === "/api/plastic-inventory") return json(STOCK);
      if (p === "/api/plastic-monthly-report") return json(MONTHLY);
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

const PERMS_INV = [{ 组: "塑胶报表", 菜单: "塑胶库存", 打开: true, 单价: true }];
const PERMS_INV_NOPRICE = [{ 组: "塑胶报表", 菜单: "塑胶库存", 打开: true }];

describe("PlasticInventoryPage", () => {
  it("类别树渲染(全部物料+类别(数量));点类别带 物料类别 参数", async () => {
    const calls = installFetch(PERMS_INV);
    renderWithProviders(<PlasticInventoryPage />, "/plastic-inventory");
    await screen.findByText("P-001");
    expect(screen.getByText("全部物料")).toBeInTheDocument();
    expect(screen.getAllByText("胶件").length).toBeGreaterThan(0); // 树 + 表格行
    expect(screen.getByText("(3)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("水口料"));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("plastic-inventory") && c.url.includes("%E6%B0%B4%E5%8F%A3%E6%96%99"))).toBe(true),
    );
  });

  it("行渲染:负数库存红、已加工徽章、单价/金额列(有「单价」位)+ 底部合计", async () => {
    installFetch(PERMS_INV);
    renderWithProviders(<PlasticInventoryPage />, "/plastic-inventory");
    await screen.findByText("P-001");
    expect(screen.getByText("-5").className).toContain("text-[#dc2626]");
    expect(screen.getByText("已加工:喷油")).toBeInTheDocument();
    expect(screen.getByText("金额")).toBeInTheDocument();
    expect(screen.getByText("200.00")).toBeInTheDocument();
    expect(screen.getByText(/库存数量 95/)).toBeInTheDocument();
    expect(screen.getByText(/金额 192.50/)).toBeInTheDocument();
  });

  it("无「单价」位:不出 单价/金额 列与金额合计", async () => {
    installFetch(PERMS_INV_NOPRICE);
    renderWithProviders(<PlasticInventoryPage />, "/plastic-inventory");
    await screen.findByText("P-001");
    expect(screen.queryByText("金额")).not.toBeInTheDocument();
    expect(screen.queryByText("单价")).not.toBeInTheDocument();
  });

  it("无「打开」权限:整页无权提示", async () => {
    installFetch([]);
    renderWithProviders(<PlasticInventoryPage />, "/plastic-inventory");
    await screen.findByText("无权访问该页面");
  });
});

const PERMS_MONTH = [{ 组: "塑胶报表", 菜单: "塑胶库存月报表", 打开: true }];

describe("PlasticMonthlyReportPage", () => {
  it("按当前月(YYYY-MM-01)取数;行渲染+合计行", async () => {
    const calls = installFetch(PERMS_MONTH);
    renderWithProviders(<PlasticMonthlyReportPage />, "/plastic-monthly-report");
    await screen.findByText("P-001");
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    expect(calls.some((c) => c.url.includes(`plastic-monthly-report`) && c.url.includes(encodeURIComponent(ym)))).toBe(true);
    // 合计:期初 10 / 入库 120 / 出库 5 / 期末 125
    expect(screen.getByText(/合计:期初 10 · 入库 120 · 出库 5 · 期末 125/)).toBeInTheDocument();
  });

  it("入库绿/出库红/期末粗;上月跳转改月份参数;关键字由「查询」触发", async () => {
    const calls = installFetch(PERMS_MONTH);
    renderWithProviders(<PlasticMonthlyReportPage />, "/plastic-monthly-report");
    await screen.findByText("P-001");
    const inCell = screen.getAllByText("20")[0];
    expect(inCell.className).toContain("text-[#15803d]");
    // 上月
    fireEvent.click(screen.getByRole("button", { name: "上月" }));
    const prev = new Date();
    prev.setMonth(prev.getMonth() - 1);
    const pYm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-01`;
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes(encodeURIComponent(pYm)))).toBe(true),
    );
    // 关键字:输入后不发,点查询才发
    const beforeKw = calls.filter((c) => c.url.includes("keyword=")).length;
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "胶壳" } });
    expect(calls.filter((c) => c.url.includes("keyword=")).length).toBe(beforeKw);
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("keyword=%E8%83%B6%E5%A3%B3"))).toBe(true),
    );
  });

  it("无「打开」权限:整页无权提示", async () => {
    installFetch([]);
    renderWithProviders(<PlasticMonthlyReportPage />, "/plastic-monthly-report");
    await screen.findByText("无权访问该页面");
  });
});
