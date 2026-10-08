// 原料出库表 + 原料盘点单(单据+查询双页签):对照老系统
// PlasticRawMaterialStockIssuePage/StockIssueQueryPage + StocktakePage/StocktakeQueryPage。
// 出库:制单人必填、调入清单(已审核需求表 -> 明细数量=需求数量包,回填 生产车间/领料备注)、
// 三级审核链、保存 POST;查询:默认汇总、额外筛选 领料备注/制单人 下发参数、明细双击弹单据详情。
// 盘点:选原料带出系统数量(=库存)、盈亏=盘点-系统(负红)、保存 POST 载荷含 盈亏数量、
// 审核提示「已审核·库存已校准」;查询:默认汇总 系统数/盘点数/盈亏数,明细双击弹详情。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticRawMaterialStockIssuePage from "@/pages/PlasticRawMaterialStockIssuePage";
import PlasticRawMaterialStocktakePage from "@/pages/PlasticRawMaterialStocktakePage";

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

const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const PERMS = [
  { 组: "原料仓库", 菜单: "原料出库表", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true },
  { 组: "原料报表", 菜单: "原料出库查询", 打开: true },
  { 组: "原料仓库", 菜单: "原料盘点单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true },
  { 组: "原料报表", 菜单: "原料盘点查询", 打开: true },
];

const SI_HEADER = {
  id: 1,
  单号: "RI-1",
  生产车间: "一车间",
  日期: "2026-09-06",
  电脑单号: "",
  领料备注: "生产领料",
  制单人: "张三",
  操作员: "tester",
  数量: 2,
  审核: "0",
  主管审核: "0",
  经理审核: "0",
};
const SI_DETAIL = {
  单头: SI_HEADER,
  明细: [
    { id: 11, 啤机生产单号: "PJ-100", 开单日期: "2026-09-01", 啤机外发单号: "", 原料编号: "RM-1", 原料名称: "ABS 757", 产地: "台湾", 每包重量: 25, 单位: "KG", 数量: 2, 备注: "" },
  ],
};
const DEMANDS = [
  { id: 1, 单号: "D-001", 啤机生产单号: "PJ-100", 生产车间: "一车间", 领料备注: "生产领料", 数量KG: 50, 审核: "1" },
  { id: 2, 单号: "D-002", 啤机生产单号: "PJ-101", 生产车间: "二车间", 数量KG: 10, 审核: "0" },
];

const ST_HEADER = { id: 1, 单号: "RT-1", 日期: "2026-09-08", 电脑单号: "", 操作员: "tester", 审核: "0", 备注: "月盘" };
const ST_DETAIL = {
  单头: ST_HEADER,
  明细: [
    { id: 11, 原料编号: "RM-1", 原料名称: "ABS 757", 产地: "台湾", 每包重量: 25, 单位: "KG", 系统数量: 8, 盘点数量: 6, 盈亏数量: -2, 备注: "" },
  ],
};

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown[] = PERMS) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/plastic-raw-material-master/categories")
        return json([{ 类别: "ABS", 数量: 2 }]);
      if (p === "/api/plastic-raw-material-master")
        return json({
          items: [{ ID: 7, 物料编号: "RM-1", 物料名称: "ABS 757", 产地: "台湾", 每包重量: 25, 单位: "KG", 库存: 8 }],
          total: 1,
        });
      if (p === "/api/plastic-raw-material-stock-issue") {
        if (init?.method === "POST") return json({ 单号: "RI-NEW" });
        return json({ items: [SI_HEADER], total: 1 });
      }
      if (p === "/api/plastic-raw-material-stock-issue/RI-1") return json(SI_DETAIL);
      if (p === "/api/plastic-raw-material-demand") return json({ items: DEMANDS, total: 2 });
      if (p === "/api/plastic-raw-material-demand/D-001")
        return json({
          单头: DEMANDS[0],
          明细: [
            { id: 21, 原料编号: "RM-1", 原料名称: "ABS 757", 每包重量: 25, 单位: "KG", 需求数量KG: 50, 需求数量包: 2 },
          ],
        });
      if (p === "/api/plastic-raw-material-stock-issue-query/summary")
        return json([
          { 领料备注: "生产领料", 开单日期: "2026-09-01", 啤机生产单号: "PJ-100", 啤机外发单号: "", 原料编号: "RM-1", 原料名称: "ABS 757", 产地: "台湾", 单位: "KG", 领料数量包: 2, 备注: "" },
        ]);
      if (p === "/api/plastic-raw-material-stock-issue-query/detail")
        return json([
          { 领料备注: "生产领料", 开单日期: "2026-09-01", 啤机生产单号: "PJ-100", 日期: "2026-09-06", 审核日期: "", 单号: "RI-1", 生产车间: "一车间", 啤机外发单号: "", 原料编号: "RM-1", 原料名称: "ABS 757", 产地: "台湾", 单位: "KG", 数量包: 2, 备注: "", 制单人: "张三", 审核: "0" },
        ]);
      if (p === "/api/plastic-raw-material-stocktake") {
        if (init?.method === "POST") return json({ 单号: "RT-NEW" });
        return json({ items: [ST_HEADER], total: 1 });
      }
      if (p === "/api/plastic-raw-material-stocktake/RT-1") return json(ST_DETAIL);
      if (p === "/api/plastic-raw-material-stocktake-query/summary")
        return json([{ 原料编号: "RM-1", 原料名称: "ABS 757", 产地: "台湾", 单位: "KG", 系统数: 8, 盘点数: 6, 盈亏数: -2 }]);
      if (p === "/api/plastic-raw-material-stocktake-query/detail")
        return json([
          { 日期: "2026-09-08", 单号: "RT-1", 原料编号: "RM-1", 原料名称: "ABS 757", 产地: "台湾", 单位: "KG", 系统数量: 8, 盘点数量: 6, 盈亏数量: -2, 备注: "", 审核: "0" },
        ]);
      if (p === "/api/production-reports/tracking")
        return json([
          { 生产单号: "SC-1001", 款号: "K-1", 款式: "玩具车", 客户名称: "客户A", 计划数量: 100, 交货日期: "2026-10-01" },
        ]);
      if (p.endsWith("/approve") || p.endsWith("/unapprove") || p.endsWith("/supervisor-approve") || p.endsWith("/manager-approve"))
        return json({});
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

