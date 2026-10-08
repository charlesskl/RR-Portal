// 来料领料单(来料仓)全量对齐:逐场景对照老系统
// web/src/pages/materials/MaterialDocPage.tsx、MaterialDocCreateDrawer.tsx、
// MaterialLineTable.tsx(usageCols)、MaterialIssueQueryPage.tsx
// 与 web/src/__tests__/issueBasisPick.test.ts、materialDocs.test.ts 测试契约。
// 业务口径:审核=出库(三级流转:主管审核 -> 经理审核 -> 审核(出库)),与塑胶领料单两仓口径一致。
// 权限键实证:后端 MenuCatalog 只有「来料领料单」,issue-query 与单据共用该菜单(无独立查询菜单)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import MaterialIssuePage from "@/pages/MaterialIssuePage";
import {
  basisRowToLine,
  issueBasis档,
  issueBasis档说明,
  sumQty,
  toSubmitLine,
  validLines,
  可挑选档,
} from "@/lib/materialIssue";
import type { IssueBasisRow, MaterialIssueDetail, MaterialIssueHeader } from "@/api/types";

// ---------- 测试基建:fetch 路由桩 ----------

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const noContent = () => new Response(null, { status: 204 });

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

// 权限键与后端 MenuCatalog 一致:单据与查询共用「来料领料单」
const PERMS_FULL = [
  { 组: "物料管理", 菜单: "来料领料单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
];
const permsPatch = (menu: string, patch: Record<string, boolean>) =>
  PERMS_FULL.map((r) => (r.菜单 === menu ? { ...r, ...patch } : r));

const MI_UNAUDITED: MaterialIssueHeader = {
  id: 1,
  单号: "LL20260915001",
  日期: "2026-09-15",
  领料部门: "装配部",
  领料人: "张三",
  仓库: "来料仓",
  接受人: "李四",
  数量: 30,
  金额: null,
  操作员: "admin",
  审核: "0",
  主管审核: "0",
  经理审核: "0",
  备注: "急用",
};
const MI_SUP = { ...MI_UNAUDITED, 主管审核: "1", 主管审核人: "boss1" };
const MI_MGR = { ...MI_SUP, 经理审核: "1", 经理审核人: "boss2" };
const MI_AUDITED = { ...MI_MGR, 审核: "1", 审核人: "admin" };

const issueDetailOf = (h: MaterialIssueHeader): MaterialIssueDetail => ({
  单头: h,
  明细: [
    {
      id: 1,
      生产单号: "SC-1",
      款号: "K-1",
      物料编号: "M-1",
      物料名称: "棉布",
      物料类别: "面料",
      规格: "S",
      颜色: "黑",
      单位: "米",
      数量: 30,
      已出数量: h.审核 === "1" ? 30 : 10,
      备注: "行注",
    },
  ],
});

// 分次出库数据源:三行(行11 未领 20 / 行12 已出完未领 0 / 行13 未领 3)
const issueDetail2 = (h: MaterialIssueHeader): MaterialIssueDetail => ({
  单头: h,
  明细: [
    { id: 11, 生产单号: "SC-1", 款号: "K-1", 物料编号: "M-1", 物料名称: "棉布", 规格: "S", 颜色: "黑", 单位: "米", 数量: 30, 已出数量: 10 },
    { id: 12, 生产单号: "SC-1", 款号: "K-1", 物料编号: "M-2", 物料名称: "拉链", 规格: "L", 颜色: "白", 单位: "条", 数量: 7, 已出数量: 7 },
    { id: 13, 生产单号: "SC-2", 款号: "K-2", 物料编号: "M-3", 物料名称: "纽扣", 规格: "-", 颜色: "红", 单位: "粒", 数量: 3, 已出数量: 0 },
  ],
});

// 批量领料数据源:两单三行(货号 HH-A 两行 + HH-B 一行)
const BASIS_SC001: IssueBasisRow[] = [
  { 生产单号: "SC001", 款号: "K1", 货号: "HH-B", 物料编号: "M-2", 物料名称: "拉链", 规格: "L", 颜色: "白", 单位: "条", 数量: 7 },
];
const BASIS_SC002: IssueBasisRow[] = [
  { 生产单号: "SC002", 款号: "K2", 货号: "HH-A", 物料编号: "M-1", 物料名称: "棉布", 规格: "S", 颜色: "黑", 单位: "米", 数量: 10 },
  { 生产单号: "SC002", 款号: "K2", 货号: "HH-A", 物料编号: "M-3", 物料名称: "纽扣", 规格: "-", 颜色: "红", 单位: "粒", 数量: 3 },
];
// 半成品仓现存数据源
const BASIS_SEMI: IssueBasisRow[] = [
  { 生产单号: "SC009", 款号: "K9", 物料编号: "B-1", 物料名称: "半成品件", 规格: "M", 颜色: "蓝", 单位: "PCS", 数量: 5 },
];

const MATERIALS = {
  items: [
    { id: 9, 物料编号: "M-9", 物料名称: "弹力布", 物料类别: "面料", 规格: "M", 颜色: "灰", 单位: "米", 库存: 500 },
  ],
  total: 1,
};

const PRODUCTIONS = [
  { 生产单号: "SC001", 款号: "K1", 款式: "玩具车", 客户名称: "客户A", 计划数量: 100, 未完成数: 40, 交货日期: "2026-09-30" },
];

const EMPLOYEES = {
  items: [
    { 编号: "E1", 姓名: "张三", 部门编号: "装配部", 职称: "仓管" },
    { 编号: "E2", 姓名: "李四", 部门编号: "PMC", 职称: "PMC" },
    { 编号: "E3", 姓名: "王五", 部门编号: "装配部", 职称: "工人" },
  ],
  total: 3,
};

const STOCK = [{ 物料编号: "M-9", 物料名称: "弹力布", 仓库: "来料仓", 库存数量: 500 }];

const QUERY_DETAIL = [
  {
    类型: "领料",
    日期: "2026-09-15",
    单号: "LL20260915001",
    生产单号: "SC-1",
    款号: "K-1",
    领料部门: "装配部",
    领料人: "张三",
    物料编号: "M-1",
    物料名称: "棉布",
    物料类别: "面料",
    规格: "S",
    颜色: "黑",
    单位: "米",
    数量: 30,
    备注: "",
    审核: "1",
  },
];
const QUERY_SUMMARY = [
  { 物料编号: "M-1", 物料名称: "棉布", 物料类别: "面料", 规格: "S", 颜色: "黑", 单位: "米", 领用数量: 30 },
];

interface Cfg {
  perms: unknown;
  first: unknown;
  list: unknown;
  detail: MaterialIssueDetail;
  stock: unknown;
  materials: unknown;
  productions: unknown;
  employees: unknown;
  basis: Record<string, IssueBasisRow[]>;
  qd: unknown;
  qs: unknown;
  cats: unknown;
  outbound: { 出库行数: number; 完成: boolean };
  onCall?: (c: Call) => Response | undefined;
}

function baseCfg(): Cfg {
  return {
    perms: PERMS_FULL,
    first: { items: [MI_UNAUDITED], total: 1 },
    list: { items: [MI_UNAUDITED], total: 1 },
    detail: issueDetailOf(MI_UNAUDITED),
    stock: STOCK,
    materials: MATERIALS,
    productions: PRODUCTIONS,
    employees: EMPLOYEES,
    basis: { SC001: BASIS_SC001, SC002: BASIS_SC002, "SC-1": BASIS_SC001, SC009: BASIS_SEMI },
    qd: QUERY_DETAIL,
    qs: QUERY_SUMMARY,
    cats: [{ 编号: "1", 类别: "面料", 数量: 3 }],
    outbound: { 出库行数: 1, 完成: false },
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
      // 来料领料查询(与单据同资源段)
      if (p === "/api/material-issues/issue-query/detail") return json(cfg.qd);
      if (p === "/api/material-issues/issue-query/summary") return json(cfg.qs);
      // 来料领料单
      if (p === "/api/material-issues" && method === "GET")
        return u.searchParams.get("size") === "1" ? json(cfg.first) : json(cfg.list);
      if (p === "/api/material-issues" && method === "POST")
        return json({ 单号: "LL20260916001" }, 201);
      if (/^\/api\/material-issues\/[^/]+\/(supervisor-approve|manager-approve|approve|unapprove)$/.test(p))
        return noContent();
      // 分次出库(对照老系统 MaterialIssueOutboundDrawer 的 POST /outbound)
      if (/^\/api\/material-issues\/[^/]+\/outbound$/.test(p) && method === "POST")
        return json({ 单号: "LL20260915001", ...cfg.outbound });
      if (/^\/api\/material-issues\/[^/]+$/.test(p) && method === "GET") return json(cfg.detail);
      if (/^\/api\/material-issues\/[^/]+$/.test(p) && method === "DELETE") return noContent();
      // 应领明细(按生产单带入)
      const basisMatch = /^\/api\/production\/([^/]+)\/issue-basis$/.exec(p);
      if (basisMatch) {
        const no = decodeURIComponent(basisMatch[1]);
        return json(cfg.basis[no] ?? []);
      }
      // 选择器/库存数据源
      if (p === "/api/material-inventory") return json(cfg.stock);
      if (p === "/api/semi-inventory") return json([{ 物料编号: "B-1", 库存: 5 }]);
      if (p === "/api/finished-inventory") return json([]);
      if (p === "/api/material-master/categories") return json(cfg.cats);
      if (p === "/api/material-master") return json(cfg.materials);
      if (p === "/api/production-reports/tracking") return json(cfg.productions);
      if (p === "/api/master/employees") return json(cfg.employees);
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (cfg: Cfg, route = "/material-issues") => {
  const calls = installFetch(cfg);
  renderWithProviders(<MaterialIssuePage />, route);
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
  it("首进自动打开最新领料单:单头卡 + 明细保真列(材料/已出数量/未领) + 三级状态", async () => {
    setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());

    // 单头卡主字段
    expect(screen.getByText("装配部")).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("来料仓")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();
    // 状态文案照抄老系统 MaterialDocPage 领料单列
    expect(screen.getByText("待主管审核")).toBeInTheDocument();
    // 明细保真列(usageCols + 分次出库两列)
    for (const h of ["生产单号", "款号", "物料编号", "物料名称", "规格", "材料", "颜色", "单位", "数量", "已出数量", "未领", "备注"]) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("面料")).toBeInTheDocument();
    // 未领 = 数量30 - 已出10 = 20
    expect(screen.getByText("20")).toBeInTheDocument();
    // 未审核三级入口:主管审核(经理审核/审核(出库)按序不出现)
    expect(screen.getByRole("button", { name: "主管审核" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "经理审核" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审核(出库)" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument();
  });

  it("打开弹窗:列表列(领料单号/日期/领料部门/领料人/仓库/接受人/数量/状态) + 点行载入", async () => {
    const cfg = baseCfg();
    cfg.first = { items: [], total: 0 };
    setup(cfg);
    await waitFor(() => expect(screen.getByText("尚未打开单据")).toBeInTheDocument());

    fireEvent.click(screen.getByText("打开"));
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    expect(screen.getByText("领料部门")).toBeInTheDocument();
    expect(screen.getByText("接受人")).toBeInTheDocument();
    expect(screen.getByText("待主管审核")).toBeInTheDocument();

    fireEvent.click(screen.getByText("LL20260915001"));
    await waitFor(() => expect(screen.getByText("面料")).toBeInTheDocument());
  });
});

// ---------- 新建:按生产单带入(批量领料 · 按货号挑选) ----------

describe("按生产单带入(批量领料)", () => {
  const gotoNew = async () => {
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));
  };
  const openBasisAndLoad = async (input: string) => {
    fireEvent.click(screen.getByText("按生产单带入"));
    fireEvent.change(screen.getByLabelText("生产单号输入"), { target: { value: input } });
    fireEvent.click(screen.getByRole("button", { name: "调入" }));
  };

  it("多单调入:逐单请求 issue-basis(默认来料仓 -> 档=来料,按货号=true),合并按 货号->物料编号 排序,默认全选", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    await openBasisAndLoad("SC002,SC001");

    await waitFor(() => expect(screen.getByText("M-3")).toBeInTheDocument());
    const reqs = calls.filter((c) => c.url.includes("/issue-basis"));
    expect(reqs).toHaveLength(2);
    for (const r of reqs) {
      expect(decodeURIComponent(r.url)).toContain("档=来料");
      expect(decodeURIComponent(r.url)).toContain("按货号=true");
    }
    // 合并排序:HH-A(M-1,M-3) 在前,HH-B(M-2) 在后;默认全选
    expect(screen.getAllByRole("checkbox", { name: /^选择 / })).toHaveLength(3);
    expect(screen.getByLabelText("选择 M-1")).toBeChecked();
    expect(screen.getByLabelText("选择 M-2")).toBeChecked();
    expect(screen.getByLabelText("选择 M-3")).toBeChecked();
    // 货号筛选选项 = distinct 货号(首行=清空「全部货号」)
    fireEvent.click(screen.getByLabelText("货号筛选"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["全部货号", "HH-A", "HH-B"]);
  });

  it("确定带入:只带勾选的行(数量=应领量),空白行被替换", async () => {
    setup(baseCfg());
    await gotoNew();
    // 先加一行空白行
    fireEvent.click(screen.getByText("加一行"));
    expect(screen.getAllByLabelText("数量")).toHaveLength(1);

    await openBasisAndLoad("SC002, SC001");
    await waitFor(() => expect(screen.getByLabelText("选择 M-3")).toBeInTheDocument());
    // 取消勾选 M-3
    fireEvent.click(screen.getByLabelText("选择 M-3"));
    fireEvent.click(screen.getByRole("button", { name: "确定带入" }));

    await waitFor(() => expect(screen.getByText(/已带入 2 行/)).toBeInTheDocument());
    const qtyInputs = screen.getAllByLabelText("数量");
    expect(qtyInputs).toHaveLength(2);
    // 应领量带入,HH-A/M-1 在前,HH-B/M-2 在后
    expect(qtyInputs[0]).toHaveValue(10);
    expect(qtyInputs[1]).toHaveValue(7);
    expect(screen.getAllByLabelText("物料编号")[0]).toHaveValue("M-1");
    expect(screen.getAllByLabelText("物料编号")[1]).toHaveValue("M-2");
  });

  it("半成品仓档:单弹窗直接带入库存现存(不带 按货号),材料列补「半成品」", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    // 表头仓库切到半成品仓
    pickOption("仓库", "半成品仓");
    fireEvent.click(screen.getByText("按生产单带入"));
    fireEvent.change(screen.getByLabelText("生产单号输入"), { target: { value: "SC009" } });
    fireEvent.click(screen.getByRole("button", { name: "带入" }));

    await waitFor(() => expect(screen.getByText(/已带入 1 行\(库存现存\)/)).toBeInTheDocument());
    const req = calls.find((c) => c.url.includes("/issue-basis"))!;
    expect(decodeURIComponent(req.url)).toContain("档=半成品");
    expect(decodeURIComponent(req.url)).not.toContain("按货号=true");
    expect(screen.getByLabelText("物料编号")).toHaveValue("B-1");
    expect(screen.getByLabelText("数量")).toHaveValue(5);
    // 现存档补材料列
    expect(screen.getByText("半成品")).toBeInTheDocument();
  });

  it("下推入口:URL ?basis=生产单号 自动带入应领明细(默认来料仓 -> 档=来料,不带 按货号)", async () => {
    const calls = setup(baseCfg(), "/material-issues?basis=SC001");
    await waitFor(() => expect(screen.getByText(/已带入 1 行/)).toBeInTheDocument());
    const req = calls.find((c) => c.url.includes("/issue-basis"))!;
    expect(decodeURIComponent(req.url)).toContain("档=来料");
    expect(decodeURIComponent(req.url)).not.toContain("按货号=true");
    // 进入新建态,行已带入
    expect(screen.getByLabelText("数量")).toHaveValue(7);
  });
});

