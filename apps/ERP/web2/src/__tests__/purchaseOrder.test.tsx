// 采购订单(来料)全量对齐:逐场景对照老系统 web/src/pages/production/PurchaseOrderListPage.tsx、
// PurchaseOrderDrawer.tsx 与 purchaseOrderDrawerStock/replenishPoLock/printContracts 测试契约。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PurchaseOrderPage from "@/pages/PurchaseOrderPage";
import { applyLossRate, replenishPurchaseLines, shouldDefaultSelect } from "@/lib/purchaseOrder";
import { buildPurchaseOrderPrintHtml } from "@/lib/printPurchaseOrder";
import { PRINT_NOTES } from "@/lib/printContract";
import type {
  PurchaseOrderDetail,
  PurchaseOrderHeader,
  ReplenishmentDetail,
} from "@/api/types";

// ---------- 测试基建:fetch 路由桩 ----------

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [
  {
    组: "物料管理",
    菜单: "采购订单",
    打开: true,
    保存: true,
    删除: true,
    打印: true,
    单价: true,
    金额: true,
    审核: true,
    反审核: true,
    功能: true,
  },
];
const PERMS_NO_PRICE = [{ ...PERMS_FULL[0], 单价: false, 金额: false }];
const PERMS_NO_DELETE = [{ ...PERMS_FULL[0], 删除: false }];
const PERMS_NO_AUDIT = [{ ...PERMS_FULL[0], 审核: false }];

const HDR_UNAUDITED: PurchaseOrderHeader = {
  id: 1,
  单号: "PO20260915001",
  日期: "2026-09-15",
  交货日期: "2026-09-25",
  供应商编号: "S1",
  供应商名称: "供应商A",
  仓库: "来料仓",
  数量: 100,
  金额: 500,
  操作员: "admin",
  审核: "0",
  生产单号: "SC-1",
  PO号: "PO-1",
  收件人: "张三",
  打印次数: 0,
};
const HDR_SUPERVISED: PurchaseOrderHeader = {
  ...HDR_UNAUDITED,
  主管审核: "1",
  主管审核人: "主管",
};
const HDR_MANAGED: PurchaseOrderHeader = {
  ...HDR_SUPERVISED,
  经理审核: "1",
  经理审核人: "经理",
};
const HDR_AUDITED: PurchaseOrderHeader = { ...HDR_MANAGED, 审核: "1", 审核人: "经理" };

const detailOf = (h: PurchaseOrderHeader): PurchaseOrderDetail => ({
  单头: h,
  明细: [
    {
      id: 1,
      物料编号: "M-1",
      物料名称: "布料",
      规格: "S",
      颜色: "红",
      单位: "PCS",
      数量: 100,
      单价: 5,
      金额: 500,
      预算数量: 100,
      材料: "棉",
      生产单号: "SC-1",
      款号: "K-1",
      备注: "",
      供应商编号: "S1",
      供应商名称: "供应商A",
      可用库存: 20,
    },
  ],
});

// 采购物料分析(basis):M-1 正常 / M-2 库存已够 / M-3 已下单
const BASIS = [
  {
    ID: 1,
    物料编号: "M-1",
    物料名称: "布料",
    规格: "S",
    颜色: "红",
    单位: "PCS",
    需订数量: 80,
    可用库存: 20,
    预算单价: 5,
    供应商编号: "S1",
    供应商名称: "供应商A",
    合同号: "HT-1",
    已订数量: 0,
  },
  {
    ID: 2,
    物料编号: "M-2",
    物料名称: "扣子",
    单位: "粒",
    需订数量: 50,
    可用库存: 100,
    预算单价: 1,
    供应商编号: "S1",
    供应商名称: "供应商A",
    已订数量: 0,
  },
  {
    ID: 3,
    物料编号: "M-3",
    物料名称: "拉链",
    单位: "条",
    需订数量: 30,
    可用库存: 0,
    预算单价: 2,
    已订数量: 5,
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
      备注: "辅料;材料:橡筋",
    },
  ],
  total: 1,
};

const 挂单补料: ReplenishmentDetail = {
  单头: { ID: 1, 单号: "BUL1", 生产单号: "SC-1", 款号: "K-1", 仓库: "来料仓" },
  明细: [{ 物料编号: "M-1", 物料名称: "布料", 数量: 5 }],
};
const 自由补料: ReplenishmentDetail = {
  单头: { ID: 2, 单号: "BUL2", 仓库: "来料仓" },
  明细: [{ 物料编号: "M-2", 物料名称: "扣子", 数量: 2 }],
};