describe("PlasticRawMaterialStockIssuePage(原料出库表)", () => {
  it("调入清单:只列已审核需求表,点单号带入明细(数量=需求数量包)并回填 生产车间/领料备注;保存 POST", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialStockIssuePage />, "/plastic-raw-material-stock-issue");
    await screen.findByText("原料出库表(新建)");
    fireEvent.click(screen.getByRole("button", { name: "调入清单" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("D-001"));
    expect(dlg).not.toHaveTextContent("D-002"); // 未审核不列
    fireEvent.click(screen.getByText("D-001").closest("tr")!);
    await screen.findByText("已调入需求表 D-001 的 1 行明细");
    expect(screen.getByLabelText("生产车间")).toHaveValue("一车间");
    expect(screen.getByLabelText("领料备注")).toHaveTextContent("生产领料");
    expect(screen.getByLabelText("原料编号")).toHaveValue("RM-1");
    expect(screen.getByLabelText("数量")).toHaveValue(2);
    expect(screen.getByLabelText("啤机生产单号")).toHaveValue("PJ-100");
    // 制单人必填
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选制单人");
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    const empDlg = await screen.findByRole("dialog");
    await waitFor(() => expect(empDlg).toHaveTextContent("张三"));
    fireEvent.click(screen.getByText("张三").closest("tr")!);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url.endsWith("/plastic-raw-material-stock-issue") && c.method === "POST",
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.制单人).toBe("张三");
      expect(body.明细).toEqual([
        expect.objectContaining({ 原料编号: "RM-1", 数量: 2, 啤机生产单号: "PJ-100" }),
      ]);
    });
  });

  it("明细行联动生产单:点「选」从已审核生产制单选入,保存载荷含 生产单号", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialStockIssuePage />, "/plastic-raw-material-stock-issue");
    await screen.findByText("原料出库表(新建)");
    // 加一行 → 点「选」弹生产制单选择 → 点行回填 生产单号
    fireEvent.click(screen.getByRole("button", { name: "加一行" }));
    fireEvent.click(screen.getByRole("button", { name: "选生产单" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("SC-1001"));
    fireEvent.click(screen.getByText("SC-1001").closest("tr")!);
    expect(screen.getByLabelText("生产单号")).toHaveValue("SC-1001");
    // 手输也行(不与选择器互斥)
    fireEvent.change(screen.getByLabelText("原料编号"), { target: { value: "RM-1" } });
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "1" } });
    // 制单人 → 保存 → 载荷带 生产单号
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    const empDlg = await screen.findByRole("dialog");
    await waitFor(() => expect(empDlg).toHaveTextContent("张三"));
    fireEvent.click(screen.getByText("张三").closest("tr")!);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url.endsWith("/plastic-raw-material-stock-issue") && c.method === "POST",
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.明细).toEqual([
        expect.objectContaining({ 原料编号: "RM-1", 数量: 1, 生产单号: "SC-1001" }),
      ]);
    });
  });

  it("三级审核链 + 查询页签:默认汇总,领料备注/制单人 下发参数,明细双击弹单据详情", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialStockIssuePage />, "/plastic-raw-material-stock-issue?open=RI-1");
    await screen.findByText("原料出库表 · RI-1");
    expect(screen.getByRole("button", { name: "主管审核" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "审核(下发)" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "主管审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/RI-1/supervisor-approve"))).toBe(true),
    );
    // 查询页签
    fireEvent.click(screen.getByRole("button", { name: "原料出库查询" }));
    await screen.findByText("领料数量(包)");
    pickOption("领料备注", "样品领料");
    fireEvent.change(screen.getByLabelText("制单人"), { target: { value: "张三" } });
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.includes("stock-issue-query/summary?") &&
            decodeURIComponent(c.url).includes("领料备注=样品领料") &&
            decodeURIComponent(c.url).includes("制单人=张三"),
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "明细查询" }));
    const cell = await screen.findByText("RI-1");
    fireEvent.doubleClick(cell.closest("tr")!);
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("原料出库单 RI-1"));
    expect(dlg).toHaveTextContent("一车间");
  });
});