// ---------- 新建:按装配BOM带入(后端 /assembly-issue 展开,按表头仓库自动分类) ----------

describe("按装配BOM带入", () => {
  const ASM_VIEW = {
    行: [
      { 物料编号: "P-1", 物料名称: "纸袋", 规格: null, 颜色: null, 单位: "个", 数量: 100, 仓库: "来料" },
      { 物料编号: "P-2", 物料名称: "左耳朵", 规格: null, 颜色: "幻彩红", 单位: "个", 数量: 33.34, 仓库: "塑胶" },
    ],
    跳过半成品: [],
  };
  const asmCfg = (view: unknown = ASM_VIEW) => ({
    ...baseCfg(),
    onCall: (c: Call) => {
      const u = new URL(c.url, "http://test");
      if (/^\/api\/styles\/[^/]+\/assembly-issue$/.test(u.pathname)) return json(view);
      return undefined;
    },
  });
  const gotoNew = async () => {
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));
  };
  const openAsmAndLoad = async (货号 = "92125-S001", qty = "100") => {
    fireEvent.click(screen.getByText("按装配BOM带入"));
    fireEvent.change(screen.getByLabelText("装配BOM货号"), { target: { value: 货号 } });
    fireEvent.change(screen.getByLabelText("做货数量"), { target: { value: qty } });
    fireEvent.click(screen.getByRole("button", { name: "展开" }));
  };

  it("默认来料仓:只带出来料仓的料(塑胶行被过滤),数量参数随请求下发", async () => {
    const calls = setup(asmCfg());
    await gotoNew();
    await openAsmAndLoad();
    await waitFor(() => expect(screen.getByText("P-1")).toBeInTheDocument());
    // 塑胶件被过滤不显示;图例注明过滤
    expect(screen.queryByText("P-2")).not.toBeInTheDocument();
    expect(screen.getByText(/另有 1 行其它仓物料未列出/)).toBeInTheDocument();
    const req = calls.find((c) => c.url.includes("/assembly-issue"))!;
    expect(decodeURIComponent(req.url)).toContain("数量=100");
    fireEvent.click(screen.getByRole("button", { name: /确定带入 1 行/ }));
    await waitFor(() => expect(screen.getByText(/已带入 1 行\(装配BOM展开\)/)).toBeInTheDocument());
    expect(screen.getByLabelText("数量")).toHaveValue(100);
    expect(screen.getByLabelText("款号")).toHaveValue("92125-S001");
  });

  it("塑胶仓:只带塑胶件", async () => {
    setup(asmCfg());
    await gotoNew();
    pickOption("仓库", "塑胶仓");
    await openAsmAndLoad();
    await waitFor(() => expect(screen.getByText("P-2")).toBeInTheDocument());
    expect(screen.queryByText("P-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /确定带入 1 行/ }));
    await waitFor(() => expect(screen.getByLabelText("数量")).toHaveValue(33.34));
    expect(screen.getByLabelText("物料编号")).toHaveValue("P-2");
  });

  it("BOM 无可展开半成品行:提示不成行", async () => {
    setup(asmCfg({ 行: [], 跳过半成品: [] }));
    await gotoNew();
    await openAsmAndLoad();
    await waitFor(() =>
      expect(screen.getByText(/没有可展开的半成品行/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "确定带入" })).toBeDisabled();
  });
});