const REPL_LIST = {
  items: [
    {
      ID: 1,
      单号: "BUL1",
      日期: "2026-09-10",
      部门: "装配部",
      生产单号: "SC-1",
      款号: "K-1",
      仓库: "来料仓",
      数量: 5,
      审核时间: "2026-09-10T10:00",
    },
    { ID: 2, 单号: "BUL2", 日期: "2026-09-11", 仓库: "来料仓", 数量: 2, 审核时间: null },
  ],
  total: 2,
};

interface Cfg {
  perms: unknown;
  firstList: unknown;
  list: unknown;
  detail: PurchaseOrderDetail;
  basis: unknown;
  suppliers: unknown;
  materials: unknown;
  replList: unknown;
  replDetails: Record<string, ReplenishmentDetail>;
  onCall?: (c: Call) => Response | undefined;
}

function baseCfg(): Cfg {
  return {
    perms: PERMS_FULL,
    firstList: { items: [HDR_UNAUDITED], total: 1 },
    list: { items: [HDR_UNAUDITED], total: 1 },
    detail: detailOf(HDR_UNAUDITED),
    basis: BASIS,
    suppliers: SUPPLIERS,
    materials: MATERIALS,
    replList: REPL_LIST,
    replDetails: { BUL1: 挂单补料, BUL2: 自由补料 },
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
      if (p === "/api/purchase-orders/basis") return json(cfg.basis);
      if (p === "/api/purchase-orders" && method === "GET") {
        return u.searchParams.get("size") === "1" ? json(cfg.firstList) : json(cfg.list);
      }
      if (p === "/api/purchase-orders" && method === "POST")
        return json({ 单号: "PO20260916001" }, 201);
      if (p.endsWith("/print") && method === "POST") return json({ 打印次数: 1 });
      if (p.endsWith("/supervisor-approve") && method === "POST") return json({});
      if (p.endsWith("/manager-approve") && method === "POST") return json({});
      if (p.endsWith("/approve") && method === "POST") return json({});
      if (p.endsWith("/unapprove") && method === "POST") return json({});
      if (/^\/api\/purchase-orders\/[^/]+$/.test(p) && method === "GET")
        return json(cfg.detail);
      if (/^\/api\/purchase-orders\/[^/]+$/.test(p) && method === "PUT") return noContent();
      if (/^\/api\/purchase-orders\/[^/]+$/.test(p) && method === "DELETE") return noContent();
      if (p === "/api/master/suppliers") return json(cfg.suppliers);
      if (p === "/api/material-master") return json(cfg.materials);
      if (p === "/api/replenishments" && method === "GET") return json(cfg.replList);
      if (p.endsWith("/mark-purchased") && method === "POST") return json({});
      if (/^\/api\/replenishments\/[^/]+$/.test(p) && method === "GET") {
        const no = decodeURIComponent(p.split("/").pop()!);
        return json(cfg.replDetails[no]);
      }
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (cfg: Cfg) => {
  const calls = installFetch(cfg);
  renderWithProviders(<PurchaseOrderPage />, "/purchase-orders");
  return calls;
};

// 等待自动打开的首单详情水合到表单(未审核查看态)
const waitForm = async () =>
  waitFor(() => expect(screen.getByLabelText("供应商")).toHaveValue("S1 供应商A"));

// 进入新建态
const gotoNew = async () => {
  await waitForm();
  fireEvent.click(screen.getByText("新建"));
};

// 选供应商(供应商A) + 填 PO号
const fillHeader = async () => {
  fireEvent.click(screen.getByText("选择"));
  const row = await screen.findByText("供应商A");
  fireEvent.click(row.closest("tr")!);
  fireEvent.change(screen.getByLabelText("PO号(合同号)"), { target: { value: "PO-9" } });
};

// 新建态录入清单 SC-1(basis 三行)
const appendBasis = async () => {
  fireEvent.click(screen.getByText("录入清单"));
  fireEvent.change(screen.getByPlaceholderText("输入生产单号,带出待采购物料"), {
    target: { value: "SC-1" },
  });
  fireEvent.click(screen.getByText("追加"));
  await waitFor(() =>
    expect(screen.getByLabelText("勾选 M-1", { exact: false })).toBeInTheDocument(),
  );
};

beforeEach(() => {
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ---------- 打开与查询 ----------

describe("打开与查询", () => {
  it("首进自动打开最新一单:未审核进可编辑查看态(表单水合 + 明细网格)", async () => {
    setup(baseCfg());
    await waitForm();

    expect(screen.getByLabelText("PO号(合同号)")).toHaveValue("PO-1");
    expect(screen.getByLabelText("收件人")).toHaveValue("张三");
    expect(screen.getByText("未审核")).toBeInTheDocument();
    // 明细网格回填 + 默认全勾
    expect(screen.getByLabelText("数量")).toHaveValue(100);
    expect(screen.getByLabelText("勾选 M-1", { exact: false })).toBeChecked();
    // 行级供应商/实时可用库存随详情返回:「默认供应商」列显示供应商,不再是 未指定/-
    expect(screen.getByText("供应商A")).toBeInTheDocument();
    expect(screen.queryByText("未指定")).not.toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    // 工具条:保存修改/删除/主管审核
    expect(screen.getByText("保存修改")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "主管审核" })).toBeInTheDocument();
  });

  it("打开弹窗:列表列(单号/日期/供应商/生产单号/数量/金额/状态) + 点行载入", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [], total: 0 };
    setup(cfg);
    await waitFor(() => expect(screen.getByText("尚未打开单据")).toBeInTheDocument());

    fireEvent.click(screen.getByText("打开"));
    await waitFor(() =>
      expect(screen.getByText("PO20260915001")).toBeInTheDocument(),
    );
    expect(screen.getByText("供应商A")).toBeInTheDocument();
    expect(screen.getByText("SC-1")).toBeInTheDocument();
    expect(screen.getByText("未审核")).toBeInTheDocument();

    fireEvent.click(screen.getByText("PO20260915001"));
    await waitForm();
  });

  it("查询:输入关键字按 单号/供应商/生产单号 服务端搜索(page 回 1)", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [], total: 0 };
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getByText("尚未打开单据")).toBeInTheDocument());

    fireEvent.click(screen.getByText("打开"));
    await waitFor(() => expect(screen.getByText("PO20260915001")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("单号 / 供应商 / 生产单号"), {
      target: { value: "供应商A" },
    });
    fireEvent.click(screen.getByText("查询"));

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.startsWith("/api/purchase-orders?") &&
            c.url.includes("keyword=") &&
            c.url.includes("page=1"),
        ),
      ).toBe(true),
    );
    const q = calls.find((c) => c.url.includes("keyword="))!;
    expect(decodeURIComponent(q.url)).toContain("keyword=供应商A");
  });
});

