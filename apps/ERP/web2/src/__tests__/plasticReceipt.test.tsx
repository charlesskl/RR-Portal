// 塑胶入仓单(塑胶仓)全量对齐:逐场景对照老系统
// web/src/pages/plastics/PlasticReceiptFormPage.tsx、PlasticReceiptLineTable.tsx、
// PlasticPurchaseOrderDrawer.tsx 与 plasticPurchaseOrderDrawerStock.test.ts。
// 业务口径:单级审核=入库存;?单号= 直开指定单;?ppo= 下推带入;
// 喷油排期改单由后端后台更新未审核入仓单,前端重开/审核后 refetch 展示最新;
// 采购行带生产单号 -> 行锁定(同 Task 4 replenishPoLock 口径)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticReceiptPage from "@/pages/PlasticReceiptPage";
import {
  buildPlasticReceiptPrintHtml,
  filterOwedOrders,
  owedOrders,
  progressRowToLine,
  sumAmount,
  toSubmitLine,
  validLines,
} from "@/lib/plasticReceipt";
import type {
  PlasticPurchaseProgressRow,
  PlasticReceiptDetail,
  PlasticReceiptHeader,
} from "@/api/types";

// ---------- 测试基建:fetch 路由桩 ----------

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const noContent = () => new Response(null, { status: 204 });

