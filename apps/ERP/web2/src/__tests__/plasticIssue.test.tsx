// 塑胶领料单(塑胶仓)全量对齐:逐场景对照老系统
// web/src/pages/plastics/PlasticIssueFormPage.tsx、PlasticIssueLineTable.tsx、
// PlasticIssueQueryPage.tsx 与 web/src/__tests__/issueBasisPick.test.ts 测试契约。
// 业务口径:审核=出库(三级流转:主管审核 -> 经理审核 -> 审核(出库))。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticIssuePage from "@/pages/PlasticIssuePage";
import {
  buildPlasticIssuePrintHtml,
  distinct货号,
  issueBasisKey,
  mergeIssueBasisRows,
  parse生产单号s,
  prefillDefaultWarehouse,
  stockRefRows,
  toSubmitLine,
  validLines,
} from "@/lib/plasticIssue";
import type { IssueBasisRow, PlasticIssueDetail, PlasticIssueHeader } from "@/api/types";

// ---------- 测试基建:fetch 路由桩 ----------

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const noContent = () => new Response(null, { status: 204 });

// 权限键与后端 MenuCatalog 一致:单据「塑胶领料单」,查询「塑胶领料查询」
const PERMS_FULL = [
  { 组: "塑胶仓储", 菜单: "塑胶领料单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
  { 组: "塑胶报表", 菜单: "塑胶领料查询", 打开: true, 保存: false, 删除: false, 打印: true, 单价: true, 金额: true, 审核: false, 反审核: false, 功能: false },
];
const permsPatch = (menu: string, patch: Record<string, boolean>) =>
  PERMS_FULL.map((r) => (r.菜单 === menu ? { ...r, ...patch } : r));

const PI_UNAUDITED: PlasticIssueHeader = {
  id: 1,
  单号: "LL20260915001",
  日期: "2026-09-15",
  领料部门: "注塑部",
  领料人: "张三",
  仓库: "塑胶仓",
  数量: 30,
  金额: null,
  操作员: "admin",
  审核: "0",
  主管审核: "0",
  经理审核: "0",
  领料备注: "生产领料",
  收件人: "李四",
  电脑单号: "DN-001",
  备注: "急用",
  胶箱数: 2,
  卡板数: 1,
};
const PI_SUP = { ...PI_UNAUDITED, 主管审核: "1", 主管审核人: "boss1" };
const PI_MGR = { ...PI_SUP, 经理审核: "1", 经理审核人: "boss2" };
const PI_AUDITED = { ...PI_MGR, 审核: "1", 审核人: "admin" };

const issueDetailOf = (h: PlasticIssueHeader): PlasticIssueDetail => ({
  单头: h,
  明细: [
    {
      id: 1,
      装配采购: "装配",
      生产单号: "SC-1",
      款号: "K-1",
      物料编号: "PM-1",
      模具编号: "MJ-1",
      物料名称: "ABS粒",
      规格: "S",
      颜色: "黑",
      色粉号: "SF-1",
      用料名称: "用料A",
      仓位号: "A01",
      单位: "KG",
      数量: 30,
      备注: "",
    },
  ],
});

// 批量领料数据源:两单三行(货号 HH-A 两行 + HH-B 一行)
const BASIS_SC001: IssueBasisRow[] = [
  { 生产单号: "SC001", 款号: "K1", 货号: "HH-B", 物料编号: "PM-2", 物料名称: "PP粒", 规格: "L", 颜色: "白", 单位: "KG", 数量: 7 },
];
const BASIS_SC002: IssueBasisRow[] = [
  { 生产单号: "SC002", 款号: "K2", 货号: "HH-A", 物料编号: "PM-1", 物料名称: "ABS粒", 规格: "S", 颜色: "黑", 单位: "KG", 数量: 10 },
  { 生产单号: "SC002", 款号: "K2", 货号: "HH-A", 物料编号: "PM-3", 物料名称: "色粉", 规格: "-", 颜色: "红", 单位: "KG", 数量: 3 },
];

const PLASTIC_MATERIALS = {
  items: [
    {
      id: 9,
      物料编号: "PM-9",
      物料名称: "ABS再生粒",
      规格: "M",
      颜色: "灰",
      仓位号: "B02",
      单位: "KG",
    },
  ],
  total: 1,
};

const PRODUCTIONS = [
  { 生产单号: "SC001", 款号: "K1", 款式: "玩具车", 客户名称: "客户A", 计划数量: 100, 未完成数: 40, 交货日期: "2026-09-30" },
];

const STOCK = [{ 物料编号: "PM-9", 物料名称: "ABS再生粒", 仓库: "塑胶仓", 库存数量: 500 }];

const QUERY_DETAIL = [
  {
    日期: "2026-09-15",
    单号: "LL20260915001",
    生产单号: "SC-1",
    款号: "K-1",
    领料部门: "注塑部",
    领料人: "张三",
    装配采购: "装配",
    物料编号: "PM-1",
    物料名称: "ABS粒",
    颜色: "黑",
    塑胶货号: "HH-1",
    共用物料: "",
    共用货号: "",
    单位: "KG",
    数量: 30,
    单价: 2.5,
    金额: 75,
    备注: "",
    审核: "1",
  },
];
const QUERY_SUMMARY = [
  { 生产单号: "SC-1", 款号: "K-1", 物料编号: "PM-1", 物料名称: "ABS粒", 颜色: "黑", 塑胶货号: "HH-1", 共用物料: "", 共用货号: "", 单位: "KG", 数量: 30, 单价: 2.5, 金额: 75 },
];

interface Cfg {
  perms: unknown;
  first: unknown;
  list: unknown;
  detail: PlasticIssueDetail;
  stock: unknown;
  materials: unknown;
  materialSetting: unknown;
  productions: unknown;
  basis: Record<string, IssueBasisRow[]>;
  qd: unknown;
  qs: unknown;
  cats: unknown;
  onCall?: (c: Call) => Response | undefined;
}

function baseCfg(): Cfg {
  return {
    perms: PERMS_FULL,
    first: { items: [PI_UNAUDITED], total: 1 },
    list: { items: [PI_UNAUDITED], total: 1 },
    detail: issueDetailOf(PI_UNAUDITED),
    stock: STOCK,
    materials: PLASTIC_MATERIALS,
    materialSetting: { 物料编号: "PM-9", 默认仓库: "塑胶仓" },
    productions: PRODUCTIONS,
    basis: { SC001: BASIS_SC001, SC002: BASIS_SC002, "SC-1": BASIS_SC001 },
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
      // 塑胶领料查询
      if (p === "/api/plastic-issue-query/detail") return json(cfg.qd);
      if (p === "/api/plastic-issue-query/summary") return json(cfg.qs);
      // 塑胶领料单
      if (p === "/api/plastic-issues" && method === "GET")
        return u.searchParams.get("size") === "1" ? json(cfg.first) : json(cfg.list);
      if (p === "/api/plastic-issues" && method === "POST")
        return json({ 单号: "LL20260916001" }, 201);
      if (/^\/api\/plastic-issues\/[^/]+\/(supervisor-approve|manager-approve|approve|unapprove)$/.test(p))
        return noContent();
      if (/^\/api\/plastic-issues\/[^/]+$/.test(p) && method === "GET") return json(cfg.detail);
      if (/^\/api\/plastic-issues\/[^/]+$/.test(p) && method === "DELETE") return noContent();
      // 应领明细(按生产单带入)
      const basisMatch = /^\/api\/production\/([^/]+)\/issue-basis$/.exec(p);
      if (basisMatch) {
        const no = decodeURIComponent(basisMatch[1]);
        return json(cfg.basis[no] ?? []);
      }
      // 选择器/库存数据源
      if (p === "/api/plastic-inventory") return json(cfg.stock);
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

const setup = (cfg: Cfg, route = "/plastic-issues") => {
  const calls = installFetch(cfg);
  renderWithProviders(<PlasticIssuePage />, route);
  return calls;
};

// SearchSelect:点开按钮再点选项(替代原生 select 的 fireEvent.change)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
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
  it("首进自动打开最新领料单:单头卡 + 明细保真列(模具编号/色粉号/用料名称) + 三级状态 + 库存参考", async () => {
    setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());

    // 单头卡主字段
    expect(screen.getByText("注塑部")).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("塑胶仓")).toBeInTheDocument();
    expect(screen.getByText("未审核")).toBeInTheDocument();
    // 明细保真列序字段(老系统 PlasticIssueLineTable 列)
    for (const h of ["装配采购", "生产单号", "款号", "物料编号", "模具编号", "物料名称", "色粉号", "用料名称", "单位", "数量"]) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("MJ-1")).toBeInTheDocument();
    expect(screen.getByText("SF-1")).toBeInTheDocument();
    expect(screen.getByText("用料A")).toBeInTheDocument();
    // 库存参考(表头仓库=塑胶仓 -> /plastic-inventory?仓库=塑胶仓;但明细 PM-1 不在库存表 -> 0)
    await waitFor(() => expect(screen.getByText("库存参考")).toBeInTheDocument());
    // 未审核三级入口:主管审核(经理审核/审核(出库)按序不出现)
    expect(screen.getByRole("button", { name: "主管审核" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "经理审核" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审核(出库)" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打印" })).toBeInTheDocument();
  });

  it("打开弹窗:列表列(领料单号/日期/领料部门/领料人/仓库/数量/状态) + 点行载入", async () => {
    const cfg = baseCfg();
    cfg.first = { items: [], total: 0 };
    setup(cfg);
    await waitFor(() => expect(screen.getByText("尚未打开单据")).toBeInTheDocument());

    fireEvent.click(screen.getByText("打开"));
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    expect(screen.getByText("领料部门")).toBeInTheDocument();
    expect(screen.getByText("领料人")).toBeInTheDocument();

    fireEvent.click(screen.getByText("LL20260915001"));
    await waitFor(() => expect(screen.getByText("MJ-1")).toBeInTheDocument());
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

  it("多单调入:逐单请求 issue-basis(档=塑胶,按货号=true),合并按 货号->物料编号 排序,默认全选", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    await openBasisAndLoad("SC002,SC001");

    await waitFor(() => expect(screen.getByText("PM-3")).toBeInTheDocument());
    const reqs = calls.filter((c) => c.url.includes("/issue-basis"));
    expect(reqs).toHaveLength(2);
    for (const r of reqs) {
      expect(decodeURIComponent(r.url)).toContain("档=塑胶");
      expect(decodeURIComponent(r.url)).toContain("按货号=true");
    }
    // 合并排序:HH-A(PM-1,PM-3) 在前,HH-B(PM-2) 在后;默认全选
    expect(screen.getAllByRole("checkbox", { name: /^选择 / })).toHaveLength(3);
    expect(screen.getByLabelText("选择 PM-1")).toBeChecked();
    expect(screen.getByLabelText("选择 PM-2")).toBeChecked();
    expect(screen.getByLabelText("选择 PM-3")).toBeChecked();
    // 货号筛选选项 = distinct 货号(首行=「全部货号」清空行)
    fireEvent.click(screen.getByLabelText("货号筛选"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "全部货号",
      "HH-A",
      "HH-B",
    ]);
  });

  it("确定带入:只带勾选的行(数量=应领量),空白行被替换", async () => {
    setup(baseCfg());
    await gotoNew();
    // 先加一行空白行
    fireEvent.click(screen.getByText("加一行"));
    expect(screen.getAllByLabelText("数量")).toHaveLength(1);

    await openBasisAndLoad("SC002, SC001");
    await waitFor(() => expect(screen.getByLabelText("选择 PM-3")).toBeInTheDocument());
    // 取消勾选 PM-3
    fireEvent.click(screen.getByLabelText("选择 PM-3"));
    fireEvent.click(screen.getByRole("button", { name: "确定带入" }));

    await waitFor(() => expect(screen.getByText(/已带入 2 行/)).toBeInTheDocument());
    const qtyInputs = screen.getAllByLabelText("数量");
    expect(qtyInputs).toHaveLength(2);
    // 应领量带入,HH-A/PM-1 在前,HH-B/PM-2 在后
    expect(qtyInputs[0]).toHaveValue(10);
    expect(qtyInputs[1]).toHaveValue(7);
    expect(screen.getAllByLabelText("物料编号")[0]).toHaveValue("PM-1");
    expect(screen.getAllByLabelText("物料编号")[1]).toHaveValue("PM-2");
  });

  it("行编辑:带入后数量/颜色/模具编号可改完再保存", async () => {
    const calls = setup(baseCfg());
    await gotoNew();
    await openBasisAndLoad("SC001");
    await waitFor(() => expect(screen.getByLabelText("选择 PM-2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "确定带入" }));
    await waitFor(() => expect(screen.getByText(/已带入 1 行/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("模具编号"), { target: { value: "MJ-9" } });
    fireEvent.change(screen.getByLabelText("领料人"), { target: { value: "张三" } });
    fireEvent.change(screen.getByLabelText("仓库"), { target: { value: "塑胶仓" } });
    fireEvent.click(screen.getByText("保存"));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/plastic-issues")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/plastic-issues")!;
    expect(post.body!.领料人).toBe("张三");
    expect(post.body!.仓库).toBe("塑胶仓");
    expect(post.body!.领料备注).toBe("生产领料");
    const lines = post.body!.明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ 生产单号: "SC001", 款号: "K1", 物料编号: "PM-2", 数量: 5, 模具编号: "MJ-9" });
    await waitFor(() => expect(screen.getByText(/塑胶领料单已创建:LL20260916001/)).toBeInTheDocument());
  });

  it("下推入口:URL ?basis=生产单号 自动带入应领明细(不带 按货号)", async () => {
    const calls = setup(baseCfg(), "/plastic-issues?basis=SC001");
    await waitFor(() => expect(screen.getByText(/已带入 1 行/)).toBeInTheDocument());
    const req = calls.find((c) => c.url.includes("/issue-basis"))!;
    expect(decodeURIComponent(req.url)).toContain("档=塑胶");
    expect(decodeURIComponent(req.url)).not.toContain("按货号=true");
    // 进入新建态,行已带入
    expect(screen.getByLabelText("数量")).toHaveValue(7);
  });
});

// ---------- 新建:手选物料 / 默认仓库预填 / 库存参考 / 保存校验 ----------

describe("新建·手选与校验", () => {
  it("手选物料:回填名称/规格/颜色/仓位号/单位;塑胶物料设置预填默认仓库(不覆盖已填);库存参考出现", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));

    fireEvent.click(screen.getByText("加一行"));
    fireEvent.click(screen.getByLabelText("物料编号选择"));
    await waitFor(() => expect(screen.getByText("ABS再生粒")).toBeInTheDocument());
    fireEvent.click(screen.getByText("ABS再生粒").closest("tr")!);

    // 行回填(物料名称只读格;选择器行与明细行同文案,用 getAllByText)
    await waitFor(() => expect(screen.getByLabelText("物料编号")).toHaveValue("PM-9"));
    expect(screen.getAllByText("ABS再生粒").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("颜色")).toHaveValue("灰");
    // 默认仓库预填(表头仓库为空 -> 塑胶仓)
    await waitFor(() => expect(screen.getByLabelText("仓库")).toHaveValue("塑胶仓"));
    expect(
      calls.some((c) => c.url === "/api/plastic-material-settings/lookup/PM-9"),
    ).toBe(true);
    // 库存参考:仓库就绪后查 /plastic-inventory,显示现存量
    await waitFor(() => expect(screen.getByText("500")).toBeInTheDocument());
    expect(calls.some((c) => decodeURIComponent(c.url).startsWith("/api/plastic-inventory"))).toBe(true);
  });

  it("保存校验:缺领料人/缺仓库/无有效明细分别拦截,不发 POST", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));
    const noPost = () => calls.some((c) => c.method === "POST" && c.url === "/api/plastic-issues");

    // 无任何内容:先撞领料人校验
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请填领料人")).toBeInTheDocument());
    expect(noPost()).toBe(false);

    fireEvent.change(screen.getByLabelText("领料人"), { target: { value: "张三" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请填仓库")).toBeInTheDocument());
    expect(noPost()).toBe(false);

    fireEvent.change(screen.getByLabelText("仓库"), { target: { value: "塑胶仓" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(screen.getByText("请至少录入一行有效物料明细(物料编号+数量)")).toBeInTheDocument(),
    );
    expect(noPost()).toBe(false);
  });
});

// ---------- 审核流转:主管 -> 经理 -> 审核(=出库) / 反审核 / 删除 ----------

describe("审核流转(审核=出库)", () => {
  it("三级链:主管审核 -> 经理审核 -> 审核(出库),逐级 POST 并刷新状态", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      if (c.url.endsWith("/supervisor-approve")) cfg.detail = issueDetailOf(PI_SUP);
      if (c.url.endsWith("/manager-approve")) cfg.detail = issueDetailOf(PI_MGR);
      if (c.url.endsWith("/approve")) cfg.detail = issueDetailOf(PI_AUDITED);
      return undefined;
    };
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getByRole("button", { name: "主管审核" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "主管审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/plastic-issues/LL20260915001/supervisor-approve")).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "经理审核" })).toBeInTheDocument());
    expect(screen.getAllByText(/主管已审/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "经理审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/plastic-issues/LL20260915001/manager-approve")).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "审核(出库)" })).toBeInTheDocument());

    // 审核=出库:POST approve,状态变已审核,出现反审核,编辑入口消失
    fireEvent.click(screen.getByRole("button", { name: "审核(出库)" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/plastic-issues/LL20260915001/approve")).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "反审核" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("已审核单:反审核 POST 后回到未审核;删除未审核单确认后 DELETE 回新建态", async () => {
    const cfg = baseCfg();
    cfg.first = { items: [PI_AUDITED], total: 1 };
    cfg.detail = issueDetailOf(PI_AUDITED);
    cfg.onCall = (c) => {
      if (c.url.endsWith("/unapprove")) cfg.detail = issueDetailOf(PI_UNAUDITED);
      return undefined;
    };
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "反审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/plastic-issues/LL20260915001/unapprove")).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.getByText("确认删除该塑胶领料单?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认删除"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url === "/api/plastic-issues/LL20260915001"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("已删除")).toBeInTheDocument());
  });
});

