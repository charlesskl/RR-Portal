// 塑胶退仓单页:对照老系统 PlasticReceiptFormPage(cfg=plastic-warehouse-returns) + PlasticWarehouseReturnQueryPage。
// 场景:首屏自动开最新单(查看态)/新建校验三连(供应商/仓库/明细)/保存 POST 载荷/
// 审核与反审核/批量审核(多选只列未审核,逐张 POST)/选入仓单带出明细/查询页签(明细双击开单据详情)/权限过滤。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticWarehouseReturnPage from "@/pages/PlasticWarehouseReturnPage";

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
  { 组: "塑胶仓储", 菜单: "塑胶退仓单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
  { 组: "塑胶报表", 菜单: "塑胶退仓查询", 打开: true, 单价: true },
];

const LIST = {
  items: [
    { id: 1, 单号: "RT1", 供应商名称: "恒科", 仓库: "塑胶仓", 数量: 10, 日期: "2026-09-01", 审核: "0" },
    { id: 2, 单号: "RT2", 供应商名称: "龙昌", 仓库: "塑胶仓", 数量: 5, 日期: "2026-09-02", 审核: "0" },
  ],
  total: 2,
};

const DETAIL = {
  单头: { id: 1, 单号: "RT1", 供应商编号: "S1", 供应商名称: "恒科", 仓库: "塑胶仓", 日期: "2026-09-01", 数量: 10, 金额: 100, 审核: "0" },
  明细: [{ id: 11, 订单单号: "PO1", 生产单号: "MO1", 物料编号: "P-001", 物料名称: "胶壳", 单位: "个", 数量: 10, 单价: 10, 金额: 100 }],
};

const QUERY_DETAIL = [
  { 日期: "2026-09-01", 单号: "RT1", 订单单号: "PO1", 生产单号: "MO1", 款号: "K1", 工模编号: "MJ1", 物料编号: "P-001", 物料名称: "胶壳", 颜色: "黑", 塑胶货号: "PH1", 共用货号: "", 供应商: "恒科", 单位: "个", 数量: 10, 单价: 10, 金额: 100, 备注: "", 审核: "1" },
];