// 权限键与后端 MenuCatalog 一致:单据「塑胶入仓单」(组 塑胶仓储),查询「塑胶入仓查询」
const PERMS_FULL = [
  { 组: "塑胶仓储", 菜单: "塑胶入仓单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
  { 组: "塑胶报表", 菜单: "塑胶入仓查询", 打开: true, 保存: false, 删除: false, 打印: true, 单价: true, 金额: true, 审核: false, 反审核: false, 功能: false },
];
const permsPatch = (menu: string, patch: Record<string, boolean>) =>
  PERMS_FULL.map((r) => (r.菜单 === menu ? { ...r, ...patch } : r));

const PR_UNAUDITED: PlasticReceiptHeader = {
  id: 1,
  单号: "SR20260915001",
  日期: "2026-09-15",
  供应商编号: "S-01",
  供应商名称: "兴发塑胶",
  仓库: "塑胶仓",
  数量: 30,
  金额: 75,
  操作员: "admin",
  审核: "0",
  订单单号: "PO-9",
  电脑单号: "DN-9",
  备注: "急用",
};
const PR_AUDITED: PlasticReceiptHeader = { ...PR_UNAUDITED, 审核: "1", 审核人: "admin" };

const receiptDetailOf = (h: PlasticReceiptHeader, 数量 = 30): PlasticReceiptDetail => ({
  单头: { ...h, 数量 },
  明细: [
    {
      id: 1,
      订单单号: "PO-9",
      生产单号: "SC-1",
      款号: "K-1",
      物料编号: "PM-1",
      工模编号: "GM-1",
      物料名称: "ABS粒",
      规格: "S",
      颜色: "黑",
      塑胶货号: "HH-1",
      仓位号: "A01",
      单位: "KG",
      数量,
      单价: 2.5,
      金额: 数量 * 2.5,
      备注: "",
    },
  ],
});

// 塑胶采购订单进度欠数行:PO-A 已审核两行(一行挂生产单号,一行不挂);PO-B 未审核;PO-C 已审核
const PROGRESS: PlasticPurchaseProgressRow[] = [
  { 采购单号: "PO-A", 审核: "1", 供应商名称: "兴发塑胶", 订购日期: "2026-09-10", 生产单号: "SC-9", 款号: "K9", 物料编号: "PM-7", 物料名称: "PP粒", 模具编号: "MJ-7", 颜色: "白", 单位: "KG", 订购数量: 100, 入仓数量: 60, 欠数: 40 },
  { 采购单号: "PO-A", 审核: "1", 供应商名称: "兴发塑胶", 订购日期: "2026-09-10", 款号: "K10", 物料编号: "PM-8", 物料名称: "色粉", 颜色: "红", 单位: "KG", 订购数量: 10, 入仓数量: 5, 欠数: 5 },
  { 采购单号: "PO-B", 审核: "0", 供应商名称: "未审供应商", 订购日期: "2026-09-11", 物料编号: "PM-X", 欠数: 3 },
  { 采购单号: "PO-C", 审核: "1", 供应商名称: "广源胶业", 订购日期: "2026-09-12", 物料编号: "PM-9", 欠数: 8 },
];

const SUPPLIERS = { items: [{ 供应商编号: "S-01", 供应商名称: "兴发塑胶" }], total: 1 };
const PLASTIC_MATERIALS = {
  items: [{ id: 9, 物料编号: "PM-9", 物料名称: "ABS再生粒", 规格: "M", 颜色: "灰", 仓位号: "B02", 单位: "KG" }],
  total: 1,
};
const PRODUCTIONS = [
  { 生产单号: "SC001", 款号: "K1", 款式: "玩具车", 客户名称: "客户A", 计划数量: 100, 未完成数: 40, 交货日期: "2026-09-30" },
];
const WH_OPTIONS = [{ 编号: "02", 名称: "塑胶仓" }];

// 塑胶入仓查询数据源
const QUERY_DETAIL = [
  {
    日期: "2026-09-15",
    单号: "SR20260915001",
    订单单号: "PO-9",
    生产单号: "SC-1",
    款号: "K-1",
    工模编号: "GM-1",
    物料编号: "PM-1",
    物料名称: "ABS粒",
    颜色: "黑",
    塑胶货号: "HH-1",
    共用货号: "",
    供应商: "兴发塑胶",
    单位: "KG",
    数量: 30,
    单价: 2.5,
    金额: 75,
    备注: "",
    审核: "1",
  },
];
const QUERY_SUMMARY = [
  { 物料编号: "PM-1", 物料名称: "ABS粒", 颜色: "黑", 塑胶货号: "HH-1", 共用货号: "", 共用物料: "", 物料类别: "胶料", 单位: "KG", 数量: 30, 金额: 75 },
];

interface Cfg {
  perms: unknown;
  first: unknown;
  list: unknown;
  detail: PlasticReceiptDetail;
  progress: PlasticPurchaseProgressRow[];
  ppoDetail: unknown;
  suppliers: unknown;
  materials: unknown;
  materialSetting: unknown;
  productions: unknown;
  whOptions: unknown;
  qd: unknown;
  qs: unknown;
  cats: unknown;
  onCall?: (c: Call) => Response | undefined;
}

function baseCfg(): Cfg {
  return {
    perms: PERMS_FULL,
    first: { items: [PR_UNAUDITED], total: 1 },
    list: { items: [PR_UNAUDITED], total: 1 },
    detail: receiptDetailOf(PR_UNAUDITED),
    progress: PROGRESS,
    ppoDetail: { 单头: { 单号: "PO-A", 供应商编号: "S-01", 供应商名称: "兴发塑胶" }, 明细: [] },
    suppliers: SUPPLIERS,
    materials: PLASTIC_MATERIALS,
    materialSetting: { 物料编号: "PM-9", 默认仓库: "塑胶仓" },
    productions: PRODUCTIONS,
    whOptions: WH_OPTIONS,
    qd: QUERY_DETAIL,
    qs: QUERY_SUMMARY,
    cats: [{ 编号: "1", 类别: "胶料", 数量: 3 }],
  };
}

function installFetch(cfg: Cfg) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      const call: Call = { url, method, body };
      calls.push(call);
      const custom = cfg.onCall?.(call);
      if (custom) return custom;
      const u = new URL(url, "http://test");
      const p = u.pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(cfg.perms));
      // 塑胶入仓查询
      if (p === "/api/plastic-receipt-query/detail") return json(cfg.qd);
      if (p === "/api/plastic-receipt-query/summary") return json(cfg.qs);
      // 塑胶入仓单
      if (p === "/api/plastic-receipts" && method === "GET")
        return u.searchParams.get("size") === "1" ? json(cfg.first) : json(cfg.list);
      if (p === "/api/plastic-receipts" && method === "POST")
        return json({ 单号: "SR20260916001" }, 201);
      if (/^\/api\/plastic-receipts\/[^/]+\/(approve|unapprove)$/.test(p)) return noContent();
      if (/^\/api\/plastic-receipts\/[^/]+$/.test(p) && method === "GET") return json(cfg.detail);
      if (/^\/api\/plastic-receipts\/[^/]+$/.test(p) && method === "DELETE") return noContent();
      // 从采购单带入数据源
      if (p === "/api/plastic-purchase-progress") return json(cfg.progress);
      if (/^\/api\/plastic-purchase-orders\/[^/]+$/.test(p)) return json(cfg.ppoDetail);
      // 选择器/主数据
      if (p === "/api/master/suppliers") return json(cfg.suppliers);
      if (p === "/api/master/warehouse-locations/options") return json(cfg.whOptions);
      if (p === "/api/plastic-material-master/categories") return json(cfg.cats);
      if (p === "/api/plastic-material-master") return json(cfg.materials);
      if (p.startsWith("/api/plastic-material-settings/lookup/")) {
        if (cfg.materialSetting == null) return json({ 消息: "未设置" }, 404);
        return json(cfg.materialSetting);
      }
      if (p === "/api/production-reports/tracking") return json(cfg.productions);
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (cfg: Cfg, route = "/plastic-receipts") => {
  const calls = installFetch(cfg);
  renderWithProviders(<PlasticReceiptPage />, route);
  return calls;
};

