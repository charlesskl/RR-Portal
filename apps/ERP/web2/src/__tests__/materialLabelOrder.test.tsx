// 来料标签单页:对照老系统 web/src/pages/materials/MaterialLabelOrderPage.tsx +
// MaterialLabelQueryPage.tsx + web/src/__tests__/materialLabelQuery.test.ts。
// 场景:校验/打印展开纯函数、打开单据(选择弹窗)、保存校验与新建载荷、审核/反审核、
// 前单/后单(无相邻单提示)、打印标签按标签数展开、复制单、
// 查询页签(明细/汇总/参数归一化/导出列/双击回单据页签)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import {
  expandLabelRows,
  validateLabelLines,
  type LabelLine,
} from "@/lib/materialLabel";
import { buildDocQuery, ALL_APPROVAL, ALL_CAT } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable } from "@/lib/tableExport";
import MaterialLabelOrderPage from "@/pages/MaterialLabelOrderPage";

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

vi.mock("@/lib/tableExport", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tableExport")>();
  return { ...mod, downloadCsv: vi.fn(), printTable: vi.fn() };
});

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const PERMS_FULL = [
  { 组: "物料管理", 菜单: "来料标签单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true },
  { 组: "物料管理", 菜单: "来料标签查询", 打开: true },
];

const ORDER = {
  ID: 1, 电脑单号: "BQ20260901001", 日期: "2026-09-01", 备注一: "首单", 备注二: "",
  操作员: "op1", 审核: "0", 审核人: null, 审核时间: null,
  明细: [
    { ID: 11, 物料编号: "M-001", 物料名称: "布料", 规格: "S", 颜色: "红", 单位: "米", 数量: 10, 标签数: 2, 备注: "" },
  ],
};

const LABEL_DETAIL = [
  { 日期: "2026-09-01", 电脑单号: "BQ20260901001", 物料编号: "M-001", 物料名称: "布料", 物料类别: "面料", 规格: "S", 颜色: "红", 单位: "米", 数量: 10, 标签数: 2, 备注: "", 审核: "0" },
];
const LABEL_SUMMARY = [
  { 物料编号: "M-001", 物料名称: "布料", 物料类别: "面料", 规格: "S", 颜色: "红", 单位: "米", 数量: 10, 标签数: 2 },
];

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  let audited = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      const u = new URL(url, "http://test");
      const p = u.pathname;
      const m = init?.method ?? "GET";
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/material-label-orders/label-query/detail") return json(LABEL_DETAIL);
      if (p === "/api/material-label-orders/label-query/summary") return json(LABEL_SUMMARY);
      if (p === "/api/material-label-orders/materials")
        return json({
          items: [{ 物料编号: "M-100", 物料名称: "拉链", 规格: "5#", 颜色: "黑", 单位: "条" }],
          total: 1,
        });
      if (p === "/api/material-label-orders" && m === "GET")
        return json({ items: [{ ID: 1, 电脑单号: "BQ20260901001", 日期: "2026-09-01", 操作员: "op1", 审核: "0", 审核人: null, 审核时间: null, 备注一: "首单", 备注二: null }], total: 1 });
      if (p === "/api/material-label-orders" && m === "POST") return json({ 电脑单号: "BQ20260918001" });
      if (p === "/api/material-label-orders/BQ20260901001" && m === "GET")
        return json({ ...ORDER, 审核: audited ? "1" : "0" });
      if (p === "/api/material-label-orders/BQ20260918001" && m === "GET")
        return json({ ...ORDER, 电脑单号: "BQ20260918001", 备注一: "", 明细: [{ ID: 21, 物料编号: "M-100", 物料名称: "拉链", 规格: "5#", 颜色: "黑", 单位: "条", 数量: 4, 标签数: 1, 备注: null }] });
      if (p.endsWith("/audit")) {
        audited = true;
        return new Response(null, { status: 204 });
      }
      if (p.endsWith("/reverse-audit")) {
        audited = false;
        return new Response(null, { status: 204 });
      }
      if (p.endsWith("/adjacent")) return new Response(null, { status: 204 });
      if (p === "/api/material-master/categories") return json([{ 类别: "面料", 数量: 3 }]);
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

const openFirstOrder = async () => {
  fireEvent.click(screen.getByRole("button", { name: "打开" }));
  const dlg = await screen.findByRole("dialog");
  fireEvent.click(await within(dlg).findByText("BQ20260901001"));
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
  vi.mocked(downloadCsv).mockClear();
  vi.mocked(printTable).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------- 纯函数 ----------

const lline = (p: Partial<LabelLine>): LabelLine => ({ key: 0, 物料编号: "", 数量: 0, 标签数: 1, ...p });

describe("来料标签单·校验与打印展开", () => {
  it("至少一条明细(空白物料编号不计)", () => {
    expect(validateLabelLines([])).toBe("至少需要一条明细");
    expect(validateLabelLines([lline({ 物料编号: "  " })])).toBe("至少需要一条明细");
  });
  it("数量必须非负有限;标签数必须非负整数", () => {
    expect(validateLabelLines([lline({ 物料编号: "A", 数量: -1 })])).toBe("第1行：数量必须为有限的非负数");
    expect(validateLabelLines([lline({ 物料编号: "A", 数量: 1, 标签数: 1.5 })])).toBe(
      "第1行：标签数必须为非负整数",
    );
    expect(validateLabelLines([lline({ 物料编号: "A", 数量: 0, 标签数: 0 })])).toBeNull();
  });
  it("打印展开:每行按标签数展开,序号连续,标签序号 i/N", () => {
    const rows = expandLabelRows([
      lline({ 物料编号: "M-1", 物料名称: "布料", 数量: 5, 标签数: 2 }),
      lline({ 物料编号: "", 标签数: 3 }), // 空白行跳过
      lline({ 物料编号: "M-2", 数量: 1, 标签数: 1 }),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ 序号: 1, 物料编号: "M-1", 标签序号: "1/2" });
    expect(rows[1]).toMatchObject({ 序号: 2, 物料编号: "M-1", 标签序号: "2/2" });
    expect(rows[2]).toMatchObject({ 序号: 3, 物料编号: "M-2", 标签序号: "1/1" });
  });
});

// ---------- 查询参数归一化(对照 web/src/__tests__/materialLabelQuery.test.ts,走共享 buildDocQuery) ----------

describe("来料标签查询·参数归一化", () => {
  it("空筛选 -> 全部 undefined;ALL/全部 不下发;trim 生效", () => {
    expect(buildDocQuery({})).toEqual({
      keyword: undefined, 物料类别: undefined, 审核情况: undefined, 起: undefined, 止: undefined,
    });
    expect(buildDocQuery({ 类别: ALL_CAT, 审核情况: ALL_APPROVAL })).toMatchObject({
      物料类别: undefined, 审核情况: undefined,
    });
    expect(buildDocQuery({ keyword: " MLAB ", 类别: "布料", 审核情况: "已审核" })).toMatchObject({
      keyword: "MLAB", 物料类别: "布料", 审核情况: "已审核",
    });
  });
});

// ---------- 页面(单据页签) ----------

describe("MaterialLabelOrderPage 单据页签", () => {
  it("打开:选择弹窗点行载入整单(单头/明细/未审核徽章)", async () => {
    installFetch();
    renderWithProviders(<MaterialLabelOrderPage />, "/material-label-orders");
    await screen.findByRole("button", { name: "打开" });
    await openFirstOrder();
    await screen.findByText("来料标签单 · BQ20260901001");
    expect(screen.getByLabelText("备注一")).toHaveValue("首单");
    expect(screen.getByLabelText("物料编号")).toHaveValue("M-001");
    expect(screen.getByText("未审核")).toBeInTheDocument();
    // 合计:数量 10 / 标签数 2
    expect(screen.getByText("数量合计:").parentElement).toHaveTextContent("10");
    expect(screen.getByText("标签数合计:").parentElement).toHaveTextContent("2");
  });

  it("审核/反审核:POST 对应端点并重取(后端 审核位=审核,反审核位=反审核)", async () => {
    const calls = installFetch();
    renderWithProviders(<MaterialLabelOrderPage />, "/material-label-orders");
    await screen.findByRole("button", { name: "打开" });
    await openFirstOrder();
    await screen.findByText("来料标签单 · BQ20260901001");
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.url === "/api/material-label-orders/BQ20260901001/audit" && c.method === "POST"),
      ).toBe(true);
    });
    await screen.findByText("已审核");
    fireEvent.click(screen.getByRole("button", { name: "反审核" }));
    await waitFor(() => {
      expect(
        calls.some(
          (c) => c.url === "/api/material-label-orders/BQ20260901001/reverse-audit" && c.method === "POST",
        ),
      ).toBe(true);
    });
  });

  it("打印标签:按标签数展开成 2 行进打印窗口,标题带单号", async () => {
    installFetch();
    renderWithProviders(<MaterialLabelOrderPage />, "/material-label-orders");
    await screen.findByRole("button", { name: "打开" });
    await openFirstOrder();
    await screen.findByText("来料标签单 · BQ20260901001");
    fireEvent.click(screen.getByRole("button", { name: "打印标签" }));
    expect(printTable).toHaveBeenCalledTimes(1);
    const [title, cols, rows] = vi.mocked(printTable).mock.calls[0];
    expect(title).toBe("来料标签单 BQ20260901001");
    expect(cols.map((c) => c.title)).toEqual([
      "序号", "物料编号", "物料名称", "规格", "颜色", "单位", "数量", "标签序号",
    ]);
    expect(rows).toHaveLength(2); // 标签数=2 展开两行
    expect(rows[0]).toMatchObject({ 序号: 1, 标签序号: "1/2" });
  });

  it("新建保存:选物料加行(重复物料警告),校验数量,POST 后 GET 整单", async () => {
    const calls = installFetch();
    renderWithProviders(<MaterialLabelOrderPage />, "/material-label-orders");
    await screen.findByRole("button", { name: "新建" });
    // 选物料加行
    fireEvent.click(screen.getByRole("button", { name: "选物料加行" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(await within(dlg).findByText("M-100"));
    // 新行带出物料信息,数量手填
    const qtyInputs = screen.getAllByLabelText("数量");
    fireEvent.change(qtyInputs[0], { target: { value: "4" } });
    // 再选同一物料:警告已在明细中,行数不变
    fireEvent.click(screen.getByRole("button", { name: "选物料加行" }));
    const dlg2 = await screen.findByRole("dialog");
    fireEvent.click(await within(dlg2).findByText("M-100"));
    await screen.findByText(/物料 \[M-100\] 已在明细中/);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url === "/api/material-label-orders" && c.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.明细).toHaveLength(1);
      expect(body.明细[0]).toMatchObject({ 物料编号: "M-100", 数量: 4, 标签数: 1, 序号: 1 });
    });
    await screen.findByText("来料标签单已保存");
    // 保存后 GET 新单整单并进入查看态
    await screen.findByText("来料标签单 · BQ20260918001");
  });

  it("空明细保存被拦:至少需要一条明细", async () => {
    const calls = installFetch();
    renderWithProviders(<MaterialLabelOrderPage />, "/material-label-orders");
    await screen.findByRole("button", { name: "保存" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("至少需要一条明细");
    expect(calls.some((c) => c.url === "/api/material-label-orders" && c.method === "POST")).toBe(false);
  });

  it("后单:无相邻单(204)提示已经是最后一张单据", async () => {
    installFetch();
    renderWithProviders(<MaterialLabelOrderPage />, "/material-label-orders");
    await screen.findByRole("button", { name: "打开" });
    await openFirstOrder();
    await screen.findByText("来料标签单 · BQ20260901001");
    fireEvent.click(screen.getByRole("button", { name: "后单" }));
    await screen.findByText("已经是最后一张单据");
  });

  it("复制单:清掉单号转未保存新单,明细保留", async () => {
    installFetch();
    renderWithProviders(<MaterialLabelOrderPage />, "/material-label-orders");
    await screen.findByRole("button", { name: "打开" });
    await openFirstOrder();
    await screen.findByText("来料标签单 · BQ20260901001");
    fireEvent.click(screen.getByRole("button", { name: "复制单" }));
    await screen.findByText(/已复制为未保存新单/);
    expect(screen.queryByText("来料标签单 · BQ20260901001")).not.toBeInTheDocument();
    expect(screen.getByLabelText("物料编号")).toHaveValue("M-001");
  });
});