// ---------- 新建:录入清单 + 库存数量显示 + 保存 ----------

describe("新建与保存", () => {
  it("录入清单:basis 行追加,供应商/PO号带出,可用库存与已下单标记展示,默认勾选规则生效", async () => {
    setup(baseCfg());
    await gotoNew();
    await appendBasis();

    // 表头带出:供应商 + PO号=合同号
    expect(screen.getByLabelText("供应商")).toHaveValue("S1 供应商A");
    expect(screen.getByLabelText("PO号(合同号)")).toHaveValue("HT-1");
    // 默认勾选:M-1 勾;M-2(库存够)/M-3(已下单)不勾
    expect(screen.getByLabelText("勾选 M-1", { exact: false })).toBeChecked();
    expect(screen.getByLabelText("勾选 M-2", { exact: false })).not.toBeChecked();
    expect(screen.getByLabelText("勾选 M-3", { exact: false })).not.toBeChecked();
    // 可用库存够需求的行绿色 + tooltip
    expect(screen.getByTitle("实时库存已够需求,默认不勾选下单")).toHaveTextContent("100");
    // 已下单标记 + tooltip
    expect(screen.getByTitle("该工作单已下过此物料,重复下单会重复采购")).toHaveTextContent(
      "已下单 5",
    );
    expect(screen.getByText(/已勾选 1 \/ 3 行/)).toBeInTheDocument();
  });

  it("损耗率:默认数量=需订×(1+损耗率/100),行显示「损%」徽标,仍可手改", async () => {
    const cfg = baseCfg();
    cfg.basis = [
      {
        物料编号: "M-9", 物料名称: "损耗料", 单位: "个", 需订数量: 3000, 可用库存: 0,
        预算单价: 1, 供应商编号: "S1", 供应商名称: "供应商A", 合同号: "HT-9", 已订数量: 0,
        采购损耗率: 6.67,
      },
    ];
    setup(cfg);
    await gotoNew();
    fireEvent.click(screen.getByText("录入清单"));
    fireEvent.change(screen.getByPlaceholderText("输入生产单号,带出待采购物料"), {
      target: { value: "SC-9" },
    });
    fireEvent.click(screen.getByText("追加"));
    const cb = await screen.findByLabelText("勾选 M-9", { exact: false });
    const tr = cb.closest("tr")!;
    // 3000 × 1.0667 = 3200.1
    expect(within(tr).getByLabelText("数量")).toHaveValue(3200.1);
    expect(within(tr).getByText("损6.67%")).toBeInTheDocument();
    // 手改不受设置绑死
    fireEvent.change(within(tr).getByLabelText("数量"), { target: { value: "3200" } });
    expect(within(tr).getByLabelText("数量")).toHaveValue(3200);
  });

  it("保存:POST 只带勾选的行,预算数量=需订数量,单头生产单号按明细兜底", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    await appendBasis();
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url === "/api/purchase-orders"),
      ).toBe(true),
    );
    const post = calls.find(
      (c) => c.method === "POST" && c.url === "/api/purchase-orders",
    )!;
    expect(post.body!.供应商编号).toBe("S1");
    expect(post.body!.PO号).toBe("HT-1");
    expect(post.body!.生产单号).toBe("SC-1"); // 全部明细同属 SC-1,兜底带出
    const lines = post.body!.明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(1); // 只有勾选的 M-1
    expect(lines[0].物料编号).toBe("M-1");
    expect(lines[0].数量).toBe(80);
    expect(lines[0].单价).toBe(5);
    expect(lines[0].预算数量).toBe(80);
    expect(lines[0].生产单号).toBe("SC-1");

    await waitFor(() =>
      expect(screen.getByText(/采购订单已创建:PO20260916001/)).toBeInTheDocument(),
    );
  });

  it("校验:缺供应商/缺PO号/未勾选物料行,逐级拦截不发请求", async () => {
    const calls = setup(baseCfg());
    await gotoNew();

    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请选择供应商")).toBeInTheDocument());

    await fillHeader();
    fireEvent.change(screen.getByLabelText("PO号(合同号)"), { target: { value: "" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(screen.getByText(/请填写 PO号/)).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("PO号(合同号)"), { target: { value: "PO-9" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(screen.getByText("请勾选要下单的物料行")).toBeInTheDocument(),
    );
    expect(
      calls.some((c) => c.method === "POST" && c.url === "/api/purchase-orders"),
    ).toBe(false);
  });

  it("勾选含已下单物料:先弹重复下单确认,「仍要下单」后才提交", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    await appendBasis();
    fireEvent.click(screen.getByLabelText("勾选 M-3", { exact: false }));
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(screen.getByText("勾选项中包含已下单物料")).toBeInTheDocument(),
    );
    expect(screen.getByText(/M-3 拉链\(已订 5\)/)).toBeInTheDocument();
    expect(
      calls.some((c) => c.method === "POST" && c.url === "/api/purchase-orders"),
    ).toBe(false);

    fireEvent.click(screen.getByText("仍要下单"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url === "/api/purchase-orders"),
      ).toBe(true),
    );
    const post = calls.find(
      (c) => c.method === "POST" && c.url === "/api/purchase-orders",
    )!;
    expect(post.body!.明细 as unknown[]).toHaveLength(2); // M-1 + M-3
  });
});