// SearchSelect:点开按钮再点选项(替代原生 select 的 fireEvent.change)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

// 路由探针:观察 URL 参数是否被消费清理
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="loc-search">{loc.search}</span>;
}
const setupWithProbe = (cfg: Cfg, route: string) => {
  const calls = installFetch(cfg);
  renderWithProviders(
    <>
      <PlasticReceiptPage />
      <LocationProbe />
    </>,
    route,
  );
  return calls;
};

beforeEach(() => {
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ---------- 打开与查看 ----------

describe("打开与查看", () => {
  it("首进自动打开最新单:单头卡 + 明细保真列(工模编号/塑胶货号/单价/金额) + 状态徽章", async () => {
    setup(baseCfg());
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());

    expect(screen.getAllByText("兴发塑胶").length).toBeGreaterThan(0);
    expect(screen.getAllByText("塑胶仓").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PO-9").length).toBeGreaterThan(0);
    expect(screen.getByText("未审核")).toBeInTheDocument();
    // 明细保真列序字段(老系统 PlasticReceiptLineTable 列)
    for (const h of ["订单单号", "生产单号", "款号", "物料编号", "工模编号", "物料名称", "颜色", "塑胶货号", "单位", "数量", "单价", "金额"]) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("GM-1")).toBeInTheDocument();
    expect(screen.getByText("HH-1")).toBeInTheDocument();
    // 未审核:审核(入仓)/删除/打印入口在,反审核不在
    expect(screen.getByRole("button", { name: "审核(入仓)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "反审核" })).not.toBeInTheDocument();
  });

  it("?单号= 参数直开指定单(不依赖首进最新单),消费后清掉 URL 参数", async () => {
    const cfg = baseCfg();
    cfg.first = { items: [], total: 0 };
    const calls = setupWithProbe(cfg, "/plastic-receipts?单号=SR20260915001");
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    expect(
      calls.some((c) => c.method === "GET" && c.url === "/api/plastic-receipts/SR20260915001"),
    ).toBe(true);
    expect(screen.getByText("GM-1")).toBeInTheDocument();
    // 消费后参数被清理(与 ?ppo= 口径一致),keep-alive 下同实例再次带参导航可重新生效
    await waitFor(() => expect(screen.getByTestId("loc-search").textContent).toBe(""));
  });

  it("打开弹窗:列表列(送货单号/日期/供应商/仓库/数量/金额/状态) + 点行载入", async () => {
    const cfg = baseCfg();
    cfg.first = { items: [], total: 0 };
    setup(cfg);
    await waitFor(() => expect(screen.getByText("尚未打开单据")).toBeInTheDocument());

    fireEvent.click(screen.getByText("打开"));
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    for (const h of ["送货单号", "供应商", "仓库", "状态"]) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }

    fireEvent.click(screen.getByText("SR20260915001"));
    await waitFor(() => expect(screen.getByText("GM-1")).toBeInTheDocument());
  });
});

// ---------- 从采购单带入 ----------

describe("从采购单带入", () => {
  const gotoNew = async () => {
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));
  };

  it("弹窗:按采购单号去重,只列已审核有欠数单;关键字按 单号/供应商 过滤", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    fireEvent.click(screen.getByText("从采购单带入"));

    await waitFor(() => expect(screen.getByText("PO-A")).toBeInTheDocument());
    expect(screen.getByText("PO-C")).toBeInTheDocument();
    expect(screen.queryByText("PO-B")).not.toBeInTheDocument(); // 未审核不列
    expect(
      calls.some((c) => c.url.startsWith("/api/plastic-purchase-progress") && c.url.includes("onlyOwed=true")),
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("采购单过滤"), { target: { value: "广源" } });
    expect(screen.queryByText("PO-A")).not.toBeInTheDocument();
    expect(screen.getByText("PO-C")).toBeInTheDocument();
  });

  it("点单带入:数量=欠数(全收),表头供应商/订单单号带出,空白行被丢弃;挂生产单号的行锁定", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    // 先加一行空白行
    fireEvent.click(screen.getByText("加一行"));
    expect(screen.getAllByLabelText("数量")).toHaveLength(1);

    fireEvent.click(screen.getByText("从采购单带入"));
    await waitFor(() => expect(screen.getByText("PO-A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("PO-A"));

    await waitFor(() => expect(screen.getByText(/已带入 2 行/)).toBeInTheDocument());
    // 进度表无供应商编号,取采购订单单头补齐
    expect(calls.some((c) => c.url === "/api/plastic-purchase-orders/PO-A")).toBe(true);
    expect(screen.getByLabelText("供应商")).toHaveValue("兴发塑胶");
    // [0]=表头订单单号,[1]/[2]=明细行订单单号
    const orderInputs = screen.getAllByLabelText("订单单号");
    expect(orderInputs[0]).toHaveValue("PO-A");
    expect(orderInputs[1]).toHaveValue("PO-A");

    const qtyInputs = screen.getAllByLabelText("数量");
    expect(qtyInputs).toHaveLength(2); // 空白行被丢弃
    expect(qtyInputs[0]).toHaveValue(40);
    expect(qtyInputs[1]).toHaveValue(5);

    // 挂生产单号(SC-9)的行锁定 disabled + tooltip;未挂的行仍可编辑(有「选」钮)
    const prodInputs = screen.getAllByLabelText("生产单号");
    expect(prodInputs[0]).toBeDisabled();
    expect(prodInputs[0]).toHaveValue("SC-9");
    expect(prodInputs[0]).toHaveAttribute("title", "采购行已挂生产单号,锁定不可改(贯穿到入库/统计)");
    expect(prodInputs[1]).not.toBeDisabled();
    expect(screen.getAllByLabelText("工模编号")[0]).toHaveValue("MJ-7");
  });

  it("下推入口:URL ?ppo=采购单号 自动带入欠数行并进新建态", async () => {
    const calls = setup(baseCfg(), "/plastic-receipts?ppo=PO-A");
    await waitFor(() => expect(screen.getByText(/已带入 2 行/)).toBeInTheDocument());
    expect(screen.getByLabelText("送货单号")).toBeInTheDocument(); // 新建态表单
    expect(screen.getAllByLabelText("数量")[0]).toHaveValue(40);
    expect(
      calls.some((c) => c.url.startsWith("/api/plastic-purchase-progress") && c.url.includes("onlyOwed=true")),
    ).toBe(true);
  });

  it("下推的采购单无欠数行:提示且不带入(?ppo= 空进度)", async () => {
    const cfg = baseCfg();
    cfg.progress = [];
    setup(cfg, "/plastic-receipts?ppo=PO-Z");
    await waitFor(() => expect(screen.getByText("采购单 PO-Z 无欠数行")).toBeInTheDocument());
    expect(screen.queryAllByLabelText("数量")).toHaveLength(0);
  });
});

// ---------- 手选物料 / 生产制单 ----------

describe("新建·手选", () => {
  it("手选物料:回填名称/规格/颜色/仓位号/单位;塑胶物料设置预填默认仓库(不覆盖已填)", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));

    fireEvent.click(screen.getByText("加一行"));
    fireEvent.click(screen.getByLabelText("物料编号选择"));
    await waitFor(() => expect(screen.getByText("ABS再生粒")).toBeInTheDocument());
    fireEvent.click(screen.getByText("ABS再生粒").closest("tr")!);

    await waitFor(() => expect(screen.getByLabelText("物料编号")).toHaveValue("PM-9"));
    expect(screen.getAllByText("ABS再生粒").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("颜色")).toHaveValue("灰");
    // 默认仓库预填(表头仓库为空 -> 塑胶仓)
    await waitFor(() => expect(screen.getByLabelText("仓库")).toHaveTextContent("塑胶仓"));
    expect(calls.some((c) => c.url === "/api/plastic-material-settings/lookup/PM-9")).toBe(true);
  });

  it("生产制单选择器:回填生产单号/款号(仅列已审核,审核=1)", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));

    fireEvent.click(screen.getByText("加一行"));
    fireEvent.click(screen.getByLabelText("生产单号选择"));
    await waitFor(() => expect(screen.getByText("玩具车")).toBeInTheDocument());
    const trackingReq = calls.find((c) => c.url.startsWith("/api/production-reports/tracking"))!;
    expect(decodeURIComponent(trackingReq.url)).toContain("审核=1");
    fireEvent.click(screen.getByText("SC001").closest("tr")!);

    expect(screen.getByLabelText("生产单号")).toHaveValue("SC001");
    expect(screen.getByLabelText("款号")).toHaveValue("K1");
  });
});

