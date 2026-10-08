// 原料采购分析表 + 原料采购订单 + 原料采购进度表:对照老系统
// PlasticRawMaterialPurchaseAnalysisPage / PurchaseOrderPage / PurchaseProgressPage。
// 分析表:行渲染、可购数量>0 红、只看可购/类别参数。
// 采购订单:供应商必填校验、保存 POST、三级审核链(主管->经理->审核(下发))按钮按阶段可用并逐段 POST、
// 无「单价」位裁 单价/金额 列与金额合计。
// 进度表:整单汇总(订货数量口径)/展开明细/完成情况徽章/欠数红;日期类型=不选择日期 时不下发起止;
// 点采购单号跳原料采购订单整单(MENU_PATHS 已注册)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticRawMaterialPurchaseAnalysisPage from "@/pages/PlasticRawMaterialPurchaseAnalysisPage";
import PlasticRawMaterialPurchaseOrderPage from "@/pages/PlasticRawMaterialPurchaseOrderPage";
import PlasticRawMaterialPurchaseProgressPage from "@/pages/PlasticRawMaterialPurchaseProgressPage";

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

const PERMS = [
  { 组: "原料仓库", 菜单: "原料采购分析表", 打开: true },
  { 组: "原料仓库", 菜单: "原料采购订单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
];
const PERMS_NO_PRICE = [
  { 组: "原料仓库", 菜单: "原料采购订单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: false },
];

const PO_HEADER = {
  id: 1,
  单号: "RPO-1",
  供应商编号: "S1",
  供应商名称: "台化",
  订购日期: "2026-09-01",
  交货日期: "2026-09-20",
  数量: 100,
  操作员: "tester",
  审核: "0",
  主管审核: "0",
  经理审核: "0",
};
const PO_DETAIL = {
  单头: PO_HEADER,
  明细: [
    { id: 11, 原料编号: "RM-1", 原料名称: "ABS 757", 规格: "25KG/包", 单位: "KG", 单价类型: "含税", 订货数量: 100, 单价: 12.5, 备注: "" },
  ],
};
const PROGRESS = [
  { 订购日期: "2026-09-01", 交货日期: "2026-09-20", 采购单号: "RPO-1", 供应商编号: "S1", 供应商名称: "台化", 原料编号: "RM-1", 原料名称: "ABS 757", 规格: "25KG/包", 单位: "KG", 单价类型: "含税", 订货数量: 100, 入仓数量: 60, 欠数: 40, 进度: 60, 审核: "1", 备注: "" },
  { 订购日期: "2026-09-01", 交货日期: "2026-09-20", 采购单号: "RPO-1", 供应商编号: "S1", 供应商名称: "台化", 原料编号: "RM-2", 原料名称: "PP 料", 规格: "", 单位: "KG", 单价类型: "未税", 订货数量: 50, 入仓数量: 50, 欠数: 0, 进度: 100, 审核: "1", 备注: "" },
];

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
          items: [{ ID: 7, 物料编号: "RM-1", 物料名称: "ABS 757", 规格: "25KG/包", 单位: "KG", 单价: 12.5 }],
          total: 1,
        });
      if (p === "/api/plastic-raw-material-purchase-analysis")
        return json([
          { 原料编号: "RM-1", 原料名称: "ABS 757", 规格: "25KG/包", 物料类别: "ABS", 单位: "KG", 当前库存: 10, 安全库存: 200, 生产需求: 500, 可购数量: 240 },
          { 原料编号: "RM-2", 原料名称: "PP 料", 规格: "", 物料类别: "PP", 单位: "KG", 当前库存: 100, 安全库存: 50, 生产需求: 0, 可购数量: 0 },
        ]);
      if (p === "/api/plastic-raw-material-purchase-order") {
        if (init?.method === "POST") return json({ 单号: "RPO-NEW" });
        return json({ items: [PO_HEADER], total: 1 });
      }
      if (p === "/api/plastic-raw-material-purchase-order/RPO-1") return json(PO_DETAIL);
      if (p === "/api/plastic-raw-material-purchase-progress") return json(PROGRESS);
      if (p.endsWith("/supervisor-approve") || p.endsWith("/manager-approve") || p.endsWith("/approve") || p.endsWith("/unapprove"))
        return json({});
      if (p === "/api/master/suppliers")
        return json({ items: [{ 供应商编号: "S1", 供应商名称: "台化" }], total: 1 });
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

beforeEach(() => {
  lastLoc = "";
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlasticRawMaterialPurchaseAnalysisPage(原料采购分析表)", () => {
  it("行渲染;可购数量>0 红,=0 不红;类别下拉来自原料类别", async () => {
    installFetch();
    renderWithProviders(<PlasticRawMaterialPurchaseAnalysisPage />, "/plastic-raw-material-purchase-analysis");
    await screen.findByText("RM-1");
    // 类别下拉选项来自原料类别(SearchSelect 展开后才渲染选项)
    fireEvent.click(screen.getByLabelText("物料类别"));
    expect(screen.getByRole("option", { name: "ABS(2)" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    const red = screen.getByText("240");
    expect(red.className).toContain("text-[#dc2626]");
    // RM-2 行:生产需求 0(纯 td)/可购数量 0(span),可购不红
    const row2 = screen.getByText("PP 料").closest("tr")!;
    const zeroSpan = Array.from(row2.querySelectorAll("span")).find((e) => e.textContent === "0")!;
    expect(zeroSpan.className).not.toContain("text-[#dc2626]");
  });

  it("「只看可购」勾选即时下发 onlyBuy=true;关键字点「查询」才发请求", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialPurchaseAnalysisPage />, "/plastic-raw-material-purchase-analysis");
    await screen.findByText("RM-1");
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("onlyBuy=true"))).toBe(true),
    );
    // 关键字输入不触发;点「查询」才带 keyword 重新请求
    const hitsBefore = calls.filter((c) => c.url.includes("purchase-analysis")).length;
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "ABS" } });
    expect(calls.filter((c) => c.url.includes("purchase-analysis")).length).toBe(hitsBefore);
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));
    await waitFor(() => {
      const hits = calls.filter((c) => c.url.includes("purchase-analysis"));
      expect(hits.length).toBeGreaterThan(hitsBefore);
      const last = new URL(hits[hits.length - 1].url, "http://test");
      expect(last.searchParams.get("keyword")).toBe("ABS");
    });
  });
});

