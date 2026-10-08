// 成品入仓单页:对照老系统 FinishedReceiptPage + FinishedReceiptQueryPage(+FinishedReceiptCenterPage 双页签)。
// 页面:新建校验(仓库/有效明细)、保存 POST 载荷(箱数/订单单号/仓库)、?open= 直开+审核 POST、
// 打开弹窗列表双击、查询页签汇总(箱数/数量合计+客户下拉+汇总按供应商)/明细双击回单据、无保存位按钮不渲染。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import { shiftDayRange } from "@/lib/purchaseReceipt";
import FinishedReceiptPage from "@/pages/FinishedReceiptPage";

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

const PERMS_FULL = [
  { 组: "成品仓储", 菜单: "成品入仓", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
];

const DETAIL = {
  单头: { ID: 1, 单号: "FR1", 订单单号: "PO-1", 入库单号: "RK-1", 供应商编号: "S1", 供应商名称: "恒科", 仓库: "成品仓", 日期: "2026-09-01", 数量: 5, 审核: "0", 操作员: "tester" },
  明细: [{ ID: 11, 订单单号: "PO-1", 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 生产单号: "MO1", 箱数: 2, 数量: 5, 单价: 1 }],
};

const LIST = { items: [DETAIL.单头], total: 1 };

const QUERY_SUMMARY = [
  { 客户: "ZURU", 配件编号: "AAA0001", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 供应商编号: "S1", 供应商名称: "恒科", 入仓箱数: 2, 入仓数量: 5 },
];
const QUERY_DETAIL = [
  { 日期: "2026-09-01", 单号: "FR1", 入库单号: "RK-1", 订单单号: "PO-1", 供应商编号: "S1", 供应商名称: "恒科", 生产单号: "MO1", 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 箱数: 2, 数量: 5, 备注: "", 审核: "0" },
];

const PRODUCTS = {
  items: [
    { 配件编号: "AAA0002", 客户: "ZURU", 产品货号: "9215B", 产品名称: "飞机", 产品装配名称: "胶袋", 加工单价: 2, 库存单价: 1.5 },
  ],
  total: 1,
};

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
      if (p === "/api/finished-receipts") {
        if (init?.method === "POST") return json({ 单号: "FR-NEW" });
        return json(LIST);
      }
      if (p === "/api/finished-receipts/FR1" && init?.method === "PUT") return json(DETAIL);
      if (p === "/api/finished-receipts/FR1") return json(DETAIL);
      if (p === "/api/finished-receipts/FR-NEW")
        return json({ ...DETAIL, 单头: { ...DETAIL.单头, 单号: "FR-NEW" } });
      if (p.endsWith("/approve") || p.endsWith("/unapprove")) return json({});
      if (p === "/api/finished-receipts/products") return json(PRODUCTS);
      if (p === "/api/finished-receipt-query/summary") return json(QUERY_SUMMARY);
      if (p === "/api/finished-receipt-query/detail") return json(QUERY_DETAIL);
      if (p === "/api/master/suppliers") return json({ items: [{ 供应商编号: "S1", 供应商名称: "恒科" }], total: 1 });
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

describe("FinishedReceiptPage", () => {
  it("新建保存校验:有效明细必填(数量>0)", async () => {
    installFetch();
    renderWithProviders(<FinishedReceiptPage />, "/finished-receipts");
    await screen.findByText("成品入仓单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请至少录入一行数量大于 0 的明细");
  });

  it("选产品加行 + 数量/箱数 -> 保存 POST 载荷(成品仓/箱数/单价)", async () => {
    const calls = installFetch();
    renderWithProviders(<FinishedReceiptPage />, "/finished-receipts");
    await screen.findByText("成品入仓单(新建)");
    fireEvent.change(screen.getByLabelText("订单单号"), { target: { value: "PO-9" } });
    fireEvent.click(screen.getByRole("button", { name: "选产品加行" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("AAA0002"));
    fireEvent.doubleClick(screen.getByText("9215B").closest("tr")!);
    fireEvent.change((await screen.findAllByLabelText("数量"))[0], { target: { value: "3" } });
    fireEvent.change((await screen.findAllByLabelText("箱数"))[0], { target: { value: "2" } });
    await screen.findByText("入仓数量汇总");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/finished-receipts") && c.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.订单单号).toBe("PO-9");
      expect(body.仓库).toBe("成品仓");
      expect(body.明细).toHaveLength(1);
      expect(body.明细[0]).toMatchObject({ 配件编号: "AAA0002", 产品货号: "9215B", 数量: 3, 箱数: 2 });
    });
    await screen.findByText("成品入仓单已保存");
  });

  it("?open= 直开单据:单头回填(供应商/订单单号/入库单号)+明细(箱数)+未审核;审核 POST approve", async () => {
    const calls = installFetch();
    renderWithProviders(<FinishedReceiptPage />, "/finished-receipts?open=FR1");
    await screen.findByText("成品入仓单 · FR1");
    expect(screen.getByLabelText("供应商")).toHaveValue("恒科");
    expect(screen.getByLabelText("订单单号")).toHaveValue("PO-1");
    expect(screen.getAllByText("彩盒").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("箱数")[0]).toHaveValue(2);
    expect(screen.getByText("未审核")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/finished-receipts/FR1/approve") && c.method === "POST")).toBe(true),
    );
  });

  it("查询页签:汇总带 箱数/数量 合计 + 客户下拉;明细双击回单据页签打开整单", async () => {
    installFetch();
    renderWithProviders(<FinishedReceiptPage />, "/finished-receipts");
    await screen.findByText("成品入仓单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "成品入仓查询" }));
    await screen.findByText(/箱数:2/);
    expect(screen.getByText(/数量:5/)).toBeInTheDocument();
    // 客户下拉选项从汇总行带出
    fireEvent.click(screen.getByLabelText("客户"));
    await waitFor(() => {
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toContain("ZURU");
    });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "明细查询" }));
    const cell = (await screen.findAllByText("FR1"))[0];
    fireEvent.doubleClick(cell.closest("tr")!);
    await screen.findByText("成品入仓单 · FR1");
  });

  it("查询页签日级按钮:今天/上一天把起止设为同一天并重查(对照老系统 shiftDay)", async () => {
    const calls = installFetch();
    renderWithProviders(<FinishedReceiptPage />, "/finished-receipts");
    await screen.findByText("成品入仓单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "成品入仓查询" }));
    await screen.findByText(/箱数:2/);
    const today = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const t = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
    fireEvent.click(screen.getByRole("button", { name: "今天" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.includes("/finished-receipt-query/summary") &&
            decodeURIComponent(c.url).includes(`起日期=${t}`) &&
            decodeURIComponent(c.url).includes(`止日期=${t}`),
        ),
      ).toBe(true),
    );
    expect((screen.getByLabelText("起") as HTMLInputElement).value).toBe(t);
    expect((screen.getByLabelText("止") as HTMLInputElement).value).toBe(t);
    fireEvent.click(screen.getByRole("button", { name: "上一天" }));
    const y = shiftDayRange(t, -1).起;
    await waitFor(() => expect((screen.getByLabelText("起") as HTMLInputElement).value).toBe(y));
    expect((screen.getByLabelText("止") as HTMLInputElement).value).toBe(y);
  });

  it("汇总按供应商:请求带 bySupplier=true 且多出供应商列", async () => {
    const calls = installFetch();
    renderWithProviders(<FinishedReceiptPage />, "/finished-receipts");
    await screen.findByText("成品入仓单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "成品入仓查询" }));
    await screen.findByText(/箱数:2/);
    fireEvent.click(screen.getByLabelText("汇总按供应商"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/finished-receipt-query/summary") && c.url.includes("bySupplier=true")),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getAllByText("供应商").length).toBeGreaterThan(0));
  });

  it("无「保存」位:新建/保存按钮不渲染", async () => {
    installFetch([{ 组: "成品仓储", 菜单: "成品入仓", 打开: true, 审核: true }]);
    renderWithProviders(<FinishedReceiptPage />, "/finished-receipts");
    await screen.findByText("成品入仓单(新建)");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "新建" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    });
  });

  it("无「打开」位:无权访问提示", async () => {
    installFetch([{ 组: "成品仓储", 菜单: "成品入仓", 保存: true }]);
    renderWithProviders(<FinishedReceiptPage />, "/finished-receipts");
    await screen.findByText("无权访问该页面");
  });
});