// ---------- 保存校验与提交 ----------

describe("保存", () => {
  it("逐级校验:缺送货单号/缺供应商/缺仓库/无有效明细分别拦截,不发 POST", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));
    const noPost = () => calls.some((c) => c.method === "POST" && c.url === "/api/plastic-receipts");

    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请填写送货单号")).toBeInTheDocument());
    expect(noPost()).toBe(false);

    fireEvent.change(screen.getByLabelText("送货单号"), { target: { value: "SH-001" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请选供应商")).toBeInTheDocument());
    expect(noPost()).toBe(false);

    // 选供应商
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    await waitFor(() => expect(screen.getByText("兴发塑胶")).toBeInTheDocument());
    fireEvent.click(screen.getByText("兴发塑胶").closest("tr")!);
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请选择仓库")).toBeInTheDocument());
    expect(noPost()).toBe(false);

    pickOption("仓库", "02 塑胶仓");
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(screen.getByText("请至少录入一行有效物料明细(物料编号+数量)")).toBeInTheDocument(),
    );
    expect(noPost()).toBe(false);
  });

  it("保存成功:POST 载荷对照后端 DTO(送货单号/供应商/仓库/订单单号;明细空串不带,单价空不带,锁定行带生产单号)", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));

    // 从采购单带入(含锁定行)
    fireEvent.click(screen.getByText("从采购单带入"));
    await waitFor(() => expect(screen.getByText("PO-A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("PO-A"));
    await waitFor(() => expect(screen.getByText(/已带入 2 行/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("送货单号"), { target: { value: "SH-2026" } });
    pickOption("仓库", "02 塑胶仓");
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/plastic-receipts")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/plastic-receipts")!;
    expect(post.body).toMatchObject({
      单号: "SH-2026",
      供应商编号: "S-01",
      供应商名称: "兴发塑胶",
      仓库: "塑胶仓",
      订单单号: "PO-A",
    });
    const lines = post.body!.明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      订单单号: "PO-A",
      生产单号: "SC-9",
      款号: "K9",
      物料编号: "PM-7",
      工模编号: "MJ-7",
      数量: 40,
    });
    expect(lines[0].单价).toBeUndefined();
    expect(lines[1]).toMatchObject({ 物料编号: "PM-8", 数量: 5 });
    expect(lines[1].生产单号).toBeUndefined();
    await waitFor(() => expect(screen.getByText(/塑胶入仓单已创建:SR20260916001/)).toBeInTheDocument());
  });
});