// ---------- 新建:手选物料 / 领料人选人 / 库存列 / 保存校验 ----------

describe("新建·手选与校验", () => {
  it("手选物料:回填编号/名称/材料/规格/颜色/单位;库存列按表头仓库查 material-inventory", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));

    fireEvent.click(screen.getByText("加一行"));
    fireEvent.click(screen.getByLabelText("物料编号选择"));
    await waitFor(() => expect(screen.getByText("弹力布")).toBeInTheDocument());
    fireEvent.click(screen.getByText("弹力布").closest("tr")!);

    await waitFor(() => expect(screen.getByLabelText("物料编号")).toHaveValue("M-9"));
    expect(screen.getByLabelText("颜色")).toHaveValue("灰");
    // 材料列只读带出
    expect(screen.getAllByText("面料").length).toBeGreaterThan(0);
    // 库存列:默认仓库=来料仓 -> /material-inventory,显示现存量 500
    await waitFor(() => expect(screen.getByText("500")).toBeInTheDocument());
    expect(
      calls.some((c) => decodeURIComponent(c.url).startsWith("/api/material-inventory")),
    ).toBe(true);
  });

  it("领料人点「选」从人事档案选人;接受人下拉仅 职称=仓管/PMC", async () => {
    setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));

    // 接受人下拉:仓管张三 + PMC李四,不含工人王五(首行=清空「选择仓管/PMC」)
    fireEvent.click(screen.getByLabelText("接受人"));
    await waitFor(() => {
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
        "选择仓管/PMC",
        "张三",
        "李四",
      ]);
    });
    fireEvent.keyDown(document, { key: "Escape" });

    // 领料人选择器
    fireEvent.click(screen.getByLabelText("领料人选择"));
    await waitFor(() => expect(screen.getByText("王五")).toBeInTheDocument());
    fireEvent.click(screen.getByText("王五").closest("tr")!);
    await waitFor(() => expect(screen.getByLabelText("领料人")).toHaveValue("王五"));
  });

  it("保存校验:缺接受人/无有效明细分别拦截,不发 POST", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));
    const noPost = () => calls.some((c) => c.method === "POST" && c.url === "/api/material-issues");

    // 仓库默认来料仓已填,先撞接受人校验(对照老系统 required)
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请填写接受人")).toBeInTheDocument());
    expect(noPost()).toBe(false);

    // 接受人候选(职称=仓管/PMC)异步加载,等选项就位再选
    fireEvent.click(screen.getByLabelText("接受人"));
    fireEvent.click(await screen.findByRole("option", { name: "李四" }));
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请至少录入一行有效物料明细")).toBeInTheDocument());
    expect(noPost()).toBe(false);
  });

  it("保存成功:部门默认装配部/仓库默认来料仓/日期当天;明细空串不带、数量转数值", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));

    fireEvent.click(screen.getByText("按生产单带入"));
    fireEvent.change(screen.getByLabelText("生产单号输入"), { target: { value: "SC001" } });
    fireEvent.click(screen.getByRole("button", { name: "调入" }));
    await waitFor(() => expect(screen.getByLabelText("选择 M-2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "确定带入" }));
    await waitFor(() => expect(screen.getByText(/已带入 1 行/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("行备注"), { target: { value: " 行注 " } });
    // 接受人候选异步加载,等选项就位再选
    fireEvent.click(screen.getByLabelText("接受人"));
    fireEvent.click(await screen.findByRole("option", { name: "李四" }));
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/material-issues")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/material-issues")!;
    expect(post.body!.领料部门).toBe("装配部");
    expect(post.body!.仓库).toBe("来料仓");
    expect(post.body!.接受人).toBe("李四");
    expect(String(post.body!.日期)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const lines = post.body!.明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ 生产单号: "SC001", 款号: "K1", 物料编号: "M-2", 数量: 5, 备注: "行注" });
    await waitFor(() => expect(screen.getByText(/来料领料单已创建:LL20260916001/)).toBeInTheDocument());
  });
});

