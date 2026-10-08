// 采购入仓单/采购退仓单(来料仓)全量对齐:逐场景对照老系统
// web/src/pages/materials/MaterialDocPage.tsx、MaterialDocCreateDrawer.tsx、MaterialLineTable.tsx、
// PurchaseReceiptQueryPage.tsx、PurchaseReturnQueryPage.tsx 与 materialDocs/tableExport 测试契约。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PurchaseReceiptPage, { PurchaseReturnsPage } from "@/pages/PurchaseReceiptPage";
import { inventoryApi } from "@/api/endpoints";
import {
  buildDocQuery,
  orderRowToLine,
  owedAfter,
  spareTogglePatch,
  sumQty,
  toSubmitLine,
  validLines,
  ALL_APPROVAL,
  ALL_CAT,
} from "@/lib/purchaseReceipt";
import { buildCsv } from "@/lib/tableExport";
import type {
  PurchaseReceiptDetail,
  PurchaseReceiptHeader,
  PurchaseReturnDetail,
  PurchaseReturnHeader,
} from "@/api/types";

// ---------- 测试基建:fetch 路由桩 ----------

type Call = { url: string; method: string; body?: Record<string, unknown> };

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const noContent = () => new Response(null, { status: 204 });

// 权限键用最新名(采购退仓单;旧名「采购出仓单」已迁移)
const PERMS_FULL = [
  { 组: "物料管理", 菜单: "采购订单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
  { 组: "物料管理", 菜单: "采购入仓单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
  { 组: "物料管理", 菜单: "采购退仓单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
];
const PERMS_NO_PRICE = PERMS_FULL.map((r) => ({ ...r, 单价: false, 金额: false }));
const PERMS_NO_AUDIT = PERMS_FULL.map((r) => ({ ...r, 审核: false }));

const RCPT_UNAUDITED: PurchaseReceiptHeader = {
  id: 1,
  单号: "SH20260915001",
  日期: "2026-09-15",
  供应商编号: "S1",
  供应商名称: "供应商A",
  仓库: "来料仓",
  付款方式: "月结",
  数量: 80,
  金额: 400,
  操作员: "admin",
  审核: "0",
  备注: "急",
};
const RCPT_AUDITED: PurchaseReceiptHeader = { ...RCPT_UNAUDITED, 审核: "1", 审核人: "admin" };

const receiptDetailOf = (h: PurchaseReceiptHeader): PurchaseReceiptDetail => ({
  单头: h,
  明细: [
    {
      id: 1,
      订单单号: "PO20260901001",
      生产单号: "SC-1",
      款号: "K-1",
      物料编号: "M-1",
      物料名称: "布料",
      物料类别: "面料",
      规格: "S",
      颜色: "红",
      单位: "PCS",
      数量: 80,
      单价: 5,
      金额: 400,
      备注: "",
    },
  ],
});

const RET_UNAUDITED: PurchaseReturnHeader = {
  id: 2,
  单号: "CT20260915001",
  日期: "2026-09-15",
  入仓单号: "SH20260915001",
  供应商编号: "S1",
  供应商名称: "供应商A",
  仓库: "来料仓",
  数量: 10,
  金额: 50,
  操作员: "admin",
  审核: "0",
};
const RET_AUDITED: PurchaseReturnHeader = { ...RET_UNAUDITED, 审核: "1", 审核人: "admin" };

const returnDetailOf = (h: PurchaseReturnHeader): PurchaseReturnDetail => ({
  单头: h,
  明细: [
    {
      id: 1,
      生产单号: "SC-1",
      款号: "K-1",
      物料编号: "M-1",
      物料名称: "布料",
      物料类别: "面料",
      规格: "S",
      颜色: "红",
      单位: "PCS",
      数量: 10,
      单价: 5,
      金额: 50,
    },
  ],
});

// 采购订单进度欠数行:PO20260901001 两行(供应商 S1) + PO20260902002 一行(供应商 S2)
const PROGRESS = [
  {
    订购日期: "2026-09-01",
    采购单号: "PO20260901001",
    生产单号: "SC-1",
    款号: "K-1",
    物料编号: "M-1",
    物料名称: "布料",
    物料类别: "面料",
    规格: "S",
    颜色: "红",
    单位: "PCS",
    订购数量: 100,
    入仓数量: 20,
    欠数: 80,
    供应商编号: "S1",
    供应商名称: "供应商A",
  },
  {
    订购日期: "2026-09-01",
    采购单号: "PO20260901001",
    生产单号: "SC-1",
    款号: "K-1",
    物料编号: "M-2",
    物料名称: "扣子",
    物料类别: "辅料",
    规格: "L",
    颜色: "白",
    单位: "粒",
    订购数量: 50,
    入仓数量: 0,
    欠数: 50,
    供应商编号: "S1",
    供应商名称: "供应商A",
  },
  {
    订购日期: "2026-09-02",
    采购单号: "PO20260902002",
    生产单号: "SC-2",
    款号: "K-2",
    物料编号: "M-3",
    物料名称: "拉链",
    物料类别: "辅料",
    规格: "5#",
    颜色: "黑",
    单位: "条",
    订购数量: 30,
    入仓数量: 0,
    欠数: 30,
    供应商编号: "S2",
    供应商名称: "供应商B",
  },
];

const SUPPLIERS = {
  items: [
    { 供应商编号: "S1", 供应商名称: "供应商A" },
    { 供应商编号: "S2", 供应商名称: "供应商B" },
  ],
  total: 2,
};

const MATERIALS = {
  items: [
    {
      id: 1,
      物料编号: "M-9",
      物料名称: "松紧带",
      规格: "2cm",
      物料类别: "辅料",
      颜色: "白",
      单位: "米",
      单价: 1.5,
      库存: 300,
    },
  ],
  total: 1,
};

const CATS = [{ 编号: "1", 类别: "面料", 数量: 3 }];

const RCPT_QD = [
  {
    日期: "2026-09-15",
    单号: "TM001",
    入库单号: "SH20260915001",
    订单单号: "PO20260901001",
    供应商编号: "S1",
    供应商名称: "供应商A",
    生产单号: "SC-1",
    款号: "K-1",
    物料编号: "M-1",
    物料名称: "布料",
    物料类别: "面料",
    规格: "S",
    颜色: "红",
    单位: "PCS",
    数量: 80,
    备注: "",
    审核: "1",
  },
];
const RCPT_QS = [
  { 物料编号: "M-1", 物料名称: "布料", 物料类别: "面料", 规格: "S", 颜色: "红", 单位: "PCS", 数量: 80 },
];
const RET_QD = [
  {
    日期: "2026-09-15",
    单号: "CT20260915001",
    供应商编号: "S1",
    供应商名称: "供应商A",
    生产单号: "SC-1",
    款号: "K-1",
    物料编号: "M-1",
    物料名称: "布料",
    物料类别: "面料",
    规格: "S",
    颜色: "红",
    单位: "PCS",
    数量: 10,
    备注: "",
    审核: "0",
  },
];
const RET_QS = [
  { 物料编号: "M-1", 物料名称: "布料", 物料类别: "面料", 规格: "S", 颜色: "红", 单位: "PCS", 退仓数量: 10 },
];

interface Cfg {
  perms: unknown;
  receiptFirst: unknown;
  receiptList: unknown;
  receiptDetail: PurchaseReceiptDetail;
  returnFirst: unknown;
  returnList: unknown;
  returnDetail: PurchaseReturnDetail;
  progress: unknown;
  suppliers: unknown;
  materials: unknown;
  cats: unknown;
  rcptQd: unknown;
  rcptQs: unknown;
  retQd: unknown;
  retQs: unknown;
  onCall?: (c: Call) => Response | undefined;
}

function baseCfg(): Cfg {
  return {
    perms: PERMS_FULL,
    receiptFirst: { items: [RCPT_UNAUDITED], total: 1 },
    receiptList: { items: [RCPT_UNAUDITED], total: 1 },
    receiptDetail: receiptDetailOf(RCPT_UNAUDITED),
    returnFirst: { items: [RET_UNAUDITED], total: 1 },
    returnList: { items: [RET_UNAUDITED], total: 1 },
    returnDetail: returnDetailOf(RET_UNAUDITED),
    progress: PROGRESS,
    suppliers: SUPPLIERS,
    materials: MATERIALS,
    cats: CATS,
    rcptQd: RCPT_QD,
    rcptQs: RCPT_QS,
    retQd: RET_QD,
    retQs: RET_QS,
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
      // 采购入仓单
      if (p === "/api/purchase-receipts/receipt-query/detail") return json(cfg.rcptQd);
      if (p === "/api/purchase-receipts/receipt-query/summary") return json(cfg.rcptQs);
      if (p === "/api/purchase-receipts" && method === "GET")
        return u.searchParams.get("size") === "1" ? json(cfg.receiptFirst) : json(cfg.receiptList);
      if (p === "/api/purchase-receipts" && method === "POST")
        return json({ 单号: "SH20260916001" }, 201);
      if (/^\/api\/purchase-receipts\/[^/]+\/approve$/.test(p)) return noContent();
      if (/^\/api\/purchase-receipts\/[^/]+\/unapprove$/.test(p)) return noContent();
      if (/^\/api\/purchase-receipts\/[^/]+$/.test(p) && method === "GET")
        return json(cfg.receiptDetail);
      if (/^\/api\/purchase-receipts\/[^/]+$/.test(p) && method === "DELETE") return noContent();
      // 采购退仓单
      if (p === "/api/purchase-returns/return-query/detail") return json(cfg.retQd);
      if (p === "/api/purchase-returns/return-query/summary") return json(cfg.retQs);
      if (p === "/api/purchase-returns" && method === "GET")
        return u.searchParams.get("size") === "1" ? json(cfg.returnFirst) : json(cfg.returnList);
      if (p === "/api/purchase-returns" && method === "POST")
        return json({ 单号: "CT20260916001" }, 201);
      if (/^\/api\/purchase-returns\/[^/]+\/approve$/.test(p)) return noContent();
      if (/^\/api\/purchase-returns\/[^/]+\/unapprove$/.test(p)) return noContent();
      if (/^\/api\/purchase-returns\/[^/]+$/.test(p) && method === "GET")
        return json(cfg.returnDetail);
      if (/^\/api\/purchase-returns\/[^/]+$/.test(p) && method === "DELETE") return noContent();
      // 选择器数据源
      if (p === "/api/purchase-orders/progress") return json(cfg.progress);
      if (p === "/api/master/suppliers") return json(cfg.suppliers);
      if (p === "/api/material-master/categories") return json(cfg.cats);
      if (p === "/api/material-master") return json(cfg.materials);
      // 跨页刷新探针数据源(终审修复):库存页/首页统计卡同端点
      if (p === "/api/material-inventory") return json([]);
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setupReceipt = (cfg: Cfg) => {
  const calls = installFetch(cfg);
  renderWithProviders(<PurchaseReceiptPage />, "/purchase-receipts");
  return calls;
};
const setupReturn = (cfg: Cfg) => {
  const calls = installFetch(cfg);
  renderWithProviders(<PurchaseReturnsPage />, "/purchase-returns");
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

// ---------- 采购入仓单:打开与查看 ----------

describe("入仓单·打开与查看", () => {
  it("首进自动打开最新入仓单:只读单头卡 + 明细含关联采购单号(订单单号) + 审核/删除入口", async () => {
    setupReceipt(baseCfg());
    await waitFor(() => expect(screen.getByText("SH20260915001")).toBeInTheDocument());

    expect(screen.getByText("未审核")).toBeInTheDocument();
    expect(screen.getByText("供应商A")).toBeInTheDocument();
    // 关联采购单号显示(明细 订单单号)
    expect(screen.getByText("PO20260901001")).toBeInTheDocument();
    expect(screen.getByText("布料")).toBeInTheDocument();
    // 未审核:审核(=入库存)/删除可用
    expect(screen.getByRole("button", { name: "审核" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "反审核" })).not.toBeInTheDocument();
    // 入仓单无修改入口(后端无 PUT);打印为通用单据打印(对照老系统详情抽屉)
    expect(screen.queryByText("保存修改")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument();
  });

  it("打开弹窗:列表列(单号/日期/供应商/仓库/数量/金额/状态) + 点行载入", async () => {
    const cfg = baseCfg();
    cfg.receiptFirst = { items: [], total: 0 };
    setupReceipt(cfg);
    await waitFor(() => expect(screen.getByText("尚未打开单据")).toBeInTheDocument());

    fireEvent.click(screen.getByText("打开"));
    await waitFor(() => expect(screen.getByText("SH20260915001")).toBeInTheDocument());
    expect(screen.getByText("供应商A")).toBeInTheDocument();
    expect(screen.getByText("来料仓")).toBeInTheDocument();
    expect(screen.getByText("未审核")).toBeInTheDocument();

    fireEvent.click(screen.getByText("SH20260915001"));
    await waitFor(() => expect(screen.getByText("PO20260901001")).toBeInTheDocument());
  });
});

// ---------- 采购入仓单:新建(整单带入)与保存 ----------

describe("入仓单·新建与保存", () => {
  const gotoNew = async () => {
    await waitFor(() => expect(screen.getByText("SH20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));
  };

  it("整单带入:欠数行追加(数量=欠数,订单单号=采购单号),表头供应商带出,收后欠数实时状态", async () => {
    setupReceipt(baseCfg());
    await gotoNew();

    fireEvent.click(screen.getByText("整单带入"));
    await waitFor(() => expect(screen.getByText("PO20260901001")).toBeInTheDocument());
    // 一张订单一行:货号去重合并 + 欠数合计
    expect(screen.getByText("PO20260901001")).toBeInTheDocument();
    expect(screen.getByText("130")).toBeInTheDocument(); // 80+50
    // 带入 PO20260901001(第一组)
    const row = screen.getByText("PO20260901001").closest("tr")!;
    fireEvent.click(within(row).getByText("带入"));
    await waitFor(() =>
      expect(screen.getByText(/已带入 2 行/)).toBeInTheDocument(),
    );

    // 表头供应商自动带出
    expect(screen.getByLabelText("供应商")).toHaveValue("S1 供应商A");
    // 明细行:数量=欠数;两行收后欠数均为 已完成(数量=欠数)
    expect(screen.getAllByLabelText("数量")).toHaveLength(2);
    expect(screen.getAllByLabelText("数量")[0]).toHaveValue(80);
    expect(screen.getAllByText("已完成")).toHaveLength(2);
    // 改数量 -> 欠 30(红)
    fireEvent.change(screen.getAllByLabelText("数量")[0], { target: { value: "50" } });
    expect(screen.getByText("欠 30")).toBeInTheDocument();
  });

  it("保存:送货单号必填校验后 POST,载荷带 单号/仓库/明细(订单单号=关联采购单号)", async () => {
    const calls = setupReceipt(baseCfg());
    await gotoNew();

    fireEvent.click(screen.getByText("整单带入"));
    await waitFor(() => expect(screen.getByText("PO20260901001")).toBeInTheDocument());
    fireEvent.click(within(screen.getByText("PO20260901001").closest("tr")!).getByText("带入"));
    await waitFor(() => expect(screen.getByText(/已带入 2 行/)).toBeInTheDocument());

    // 缺送货单号拦截
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请填写送货单号")).toBeInTheDocument());
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/purchase-receipts")).toBe(false);

    fireEvent.change(screen.getByLabelText("送货单号"), { target: { value: "SH-9" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/purchase-receipts")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/purchase-receipts")!;
    expect(post.body!.单号).toBe("SH-9");
    expect(post.body!.仓库).toBe("来料仓");
    expect(post.body!.供应商编号).toBe("S1");
    const lines = post.body!.明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    expect(lines[0].订单单号).toBe("PO20260901001");
    expect(lines[0].数量).toBe(80);
    await waitFor(() =>
      expect(screen.getByText(/采购入仓单已创建:SH20260916001/)).toBeInTheDocument(),
    );
  });

  it("手选物料加行(补料口径:数量只入库存,不强制关联生产单号)", async () => {
    const calls = setupReceipt(baseCfg());
    await gotoNew();

    fireEvent.click(screen.getByText("加一行"));
    fireEvent.click(screen.getByText("选物料"));
    await waitFor(() => expect(screen.getByText("松紧带")).toBeInTheDocument());
    fireEvent.click(screen.getByText("松紧带").closest("tr")!);
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("送货单号"), { target: { value: "SH-10" } });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/purchase-receipts")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/purchase-receipts")!;
    const lines = post.body!.明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0].物料编号).toBe("M-9");
    expect(lines[0].数量).toBe(12);
    expect(lines[0].订单单号).toBeUndefined();
    expect(lines[0].生产单号).toBeUndefined();
  });

  it("备品勾选:出现备品数量输入,填入后保存载荷带 备品='1'+备品数量", async () => {
    const calls = setupReceipt(baseCfg());
    await gotoNew();

    fireEvent.click(screen.getByText("整单带入"));
    await waitFor(() => expect(screen.getByText("PO20260901001")).toBeInTheDocument());
    fireEvent.click(within(screen.getByText("PO20260901001").closest("tr")!).getByText("带入"));
    await waitFor(() => expect(screen.getByText(/已带入 2 行/)).toBeInTheDocument());

    // 勾选行1备品:出现备品数量输入框(数量=欠数 80 未超收,不自动拆分)
    fireEvent.click(screen.getByRole("checkbox", { name: "行1 备品" }));
    const spareInput = await screen.findByLabelText("行1 备品数量");
    fireEvent.change(spareInput, { target: { value: "5" } });
    // 欠数列:备品徽标 + 订单部分状态(行1 80=欠数 → 已完成;行2 也是已完成)
    await waitFor(() => expect(screen.getByText("备品 5")).toBeInTheDocument());
    expect(screen.getAllByText("已完成").length).toBe(2);

    fireEvent.change(screen.getByLabelText("送货单号"), { target: { value: "SH-11" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/purchase-receipts")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/purchase-receipts")!;
    const lines = post.body!.明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    expect(lines[0].备品).toBe("1");
    expect(lines[0].备品数量).toBe(5);
    expect(lines[0].数量).toBe(80); // 数量仍是订单部分
    expect(lines[1].备品).toBeUndefined();
  });

  it("备品勾选未填备品数量:保存被拦并提示", async () => {
    const calls = setupReceipt(baseCfg());
    await gotoNew();

    fireEvent.click(screen.getByText("整单带入"));
    await waitFor(() => expect(screen.getByText("PO20260901001")).toBeInTheDocument());
    fireEvent.click(within(screen.getByText("PO20260901001").closest("tr")!).getByText("带入"));
    await waitFor(() => expect(screen.getByText(/已带入 2 行/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "行1 备品" }));
    await screen.findByLabelText("行1 备品数量");
    fireEvent.change(screen.getByLabelText("送货单号"), { target: { value: "SH-12" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(screen.getByText(/勾选了备品但未填备品数量/)).toBeInTheDocument(),
    );
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/purchase-receipts")).toBe(false);
  });

  it("超收行勾选备品:超收部分自动拆到备品数量,数量回到欠数", async () => {
    setupReceipt(baseCfg());
    await gotoNew();

    fireEvent.click(screen.getByText("整单带入"));
    await waitFor(() => expect(screen.getByText("PO20260901001")).toBeInTheDocument());
    fireEvent.click(within(screen.getByText("PO20260901001").closest("tr")!).getByText("带入"));
    await waitFor(() => expect(screen.getByText(/已带入 2 行/)).toBeInTheDocument());

    // 行1 欠数 80,改成收 100 → 超收 20
    const qtyInputs = screen.getAllByLabelText("数量");
    fireEvent.change(qtyInputs[0], { target: { value: "100" } });
    await waitFor(() => expect(screen.getByText("超收 20")).toBeInTheDocument());

    // 勾选备品 → 自动拆分:数量=80,备品数量=20,显示 备品 20 + 已完成
    fireEvent.click(screen.getByRole("checkbox", { name: "行1 备品" }));
    await waitFor(() => expect(screen.getByText("备品 20")).toBeInTheDocument());
    expect(screen.getAllByLabelText("数量")[0]).toHaveValue(80);
    expect(screen.getByLabelText("行1 备品数量")).toHaveValue(20);
    expect(screen.queryByText(/超收/)).not.toBeInTheDocument();
  });
});

// ---------- 采购入仓单:审核(=入库存)/反审核/删除 ----------

describe("入仓单·审核流转", () => {
  it("审核=入库存:未审核单点审核 POST approve,刷新后已审核 + 出现反审核,编辑入口消失", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      if (c.url.endsWith("/approve")) cfg.receiptDetail = receiptDetailOf(RCPT_AUDITED);
      return undefined;
    };
    const calls = setupReceipt(cfg);
    await waitFor(() => expect(screen.getByRole("button", { name: "审核" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/purchase-receipts/SH20260915001/approve")).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "反审核" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  // 终审修复:审核成功后跨页刷新。库存页 keep-alive 常驻挂载,queryKey 前缀 ["material-inventory"]
  // 被 invalidate 后活跃查询立即重发;探针组件模拟库存页的活跃查询
  it("审核成功后跨页刷新:[material-inventory] 前缀失效,活跃库存查询重发请求", async () => {
    function InventoryProbe() {
      useQuery({
        queryKey: ["material-inventory", { probe: true }],
        queryFn: () => inventoryApi.list({}),
      });
      return null;
    }
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      if (c.url.endsWith("/approve")) cfg.receiptDetail = receiptDetailOf(RCPT_AUDITED);
      return undefined;
    };
    const calls = installFetch(cfg);
    renderWithProviders(
      <>
        <InventoryProbe />
        <PurchaseReceiptPage />
      </>,
      "/purchase-receipts",
    );
    const invCalls = () =>
      calls.filter(
        (c) => new URL(c.url, "http://test").pathname === "/api/material-inventory",
      );
    await waitFor(() => expect(invCalls().length).toBe(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "审核" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "审核" }));

    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/purchase-receipts/SH20260915001/approve")).toBe(true),
    );
    // 审核成功后库存查询被 invalidate 并重发(keep-alive 下库存页立刻拿到新数据)
    await waitFor(() => expect(invCalls().length).toBeGreaterThan(1));
  });

  it("已审核单:反审核 POST 后回到未审核;删除未审核单确认后 DELETE 回新建态", async () => {
    const cfg = baseCfg();
    cfg.receiptFirst = { items: [RCPT_AUDITED], total: 1 };
    cfg.receiptDetail = receiptDetailOf(RCPT_AUDITED);
    cfg.onCall = (c) => {
      if (c.url.endsWith("/unapprove")) cfg.receiptDetail = receiptDetailOf(RCPT_UNAUDITED);
      return undefined;
    };
    const calls = setupReceipt(cfg);
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "反审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/purchase-receipts/SH20260915001/unapprove")).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.getByText("确认删除该采购入仓单?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认删除"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url === "/api/purchase-receipts/SH20260915001"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("已删除")).toBeInTheDocument());
  });
});

// ---------- 采购退仓单(= 退回供应商) ----------

describe("退仓单(退回供应商)", () => {
  it("/purchase-returns 路由:新权限键「采购退仓单」生效,表头有入仓单号,无送货单号", async () => {
    setupReturn(baseCfg());
    await waitFor(() => expect(screen.getByText("CT20260915001")).toBeInTheDocument());

    expect(screen.getByRole("heading", { name: /采购退仓单/ })).toBeInTheDocument();
    expect(screen.getByText("SH20260915001")).toBeInTheDocument(); // 入仓单号
    // 权限键是新名:审核/删除按「采购退仓单」权限行渲染
    expect(screen.getByRole("button", { name: "审核" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("新建"));
    expect(screen.getByLabelText("入仓单号")).toBeInTheDocument();
    expect(screen.queryByLabelText("送货单号")).not.toBeInTheDocument();
  });

  it("新建退仓单:缺仓库拦截;POST /api/purchase-returns 载荷带入仓单号/仓库/明细", async () => {
    const calls = setupReturn(baseCfg());
    await waitFor(() => expect(screen.getByText("CT20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));

    fireEvent.click(screen.getByText("加一行"));
    fireEvent.click(screen.getByText("选物料"));
    await waitFor(() => expect(screen.getByText("松紧带")).toBeInTheDocument());
    fireEvent.click(screen.getByText("松紧带").closest("tr")!);
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("入仓单号"), { target: { value: "SH20260915001" } });

    // 退仓单仓库默认空,必填拦截
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请填写仓库")).toBeInTheDocument());
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/purchase-returns")).toBe(false);

    fireEvent.change(screen.getByLabelText("仓库"), { target: { value: "来料仓" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/purchase-returns")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/purchase-returns")!;
    expect(post.body!.入仓单号).toBe("SH20260915001");
    expect(post.body!.仓库).toBe("来料仓");
    const lines = post.body!.明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0].物料编号).toBe("M-9");
    expect(lines[0].数量).toBe(3);
    await waitFor(() =>
      expect(screen.getByText(/采购退仓单已创建:CT20260916001/)).toBeInTheDocument(),
    );
  });

  it("退仓审核:POST /api/purchase-returns/{单号}/approve(审核即退回供应商扣库存)", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      if (c.url.endsWith("/approve")) cfg.returnDetail = returnDetailOf(RET_AUDITED);
      return undefined;
    };
    const calls = setupReturn(cfg);
    await waitFor(() => expect(screen.getByRole("button", { name: "审核" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/purchase-returns/CT20260915001/approve")).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());
  });
});

// ---------- 入仓/退仓查询 ----------

describe("入仓查询", () => {
  it("查询页签:默认本月区间请求明细;明细含入库单号/订单单号;切汇总查询", async () => {
    const calls = setupReceipt(baseCfg());
    await waitFor(() => expect(screen.getByText("SH20260915001")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "采购入仓查询" }));
    await waitFor(() => expect(screen.getByText("TM001")).toBeInTheDocument());
    const d = calls.find((c) => c.url.startsWith("/api/purchase-receipts/receipt-query/detail"))!;
    expect(decodeURIComponent(d.url)).toContain("起=");
    expect(decodeURIComponent(d.url)).toContain("止=");
    // 明细列:入库单号 + 订单单号(关联采购单号)
    expect(screen.getAllByText("SH20260915001").length).toBeGreaterThan(0);
    expect(screen.getByText("PO20260901001")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "汇总查询" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.startsWith("/api/purchase-receipts/receipt-query/summary")),
      ).toBe(true),
    );
  });

  it("过滤下发:审核情况/物料类别/关键字;双击入库单号回单据页签打开整单", async () => {
    const calls = setupReceipt(baseCfg());
    await waitFor(() => expect(screen.getByText("SH20260915001")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "采购入仓查询" }));
    await waitFor(() => expect(screen.getByText("TM001")).toBeInTheDocument());

    pickOption("审核情况", "已审核");
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("receipt-query/detail") && decodeURIComponent(c.url).includes("审核情况=已审核"),
        ),
      ).toBe(true),
    );
    pickOption("物料类别", "面料(3)");
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("receipt-query/detail") && decodeURIComponent(c.url).includes("物料类别=面料"),
        ),
      ).toBe(true),
    );
    fireEvent.change(screen.getByPlaceholderText("单号/入库单号/订单号/供应商/物料"), {
      target: { value: "PO20260901001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("receipt-query/detail") && decodeURIComponent(c.url).includes("keyword=PO20260901001"),
        ),
      ).toBe(true),
    );

    // 双击明细行 -> 回单据页签并打开该入仓单
    fireEvent.doubleClick(screen.getByText("TM001").closest("tr")!);
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "GET" && c.url === "/api/purchase-receipts/SH20260915001"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "审核" })).toBeInTheDocument());
  });

  it("退仓查询:/purchase-returns 查询页签请求 return-query;双击单号打开退仓整单", async () => {
    const calls = setupReturn(baseCfg());
    await waitFor(() => expect(screen.getByText("CT20260915001")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "采购退仓查询" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.startsWith("/api/purchase-returns/return-query/detail")),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("M-1")).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByText("M-1").closest("tr")!);
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "GET" && c.url === "/api/purchase-returns/CT20260915001"),
      ).toBe(true),
    );
  });
});