// ---------- 塑胶领料查询页签 ----------

describe("塑胶领料查询", () => {
  it("查询页签:默认本月区间请求明细;列含生产单号/塑胶货号/共用物料;切汇总查询", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "塑胶领料查询" }));
    await waitFor(() => expect(screen.getByText("HH-1")).toBeInTheDocument());
    const d = calls.find((c) => c.url.startsWith("/api/plastic-issue-query/detail"))!;
    expect(decodeURIComponent(d.url)).toContain("起=");
    expect(decodeURIComponent(d.url)).toContain("止=");
    // 明细特有列
    for (const h of ["领料部门", "装配采购", "塑胶货号", "共用物料", "共用货号"]) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }
    // 有单价位:单价/金额列在
    expect(screen.getAllByText("单价").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "汇总查询" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith("/api/plastic-issue-query/summary"))).toBe(true),
    );
  });

  it("过滤下发:审核情况/物料类别/关键字;双击明细行回单据页签打开整单", async () => {
    const calls = setup(baseCfg());
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "塑胶领料查询" }));
    await waitFor(() => expect(screen.getByText("HH-1")).toBeInTheDocument());

    pickOption("审核情况", "已审核");
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("plastic-issue-query/detail") && decodeURIComponent(c.url).includes("审核情况=已审核")),
      ).toBe(true),
    );
    pickOption("物料类别", "胶料(3)");
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("plastic-issue-query/detail") && decodeURIComponent(c.url).includes("物料类别=胶料")),
      ).toBe(true),
    );
    fireEvent.change(screen.getByPlaceholderText("物料编号/名称/生产单号/款号"), {
      target: { value: "PM-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("plastic-issue-query/detail") && decodeURIComponent(c.url).includes("keyword=PM-1")),
      ).toBe(true),
    );

    // 双击明细行 -> 回单据页签并打开该领料单
    fireEvent.doubleClick(screen.getByText("HH-1").closest("tr")!);
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "GET" && c.url === "/api/plastic-issues/LL20260915001").length).toBeGreaterThan(0),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "主管审核" })).toBeInTheDocument());
  });
});