// ---------- 审核流转:主管 -> 经理 -> 审核(=出库) / 反审核 / 删除 ----------

describe("审核流转(审核=出库)", () => {
  it("三级链:主管审核 -> 经理审核 -> 审核(出库),逐级 POST 并刷新状态文案", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      if (c.url.endsWith("/supervisor-approve")) cfg.detail = issueDetailOf(MI_SUP);
      if (c.url.endsWith("/manager-approve")) cfg.detail = issueDetailOf(MI_MGR);
      if (c.url.endsWith("/approve")) cfg.detail = issueDetailOf(MI_AUDITED);
      return undefined;
    };
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getByRole("button", { name: "主管审核" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "主管审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/material-issues/LL20260915001/supervisor-approve")).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "经理审核" })).toBeInTheDocument());
    expect(screen.getAllByText(/待经理审核/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "经理审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/material-issues/LL20260915001/manager-approve")).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "审核(出库)" })).toBeInTheDocument());
    expect(screen.getAllByText(/待出库/).length).toBeGreaterThan(0);

    // 审核=出库:POST approve,状态变出库完成,出现反审核,删除入口消失
    fireEvent.click(screen.getByRole("button", { name: "审核(出库)" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/material-issues/LL20260915001/approve")).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("出库完成")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "反审核" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("已审核单:反审核 POST 后回到待主管审核;删除未审核单确认后 DELETE 回新建态", async () => {
    const cfg = baseCfg();
    cfg.first = { items: [MI_AUDITED], total: 1 };
    cfg.detail = issueDetailOf(MI_AUDITED);
    cfg.onCall = (c) => {
      if (c.url.endsWith("/unapprove")) cfg.detail = issueDetailOf(MI_UNAUDITED);
      return undefined;
    };
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getByText("出库完成")).toBeInTheDocument());
    // 已审核:全部出完,未领=0
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "反审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/material-issues/LL20260915001/unapprove")).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.getByText("确认删除该来料领料单?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认删除"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url === "/api/material-issues/LL20260915001"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("已删除")).toBeInTheDocument());
  });
});