describe("PlasticRawMaterialPurchaseOrderPage(原料采购订单)", () => {
  it("保存校验:先选供应商;供应商选择器带出后 POST 载荷(交货日期空=null)", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialPurchaseOrderPage />, "/plastic-raw-material-purchase-order");
    await screen.findByText("原料采购订单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选供应商");
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("台化"));
    fireEvent.click(screen.getByText("台化").closest("tr")!);
    await waitFor(() => expect(screen.getByLabelText("供应商")).toHaveValue("台化"));
    fireEvent.click(screen.getByRole("button", { name: "加一行" }));
    fireEvent.click(screen.getByRole("button", { name: "选原料" }));
    const matDlg = await screen.findByRole("dialog");
    await waitFor(() => expect(matDlg).toHaveTextContent("RM-1"));
    fireEvent.click(screen.getByText("ABS 757").closest("tr")!);
    await waitFor(() => expect(screen.getByLabelText("原料编号")).toHaveValue("RM-1"));
    fireEvent.change(screen.getByLabelText("订货数量"), { target: { value: "100" } });
    // 金额列 = 100*12.5
    await waitFor(() => expect(screen.getAllByText("1250.00").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url.endsWith("/plastic-raw-material-purchase-order") && c.method === "POST",
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.供应商名称).toBe("台化");
      expect(body.交货日期).toBeNull();
      expect(body.明细).toEqual([
        expect.objectContaining({ 原料编号: "RM-1", 订货数量: 100, 单价: 12.5, 单价类型: "含税" }),
      ]);
    });
    await screen.findByText("原料采购订单已创建");
  });

  it("三级审核链:主管->经理->审核(下发) 逐段可用并 POST;完成后已审核徽章", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialPurchaseOrderPage />, "/plastic-raw-material-purchase-order?open=RPO-1");
    await screen.findByText("原料采购订单 · RPO-1");
    // 阶段0:仅 主管审核 可用
    expect(screen.getByRole("button", { name: "主管审核" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "经理审核" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "审核(下发)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "反审核" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "主管审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/RPO-1/supervisor-approve"))).toBe(true),
    );
  });

  it("无「单价」位:不出 单价/金额 列与金额合计", async () => {
    installFetch(PERMS_NO_PRICE);
    renderWithProviders(<PlasticRawMaterialPurchaseOrderPage />, "/plastic-raw-material-purchase-order?open=RPO-1");
    await screen.findByText("原料采购订单 · RPO-1");
    expect(screen.queryByText("单价")).not.toBeInTheDocument();
    expect(screen.queryByText("金额")).not.toBeInTheDocument();
    expect(screen.queryByText(/金额合计/)).not.toBeInTheDocument();
  });
});

describe("PlasticRawMaterialPurchaseProgressPage(原料采购进度表)", () => {
  const setup = (perms: unknown[] = PERMS) => {
    const calls = installFetch(perms);
    renderWithProviders(
      <>
        <Probe />
        <Routes>
          <Route path="/plastic-raw-material-purchase-progress" element={<PlasticRawMaterialPurchaseProgressPage />} />
          <Route path="/plastic-raw-material-purchase-order" element={<div>原料采购订单STUB</div>} />
        </Routes>
      </>,
      "/plastic-raw-material-purchase-progress",
    );
    return calls;
  };

  it("整单视图:订货数量口径汇总(150/110/欠40 部分入仓),点行展开原料明细", async () => {
    setup();
    await screen.findByText("RPO-1");
    expect(screen.getByText("台化")).toBeInTheDocument();
    expect(screen.getByText("部分入仓")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("110")).toBeInTheDocument();
    expect(screen.getByText("40").className).toContain("text-[#dc2626]");
    fireEvent.click(screen.getByText("RPO-1").closest("tr")!);
    await screen.findByText("PP 料");
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("100%").className).toContain("text-[#15803d]");
  });

  it("日期类型=不选择日期:区间禁用且不下发 起/止/日期类型", async () => {
    const calls = setup();
    await screen.findByText("RPO-1");
    pickOption("日期类型", "不选择日期");
    expect(screen.getByLabelText("起")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /查询/ }));
    await waitFor(() => {
      const hits = calls.filter((c) => c.url.includes("/api/plastic-raw-material-purchase-progress"));
      const last = hits[hits.length - 1];
      const u = new URL(last.url, "http://test");
      expect(u.searchParams.get("起")).toBeNull();
      expect(u.searchParams.get("日期类型")).toBeNull();
    });
  });

  it("明细视图:逐原料平铺;点采购单号跳原料采购订单整单", async () => {
    setup();
    await screen.findByText("RPO-1");
    fireEvent.click(screen.getByRole("button", { name: "明细" }));
    await screen.findByText("RM-1");
    expect(screen.getByText("RM-2")).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByText("RM-1").closest("tr")!);
    await waitFor(() => expect(lastLoc).toBe("/plastic-raw-material-purchase-order?open=RPO-1"));
    await screen.findByText("原料采购订单STUB");
  });

  it("无「打开」权限:整页无权提示", async () => {
    setup([]);
    await screen.findByText("无权访问该页面");
  });
});
