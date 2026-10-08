// 半成品入仓单页:对照老系统 SemiReceiptPage + SemiReceiptQueryPage + semiReceiptOrder 工具测试。
// 页面:新建校验(订单单号必填/供应商必填/有效明细)、保存 POST 载荷(物料编号=配件编号)、
// ?open= 直开、审核 POST、打开弹窗列表双击、查询页签汇总/明细双击回单据。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import SemiReceiptPage from "@/pages/SemiReceiptPage";

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
  { 组: "半成品仓储", 菜单: "半成品入仓", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
];

const DETAIL = {
  单头: { id: 1, 单号: "SR1", 订单单号: "PO-1", 供应商编号: "S1", 供应商名称: "恒科", 仓库: "半成品仓", 日期: "2026-09-01", 数量: 5, 审核: "0", 操作员: "tester" },
  明细: [{ id: 11, 订单单号: "PO-1", 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 生产单号: "MO1", 单位: "PCS", 数量: 5, 单价: 1 }],
};

const LIST = { items: [DETAIL.单头], total: 1 };

const QUERY_SUMMARY = [
  { 配件编号: "AAA0001", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 供应商编号: "S1", 供应商名称: "恒科", 入仓数量: 5 },
];
const QUERY_DETAIL = [
  { 日期: "2026-09-01", 单号: "SR1", 入库单号: "SR1", 订单单号: "PO-1", 供应商编号: "S1", 供应商名称: "恒科", 生产单号: "MO1", 配件编号: "AAA0001", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 数量: 5, 备注: "", 审核: "0" },
];

const PRODUCTS = {
  items: [
    { 配件编号: "AAA0002", 客户: "ZURU", 产品货号: "9215B", 产品名称: "飞机", 产品装配名称: "胶袋", 加工单价: 2, 库存单价: 1.5 },
  ],
  total: 1,
};

const KIT_NONE = { 有定义: false, 齐套: true, 组成: [] };

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown = PERMS_FULL, kit: unknown = KIT_NONE) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/semi-receipts") {
        if (init?.method === "POST") return json({ 单号: "SR-NEW" });
        return json(LIST);
      }
      if (p === "/api/semi-receipts/SR1") return json(DETAIL);
      if (p === "/api/semi-receipts/SR-NEW") return json({ ...DETAIL, 单头: { ...DETAIL.单头, 单号: "SR-NEW" } });
      if (p.endsWith("/approve") || p.endsWith("/unapprove")) return json({});
      if (p === "/api/semi-receipts/products") return json(PRODUCTS);
      if (p === "/api/semi-receipts/kit-check") return json(kit);
      if (p === "/api/semi-receipt-query/summary") return json(QUERY_SUMMARY);
      if (p === "/api/semi-receipt-query/detail") return json(QUERY_DETAIL);
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