// ---------- 分次出库抽屉(对照老系统 MaterialIssueOutboundDrawer) ----------

describe("分次出库抽屉", () => {
  // 经理已审(待出库)单:出库入口与 审核(出库) 并存(照老 MaterialDocPage 领料单行操作口径)
  const mgrCfg = () => {
    const cfg = baseCfg();
    cfg.first = { items: [MI_MGR], total: 1 };
    cfg.list = { items: [MI_MGR], total: 1 };
    cfg.detail = issueDetail2(MI_MGR);
    return cfg;
  };
  const openDrawer = async () => {
    await waitFor(() => expect(screen.getByRole("button", { name: "出库" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "出库" }));
    // 抽屉打开后异步重取整单,等明细行(本次出库输入框)就位
    await waitFor(() => expect(screen.getAllByLabelText("本次出库")).toHaveLength(3));
  };

  it("入口与默认值:经理已审单出现「出库」并与「审核(出库)」并存;本次出库默认=未领,已出完行禁用,超未领钳制", async () => {
    setup(mgrCfg());
    await openDrawer();

    // 抽屉列照抄老系统:申请数量/已出数量/未领/本次出库
    for (const h of ["申请数量", "已出数量", "未领", "本次出库"]) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }
    const inputs = screen.getAllByLabelText("本次出库");
    expect(inputs).toHaveLength(3);
    expect(inputs[0]).toHaveValue(20); // 30 - 10
    expect(inputs[1]).toHaveValue(0); // 已出完
    expect(inputs[1]).toBeDisabled();
    expect(inputs[2]).toHaveValue(3);
    // 超过未领数量钳制到未领(对照老系统 InputNumber max=未领)
    fireEvent.change(inputs[0], { target: { value: "999" } });
    expect(inputs[0]).toHaveValue(20);
  });

  it("部分出库+跳行:只提交 本次出库>0 的行(行ID/数量),提示部分出库并刷新明细", async () => {
    const cfg = mgrCfg();
    const calls = setup(cfg);
    await openDrawer();

    const inputs = screen.getAllByLabelText("本次出库");
    fireEvent.change(inputs[0], { target: { value: "4" } });
    fireEvent.change(inputs[2], { target: { value: "0" } }); // 跳行
    fireEvent.click(screen.getByRole("button", { name: "确认出库" }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/outbound"))).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/outbound"))!;
    expect(post.body).toEqual({ 明细: [{ 行ID: 11, 数量: 4 }] });
    await waitFor(() => expect(screen.getByText(/部分出库:1 行已出库,剩余可再次出库/)).toBeInTheDocument());
    // 抽屉关闭,单据仍是待出库(后端 完成=false)
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "确认出库" })).not.toBeInTheDocument(),
    );
    expect(screen.getAllByText(/待出库/).length).toBeGreaterThan(0);
  });

  it("全部出完:后端返回 完成=true,提示自动审核,单据状态置 出库完成", async () => {
    const cfg = mgrCfg();
    cfg.outbound = { 出库行数: 2, 完成: true };
    cfg.onCall = (c) => {
      if (c.url.endsWith("/outbound")) cfg.detail = { ...issueDetail2(MI_AUDITED) };
      return undefined;
    };
    const calls = setup(cfg);
    await openDrawer();

    // 默认值即全部出完(行11=20, 行13=3)
    fireEvent.click(screen.getByRole("button", { name: "确认出库" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/outbound"))).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/outbound"))!;
    expect(post.body).toEqual({
      明细: [
        { 行ID: 11, 数量: 20 },
        { 行ID: 13, 数量: 3 },
      ],
    });
    await waitFor(() =>
      expect(screen.getByText(/出库完成:2 行已全部出完,单据已自动审核/)).toBeInTheDocument(),
    );
    // 明细重取后单据自动置已审核(出库完成),出现反审核入口
    await waitFor(() => expect(screen.getByText("出库完成")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "反审核" })).toBeInTheDocument();
  });

  it("本次出库全 0:拦截不发 POST(对照老系统「没有需要出库的行」)", async () => {
    const cfg = mgrCfg();
    const calls = setup(cfg);
    await openDrawer();

    const inputs = screen.getAllByLabelText("本次出库");
    fireEvent.change(inputs[0], { target: { value: "0" } });
    fireEvent.change(inputs[2], { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "确认出库" }));

    await waitFor(() =>
      expect(screen.getByText(/没有需要出库的行\(本次出库均为 0\)/)).toBeInTheDocument(),
    );
    expect(calls.some((c) => c.url.endsWith("/outbound"))).toBe(false);
  });
});