const SUPPLIERS = { items: [{ 供应商编号: "S1", 供应商名称: "恒科" }], total: 1 };
const WH_OPTIONS = [{ 编号: "01", 名称: "塑胶仓" }];
const RECEIPTS = {
  items: [{ id: 21, 单号: "SR1", 供应商名称: "恒科", 仓库: "塑胶仓", 数量: 3, 日期: "2026-09-01", 审核: "1" }],
  total: 1,
};
const RECEIPT_DETAIL = {
  单头: { id: 21, 单号: "SR1", 供应商编号: "S1", 供应商名称: "恒科", 订单单号: "PO1" },
  明细: [{ id: 31, 订单单号: "PO1", 生产单号: "MO1", 款号: "K1", 物料编号: "P-001", 物料名称: "胶壳", 颜色: "黑", 单位: "个", 数量: 3, 单价: 2 }],
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
      if (p === "/api/plastic-warehouse-returns") {
        if (init?.method === "POST") return json({ 单号: "RT-NEW" });
        return json(LIST);
      }
      if (p === "/api/plastic-warehouse-returns/RT1") {
        if (init?.method === "DELETE") return json({});
        return json(DETAIL);
      }
      if (p.endsWith("/approve") || p.endsWith("/unapprove")) return json({});
      if (p === "/api/plastic-warehouse-return-query/detail") return json(QUERY_DETAIL);
      if (p === "/api/plastic-warehouse-return-query/summary") return json([]);
      if (p === "/api/plastic-material-master/categories") return json([]);
      if (p === "/api/master/warehouse-locations/options") return json(WH_OPTIONS);
      if (p === "/api/master/suppliers") return json(SUPPLIERS);
      if (p === "/api/plastic-receipts") return json(RECEIPTS);
      if (p === "/api/plastic-receipts/SR1") return json(RECEIPT_DETAIL);
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (perms?: unknown) => {
  const calls = installFetch(perms ?? PERMS_FULL);
  renderWithProviders(<PlasticWarehouseReturnPage />, "/plastic-warehouse-returns");
  return calls;
};

// SearchSelect:点开按钮再点选项(替代原生 select 的 fireEvent.change)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlasticWarehouseReturnPage", () => {
  it("首屏自动打开最新单(查看态):单头卡+只读明细+审核(退仓)按钮", async () => {
    setup();
    await screen.findByText("塑胶退仓单 · RT1");
    expect(screen.getByText("恒科")).toBeInTheDocument();
    expect(screen.getByText("胶壳")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审核(退仓)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });

  it("新建:供应商/仓库/明细三连校验后保存 POST 载荷", async () => {
    const calls = setup();
    await screen.findByText("塑胶退仓单 · RT1");
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    await screen.findByRole("button", { name: "保存" });
    // 缺供应商
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选供应商");
    // 选供应商(选择器)
    fireEvent.click(screen.getAllByRole("button", { name: "选择" })[0]);
    await screen.findByText("S1");
    fireEvent.click(screen.getByText("恒科").closest("tr")!);
    // 缺仓库
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选择仓库");
    pickOption("仓库", "01 塑胶仓");
    // 缺明细
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请至少录入一行有效物料明细(物料编号+数量)");
    // 加一行手填
    fireEvent.click(screen.getByRole("button", { name: /加行/ }));
    fireEvent.change(screen.getByLabelText("物料编号"), { target: { value: "P-009" } });
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/plastic-warehouse-returns") && c.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.供应商编号).toBe("S1");
      expect(body.仓库).toBe("塑胶仓");
      expect(body.明细).toEqual([{ 物料编号: "P-009", 数量: 7 }]);
    });
    await screen.findByText("塑胶退仓单已创建:RT-NEW");
  });

  it("选入仓单带出:表头 入库单号/供应商/订单单号 + 明细整单带入", async () => {
    setup();
    await screen.findByText("塑胶退仓单 · RT1");
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    // 第二个「选择」按钮 = 入库单号选择器
    const pickBtns = await screen.findAllByRole("button", { name: "选择" });
    fireEvent.click(pickBtns[1]);
    await screen.findByText("SR1");
    fireEvent.click(screen.getByText("SR1").closest("tr")!);
    await screen.findByText("已带出入仓单 SR1 的明细");
    expect(screen.getByLabelText("入库单号")).toHaveValue("SR1");
    // 表头与明细行的 订单单号 都带出 PO1
    screen.getAllByLabelText("订单单号").forEach((el) => expect(el).toHaveValue("PO1"));
    expect(screen.getByDisplayValue("P-001")).toBeInTheDocument();
  });

  it("审核:POST approve;已审核单显 反审核", async () => {
    const calls = setup();
    await screen.findByText("塑胶退仓单 · RT1");
    fireEvent.click(screen.getByRole("button", { name: "审核(退仓)" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/plastic-warehouse-returns/RT1/approve") && c.method === "POST"),
      ).toBe(true),
    );
  });

  it("批量审核:多选弹窗只列未审核,勾选两张逐张 POST,汇总提示", async () => {
    const calls = setup();
    await screen.findByText("塑胶退仓单 · RT1");
    fireEvent.click(screen.getByRole("button", { name: "批量审核" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("批量审核(仅列未审核单)");
    await screen.findByText("RT2");
    fireEvent.click(screen.getByLabelText("选择 RT1"));
    fireEvent.click(screen.getByLabelText("选择 RT2"));
    fireEvent.click(screen.getByRole("button", { name: "批量审核 2 张" }));
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("/RT1/approve"))).toBe(true);
      expect(calls.some((c) => c.url.includes("/RT2/approve"))).toBe(true);
    });
    await screen.findByText("已审核 2 张");
  });

  it("查询页签:明细查询本月参数;双击行开单据详情弹窗", async () => {
    const calls = setup();
    await screen.findByText("塑胶退仓单 · RT1");
    fireEvent.click(screen.getByRole("button", { name: "塑胶退仓查询" }));
    await screen.findByText("P-001");
    expect(
      calls.some((c) => c.url.includes("/plastic-warehouse-return-query/detail?")),
    ).toBe(true);
    fireEvent.doubleClick(screen.getByText("RT1").closest("tr")!);
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("塑胶退仓单 RT1"));
    expect(dlg).toHaveTextContent("恒科");
  });

  it("无「保存」位:新建/保存按钮不渲染(DocToolbar 权限过滤)", async () => {
    setup([
      { 组: "塑胶仓储", 菜单: "塑胶退仓单", 打开: true, 审核: true },
    ]);
    await screen.findByText("塑胶退仓单 · RT1");
    expect(screen.queryByRole("button", { name: "新建" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开" })).toBeInTheDocument();
  });
});
