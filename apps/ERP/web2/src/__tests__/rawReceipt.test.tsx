// 原料入仓单(单据+查询双页签):对照老系统 PlasticRawMaterialReceiptPage +
// ReceiptQueryPage + ReceiptQueryDetailDrawer。
// 单据:供应商必填校验、保存 POST、审核/反审核 POST、订单调入(已审核采购订单 -> 明细带入+订单单号回填)。
// 查询:默认汇总页签(列 原料编号/原料名称/产地/单位/入仓数量/金额)、明细页签双击弹单据详情、
// 类别数据源=塑胶原料类别、无「单价」位裁价格列。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticRawMaterialReceiptPage from "@/pages/PlasticRawMaterialReceiptPage";

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
  { 组: "原料仓库", 菜单: "原料入仓单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
  { 组: "原料报表", 菜单: "原料入仓查询", 打开: true, 单价: true },
];
const PERMS_NO_PRICE = [
  { 组: "原料仓库", 菜单: "原料入仓单", 打开: true, 保存: true, 审核: true, 反审核: true, 打印: true, 单价: false },
  { 组: "原料报表", 菜单: "原料入仓查询", 打开: true, 单价: false },
];

const R_HEADER = {
  id: 1,
  单号: "RR-1",
  供应商编号: "S1",
  供应商名称: "台化",
  日期: "2026-09-05",
  电脑单号: "DN-9",
  订单单号: "RPO-1",
  单价类型: "格式HK$/Lb",
  数量: 100,
  操作员: "tester",
  审核: "0",
};
const R_DETAIL = {
  单头: R_HEADER,
  明细: [
    { id: 11, 原料编号: "RM-1", 原料名称: "ABS 757", 产地: "台湾", 每包重量: 25, 单价类型: "含税", 单位: "KG", 数量: 100, 单价: 12.5, 备注: "" },
  ],
};
// 订单调入数据源:两张采购订单,只列已审核
const PO_LIST = [
  { id: 1, 单号: "RPO-1", 供应商名称: "台化", 数量: 100, 订购日期: "2026-09-01", 审核: "1" },
  { id: 2, 单号: "RPO-2", 供应商名称: "龙昌", 数量: 50, 订购日期: "2026-09-02", 审核: "0" },
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
          items: [{ ID: 7, 物料编号: "RM-1", 物料名称: "ABS 757", 单位: "KG", 单价: 12.5 }],
          total: 1,
        });
      if (p === "/api/plastic-raw-material-receipt") {
        if (init?.method === "POST") return json({ 单号: "RR-NEW" });
        return json({ items: [R_HEADER], total: 1 });
      }
      if (p === "/api/plastic-raw-material-receipt/RR-1") return json(R_DETAIL);
      if (p === "/api/plastic-raw-material-purchase-order") return json({ items: PO_LIST, total: 2 });
      if (p === "/api/plastic-raw-material-purchase-order/RPO-1")
        return json({
          单头: PO_LIST[0],
          明细: [
            { id: 21, 原料编号: "RM-1", 原料名称: "ABS 757", 单位: "KG", 单价类型: "含税", 订货数量: 100, 单价: 12.5, 备注: "PO行" },
          ],
        });
      if (p === "/api/plastic-raw-material-receipt-query/summary")
        return json([{ 原料编号: "RM-1", 原料名称: "ABS 757", 产地: "台湾", 单位: "KG", 入仓数量: 100, 金额: 1250 }]);
      if (p === "/api/plastic-raw-material-receipt-query/detail")
        return json([
          { 日期: "2026-09-05", 单号: "RR-1", 入库单号: "", 订单单号: "RPO-1", 供应商编号: "S1", 供应商名称: "台化", 原料编号: "RM-1", 原料名称: "ABS 757", 产地: "台湾", 单价类型: "含税", 单位: "KG", 数量: 100, 单价: 12.5, 金额: 1250, 备注: "", 审核: "1" },
        ]);
      if (p.endsWith("/approve") || p.endsWith("/unapprove")) return json({});
      if (p === "/api/master/suppliers")
        return json({ items: [{ 供应商编号: "S1", 供应商名称: "台化" }], total: 1 });
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