// ---------- 来料领料查询页签 ----------

describe("来料领料查询", () => {
  it("查询页签:默认本月区间请求明细;列含类型/材料;切汇总查询", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "来料领料查询" }));
    await waitFor(() => expect(screen.getByText("领料")).toBeInTheDocument());
    const d = calls.find((c) => c.url.startsWith("/api/material-issues/issue-query/detail"))!;
    expect(decodeURIComponent(d.url)).toContain("起=");
    expect(decodeURIComponent(d.url)).toContain("止=");
    // 明细特有列
    for (const h of ["类型", "领料部门", "材料"]) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }

    fireEvent.click(screen.getByRole("button", { name: "汇总查询" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith("/api/material-issues/issue-query/summary"))).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("领用数量")).toBeInTheDocument());
  });

  it("过滤下发:审核情况/物料类别/关键字;双击明细行回单据页签打开整单", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "来料领料查询" }));
    await waitFor(() => expect(screen.getByText("领料")).toBeInTheDocument());

    pickOption("审核情况", "已审核");
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("issue-query/detail") && decodeURIComponent(c.url).includes("审核情况=已审核")),
      ).toBe(true),
    );
    fireEvent.click(screen.getByLabelText("物料类别"));
    fireEvent.click(await screen.findByRole("option", { name: "面料(3)" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("issue-query/detail") && decodeURIComponent(c.url).includes("物料类别=面料")),
      ).toBe(true),
    );
    fireEvent.change(screen.getByPlaceholderText("单号/生产单号/款号/领料人/物料"), {
      target: { value: "M-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("issue-query/detail") && decodeURIComponent(c.url).includes("keyword=M-1")),
      ).toBe(true),
    );

    // 双击明细行 -> 回单据页签并打开该领料单
    fireEvent.doubleClick(screen.getByText("领料").closest("tr")!);
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "GET" && c.url === "/api/material-issues/LL20260915001").length).toBeGreaterThan(0),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "主管审核" })).toBeInTheDocument());
  });
});