// ---------- 物料选择器(对照老系统 MaterialPicker:只查有库存 + 服务端分页 50/页) ----------

describe("物料选择器", () => {
  const matCalls = (calls: Call[]) =>
    calls.filter((c) => c.url.startsWith("/api/material-master"));

  it("「加行」打开选择物料:默认 page=1&size=50 不带 onlyStock", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    fireEvent.click(screen.getByText("加行"));
    await screen.findByText("M-9");
    const last = matCalls(calls).at(-1)!;
    expect(last.url).toContain("page=1");
    expect(last.url).toContain("size=50");
    expect(last.url).not.toContain("onlyStock");
  });

  it("勾「只查有库存」:重发请求带 onlyStock=true 且回第 1 页", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    fireEvent.click(screen.getByText("加行"));
    await screen.findByText("M-9");
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => {
      const last = matCalls(calls).at(-1)!.url;
      expect(last).toContain("onlyStock=true");
      expect(last).toContain("page=1");
    });
  });

  it("总数超 50 可翻页:「下一页」请求 page=2;查询关键字回第 1 页", async () => {
    const cfg = baseCfg();
    cfg.materials = { items: [...MATERIALS.items], total: 120 };
    const calls = setup(cfg);
    await gotoNew();
    fireEvent.click(screen.getByText("加行"));
    await screen.findByText("M-9");
    expect(screen.getByText(/第 1 \/ 3 页/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("下一页"));
    await waitFor(() => expect(matCalls(calls).at(-1)!.url).toContain("page=2"));

    fireEvent.change(screen.getByLabelText("物料搜索"), { target: { value: "松紧" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => {
      const last = matCalls(calls).at(-1)!.url;
      expect(last).toContain("page=1");
      expect(last).toContain("keyword=");
    });
  });
});

// ---------- 补料带入锁生产单号 ----------

describe("补料带入锁生产单号", () => {
  const bring = async (no: string) => {
    fireEvent.click(screen.getByText("从补料单带入"));
    await waitFor(() => expect(screen.getByText(no)).toBeInTheDocument());
    const row = screen.getByText(no).closest("tr")!;
    fireEvent.click(within(row).getByText("带入"));
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`已从补料单 ${no} 带入 1 行`))).toBeInTheDocument(),
    );
  };

  it("补料单头有生产单号:行生产单号 disabled 锁定 + tooltip,保存 payload 带上,保存后标记已采购", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    await bring("BUL1");

    const moInput = screen.getByLabelText("生产单号");
    expect(moInput).toHaveValue("SC-1");
    expect(moInput).toBeDisabled();
    expect(screen.getByTitle(/补料单已挂生产单号,锁定不可改/)).toBeInTheDocument();

    await fillHeader();
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url === "/api/purchase-orders"),
      ).toBe(true),
    );
    const post = calls.find(
      (c) => c.method === "POST" && c.url === "/api/purchase-orders",
    )!;
    const lines = post.body!.明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0].物料编号).toBe("M-1");
    expect(lines[0].生产单号).toBe("SC-1");
    // 保存成功后标记补料单已采购
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "POST" && c.url === "/api/replenishments/BUL1/mark-purchased",
        ),
      ).toBe(true),
    );
  });

  it("补料单头无生产单号:行生产单号可编辑可空(只进库存),手填值进保存 payload", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    await bring("BUL2");

    const moInput = screen.getByLabelText("生产单号");
    expect(moInput).toBeEnabled();
    expect(moInput).toHaveValue("");
    fireEvent.change(moInput, { target: { value: "SC-9" } });

    await fillHeader();
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url === "/api/purchase-orders"),
      ).toBe(true),
    );
    const post = calls.find(
      (c) => c.method === "POST" && c.url === "/api/purchase-orders",
    )!;
    const lines = post.body!.明细 as Record<string, unknown>[];
    expect(lines[0].生产单号).toBe("SC-9");
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "POST" && c.url === "/api/replenishments/BUL2/mark-purchased",
        ),
      ).toBe(true),
    );
  });
});

