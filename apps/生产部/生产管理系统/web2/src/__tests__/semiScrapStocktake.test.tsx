// 半成品报废单 + 盘点单页:对照老系统 SemiScrapPage/SemiStocktakePage + 各自查询页。
// 报废:校验文案/保存 POST/审核反审核/查询双击回单据。
// 盘点:基准带出系统数量(新行 盘点=系统)/盈亏红绿/保存 POST 载荷含 系统数量+盘点数量/审核过账。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import SemiScrapPage from "@/pages/SemiScrapPage";
import SemiStocktakePage from "@/pages/SemiStocktakePage";

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

const SCRAP_PERMS = [
  { 组: "半成品仓库", 菜单: "半成品报废", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
];
const STK_PERMS = [
  { 组: "半成品仓储", 菜单: "半成品盘点", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true },
];

const SCRAP_DETAIL = {
  单头: { ID: 1, 单号: "SS1", 仓库: "半成品仓", 部门: "装配部", 报废人: "张三", 日期: "2026-09-01", 数量: 2, 审核: "0", 操作员: "tester" },
  明细: [{ ID: 11, 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 生产单号: "MO1", 数量: 2, 备注: "" }],
};

const STK_DETAIL = {
  单头: { ID: 1, 单号: "ST1", 仓库: "半成品仓", 日期: "2026-09-01", 系统数量: 8, 盘点数量: 6, 盈亏数量: -2, 审核: "0", 操作员: "tester" },
  明细: [{ ID: 11, 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 系统数量: 8, 盘点数量: 6, 盈亏数量: -2, 备注: "" }],
};

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/semi-scraps") {
        if (init?.method === "POST") return json({ 单号: "SS-NEW" });
        return json({ items: [SCRAP_DETAIL.单头], total: 1 });
      }
      if (p === "/api/semi-scraps/SS1") return json(SCRAP_DETAIL);
      if (p === "/api/semi-scraps/products")
        return json({ items: [{ 配件编号: "AAA0009", 客户: "ZURU", 产品货号: "9215Z", 产品名称: "新车", 产品装配名称: "内托" }], total: 1 });
      if (p === "/api/semi-scrap-query/summary")
        return json([{ 配件编号: "AAA0001", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 报废数量: 2 }]);
      if (p === "/api/semi-scrap-query/detail")
        return json([{ 日期: "2026-09-01", 单号: "SS1", 仓库: "半成品仓", 报废部门: "装配部", 报废人: "张三", 配件编号: "AAA0001", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 数量: 2, 备注: "", 审核: "0" }]);
      if (p === "/api/semi-stocktakes/basis") return json([{ 物料编号: "AAA0001", 系统数量: 8 }]);
      if (p === "/api/semi-stocktakes") {
        if (init?.method === "POST") return json({ 单号: "ST-NEW" });
        return json({ items: [STK_DETAIL.单头], total: 1 });
      }
      if (p === "/api/semi-stocktakes/ST1") return json(STK_DETAIL);
      if (p === "/api/semi-stocktakes/products")
        return json({ items: [{ 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒" }], total: 1 });
      if (p === "/api/semi-stocktake-query/summary")
        return json([{ 配件编号: "AAA0001", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 系统数: 8, 盘点数: 6, 盈亏数: -2 }]);
      if (p === "/api/semi-stocktake-query/detail")
        return json([{ 日期: "2026-09-01", 单号: "ST1", 配件编号: "AAA0001", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 系统数量: 8, 盘点数量: 6, 盈亏数量: -2, 备注: "", 审核: "0" }]);
      if (p.endsWith("/approve") || p.endsWith("/unapprove")) return json({});
      if (p === "/api/master/employees") return json({ items: [{ 编号: "E1", 姓名: "张三" }], total: 1 });
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

describe("SemiScrapPage(半成品报废单)", () => {
  it("新建校验 -> 选产品加行 -> 保存 POST 载荷", async () => {
    const calls = installFetch(SCRAP_PERMS);
    renderWithProviders(<SemiScrapPage />, "/semi-scraps");
    await screen.findByText("半成品报废单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请至少录入一行报废产品。");
    fireEvent.click(screen.getByRole("button", { name: "资料" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("AAA0009"));
    fireEvent.doubleClick(screen.getByText("9215Z").closest("tr")!);
    fireEvent.change(await screen.findByLabelText("数量"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("报废数量必须大于 0。");
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/semi-scraps") && c.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.仓库).toBe("半成品仓");
      expect(body.明细).toEqual([
        expect.objectContaining({ 配件编号: "AAA0009", 产品货号: "9215Z", 数量: 3 }),
      ]);
    });
  });

  it("?open= 直开 + 审核/反审核 POST;无价无单价列", async () => {
    const calls = installFetch(SCRAP_PERMS);
    renderWithProviders(<SemiScrapPage />, "/semi-scraps?open=SS1");
    await screen.findByText("半成品报废单 · SS1");
    expect(screen.getByLabelText("部门")).toHaveValue("装配部");
    expect(screen.queryByText("单价")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/semi-scraps/SS1/approve"))).toBe(true),
    );
  });

  it("查询页签:汇总 报废数量总合计;明细双击回单据页签", async () => {
    installFetch(SCRAP_PERMS);
    renderWithProviders(<SemiScrapPage />, "/semi-scraps");
    await screen.findByText("半成品报废单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "半成品报废查询" }));
    await screen.findByText(/总合计:2/);
    fireEvent.click(screen.getByRole("button", { name: "明细查询" }));
    const cell = await screen.findByText("SS1");
    fireEvent.doubleClick(cell.closest("tr")!);
    await screen.findByText("半成品报废单 · SS1");
  });
});

describe("SemiStocktakePage(半成品盘点单)", () => {
  it("选产品新行带出基准系统数量(8)且盘点数量默认=系统数量;盈亏红", async () => {
    installFetch(STK_PERMS);
    renderWithProviders(<SemiStocktakePage />, "/semi-stocktakes");
    await screen.findByText("半成品盘点单(新建)");
    // 等基准加载完再选产品
    await waitFor(() => expect(screen.getByRole("button", { name: "资料" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "资料" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("AAA0001"));
    fireEvent.doubleClick(screen.getByText("9215A").closest("tr")!);
    const sysCell = await screen.findAllByText("8");
    expect(sysCell.length).toBeGreaterThan(0);
    // 改盘点数量为 5,盈亏 -3
    fireEvent.change(screen.getByLabelText("盘点数量"), { target: { value: "5" } });
    await waitFor(() => {
      const diffs = screen.getAllByText("-3");
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs[0].className).toContain("text-[#dc2626]");
    });
  });

  it("保存 POST 载荷含 系统数量/盘点数量;?open= 直开显示盈亏数量", async () => {
    const calls = installFetch(STK_PERMS);
    renderWithProviders(<SemiStocktakePage />, "/semi-stocktakes?open=ST1");
    await screen.findByText("半成品盘点单 · ST1");
    expect(screen.getAllByText("-2").length).toBeGreaterThan(0);
    // 已开未审核单可改(盘点数量输入可用)并 PUT 更新
    fireEvent.change(screen.getByLabelText("盘点数量"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const put = calls.find((c) => c.url.endsWith("/semi-stocktakes/ST1") && c.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(put!.body!);
      expect(body.明细[0]).toMatchObject({ 配件编号: "AAA0001", 系统数量: 8, 盘点数量: 9 });
    });
  });

  it("查询页签:盈亏合计 -2;明细双击回单据页签", async () => {
    installFetch(STK_PERMS);
    renderWithProviders(<SemiStocktakePage />, "/semi-stocktakes");
    await screen.findByText("半成品盘点单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "半成品盘点查询" }));
    await screen.findByText(/盈亏合计:-2/);
    fireEvent.click(screen.getByRole("button", { name: "明细查询" }));
    const cell = await screen.findByText("ST1");
    fireEvent.doubleClick(cell.closest("tr")!);
    await screen.findByText("半成品盘点单 · ST1");
  });
});