// ---------- 审核流转(审核=入库存) / 反审核 / 删除 ----------

describe("审核流转", () => {
  it("审核(入仓):POST approve 后重取详情,状态变已审核,出现反审核,删除消失", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      if (c.url.endsWith("/approve")) cfg.detail = receiptDetailOf(PR_AUDITED);
      return undefined;
    };
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getByRole("button", { name: "审核(入仓)" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "审核(入仓)" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/plastic-receipts/SR20260915001/approve")).toBe(true),
    );
    // 审核后 refetch 详情(刷新时机:数量/状态以最新为准)
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());
    expect(
      calls.filter((c) => c.method === "GET" && c.url === "/api/plastic-receipts/SR20260915001").length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "反审核" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审核(入仓)" })).not.toBeInTheDocument();
  });

  it("审核返回 {提示}(已生成目标仓入仓单)时优先展示提示文案", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      if (c.url.endsWith("/approve")) {
        cfg.detail = receiptDetailOf(PR_AUDITED);
        return json({ 提示: "已生成半成品仓入仓单(未审核,待仓库侧审核过账)" });
      }
      return undefined;
    };
    setup(cfg);
    await waitFor(() => expect(screen.getByRole("button", { name: "审核(入仓)" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "审核(入仓)" }));
    await waitFor(() =>
      expect(screen.getByText(/已生成半成品仓入仓单/)).toBeInTheDocument(),
    );
  });

  it("审核返回 {提示}+{警告} 组合时合并展示且用 ok 语义(审核本身已成功)", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      if (c.url.endsWith("/approve")) {
        cfg.detail = receiptDetailOf(PR_AUDITED);
        return json({ 提示: "已生成半成品仓入仓单(未审核)", 警告: "排产推送失败:网络超时" });
      }
      return undefined;
    };
    setup(cfg);
    await waitFor(() => expect(screen.getByRole("button", { name: "审核(入仓)" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "审核(入仓)" }));
    const toast = await screen.findByText(/已生成半成品仓入仓单.*;.*排产推送失败/);
    // ok tone = 绿字(text-[#15803d]);err tone 为 text-[#dc2626]
    expect(toast.className).toContain("text-[#15803d]");
    expect(toast.className).not.toContain("text-[#dc2626]");
  });

  it("已审核单:反审核 POST 后回到未审核;删除未审核单确认后 DELETE 回新建态", async () => {
    const cfg = baseCfg();
    cfg.first = { items: [PR_AUDITED], total: 1 };
    cfg.detail = receiptDetailOf(PR_AUDITED);
    cfg.onCall = (c) => {
      if (c.url.endsWith("/unapprove")) cfg.detail = receiptDetailOf(PR_UNAUDITED);
      return undefined;
    };
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "反审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/plastic-receipts/SR20260915001/unapprove")).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.getByText("确认删除该塑胶入仓单?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认删除"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url === "/api/plastic-receipts/SR20260915001"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("已删除")).toBeInTheDocument());
  });
});

