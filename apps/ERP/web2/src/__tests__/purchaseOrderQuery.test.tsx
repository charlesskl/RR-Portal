// 订购单查询页:对照老系统 web/src/pages/production/PurchaseOrderQueryPage.tsx +
// web/src/__tests__/purchaseOrderQuery.test.ts(buildOrderQuery 纯函数逐条移植)。
// 场景:明细/汇总双页签、日期类型/供应商/类别/关键字进参数、价格列按「单价」权限裁剪(表格+导出)、
// 双击明细行跳 /purchase-orders?单号=(MENU_PATHS 裁决)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import { buildOrderQuery } from "@/lib/purchaseOrderQuery";
import { ALL_CAT } from "@/lib/purchaseReceipt";
import { downloadCsv, printTable } from "@/lib/tableExport";
import PurchaseOrderQueryPage from "@/pages/PurchaseOrderQueryPage";

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

const PERMS_FULL = [{ 组: "物料管理", 菜单: "采购订单", 打开: true, 单价: true }];
const PERMS_NO_PRICE = [{ 组: "物料管理", 菜单: "采购订单", 打开: true }];

const DETAIL = [
  {
    日期: "2026-09-01", 单号: "PO20260901001", 供应商编号: "SUP-1", 供应商名称: "恒科塑胶",
    生产单号: "MO-1", 款号: "K-1", 物料编号: "M-001", 物料名称: "布料", 物料类别: "面料",
    规格: "S", 颜色: "红", 单位: "米", 数量: 100, 单价: 2.5, 金额: 250, 审核: "1", 备注: "赶货",
  },
];
const SUMMARY = [
  { 物料编号: "M-001", 物料名称: "布料", 物料类别: "面料", 规格: "S", 颜色: "红", 单位: "米", 订购数量: 100 },
];

type Call = { url: string; method: string };

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/purchase-orders/order-query/detail") return json(DETAIL);
      if (p === "/api/purchase-orders/order-query/summary") return json(SUMMARY);
      if (p === "/api/material-master/categories") return json([{ 类别: "面料", 数量: 3 }]);
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

let lastLoc = "";
function Probe() {
  const l = useLocation();
  useEffect(() => {
    lastLoc = l.pathname + l.search;
  }, [l]);
  return null;
}

const setup = (perms?: unknown) => {
  const calls = installFetch(perms ?? PERMS_FULL);
  renderWithProviders(
    <>
      <Probe />
      <Routes>
        <Route path="/purchase-order-query" element={<PurchaseOrderQueryPage />} />
        <Route path="/purchase-orders" element={<div>采购订单STUB</div>} />
      </Routes>
    </>,
    "/purchase-order-query",
  );
  return calls;
};