describe("PlasticRawMaterialStocktakePage(原料盘点单)", () => {
  it("选原料带出系统数量(=库存8);改盘点数量 6,盈亏 -2 红;保存 POST 载荷含 盈亏数量", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialStocktakePage />, "/plastic-raw-material-stocktake");
    await screen.findByText("原料盘点单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "加一行" }));
    fireEvent.click(screen.getByRole("button", { name: "选原料" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("RM-1"));
    fireEvent.click(screen.getByText("ABS 757").closest("tr")!);
    await waitFor(() => expect(screen.getByLabelText("原料编号")).toHaveValue("RM-1"));
    // 系统数量带出 8
    expect(screen.getByText("系统数量合计:")).toHaveTextContent("8");
    fireEvent.change(screen.getByLabelText("盘点数量"), { target: { value: "6" } });
    await waitFor(() => {
      const diffs = screen.getAllByText("-2");
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs[0].className).toContain("text-[#dc2626]");
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url.endsWith("/plastic-raw-material-stocktake") && c.method === "POST",
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.明细).toEqual([
        expect.objectContaining({ 原料编号: "RM-1", 系统数量: 8, 盘点数量: 6, 盈亏数量: -2 }),
      ]);
    });
  });

  it("?open= 直开:审核提示「已审核·库存已校准」;查询默认汇总(系统数/盘点数/盈亏数),明细双击弹详情", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialStocktakePage />, "/plastic-raw-material-stocktake?open=RT-1");
    await screen.findByText("原料盘点单 · RT-1");
    expect(screen.getAllByText("-2").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/plastic-raw-material-stocktake/RT-1/approve"))).toBe(true),
    );
    await screen.findByText("已审核·库存已校准");
    fireEvent.click(screen.getByRole("button", { name: "原料盘点查询" }));
    // 默认汇总页签
    await screen.findByText("盈亏数");
    fireEvent.click(screen.getByRole("button", { name: "明细查询" }));
    const cell = await screen.findByText("RT-1");
    fireEvent.doubleClick(cell.closest("tr")!);
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("原料盘点单 RT-1"));
    expect(dlg).toHaveTextContent("月盘");
  });
});