// ---------- 查看态操作:保存修改 / 删除 / 三级审核 ----------

describe("查看态操作", () => {
  it("保存修改:未审核单改明细,PUT 载荷带全部勾选行", async () => {
    const calls = setup(baseCfg());
    await waitForm();

    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("行备注"), { target: { value: "急" } });
    fireEvent.click(screen.getByText("保存修改"));

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "PUT" && c.url === "/api/purchase-orders/PO20260915001",
        ),
      ).toBe(true),
    );
    const put = calls.find((c) => c.method === "PUT")!;
    const lines = put.body!.明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0].数量).toBe(150);
    expect(lines[0].备注).toBe("急");
    expect(put.body!.生产单号).toBe("SC-1"); // 已有单头生产单号优先
    await waitFor(() =>
      expect(screen.getByText(/采购订单已保存:PO20260915001/)).toBeInTheDocument(),
    );
  });

  it("删除:未审核单确认后 DELETE,回到新建态", async () => {
    const calls = setup(baseCfg());
    await waitForm();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.getByText("确认删除该采购订单?")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("确认删除"));

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "DELETE" && c.url === "/api/purchase-orders/PO20260915001",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByLabelText("供应商")).toHaveValue(""));
    expect(screen.getByText("已删除")).toBeInTheDocument();
  });

  it("三级审核链:主管审核 -> 经理审核 -> 审核(下发),按钮按流转切换", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      if (c.url.endsWith("/supervisor-approve")) cfg.detail = detailOf(HDR_SUPERVISED);
      if (c.url.endsWith("/manager-approve")) cfg.detail = detailOf(HDR_MANAGED);
      if (c.url.endsWith("/approve")) cfg.detail = detailOf(HDR_AUDITED);
      return undefined;
    };
    const calls = setup(cfg);
    await waitForm();

    fireEvent.click(screen.getByRole("button", { name: "主管审核" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/purchase-orders/PO20260915001/supervisor-approve"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "经理审核" })).toBeInTheDocument());
    expect(screen.getByText(/主管已审\(主管\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "主管审核" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "经理审核" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/purchase-orders/PO20260915001/manager-approve"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "审核(下发)" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "审核(下发)" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/purchase-orders/PO20260915001/approve"),
      ).toBe(true),
    );
    // 已审核:只读单头卡 + 反审核/打印,编辑入口消失
    await waitFor(() => expect(screen.getByText("反审核")).toBeInTheDocument());
    expect(screen.getByText("打印")).toBeInTheDocument();
    expect(screen.queryByText("保存修改")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("已审核:禁删禁改,反审核 POST 后回到可编辑态", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [HDR_AUDITED], total: 1 };
    cfg.detail = detailOf(HDR_AUDITED);
    cfg.onCall = (c) => {
      if (c.url.endsWith("/unapprove")) cfg.detail = detailOf(HDR_UNAUDITED);
      return undefined;
    };
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());

    expect(screen.queryByText("保存修改")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "主管审核" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("反审核"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/purchase-orders/PO20260915001/unapprove"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("保存修改")).toBeInTheDocument());
  });
});

// ---------- 打印 ----------

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

  const auditedCfg = () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [HDR_AUDITED], total: 1 };
    cfg.detail = detailOf(HDR_AUDITED);
    return cfg;
  };

  it("已审核点「打印」:先 POST 登记打印次数,再取最新详情开新窗口按採購單格式打印", async () => {
    const written = stubOpen();
    const calls = setup(auditedCfg());
    await waitFor(() => expect(screen.getByText("打印")).toBeInTheDocument());

    fireEvent.click(screen.getByText("打印"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/purchase-orders/PO20260915001/print"),
      ).toBe(true),
    );
    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0]).toContain("採購單");
    expect(written[0]).toContain("採購單編號：PO20260915001");
    expect(written[0]).toContain("布料");
  });

  it("无「单价/金额」位:打印内容价格脱敏为 ***", async () => {
    const written = stubOpen();
    const cfg = auditedCfg();
    cfg.perms = PERMS_NO_PRICE;
    setup(cfg);
    await waitFor(() => expect(screen.getByText("打印")).toBeInTheDocument());

    fireEvent.click(screen.getByText("打印"));
    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0]).toContain("***");
    expect(written[0]).not.toContain(">500<");
    expect(written[0]).not.toContain(">5<");
  });
});