beforeEach(() => {
  lastLoc = "";
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
  vi.mocked(downloadCsv).mockClear();
  vi.mocked(printTable).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------- 纯函数(对照 web/src/__tests__/purchaseOrderQuery.test.ts) ----------

describe("订购单查询·参数归一化", () => {
  it("空筛选 -> 全部 undefined(不下发条件)", () => {
    expect(buildOrderQuery({})).toEqual({
      供应商: undefined, keyword: undefined, 物料类别: undefined, 起: undefined, 止: undefined, 日期类型: undefined,
    });
  });
  it("日期类型透传(交货日期)", () => {
    expect(buildOrderQuery({ 日期类型: "交货日期" }).日期类型).toBe("交货日期");
  });
  it("ALL 分类节点不下发 物料类别;选中类别则下发", () => {
    expect(buildOrderQuery({ 类别: ALL_CAT }).物料类别).toBeUndefined();
    expect(buildOrderQuery({ 类别: "布料" }).物料类别).toBe("布料");
  });
  it("空串/纯空格 -> undefined,有值则 trim", () => {
    expect(buildOrderQuery({ 供应商: "   ", keyword: "" })).toMatchObject({
      供应商: undefined, keyword: undefined,
    });
    expect(buildOrderQuery({ 供应商: " 恒科 ", keyword: "PET" })).toMatchObject({
      供应商: "恒科", keyword: "PET",
    });
  });
  it("日期区间透传", () => {
    expect(buildOrderQuery({ 起: "2026-03-10", 止: "2026-03-20" })).toMatchObject({
      起: "2026-03-10", 止: "2026-03-20",
    });
  });
});

// ---------- 页面 ----------

describe("PurchaseOrderQueryPage", () => {
  it("明细页签渲染(默认本月起止);审核列映射;价格列有权限时显示", async () => {
    const calls = setup();
    await screen.findByText("PO20260901001");
    expect(screen.getByText("恒科塑胶")).toBeInTheDocument();
    expect(screen.getByText("已审核")).toBeInTheDocument();
    expect(screen.getByText("单价")).toBeInTheDocument();
    expect(screen.getByText("金额")).toBeInTheDocument();
    const hit = calls.find((c) => c.url.includes("/api/purchase-orders/order-query/detail?"));
    expect(hit?.url).toContain("%E8%B5%B7=20"); // 起=2026-..
    expect(hit?.url).toContain(encodeURIComponent("订货日期"));
  });

  it("日期类型/供应商/类别/关键字进查询参数", async () => {
    const calls = setup();
    await screen.findByText("PO20260901001");
    pickOption("日期类型", "交货日期");
    fireEvent.change(screen.getByLabelText("供应商"), { target: { value: "恒科" } });
    pickOption("物料类别", "面料(3)");
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "M-001" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => {
      const hit = calls.find(
        (c) => c.url.includes("order-query/detail?") && c.url.includes("keyword=M-001"),
      );
      expect(hit).toBeTruthy();
      const u = new URL(hit!.url, "http://test");
      expect(u.searchParams.get("日期类型")).toBe("交货日期");
      expect(u.searchParams.get("供应商")).toBe("恒科");
      expect(u.searchParams.get("物料类别")).toBe("面料");
    });
  });

  it("汇总页签:按 物料编号 合并 订购数量", async () => {
    setup();
    await screen.findByText("PO20260901001");
    fireEvent.click(screen.getByRole("button", { name: "汇总查询" }));
    await screen.findByText("订购数量", { selector: "th" });
    expect(screen.getByText("M-001")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("无「单价」位:表格与导出都不出价格列", async () => {
    setup(PERMS_NO_PRICE);
    await screen.findByText("PO20260901001");
    expect(screen.queryByText("单价")).not.toBeInTheDocument();
    expect(screen.queryByText("金额")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出EXCEL" }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [fname, cols] = vi.mocked(downloadCsv).mock.calls[0];
    expect(fname).toBe("订购单明细.csv");
    expect(cols.map((c) => c.title)).not.toContain("单价");
    expect(cols.map((c) => c.title)).not.toContain("金额");
  });

  it("有「单价」位:导出含 单价/金额 列(对照老系统 detailExportCols)", async () => {
    setup();
    await screen.findByText("PO20260901001");
    fireEvent.click(screen.getByRole("button", { name: "导出EXCEL" }));
    const [, cols] = vi.mocked(downloadCsv).mock.calls[0];
    expect(cols.map((c) => c.title)).toEqual([
      "日期", "单号", "供应商", "生产单号", "款号", "物料编号", "物料名称", "规格", "材料",
      "颜色", "单位", "数量", "单价", "金额", "审核", "备注",
    ]);
  });

  it("双击明细行:跳采购订单整单(/purchase-orders?单号=)", async () => {
    setup();
    const cell = await screen.findByText("PO20260901001");
    fireEvent.doubleClick(cell.closest("tr")!);
    await waitFor(() => {
      expect(lastLoc).toBe("/purchase-orders?" + "单号=PO20260901001");
    });
    await screen.findByText("采购订单STUB");
  });

  it("无「打开」权限:整页无权提示", async () => {
    setup([]);
    await screen.findByText("无权访问 订购单查询");
  });
});