describe("SemiReceiptPage", () => {
  it("新建保存三级校验:订单单号必填 -> 供应商必填 -> 有效明细", async () => {
    installFetch();
    renderWithProviders(<SemiReceiptPage />, "/semi-receipts");
    await screen.findByText("半成品入仓单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(/请填写订单单号/);
    fireEvent.change(screen.getByLabelText("订单单号"), { target: { value: "PO-9" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选择供应商");
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    const cell = await screen.findByText("恒科");
    fireEvent.click(cell.closest("tr")!);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请至少录入一行数量大于 0 的明细");
  });

  it("选产品加行 + 数量 -> 保存 POST 载荷(物料编号=配件编号,物料名称=产品装配名称)", async () => {
    const calls = installFetch();
    renderWithProviders(<SemiReceiptPage />, "/semi-receipts");
    await screen.findByText("半成品入仓单(新建)");
    fireEvent.change(screen.getByLabelText("订单单号"), { target: { value: "PO-9" } });
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click((await screen.findByText("恒科")).closest("tr")!);
    fireEvent.click(screen.getByRole("button", { name: "选产品加行" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("AAA0002"));
    fireEvent.doubleClick(screen.getByText("9215B").closest("tr")!);
    const qtyInput = (await screen.findAllByLabelText("数量"))[0];
    fireEvent.change(qtyInput, { target: { value: "3" } });
    // 汇总侧表实时聚合
    await screen.findByText("入仓数量汇总");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/semi-receipts") && c.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.订单单号).toBe("PO-9");
      expect(body.仓库).toBe("半成品仓");
      expect(body.供应商名称).toBe("恒科");
      expect(body.明细).toHaveLength(1);
      expect(body.明细[0]).toMatchObject({ 配件编号: "AAA0002", 物料编号: "AAA0002", 物料名称: "胶袋", 数量: 3 });
    });
    await screen.findByText("半成品入仓单已保存");
  });

  it("齐套检查:组成未齐时面板标红,保存先弹确认,确认后才 POST", async () => {
    const calls = installFetch(PERMS_FULL, {
      有定义: true,
      齐套: false,
      组成: [
        { 物料编号: "M-1", 物料名称: "料一", 单位: "个", 每件用量: 2, 需要: 6, 已回: 6, 还差: 0 },
        { 物料编号: "M-2", 物料名称: "料二", 单位: "个", 每件用量: 1, 需要: 3, 已回: 1, 还差: 2 },
      ],
    });
    renderWithProviders(<SemiReceiptPage />, "/semi-receipts");
    await screen.findByText("半成品入仓单(新建)");
    fireEvent.change(screen.getByLabelText("订单单号"), { target: { value: "PO-9" } });
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click((await screen.findByText("恒科")).closest("tr")!);
    fireEvent.click(screen.getByRole("button", { name: "选产品加行" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("AAA0002"));
    fireEvent.doubleClick(screen.getByText("9215B").closest("tr")!);
    fireEvent.change(screen.getAllByLabelText("行生产单号")[0], { target: { value: "MO1" } });
    fireEvent.change(screen.getAllByLabelText("数量")[0], { target: { value: "3" } });
    // 齐套面板:列出组成物料,未齐标红
    await screen.findByText("半成品组成齐套检查", undefined, { timeout: 3000 });
    await screen.findByText("组成未齐");
    expect(screen.getByText("M-2")).toBeInTheDocument();
    // 保存 → 拦截弹窗,不发 POST
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("半成品组成物料未齐，仍要保存吗？");
    expect(calls.some((c) => c.url.endsWith("/semi-receipts") && c.method === "POST")).toBe(false);
    // 确认 → 才发 POST
    fireEvent.click(screen.getByRole("button", { name: "仍要保存" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/semi-receipts") && c.method === "POST")).toBe(true),
    );
  });

  it("?open= 直开单据:单头回填+明细+未审核可编辑;审核 POST approve", async () => {
    const calls = installFetch();
    renderWithProviders(<SemiReceiptPage />, "/semi-receipts?open=SR1");
    await screen.findByText("半成品入仓单 · SR1");
    expect(screen.getByLabelText("供应商")).toHaveValue("恒科");
    expect(screen.getByLabelText("订单单号")).toHaveValue("PO-1");
    expect(screen.getAllByText("彩盒").length).toBeGreaterThan(0);
    expect(screen.getByText("未审核")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/semi-receipts/SR1/approve") && c.method === "POST")).toBe(true),
    );
  });

  it("查询页签:汇总带 总合计;明细双击回单据页签打开整单", async () => {
    installFetch();
    renderWithProviders(<SemiReceiptPage />, "/semi-receipts");
    await screen.findByText("半成品入仓单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "半成品入仓查询" }));
    await screen.findByText(/总合计:5/);
    fireEvent.click(screen.getByRole("button", { name: "明细查询" }));
    const cell = (await screen.findAllByText("SR1"))[0];
    fireEvent.doubleClick(cell.closest("tr")!);
    await screen.findByText("半成品入仓单 · SR1");
  });

  it("无「保存」位:新建/保存按钮不渲染", async () => {
    installFetch([{ 组: "半成品仓储", 菜单: "半成品入仓", 打开: true, 审核: true }]);
    renderWithProviders(<SemiReceiptPage />, "/semi-receipts");
    await screen.findByText("半成品入仓单(新建)");
    // 权限加载完成前乐观放行,等权限就位后按钮被过滤
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "新建" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    });
  });
});