// ---------- 塑胶入仓查询页签 ----------

describe("塑胶入仓查询", () => {
  it("查询页签:默认本月区间请求明细;列含 订单单号/工模编号/塑胶货号/共用货号/供应商/审核;切汇总查询", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "塑胶入仓查询" }));
    await waitFor(() => expect(screen.getByText("HH-1")).toBeInTheDocument());
    const d = calls.find((c) => c.url.startsWith("/api/plastic-receipt-query/detail"))!;
    expect(decodeURIComponent(d.url)).toContain("起=");
    expect(decodeURIComponent(d.url)).toContain("止=");
    // 明细特有列(对照老系统 PlasticReceiptQueryPage detailColumns)
    for (const h of ["订单单号", "工模编号", "塑胶货号", "共用货号", "供应商", "审核"]) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }
    // 有单价位:单价/金额列在
    expect(screen.getAllByText("单价").length).toBeGreaterThan(0);
    expect(screen.getAllByText("金额").length).toBeGreaterThan(0);
    expect(screen.getByText("共 1 条,双击行打开塑胶入仓单整单")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "汇总查询" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith("/api/plastic-receipt-query/summary"))).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("ABS粒")).toBeInTheDocument());
    // 汇总列无 审核/单价
    expect(screen.queryByText("审核")).not.toBeInTheDocument();
  });

  it("过滤下发:审核情况/物料类别/关键字;双击明细行回单据页签打开整单", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "塑胶入仓查询" }));
    await waitFor(() => expect(screen.getByText("HH-1")).toBeInTheDocument());

    pickOption("审核情况", "已审核");
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("plastic-receipt-query/detail") && decodeURIComponent(c.url).includes("审核情况=已审核")),
      ).toBe(true),
    );
    pickOption("物料类别", "胶料(3)");
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("plastic-receipt-query/detail") && decodeURIComponent(c.url).includes("物料类别=胶料")),
      ).toBe(true),
    );
    fireEvent.change(screen.getByPlaceholderText("物料编号/名称/生产单号/款号"), {
      target: { value: "PM-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("plastic-receipt-query/detail") && decodeURIComponent(c.url).includes("keyword=PM-1")),
      ).toBe(true),
    );

    // 双击明细行 -> 回单据页签并打开该入仓单(强制重取详情)
    const before = calls.filter(
      (c) => c.method === "GET" && c.url === "/api/plastic-receipts/SR20260915001",
    ).length;
    fireEvent.doubleClick(screen.getByText("HH-1").closest("tr")!);
    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === "GET" && c.url === "/api/plastic-receipts/SR20260915001").length,
      ).toBeGreaterThan(before),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "审核(入仓)" })).toBeInTheDocument());
  });

  it("权限:无「塑胶入仓查询·单价」位不出单价/金额列;无「打开」位整页提示无权", async () => {
    const cfg = baseCfg();
    cfg.perms = permsPatch("塑胶入仓查询", { 单价: false, 金额: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "塑胶入仓查询" }));
    await waitFor(() => expect(screen.getByText("HH-1")).toBeInTheDocument());
    expect(screen.queryByText("单价")).not.toBeInTheDocument();
    expect(screen.queryByText("金额")).not.toBeInTheDocument();

    cleanup();
    const cfg2 = baseCfg();
    cfg2.perms = permsPatch("塑胶入仓查询", { 打开: false });
    setup(cfg2);
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "塑胶入仓查询" }));
    await waitFor(() => expect(screen.getByText("无权访问塑胶入仓查询")).toBeInTheDocument());
  });
});