// ---------- 打印 ----------

describe("打印", () => {
  it("查看态点「打印」:开新窗口渲染单头+明细(含领料部门/仓库/塑胶明细列;无价格列)", async () => {
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
    expect(written[0]).toContain("塑胶领料单 LL20260915001");
    expect(written[0]).toContain("注塑部");
    expect(written[0]).toContain("塑胶仓");
    expect(written[0]).toContain("PM-1");
    expect(written[0]).toContain("色粉号");
    expect(written[0]).toContain("用料名称");
    expect(written[0]).not.toContain("单价");
    expect(written[0]).not.toContain("金额");
  });
});

// ---------- 权限位 ----------

describe("权限位", () => {
  it("无「保存」位:新建/保存按钮不渲染", async () => {
    const cfg = baseCfg();
    cfg.perms = permsPatch("塑胶领料单", { 保存: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("button", { name: "新建" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "打开" })).toBeInTheDocument();
  });

  it("无「审核」位:三级审核按钮不渲染;无「删除」位:删除不渲染", async () => {
    const cfg = baseCfg();
    cfg.perms = permsPatch("塑胶领料单", { 审核: false, 删除: false });
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
    cfg.first = { items: [PI_AUDITED], total: 1 };
    cfg.detail = issueDetailOf(PI_AUDITED);
    cfg.perms = permsPatch("塑胶领料单", { 反审核: false, 打印: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("已审核")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "反审核" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "打印" })).not.toBeInTheDocument();
  });

  it("查询页签:无「塑胶领料查询·单价」位不出单价/金额列;无「打开」位整页提示无权", async () => {
    const cfg = baseCfg();
    cfg.perms = permsPatch("塑胶领料查询", { 单价: false, 金额: false });
    setup(cfg);
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "塑胶领料查询" }));
    await waitFor(() => expect(screen.getByText("HH-1")).toBeInTheDocument());
    expect(screen.queryByText("单价")).not.toBeInTheDocument();
    expect(screen.queryByText("金额")).not.toBeInTheDocument();

    cleanup();
    const cfg2 = baseCfg();
    cfg2.perms = permsPatch("塑胶领料查询", { 打开: false });
    setup(cfg2);
    await waitFor(() => expect(screen.getByText("LL20260915001")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "塑胶领料查询" }));
    await waitFor(() => expect(screen.getByText("无权访问塑胶领料查询")).toBeInTheDocument());
  });
});