// ---------- 打印 ----------

describe("打印", () => {
  const spyWindowOpen = () => {
    const written: string[] = [];
    vi.spyOn(window, "open").mockReturnValue({
      document: { write: (s: string) => written.push(s), close: () => {} },
      focus: () => {},
      print: () => {},
    } as unknown as Window);
    return written;
  };

  it("有「单价」位:打印含单头(领料部门/仓库/接受人)+明细价格列", async () => {
    const written = spyWindowOpen();
    setup(baseCfg());
    await waitFor(() => expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "打印" }));
    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0]).toContain("来料领料单 LL20260915001");
    expect(written[0]).toContain("装配部");
    expect(written[0]).toContain("来料仓");
    expect(written[0]).toContain("接受人");
    expect(written[0]).toContain("M-1");
    expect(written[0]).toContain("单价");
  });

  it("无「单价」位:打印不出单价/金额列", async () => {
    const written = spyWindowOpen();
    const cfg = baseCfg();
    cfg.perms = permsPatch("来料领料单", { 单价: false, 金额: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "打印" }));
    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0]).toContain("来料领料单 LL20260915001");
    expect(written[0]).not.toContain("单价");
    expect(written[0]).not.toContain("金额");
  });
});

// ---------- 权限位 ----------

describe("权限位", () => {
  it("无「保存」位:新建/保存按钮不渲染", async () => {
    const cfg = baseCfg();
    cfg.perms = permsPatch("来料领料单", { 保存: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("button", { name: "新建" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "打开" })).toBeInTheDocument();
  });

  it("无「审核」位:三级审核按钮不渲染;无「删除」位:删除不渲染", async () => {
    const cfg = baseCfg();
    cfg.perms = permsPatch("来料领料单", { 审核: false, 删除: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "主管审核" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument();
  });

  it("无「反审核」位:已审核单不渲染反审核;无「打印」位:打印不渲染", async () => {
    const cfg = baseCfg();
    cfg.first = { items: [MI_AUDITED], total: 1 };
    cfg.detail = issueDetailOf(MI_AUDITED);
    cfg.perms = permsPatch("来料领料单", { 反审核: false, 打印: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("出库完成")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "反审核" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "打印" })).not.toBeInTheDocument();
  });

  it("无「来料领料单·打开」位:查询页签整页提示无权", async () => {
    const cfg = baseCfg();
    cfg.perms = permsPatch("来料领料单", { 打开: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "来料领料查询" }));
    await waitFor(() => expect(screen.getByText("无权访问来料领料查询")).toBeInTheDocument());
  });
});

// ---------- 纯函数(对照 MaterialLineTable / materialLines 契约) ----------

describe("仓库 -> issue-basis 档", () => {
  it("先判半成品(「半成品」包含「成品」子串),再成品/塑胶,默认来料", () => {
    expect(issueBasis档("半成品仓")).toBe("半成品");
    expect(issueBasis档("成品仓")).toBe("成品");
    expect(issueBasis档("塑胶仓")).toBe("塑胶");
    expect(issueBasis档("来料仓")).toBe("来料");
    expect(issueBasis档(undefined)).toBe("来料");
  });
  it("档说明与可挑选档:仅 来料/塑胶 走按货号挑选弹窗", () => {
    expect(issueBasis档说明("半成品仓")).toBe("该生产单半成品库存现存");
    expect(issueBasis档说明("来料仓")).toBe("非塑胶件(BOM 应领)");
    expect(可挑选档("来料仓")).toBe(true);
    expect(可挑选档("塑胶仓")).toBe(true);
    expect(可挑选档("半成品仓")).toBe(false);
    expect(可挑选档("成品仓")).toBe(false);
  });
});

describe("来料领料页纯逻辑", () => {
  it("basisRowToLine:数量=应领量;现存档补材料列,应领档不补", () => {
    const r: IssueBasisRow = { 生产单号: "SC1", 款号: "K1", 物料编号: "M-1", 数量: 7 };
    expect(basisRowToLine(r, "SC1", 1)).toMatchObject({ 生产单号: "SC1", 物料编号: "M-1", 数量: "7" });
    expect(basisRowToLine(r, "SC1", 1).物料类别).toBeUndefined();
    expect(basisRowToLine(r, "SC1", 2, "半成品").物料类别).toBe("半成品");
    // 生产单号缺省回落
    expect(basisRowToLine({ 物料编号: "M-2", 数量: 1 }, "SC9", 3).生产单号).toBe("SC9");
  });

  it("validLines:必须有物料编号且数量>0", () => {
    const lines = [
      { key: 1, 物料编号: "M-1", 数量: "5" },
      { key: 2, 物料编号: "", 数量: "5" },
      { key: 3, 物料编号: "M-2", 数量: "0" },
    ];
    expect(validLines(lines).map((l) => l.物料编号)).toEqual(["M-1"]);
  });

  it("toSubmitLine:空串不带,数量转数值,备注去空白", () => {
    const l = toSubmitLine({
      key: 1,
      生产单号: " SC001 ",
      物料编号: "M-1",
      物料名称: "棉布",
      颜色: "",
      数量: "7.5",
      备注: " 行注 ",
    });
    expect(l).toMatchObject({ 生产单号: "SC001", 物料编号: "M-1", 数量: 7.5, 备注: "行注" });
    expect(l.颜色).toBeUndefined();
    expect(l.规格).toBeUndefined();
  });

  it("sumQty:空串/非法按 0 计", () => {
    expect(sumQty([{ 数量: "5" }, { 数量: "" }, { 数量: 2.5 }])).toBe(7.5);
  });
});