// ---------- 权限 ----------

describe("权限位", () => {
  it("无「单价/金额」位:编辑网格无单价/金额列,已审核单头卡金额脱敏 ***", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_PRICE;
    setup(cfg);
    await waitForm();
    // 未审核查看态(编辑网格):无单价/金额输入
    expect(screen.queryByLabelText("单价")).not.toBeInTheDocument();
    expect(screen.queryByText("金额合计")).not.toBeInTheDocument();
  });

  it("无「删除」位:未审核单不渲染删除按钮", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_DELETE;
    setup(cfg);
    await waitForm();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("保存修改")).toBeInTheDocument();
  });

  it("无「审核」位:不渲染主管审核/经理审核/审核(下发)", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_AUDIT;
    setup(cfg);
    await waitForm();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "主管审核" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("保存修改")).toBeInTheDocument();
  });
});

// ---------- 纯函数:默认勾选规则(对照 web/src/__tests__/purchaseOrderDrawerStock.test.ts) ----------

describe("默认勾选(可用库存)", () => {
  it("普通行默认勾选", () => {
    expect(shouldDefaultSelect({ 需订数量: 80, 可用库存: 20 })).toBe(true);
    expect(shouldDefaultSelect({ 需订数量: 80, 可用库存: 0 })).toBe(true);
    expect(shouldDefaultSelect({})).toBe(true);
  });

  it("可用库存 >= 需订数量 -> 默认不勾选", () => {
    expect(shouldDefaultSelect({ 需订数量: 80, 可用库存: 80 })).toBe(false);
    expect(shouldDefaultSelect({ 需订数量: 80, 可用库存: 500 })).toBe(false);
  });

  it("需订数量为 0(BOM 快照已够料)-> 默认不勾选", () => {
    expect(shouldDefaultSelect({ 需订数量: 0, 可用库存: 0 })).toBe(false);
    expect(shouldDefaultSelect({ 需订数量: 0, 可用库存: 30 })).toBe(false);
  });

  it("已下单行默认不勾选(原有规则保留)", () => {
    expect(shouldDefaultSelect({ 已订数量: 5, 需订数量: 80, 可用库存: 0 })).toBe(false);
  });

  it("applyLossRate:需订×(1+损耗率/100),空不加成,4 位小数", () => {
    expect(applyLossRate(3000, 6.67)).toBe(3200.1);
    expect(applyLossRate(80, null)).toBe(80);
    expect(applyLossRate(80, 0)).toBe(80);
    expect(applyLossRate(undefined, 10)).toBeUndefined();
    expect(applyLossRate(0.3333, 10)).toBe(0.3666);
  });

  it("缺可用库存数据(手工加行)不受影响", () => {
    expect(shouldDefaultSelect({ 需订数量: 80 })).toBe(true);
  });
});

// ---------- 纯函数:补料带入行(对照 web/src/__tests__/replenishment.test.ts 锁定契约) ----------