describe("PlasticRawMaterialReceiptPage(原料入仓单)", () => {
  it("订单调入:只列已审核采购订单,点单号带入明细(数量=订货数量)并回填订单单号;保存 POST", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialReceiptPage />, "/plastic-raw-material-receipt");
    await screen.findByText("原料入仓单(新建)");
    // 供应商
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    const supDlg = await screen.findByRole("dialog");
    await waitFor(() => expect(supDlg).toHaveTextContent("台化"));
    fireEvent.click(screen.getByText("台化").closest("tr")!);
    // 订单调入
    fireEvent.click(screen.getByRole("button", { name: "调入" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("RPO-1"));
    expect(dlg).not.toHaveTextContent("RPO-2"); // 未审核不列
    fireEvent.click(screen.getByText("RPO-1").closest("tr")!);
    await screen.findByText("已调入采购订单 RPO-1 的 1 行明细");
    expect(screen.getByLabelText("订单单号")).toHaveValue("RPO-1");
    expect(screen.getByLabelText("原料编号")).toHaveValue("RM-1");
    // 数量合计=100,金额合计=1250.00
    expect(screen.getByText("数量合计:")).toHaveTextContent("100");
    expect(screen.getByText("金额合计:")).toHaveTextContent("1250.00");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url.endsWith("/plastic-raw-material-receipt") && c.method === "POST",
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.订单单号).toBe("RPO-1");
      expect(body.单价类型).toBe("格式HK$/Lb");
      expect(body.明细).toEqual([
        expect.objectContaining({ 原料编号: "RM-1", 数量: 100, 单价: 12.5, 备注: "PO行" }),
      ]);
    });
  });

  it("?open= 直开:只读回填;审核 POST", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialReceiptPage />, "/plastic-raw-material-receipt?open=RR-1");
    await screen.findByText("原料入仓单 · RR-1");
    expect(screen.getByLabelText("供应商")).toHaveValue("台化");
    expect(screen.getByLabelText("订单单号")).toHaveValue("RPO-1");
    expect(screen.getByLabelText("备注")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/plastic-raw-material-receipt/RR-1/approve"))).toBe(true),
    );
  });

  it("查询页签:默认汇总(原料编号/入仓数量/金额),明细双击弹单据详情", async () => {
    installFetch();
    renderWithProviders(<PlasticRawMaterialReceiptPage />, "/plastic-raw-material-receipt");
    await screen.findByText("原料入仓单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "原料入仓查询" }));
    // 默认汇总页签
    await screen.findByText("1250.00");
    fireEvent.click(screen.getByLabelText("物料类别"));
    expect(screen.getByRole("option", { name: "ABS(2)" })).toBeInTheDocument(); // 类别下拉=塑胶原料类别
    fireEvent.click(screen.getByRole("button", { name: "明细查询" }));
    const cell = await screen.findByText("RR-1");
    fireEvent.doubleClick(cell.closest("tr")!);
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("原料入仓单 RR-1"));
    expect(dlg).toHaveTextContent("台化");
    expect(dlg).toHaveTextContent("ABS 757");
  });

  it("无「单价」位:单据不出 单价/金额 列,查询汇总裁 金额 列", async () => {
    installFetch(PERMS_NO_PRICE);
    renderWithProviders(<PlasticRawMaterialReceiptPage />, "/plastic-raw-material-receipt");
    await screen.findByText("原料入仓单(新建)");
    // 权限异步就位后严格裁剪(加载中乐观放行,等消失)
    await waitFor(() => expect(screen.queryByText("金额合计:")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "原料入仓查询" }));
    await screen.findByText("ABS 757");
    expect(screen.queryByText("金额")).not.toBeInTheDocument();
  });
});