// ---------- 打印(通用单据打印,对照老系统 MaterialDocDetailDrawer + printDoc) ----------

describe("打印", () => {
  const stubOpen = () => {
    const written: string[] = [];
    vi.spyOn(window, "open").mockReturnValue({
      document: { write: (s: string) => written.push(s), close: () => {} },
      focus: () => {},
      print: () => {},
    } as unknown as Window);
    return written;
  };

  it("查看态点「打印」:开新窗口渲染单头+明细(含供应商/仓库/物料行)", async () => {
    const written = stubOpen();
    setupReceipt(baseCfg());
    await waitFor(() => expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "打印" }));
    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0]).toContain("采购入仓单 SH20260915001");
    expect(written[0]).toContain("供应商A");
    expect(written[0]).toContain("来料仓");
    expect(written[0]).toContain("布料");
    expect(written[0]).toContain("生产单号");
  });

  it("无「单价/金额」位:打印内容不出单价/金额列", async () => {
    const written = stubOpen();
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_PRICE;
    setupReceipt(cfg);
    await waitFor(() => expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "打印" }));
    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0]).not.toContain("单价");
    expect(written[0]).not.toContain(">400<");
  });
});

// ---------- 权限位 ----------

describe("权限位", () => {
  it("无「单价/金额」位:编辑网格无单价列,查看单头卡金额脱敏 ***", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_PRICE;
    setupReceipt(cfg);
    await waitFor(() => expect(screen.getByText("SH20260915001")).toBeInTheDocument());
    expect(screen.getByText("***")).toBeInTheDocument();

    fireEvent.click(screen.getByText("新建"));
    expect(screen.queryByLabelText("单价")).not.toBeInTheDocument();
    expect(screen.queryByText("金额合计")).not.toBeInTheDocument();
  });

  it("无「审核」位:不渲染审核按钮", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_AUDIT;
    setupReceipt(cfg);
    await waitFor(() => expect(screen.getByText("SH20260915001")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "审核" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });
});