// ---------- 页面(查询页签) ----------

describe("MaterialLabelOrderPage 查询页签", () => {
  it("明细渲染 + 双击电脑单号回单据页签打开整单", async () => {
    installFetch();
    renderWithProviders(<MaterialLabelOrderPage />, "/material-label-orders");
    fireEvent.click(await screen.findByRole("button", { name: "来料标签查询" }));
    const cell = await screen.findByText("BQ20260901001", { selector: "td" });
    expect(screen.getByText(/提示:双击明细行可打开来料标签单/)).toBeInTheDocument();
    fireEvent.doubleClick(cell.closest("tr")!);
    await screen.findByText("来料标签单 · BQ20260901001");
  });

  it("汇总页签 + 导出列对照老系统", async () => {
    installFetch();
    renderWithProviders(<MaterialLabelOrderPage />, "/material-label-orders");
    fireEvent.click(await screen.findByRole("button", { name: "来料标签查询" }));
    await screen.findByText("BQ20260901001", { selector: "td" });
    // 明细导出列
    fireEvent.click(screen.getByRole("button", { name: "导出EXCEL" }));
    let call = vi.mocked(downloadCsv).mock.calls[0];
    expect(call[0]).toBe("来料标签明细.csv");
    expect(call[1].map((c) => c.title)).toEqual([
      "日期", "电脑单号", "物料编号", "物料名称", "规格", "材料", "颜色", "单位", "数量", "标签数", "备注", "审核",
    ]);
    // 汇总页签
    fireEvent.click(screen.getByRole("button", { name: "汇总查询" }));
    await screen.findByText("标签数", { selector: "th" });
    fireEvent.click(screen.getByRole("button", { name: "导出EXCEL" }));
    call = vi.mocked(downloadCsv).mock.calls[1];
    expect(call[0]).toBe("来料标签汇总.csv");
    expect(call[1].map((c) => c.title)).toEqual([
      "物料编号", "物料名称", "材料", "规格", "颜色", "单位", "数量", "标签数",
    ]);
  });

  it("审核情况/类别/关键字进 label-query 参数", async () => {
    const calls = installFetch();
    renderWithProviders(<MaterialLabelOrderPage />, "/material-label-orders");
    fireEvent.click(await screen.findByRole("button", { name: "来料标签查询" }));
    await screen.findByText("BQ20260901001", { selector: "td" });
    pickOption("审核情况", "已审核");
    fireEvent.click(screen.getByLabelText("物料类别"));
    fireEvent.click(await screen.findByRole("option", { name: "面料(3)" }));
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "BQ" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => {
      const hit = calls.find(
        (c) => c.url.includes("label-query/detail?") && c.url.includes("keyword=BQ"),
      );
      expect(hit).toBeTruthy();
      const u = new URL(hit!.url, "http://test");
      expect(u.searchParams.get("审核情况")).toBe("已审核");
      expect(u.searchParams.get("物料类别")).toBe("面料");
    });
  });

  it("查询页签无权限:提示缺「来料标签查询·打开」", async () => {
    installFetch([{ 组: "物料管理", 菜单: "来料标签单", 打开: true, 保存: true }]);
    renderWithProviders(<MaterialLabelOrderPage />, "/material-label-orders");
    fireEvent.click(await screen.findByRole("button", { name: "来料标签查询" }));
    await screen.findByText("无权访问来料标签查询");
  });
});