// ---------- 纯函数(逐条照抄 web/src/__tests__/issueBasisPick.test.ts + 塑胶页逻辑) ----------

describe("批量领料 · 多生产单号解析", () => {
  it("逗号/空格/换行/顿号分隔,去空白去重(保持输入顺序)", () => {
    expect(parse生产单号s("SC001,SC002 SC003\nSC001， SC004、SC002")).toEqual([
      "SC001",
      "SC002",
      "SC003",
      "SC004",
    ]);
  });
  it("空输入返回空数组", () => {
    expect(parse生产单号s("  , \n ")).toEqual([]);
  });
});

describe("批量领料 · 多单合并排序", () => {
  const row = (生产单号: string, 货号: string, 物料编号: string, 数量: number): IssueBasisRow =>
    ({ 生产单号, 款号: 货号, 货号, 物料编号, 数量 });

  it("按 货号->物料编号 排序,多单混排", () => {
    const merged = mergeIssueBasisRows([
      [row("SC002", "HH-B", "M2", 5), row("SC002", "HH-A", "M2", 3)],
      [row("SC001", "HH-A", "M1", 10), row("SC001", "HH-B", "M1", 7)],
    ]);
    expect(merged.map((r) => [r.货号, r.物料编号, r.生产单号])).toEqual([
      ["HH-A", "M1", "SC001"],
      ["HH-A", "M2", "SC002"],
      ["HH-B", "M1", "SC001"],
      ["HH-B", "M2", "SC002"],
    ]);
  });

  it("同键(生产单号+货号+物料编号)去重,保留先到的;无物料编号的行丢弃", () => {
    const merged = mergeIssueBasisRows([
      [row("SC001", "HH-A", "M1", 10)],
      [row("SC001", "HH-A", "M1", 99), { 生产单号: "SC001", 货号: "HH-A", 数量: 1 }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].数量).toBe(10);
  });

  it("行键包含生产单号:不同生产单的同货号同物料是两行", () => {
    const a = row("SC001", "HH-A", "M1", 10);
    const b = row("SC002", "HH-A", "M1", 20);
    expect(issueBasisKey(a)).not.toBe(issueBasisKey(b));
  });
});

describe("批量领料 · 货号筛选选项", () => {
  it("distinct 货号,空货号归为 空串", () => {
    const rows: IssueBasisRow[] = [
      { 货号: "HH-A", 物料编号: "M1", 数量: 1 },
      { 货号: "HH-B", 物料编号: "M2", 数量: 1 },
      { 货号: "HH-A", 物料编号: "M3", 数量: 1 },
      { 物料编号: "M4", 数量: 1 },
    ];
    expect(distinct货号(rows)).toEqual(["HH-A", "HH-B", ""]);
  });
});

describe("塑胶领料页纯逻辑", () => {
  it("validLines:必须有物料编号且数量>0", () => {
    const lines = [
      { key: 1, 物料编号: "PM-1", 数量: "5" },
      { key: 2, 物料编号: "", 数量: "5" },
      { key: 3, 物料编号: "PM-2", 数量: "0" },
    ];
    expect(validLines(lines).map((l) => l.物料编号)).toEqual(["PM-1"]);
  });

  it("toSubmitLine:空串不带,数量转数值", () => {
    const l = toSubmitLine({
      key: 1,
      生产单号: " SC001 ",
      物料编号: "PM-1",
      物料名称: "ABS粒",
      颜色: "",
      数量: "7.5",
    });
    expect(l).toMatchObject({ 生产单号: "SC001", 物料编号: "PM-1", 数量: 7.5 });
    expect(l.颜色).toBeUndefined();
    expect(l.模具编号).toBeUndefined();
  });

  it("prefillDefaultWarehouse:表头已填不覆盖,未填才预填", () => {
    expect(prefillDefaultWarehouse("原料仓", "塑胶仓")).toBeNull();
    expect(prefillDefaultWarehouse("", "塑胶仓")).toBe("塑胶仓");
    expect(prefillDefaultWarehouse(undefined, undefined)).toBeNull();
  });

  it("stockRefRows:distinct 物料编号(保首现序),库存缺省 0", () => {
    const out = stockRefRows(
      [
        { 物料编号: "PM-1", 物料名称: "ABS粒" },
        { 物料编号: "PM-1", 物料名称: "ABS粒" },
        { 物料编号: "PM-2" },
        { 物料编号: "" },
      ],
      { "PM-1": 500 },
    );
    expect(out).toEqual([
      { 物料编号: "PM-1", 物料名称: "ABS粒", 库存数量: 500 },
      { 物料编号: "PM-2", 物料名称: undefined, 库存数量: 0 },
    ]);
  });

  it("buildPlasticIssuePrintHtml:单头字段 + 保真列;无价格列", () => {
    const html = buildPlasticIssuePrintHtml("塑胶领料单 LL1", {
      单头: { 单号: "LL1", 日期: "2026-09-15", 领料部门: "注塑部", 仓库: "塑胶仓" },
      明细: [{ 物料编号: "PM-1", 色粉号: "SF-1", 数量: 30 }],
    });
    expect(html).toContain("塑胶领料单 LL1");
    expect(html).toContain("注塑部");
    expect(html).toContain("色粉号");
    expect(html).toContain("SF-1");
    expect(html).not.toContain("单价");
  });
});