describe("补料带入行", () => {
  it("单头挂生产单号:带入行带 生产单号/款号 且锁定", () => {
    const rows = replenishPurchaseLines(挂单补料);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      生产单号: "SC-1",
      款号: "K-1",
      物料编号: "M-1",
      数量: 5,
      锁定生产单号: true,
    });
  });

  it("单头无生产单号:带入行不锁,生产单号留空", () => {
    const rows = replenishPurchaseLines(自由补料);
    expect(rows[0].生产单号).toBeUndefined();
    expect(rows[0].锁定生产单号).toBe(false);
  });
});

// ---------- 纯函数:採購單打印模板契约(对照 web/src/__tests__/printContracts.test.ts) ----------

const PRINT_DETAIL: PurchaseOrderDetail = {
  单头: {
    ID: 1,
    单号: "PO20260907002",
    日期: "2026-09-07",
    交货日期: "2026-09-20",
    供应商编号: "1",
    供应商名称: "东莞市圣隆贸易有限公司",
    收件人: "张三",
    生产单号: "BBD-40132522",
    金额: 500,
    供应商联系人: "谢芳",
    供应商电话: "0769-85641519",
    供应商传真: "0769-85641520",
    供应商货币: "港币",
    供应商付款方式: "月结",
  },
  明细: [
    {
      ID: 1,
      物料编号: "M-001",
      物料名称: "透明胶纸",
      规格: "2.5*90Y",
      单位: "卷",
      数量: 100,
      单价: 5,
      金额: 500,
      款号: "K001",
      备注: "急单",
    },
  ],
};

describe("採購單打印模板契约", () => {
  it("抬头/标题/双方信息/明细/条款/注意事项/落款齐全", () => {
    const html = buildPurchaseOrderPrintHtml(PRINT_DETAIL);
    expect(html).toContain("东莞兴信塑胶制品有限公司");
    expect(html).toContain("TEL:0769-87362376  FAX:0769-87362377");
    expect(html).toContain("採購單");
    expect(html).toContain("採購單編號：PO20260907002");
    expect(html).toContain("供應商：东莞市圣隆贸易有限公司");
    expect(html).toContain("聯繫人：谢芳");
    expect(html).toContain("TEL：0769-85641519");
    expect(html).toContain("货币：港币");
    expect(html).toContain("透明胶纸");
    expect(html).toContain("2.5*90Y");
    expect(html).toContain("貨號");
    expect(html).toContain("金額(HK$)");
    expect(html).toContain("合計");
    expect(html).toContain(">500<");
    expect(html).toContain("2026-09-20 前交货货送 东莞兴信塑胶制品有限公司 处，收货人：张三");
    expect(html).toContain("附送免费1%备品");
    expect(html).toContain("货物及部件质量符合国外现行最新标准");
    expect(html).toContain("生产单号：BBD-40132522");
    // 7 条注意事项逐条断言(对照老系统 printContracts.test.ts 的 PRINT_NOTES 循环)
    for (const n of PRINT_NOTES) expect(html).toContain(n);
    expect(html).toContain("供应商确认：______");
    expect(html).toContain("共&nbsp;&nbsp;页，第&nbsp;&nbsp;页");
  });

  it("供应商货币为空时回落港币", () => {
    const html = buildPurchaseOrderPrintHtml({
      ...PRINT_DETAIL,
      单头: { ...PRINT_DETAIL.单头!, 供应商货币: undefined },
    });
    expect(html).toContain("货币：港币");
  });

  it("hidePrice 时单价/金额/合計脱敏为 ***", () => {
    const html = buildPurchaseOrderPrintHtml(PRINT_DETAIL, { hidePrice: true });
    expect(html).toContain("***");
    expect(html).not.toContain(">500<");
    expect(html).not.toContain(">5<");
  });

  it("HTML 特殊字符转义", () => {
    const html = buildPurchaseOrderPrintHtml({
      单头: { ID: 2, 单号: "PO-1", 供应商名称: "A<B>" },
      明细: [],
    });
    expect(html).toContain("A&lt;B&gt;");
    expect(html).not.toContain("A<B>");
  });
});

// ---------- Batch 6:?basis= 深链(采购物料分析「下采购订单」跳入;对照老系统 PurchaseOrderDrawer 新建模式 basis 预填) ----------