// ---------- 纯函数(对照老系统 materialLines/materialLabelQuery/tableExport) ----------

describe("纯函数", () => {
  it("orderRowToLine:数量=欠数(全收),订单单号=采购单号,带订单口径", () => {
    const l = orderRowToLine(PROGRESS[0], 1);
    expect(l).toMatchObject({
      订单单号: "PO20260901001",
      生产单号: "SC-1",
      款号: "K-1",
      物料编号: "M-1",
      数量: "80",
      订购数量: 100,
      订单欠数: 80,
    });
  });

  it("owedAfter:欠N/超收N/已完成;非订单行不显示", () => {
    expect(owedAfter({ 订单单号: "PO1", 订单欠数: 80, 数量: "50" })).toEqual({ kind: "欠", value: 30 });
    expect(owedAfter({ 订单单号: "PO1", 订单欠数: 80, 数量: "100" })).toEqual({ kind: "超收", value: 20 });
    expect(owedAfter({ 订单单号: "PO1", 订单欠数: 80, 数量: "80" })).toEqual({ kind: "完成", value: 0 });
    expect(owedAfter({ 订单欠数: 80, 数量: "50" })).toBeNull();
  });

  it("validLines 过滤无物料编号或数量<=0 的行", () => {
    const lines = [
      { key: 1, 物料编号: "M1", 物料名称: "", 数量: "1", 单价: "" },
      { key: 2, 物料编号: "", 物料名称: "", 数量: "5", 单价: "" },
      { key: 3, 物料编号: "M2", 物料名称: "", 数量: "0", 单价: "" },
    ];
    expect(validLines(lines).map((l) => l.物料编号)).toEqual(["M1"]);
  });

  it("toSubmitLine:备品勾选传 \"1\",未勾选不带该字段", () => {
    const base = { key: 1, 物料编号: "M1", 物料名称: "", 数量: "3", 单价: "" };
    expect(toSubmitLine(base).备品).toBeUndefined();
    expect(toSubmitLine({ ...base, 备品: true }).备品).toBe("1");
  });

  it("toSubmitLine:备品数量>0 才带;数量允许为 0(纯备品行)", () => {
    const base = { key: 1, 物料编号: "M1", 物料名称: "", 数量: "3", 单价: "" };
    // 勾选但未填备品数量:不带(后端按旧口径整行备品归一化)
    expect(toSubmitLine({ ...base, 备品: true }).备品数量).toBeUndefined();
    // 拆分:数量=订单部分,备品数量=备品部分
    const split = toSubmitLine({ ...base, 备品: true, 备品数量: "5" });
    expect(split.备品).toBe("1");
    expect(split.备品数量).toBe(5);
    expect(split.数量).toBe(3);
    // 纯备品行:数量=0 + 备品数量>0
    const pure = toSubmitLine({ ...base, 数量: "0", 备品: true, 备品数量: "7" });
    expect(pure.数量).toBe(0);
    expect(pure.备品数量).toBe(7);
  });

  it("spareTogglePatch:超收行勾选→超收部分自动拆到备品数量;取消→并回数量", () => {
    // 欠 80,收了 100 → 勾选后 数量=80/备品数量=20
    expect(spareTogglePatch({ 订单欠数: 80, 数量: "100", 备品数量: "" }, true)).toEqual({
      备品: true, 数量: "80", 备品数量: "20",
    });
    // 未超收:勾选只出输入框,数量不动
    expect(spareTogglePatch({ 订单欠数: 80, 数量: "80", 备品数量: "" }, true)).toEqual({
      备品: true, 备品数量: "",
    });
    // 无订单口径(手工行):勾选不动数量
    expect(spareTogglePatch({ 数量: "50", 备品数量: "" }, true)).toEqual({
      备品: true, 备品数量: "",
    });
    // 取消:备品数量并回数量
    expect(spareTogglePatch({ 订单欠数: 80, 数量: "80", 备品数量: "20" }, false)).toEqual({
      备品: false, 数量: "100", 备品数量: "",
    });
  });

  it("validLines/sumQty:纯备品行有效;数量合计含备品部分(实物口径)", () => {
    const lines = [
      { key: 1, 物料编号: "M1", 物料名称: "", 数量: "1", 单价: "" },
      { key: 2, 物料编号: "M2", 物料名称: "", 数量: "0", 单价: "", 备品数量: "5" },
      { key: 3, 物料编号: "M3", 物料名称: "", 数量: "0", 单价: "" },
    ];
    expect(validLines(lines).map((l) => l.物料编号)).toEqual(["M1", "M2"]);
    expect(sumQty(lines)).toBe(6);
  });

  it("buildDocQuery:空串/全部/ALL 不下发", () => {
    expect(
      buildDocQuery({ keyword: " PO1 ", 类别: ALL_CAT, 审核情况: ALL_APPROVAL, 起: "", 止: "2026-09-30" }),
    ).toEqual({ keyword: "PO1", 物料类别: undefined, 审核情况: undefined, 起: undefined, 止: "2026-09-30" });
    expect(buildDocQuery({ 类别: "面料", 审核情况: "已审核" })).toMatchObject({
      物料类别: "面料",
      审核情况: "已审核",
    });
  });

  it("buildCsv:表头 + 转义(逗号/引号/换行)", () => {
    const csv = buildCsv(
      [{ title: "单号", key: "单号" }, { title: "备注", key: "备注" }],
      [{ 单号: "SH1", 备注: 'a,"b"\nc' }],
    );
    expect(csv).toBe('单号,备注\nSH1,"a,""b""\nc"');
  });
});
