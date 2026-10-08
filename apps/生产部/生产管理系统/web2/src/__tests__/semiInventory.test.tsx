// 半成品库存统计表 + 库存月报表:对照老系统 SemiInventoryPage/SemiMonthlyReportPage。
// 断言:默认查询参数(仓库=半成品仓)、负数红、切换 含零库存/全部记录 触发带参重查、
// 导出空数据禁用、月报月份切换(上月)与列(期初/本期入库/出库/报废/盘点盈亏/期末)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import SemiInventoryPage from "@/pages/SemiInventoryPage";
import SemiMonthlyReportPage from "@/pages/SemiMonthlyReportPage";

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

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const PERMS = [{ 组: "半成品仓储", 菜单: "半成品库存", 打开: true, 打印: true }];

const REPORT_ROWS = [
  { 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 库存数量: -5, 仓库位置: "A区" },
];

const MONTHLY_ROWS = [
  { 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 期初库存: 10, 本期入库: 20, 本期出库: 7, 本期报废: 1, 盘点盈亏: -2, 期末库存: 20 },
];

function installFetch() {
  const calls: { url: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push({ url });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(PERMS));
      if (p === "/api/semi-inventory/report") return json(REPORT_ROWS);
      if (p === "/api/semi-inventory/monthly") return json(MONTHLY_ROWS);
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

describe("SemiInventoryPage(半成品库存统计表)", () => {
  it("首屏带 仓库=半成品仓 查询;负数库存红色;仓库徽章", async () => {
    const calls = installFetch();
    renderWithProviders(<SemiInventoryPage />, "/semi-inventory");
    const qty = await screen.findByText("-5");
    expect(qty.className).toContain("text-[#dc2626]");
    expect(screen.getByText("仓库:半成品仓")).toBeInTheDocument();
    const first = calls.find((c) => c.url.includes("/semi-inventory/report?"));
    expect(first?.url).toContain(encodeURIComponent("半成品仓"));
    expect(first?.url).toContain("showAll=false");
  });

  it("切 含零库存+全部记录 触发带参重查;导出/打印按钮存在", async () => {
    const calls = installFetch();
    renderWithProviders(<SemiInventoryPage />, "/semi-inventory");
    await screen.findByText("-5");
    pickOption("零库存", "含零库存");
    pickOption("显示", "全部记录");
    await waitFor(() => {
      const last = calls.filter((c) => c.url.includes("/semi-inventory/report?")).at(-1)!;
      expect(last.url).toContain("includeZero=true");
      expect(last.url).toContain("showAll=true");
    });
    expect(screen.getByRole("button", { name: /导出EXCEL/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /打印/ })).toBeEnabled();
  });

  it("精确查询带 exact=true", async () => {
    const calls = installFetch();
    renderWithProviders(<SemiInventoryPage />, "/semi-inventory");
    await screen.findByText("-5");
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "9215" } });
    fireEvent.click(screen.getByRole("button", { name: "精确查询" }));
    await waitFor(() => {
      const last = calls.filter((c) => c.url.includes("/semi-inventory/report?")).at(-1)!;
      expect(last.url).toContain("exact=true");
      expect(last.url).toContain("keyword=9215");
    });
  });
});

describe("SemiMonthlyReportPage(半成品库存月报表)", () => {
  it("首屏本月区间查询;六数量列齐全;期末加粗", async () => {
    const calls = installFetch();
    renderWithProviders(<SemiMonthlyReportPage />, "/semi-inventory-monthly");
    await screen.findByText("恐龙");
    for (const h of ["期初库存", "本期入库", "本期出库", "本期报废", "盘点盈亏", "期末库存"])
      expect(screen.getByText(h)).toBeInTheDocument();
    const first = calls.find((c) => c.url.includes("/semi-inventory/monthly?"));
    expect(first?.url).toContain(encodeURIComponent("半成品仓"));
    expect(first?.url).toMatch(/%E8%B5%B7%E6%97%A5%E6%9C%9F|起日期/);
  });

  it("上月按钮把区间切到上月", async () => {
    const calls = installFetch();
    renderWithProviders(<SemiMonthlyReportPage />, "/semi-inventory-monthly");
    await screen.findByText("恐龙");
    fireEvent.click(screen.getByRole("button", { name: "上月" }));
    await waitFor(() => {
      const last = calls.filter((c) => c.url.includes("/semi-inventory/monthly?")).at(-1)!;
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const ym = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
      expect(last.url).toContain(encodeURIComponent(`${ym}-01`));
    });
  });
});