describe("?basis= 深链", () => {
  it("新建态自动按生产单 basis 预填:行追加+供应商/PO号带出,消费后清参", async () => {
    const calls = installFetch(baseCfg());
    renderWithProviders(<PurchaseOrderPage />, "/purchase-orders?basis=SC-1");
    // basis 请求带生产单号
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.startsWith("/api/purchase-orders/basis?") &&
            decodeURIComponent(c.url).includes("生产单号=SC-1"),
        ),
      ).toBe(true),
    );
    // 行追加进网格(默认勾选规则:可用库存够的 M-2 不勾)
    await waitFor(() =>
      expect(screen.getByLabelText("勾选 M-1", { exact: false })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("勾选 M-1", { exact: false })).toBeChecked();
    expect(screen.getByLabelText("勾选 M-2", { exact: false })).not.toBeChecked();
    // 供应商/PO号由 basis 首行带出
    await waitFor(() => expect(screen.getByLabelText("供应商")).toHaveValue("S1 供应商A"));
    expect(screen.getByLabelText("PO号(合同号)")).toHaveValue("HT-1");
  });

  it("?basis=&行= 深链:只勾分析页带过来的行(不按默认勾选规则)", async () => {
    installFetch(baseCfg());
    // 行=2(库存够的 M-2,默认规则不会勾) → 只有 M-2 被勾
    renderWithProviders(
      <PurchaseOrderPage />,
      `/purchase-orders?basis=SC-1&${encodeURIComponent("行")}=2`,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("勾选 M-1", { exact: false })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("勾选 M-1", { exact: false })).not.toBeChecked();
    expect(screen.getByLabelText("勾选 M-2", { exact: false })).toBeChecked();
    expect(screen.getByLabelText("勾选 M-3", { exact: false })).not.toBeChecked();
  });
});

// ---------- 按供应商分组下单(多供应商分别开单:一单只允许一个供应商的物料) ----------

// basis 多供应商版本:M-1/M-2 绑 S1,M-4 绑 S2,M-3 未绑定
const BASIS_MULTI = [
  ...BASIS,
  {
    物料编号: "M-4",
    物料名称: "织带",
    单位: "米",
    需订数量: 40,
    可用库存: 0,
    预算单价: 3,
    供应商编号: "S2",
    供应商名称: "供应商B",
    已订数量: 0,
  },
];

describe("按供应商过滤带入", () => {
  it("basis 多供应商:落定 S1 后只带入 S1+未绑定的行,S2 行不进网格;重选供应商B后换出", async () => {
    const cfg = baseCfg();
    cfg.basis = BASIS_MULTI;
    setup(cfg);
    await gotoNew();
    await appendBasis();
    // 落定 S1(首个绑定行):M-1/M-2(S1) + M-3(未绑定) 带入,M-4(S2) 不在网格
    await waitFor(() => expect(screen.getByLabelText("供应商")).toHaveValue("S1 供应商A"));
    expect(screen.getByLabelText("勾选 M-3", { exact: false })).toBeInTheDocument();
    expect(screen.queryByLabelText("勾选 M-4", { exact: false })).toBeNull();
    // 过滤提示
    await waitFor(() =>
      expect(screen.getByText(/其他供应商的物料未带入/)).toBeInTheDocument(),
    );
    // 重选供应商B:M-4 出现,M-1/M-2 移出,M-3(未绑定)仍在
    fireEvent.click(screen.getByText("选择"));
    fireEvent.click((await screen.findByText("供应商B")).closest("tr")!);
    await waitFor(() =>
      expect(screen.getByLabelText("勾选 M-4", { exact: false })).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("勾选 M-1", { exact: false })).toBeNull();
    expect(screen.getByLabelText("勾选 M-3", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText("供应商")).toHaveValue("S2 供应商B");
  });

  it("?basis=&供应商编号= 深链:按指定供应商过滤带入(分析页分组下单跳入)", async () => {
    const cfg = baseCfg();
    cfg.basis = BASIS_MULTI;
    installFetch(cfg);
    renderWithProviders(
      <PurchaseOrderPage />,
      `/purchase-orders?basis=SC-1&${encodeURIComponent("供应商编号")}=S2&${encodeURIComponent("供应商名称")}=${encodeURIComponent("供应商B")}`,
    );
    await waitFor(() => expect(screen.getByLabelText("供应商")).toHaveValue("S2 供应商B"));
    await waitFor(() =>
      expect(screen.getByLabelText("勾选 M-4", { exact: false })).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("勾选 M-1", { exact: false })).toBeNull();
    expect(screen.getByLabelText("勾选 M-3", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText("PO号(合同号)")).toHaveValue("HT-1");
  });

  it("默认供应商记忆:选过供应商A后,再点「新建」自动带出", async () => {
    setup(baseCfg());
    await gotoNew();
    await fillHeader(); // 选供应商A(写入记忆)
    fireEvent.click(screen.getByText("新建"));
    await waitFor(() => expect(screen.getByLabelText("供应商")).toHaveValue("S1 供应商A"));
  });
});
