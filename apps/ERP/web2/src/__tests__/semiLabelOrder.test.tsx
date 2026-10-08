// 半成品标签单页:对照老系统 SemiFinishedLabelOrderPage + SemiLabelQueryPage +
// semiFinishedLabelOrderPage/Pickers/PrintPreview 测试的关键场景。
// 数量/每箱数量 改动重算 预计标签数;实需手改后不跟随;打印预览按实需展开卡片;
// 保存 POST 载荷;审核/反审核;查询页签双击明细行回单据页签。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import SemiLabelOrderPage from "@/pages/SemiLabelOrderPage";

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
  { 组: "半成品仓库", 菜单: "半成品标签单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
];

const ORDER = {
  ID: 1,
  电脑单号: "SBL1",
  日期: "2026-09-01",
  备注一: "备一",
  备注二: "",
  操作员: "tester",
  审核: "0",
  明细: [
    { ID: 11, 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 数量: 10, 每箱数量: 4, 预计标签数: 3, 实需标签数: 3, 备注: "" },
  ],
};

const PRODUCTS = {
  items: [{ 配件编号: "AAA0002", 客户: "ZURU", 产品货号: "9215B", 产品名称: "飞机", 产品装配名称: "胶袋", 数量: 12, 每箱数量: 5 }],
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
      if (p === "/api/semi-finished-label-orders") {
        if (init?.method === "POST") return json({ 电脑单号: "SBL-NEW" });
        return json({ items: [{ ID: 1, 电脑单号: "SBL1", 日期: "2026-09-01", 操作员: "tester", 审核: "0", 备注一: "备一", 备注二: null }], total: 1 });
      }
      if (p === "/api/semi-finished-label-orders/SBL1") return json(ORDER);
      if (p === "/api/semi-finished-label-orders/SBL-NEW")
        return json({ ...ORDER, ID: 2, 电脑单号: "SBL-NEW" });
      if (p === "/api/semi-finished-label-orders/products") return json(PRODUCTS);
      if (p.endsWith("/audit") || p.endsWith("/reverse-audit")) return json({});
      if (p === "/api/semi-label-query/summary")
        return json([{ 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 数量: 10, 每箱数量: 4, 预计标签数: 3, 实需标签数: 3 }]);
      if (p === "/api/semi-label-query/detail")
        return json([{ 日期: "2026-09-01", 单号: "SBL1", 配件编号: "AAA0001", 客户: "ZURU", 产品货号: "9215A", 产品名称: "恐龙", 产品装配名称: "彩盒", 数量: 10, 每箱数量: 4, 预计标签数: 3, 实需标签数: 3, 备注: "", 审核: "0" }]);
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

describe("SemiLabelOrderPage", () => {
  it("空明细保存校验:至少需要一条明细", async () => {
    installFetch();
    renderWithProviders(<SemiLabelOrderPage />, "/semi-finished-label-orders");
    await screen.findByRole("button", { name: "保存" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("至少需要一条明细");
  });

  it("选产品加行:数量/每箱带出并算 预计标签数=3(12/5 上取整);改数量重算;实需手改后不跟随", async () => {
    const calls = installFetch();
    renderWithProviders(<SemiLabelOrderPage />, "/semi-finished-label-orders");
    await screen.findByRole("button", { name: "选产品加行" });
    fireEvent.click(screen.getByRole("button", { name: "选产品加行" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("AAA0002"));
    fireEvent.doubleClick(screen.getByText("9215B").closest("tr")!);
    // 带出 数量 12 / 每箱 5 -> 预计=实需=3(首行;第二行是空白行)
    await waitFor(() => expect(screen.getAllByLabelText("数量")[0]).toHaveValue(12));
    expect(screen.getAllByLabelText("每箱数量")[0]).toHaveValue(5);
    expect(screen.getAllByLabelText("实需标签数")[0]).toHaveValue(3);
    // 改数量 25 -> 预计 5
    fireEvent.change(screen.getAllByLabelText("数量")[0], { target: { value: "25" } });
    expect(screen.getAllByLabelText("实需标签数")[0]).toHaveValue(5);
    // 手改实需 7,再改数量 50 -> 预计重算 10,实需保持 7
    fireEvent.change(screen.getAllByLabelText("实需标签数")[0], { target: { value: "7" } });
    fireEvent.change(screen.getAllByLabelText("数量")[0], { target: { value: "50" } });
    expect(screen.getAllByLabelText("实需标签数")[0]).toHaveValue(7);
    // 保存 POST 载荷(序号重排)
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/semi-finished-label-orders") && c.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.明细).toHaveLength(1);
      expect(body.明细[0]).toMatchObject({ 配件编号: "AAA0002", 数量: 50, 每箱数量: 5, 预计标签数: 10, 实需标签数: 7, 序号: 1 });
    });
  });

  it("打印预览:按实需标签数展开卡片(3 张,序号 1/3..3/3,带单据号)", async () => {
    installFetch();
    renderWithProviders(<SemiLabelOrderPage />, "/semi-finished-label-orders?open=SBL1");
    await screen.findByText("半成品标签单 · SBL1");
    fireEvent.click(screen.getByRole("button", { name: "打印" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("1/3"));
    expect(dlg).toHaveTextContent("2/3");
    expect(dlg).toHaveTextContent("3/3");
    expect(dlg).toHaveTextContent("SBL1");
    expect(within(dlg).getAllByText("9215A")).toHaveLength(3);
  });

  it("打开弹窗选单;审核 POST audit 后显示已审核", async () => {
    const calls = installFetch();
    renderWithProviders(<SemiLabelOrderPage />, "/semi-finished-label-orders");
    await screen.findByRole("button", { name: "打开" });
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("SBL1"));
    fireEvent.click(screen.getByText("SBL1").closest("tr")!);
    await screen.findByText("半成品标签单 · SBL1");
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/semi-finished-label-orders/SBL1/audit") && c.method === "POST")).toBe(true),
    );
  });

  it("查询页签:汇总列(预计/实需标签数);明细双击回单据页签打开整单", async () => {
    installFetch();
    renderWithProviders(<SemiLabelOrderPage />, "/semi-finished-label-orders");
    await screen.findByRole("button", { name: "半成品标签查询" });
    fireEvent.click(screen.getByRole("button", { name: "半成品标签查询" }));
    await screen.findByText("预计标签数");
    fireEvent.click(screen.getByRole("button", { name: "明细查询" }));
    const cell = await screen.findByText("SBL1");
    fireEvent.doubleClick(cell.closest("tr")!);
    await screen.findByText("半成品标签单 · SBL1");
  });

  it("无「保存」位:新建/保存不渲染", async () => {
    installFetch([{ 组: "半成品仓库", 菜单: "半成品标签单", 打开: true }]);
    renderWithProviders(<SemiLabelOrderPage />, "/semi-finished-label-orders");
    await screen.findByRole("button", { name: "打开" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument(),
    );
  });
});