// ---------- 喷油改单自动更新的展示与刷新 ----------

describe("喷油改单展示", () => {
  it("未审核入仓单被后台改单后,重开同一单 refetch 展示最新数量", async () => {
    const cfg = baseCfg();
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    // 查看态数量 = 30(单头卡 + 明细行各一处)
    expect(screen.getAllByText("30").length).toBeGreaterThan(0);

    // 模拟喷油排期改单:后端把该未审核入仓单数量改为 55
    cfg.detail = receiptDetailOf(PR_UNAUDITED, 55);

    // 通过打开弹窗重开同一单 -> 强制 refetch,展示新数量
    fireEvent.click(screen.getByText("打开"));
    const dialog = await screen.findByRole("dialog");
    const row = await within(dialog).findByText("SR20260915001");
    const detailGets = () =>
      calls.filter((c) => c.method === "GET" && c.url === "/api/plastic-receipts/SR20260915001").length;
    const before = detailGets();
    fireEvent.click(row);
    // 重开触发新的 GET detail(refetch)
    await waitFor(() => expect(detailGets()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getAllByText("55").length).toBeGreaterThan(0));
    expect(screen.queryByText("30")).not.toBeInTheDocument();
  });
});

// ---------- 打印 ----------

describe("打印", () => {
  it("查看态点「打印」:开新窗口渲染单头+明细(含 工模编号/塑胶货号/单价/金额)", async () => {
    const written: string[] = [];
    vi.spyOn(window, "open").mockReturnValue({
      document: { write: (s: string) => written.push(s), close: () => {} },
      focus: () => {},
      print: () => {},
    } as unknown as Window);
    setup(baseCfg());
    await waitFor(() => expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "打印" }));
    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0]).toContain("塑胶入仓单 SR20260915001");
    expect(written[0]).toContain("兴发塑胶");
    expect(written[0]).toContain("塑胶仓");
    expect(written[0]).toContain("工模编号");
    expect(written[0]).toContain("塑胶货号");
    expect(written[0]).toContain("GM-1");
    expect(written[0]).toContain("HH-1");
    expect(written[0]).toContain("单价");
  });

  it("无「单价」位:打印不出单价/金额列", async () => {
    const written: string[] = [];
    vi.spyOn(window, "open").mockReturnValue({
      document: { write: (s: string) => written.push(s), close: () => {} },
      focus: () => {},
      print: () => {},
    } as unknown as Window);
    const cfg = baseCfg();
    cfg.perms = permsPatch("塑胶入仓单", { 单价: false, 金额: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "打印" }));
    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0]).not.toContain("单价");
    expect(written[0]).not.toContain("<th>金额</th>");
  });
});

// ---------- 权限位 ----------

describe("权限位", () => {
  it("无「保存」位:新建/保存按钮不渲染", async () => {
    const cfg = baseCfg();
    cfg.perms = permsPatch("塑胶入仓单", { 保存: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("button", { name: "新建" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "打开" })).toBeInTheDocument();
  });

  it("无「审核」位:审核(入仓)不渲染;无「删除」位:删除不渲染", async () => {
    const cfg = baseCfg();
    cfg.perms = permsPatch("塑胶入仓单", { 审核: false, 删除: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "审核(入仓)" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument();
  });

  it("无「反审核」位:已审核单不渲染反审核;无「打印」位:打印不渲染", async () => {
    const cfg = baseCfg();
    cfg.first = { items: [PR_AUDITED], total: 1 };
    cfg.detail = receiptDetailOf(PR_AUDITED);
    cfg.perms = permsPatch("塑胶入仓单", { 反审核: false, 打印: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "反审核" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "打印" })).not.toBeInTheDocument();
  });

  it("无「单价」位:编辑网格无单价/金额列、金额合计隐藏,查看态金额 ***", async () => {
    const cfg = baseCfg();
    cfg.perms = permsPatch("塑胶入仓单", { 单价: false, 金额: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("SR20260915001")).toBeInTheDocument());
    // 查看态单价/金额脱敏
    expect(screen.getAllByText("***").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("新建"));
    fireEvent.click(screen.getByText("加一行"));
    expect(screen.queryByLabelText("单价")).not.toBeInTheDocument();
    expect(screen.queryByText(/金额合计/)).not.toBeInTheDocument();
    expect(screen.getByText(/数量合计/)).toBeInTheDocument();
  });
});

// ---------- 纯函数(对照老系统 PlasticReceiptFormPage/LineTable 映射与过滤) ----------

describe("从采购单带入 · 纯函数", () => {
  it("owedOrders:只保留已审核单,按采购单号去重保首现序", () => {
    const orders = owedOrders(PROGRESS);
    expect(orders.map((r) => r.采购单号)).toEqual(["PO-A", "PO-C"]);
  });

  it("filterOwedOrders:按 采购单号/供应商名称 前端过滤,空关键字原样返回", () => {
    const orders = owedOrders(PROGRESS);
    expect(filterOwedOrders(orders, "")).toHaveLength(2);
    expect(filterOwedOrders(orders, "PO-C").map((r) => r.采购单号)).toEqual(["PO-C"]);
    expect(filterOwedOrders(orders, "广源").map((r) => r.采购单号)).toEqual(["PO-C"]);
    expect(filterOwedOrders(orders, "不存在")).toEqual([]);
  });

  it("progressRowToLine:数量=欠数;工模编号←模具编号;挂生产单号则锁定,未挂不锁", () => {
    const locked = progressRowToLine(PROGRESS[0], "PO-A", 1);
    expect(locked).toMatchObject({
      订单单号: "PO-A",
      生产单号: "SC-9",
      锁定生产单号: true,
      款号: "K9",
      物料编号: "PM-7",
      工模编号: "MJ-7",
      数量: "40",
      单价: "",
    });
    const free = progressRowToLine(PROGRESS[1], "PO-A", 2);
    expect(free.生产单号).toBeUndefined();
    expect(free.锁定生产单号).toBeUndefined();
    expect(free.数量).toBe("5");
  });

  it("validLines:必须有物料编号且数量>0", () => {
    const lines = [
      { key: 1, 物料编号: "PM-1", 数量: "5", 单价: "" },
      { key: 2, 物料编号: "", 数量: "5", 单价: "" },
      { key: 3, 物料编号: "PM-2", 数量: "0", 单价: "" },
    ];
    expect(validLines(lines).map((l) => l.物料编号)).toEqual(["PM-1"]);
  });

  it("toSubmitLine:空串不带,数量转数值,单价空不带;sumAmount 按 数量×单价", () => {
    const l = toSubmitLine({
      key: 1,
      订单单号: " PO-A ",
      生产单号: "SC-9",
      物料编号: "PM-7",
      工模编号: "MJ-7",
      颜色: "",
      数量: "40",
      单价: "",
    });
    expect(l).toMatchObject({ 订单单号: "PO-A", 生产单号: "SC-9", 物料编号: "PM-7", 数量: 40 });
    expect(l.颜色).toBeUndefined();
    expect(l.单价).toBeUndefined();
    expect(l.规格).toBeUndefined();
    expect(
      sumAmount([
        { key: 1, 数量: "10", 单价: "2.5" },
        { key: 2, 数量: "4", 单价: "" },
      ]),
    ).toBe(25);
  });

  it("buildPlasticReceiptPrintHtml:单头字段 + 保真列;hidePrice 不出价格列", () => {
    const detail = {
      单头: { 单号: "SR1", 日期: "2026-09-15", 供应商名称: "兴发塑胶", 仓库: "塑胶仓" },
      明细: [{ 物料编号: "PM-1", 工模编号: "GM-1", 塑胶货号: "HH-1", 数量: 30, 单价: 2.5, 金额: 75 }],
    };
    const html = buildPlasticReceiptPrintHtml("塑胶入仓单 SR1", detail, { hidePrice: false });
    expect(html).toContain("塑胶入仓单 SR1");
    expect(html).toContain("兴发塑胶");
    expect(html).toContain("工模编号");
    expect(html).toContain("HH-1");
    expect(html).toContain("单价");
    const hidden = buildPlasticReceiptPrintHtml("塑胶入仓单 SR1", detail, { hidePrice: true });
    expect(hidden).not.toContain("单价");
    expect(hidden).not.toContain("金额");
  });
});
