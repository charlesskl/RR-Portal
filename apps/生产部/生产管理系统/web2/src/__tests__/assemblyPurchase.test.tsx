// 委托加工单(新流程) 测试:
// A. 生产明细「选物料/半成品」双源(物料资料/塑胶半成品)多选入行(填空行优先/去重/单价回填)
// B. 打开旧单:生产明细/明细表快照逐行还原;保存修改 PUT 载荷
// C. 页签(生产明细/明细表)+ 行操作(插入/删/添加行);明细表「选物料」入行;审核链/删除/打印/权限
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import AssemblyPurchasePage from "@/pages/AssemblyPurchasePage";
import { buildAssemblyContractPrintHtml } from "@/lib/printAssemblyContract";
import { adjacentDocNo, collectProductionLines } from "@/lib/assemblyPurchase";
import { PRINT_NOTES } from "@/lib/printContract";
import type { AssemblyPurchaseOrderDetail } from "@/api/types";

// ---------- 测试基建:fetch 路由桩 ----------

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [
  { 组: "基础资料", 菜单: "款号资料", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
  { 组: "发外加工", 菜单: "委托加工单", 打开: true, 保存: true, 删除: true, 打印: true, 单价: true, 金额: true, 审核: true, 反审核: true, 功能: true },
];
const PERMS_NO_SAVE = PERMS_FULL.map((r) =>
  r.菜单 === "委托加工单" ? { ...r, 保存: false } : r,
);
const PERMS_NO_OPEN = PERMS_FULL.map((r) =>
  r.菜单 === "款号资料" ? { ...r, 打开: false } : r,
);

const CUSTOMERS = {
  items: [
    { 客户编号: "C1", 客户名称: "客户甲" },
    { 客户编号: "C2", 客户名称: "客户乙" },
  ],
  total: 2,
};
const FACTORIES = { items: [{ 加工厂编号: "F1", 加工厂名称: "加工厂一", 加工厂类别: "啤塑" }], total: 1 };
const SUPPLIERS = { items: [{ 供应商编号: "S1", 供应商名称: "供应商一" }], total: 1 };
// 物料资料(包材)+ 塑胶物料资料(半成品)双源
const MATERIALS = {
  items: [
    { ID: 1, 物料编号: "B1", 物料名称: "纸箱", 物料类别: "包材", 单位: "个" },
    { ID: 2, 物料编号: "B2", 物料名称: "彩盒", 物料类别: "包材", 单位: "个" },
  ],
  total: 2,
};
const PLASTICS = {
  items: [{ ID: 9, 款号: "92125-MA", 物料编号: "57001643", 物料名称: "左耳朵", 物料类别: "塑胶", 颜色: "幻彩红", 单位: "个" }],
  total: 1,
};

// 旧单(未审核;辅料快照 999 为手工行,打开不重算)
const DETAIL_OLD: AssemblyPurchaseOrderDetail = {
  单头: {
    单号: "ZP-OLD",
    供应商编号: "S1",
    供应商名称: "供应商一",
    客户: "C1，客户甲",
    出单日期: "2026-09-01",
    收货仓库: "半成品仓",
    审核: "0",
    操作员: "admin",
  },
  产品明细: [],
  生产明细: [
    { 产品货号: "K1", 产品名称: "玩具车", 加工数量: 10 },
    { 产品货号: "K2", 产品名称: "玩具船", 加工数量: 20 },
  ],
  辅料表: [
    { 序号: 1, 辅料编号: "M1", 辅料名称: "轮子", 需求数个: 999 },
    { 序号: 2, 辅料编号: "M3", 辅料名称: "帆布", 需求数个: 60 },
  ],
};

const HDR_OLD = { id: 1, 单号: "ZP-OLD", 日期: "2026-09-01", 供应商编号: "S1", 供应商名称: "供应商一", 客户名称: "客户甲", 收货仓库: "半成品仓", 数量: 30, 金额: 0, 审核: "0", 操作员: "admin" };

// 保存后打开的新单
const DETAIL_NEW: AssemblyPurchaseOrderDetail = {
  单头: { 单号: "ZP-NEW", 供应商编号: "F1", 供应商名称: "加工厂一", 审核: "0" },
  产品明细: [],
  生产明细: [{ 产品货号: "B1", 产品名称: "纸箱", 加工数量: 5, 单价: 2 }],
  辅料表: [],
};

interface Cfg {
  perms: unknown;
  firstList: unknown;
  list: unknown;
  details: Record<string, unknown>;
  prices?: Record<string, number>;
  onCall?: (c: Call) => Response | undefined;
}

function baseCfg(): Cfg {
  return {
    perms: PERMS_FULL,
    firstList: { items: [HDR_OLD], total: 1 },
    list: { items: [HDR_OLD], total: 1 },
    details: { "ZP-OLD": DETAIL_OLD, "ZP-NEW": DETAIL_NEW },
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
      if (p === "/api/master/customers") return json(CUSTOMERS);
      if (p === "/api/master/factories") return json(FACTORIES);
      if (p === "/api/master/suppliers") return json(SUPPLIERS);
      if (p === "/api/master/materials") return json(MATERIALS);
      if (p === "/api/processing-prices") return json({ prices: cfg.prices ?? {} });
      if (p === "/api/plastic-material-master") return json(PLASTICS);
      if (p === "/api/styles/bom-headers")
        return json([{ 款号: "92125-MA", 款式: "一窝猫蛋", 客户编号: "C1" }]);
      if (p === "/api/semi-setups")
        return json([
          { id: 1, 类型: "半成品", 名称: "左耳朵", 用量: 1, 明细: [{ 物料编号: "57001643", 使用数量: 1 }] },
          { id: 2, 类型: "半成品", 名称: "右耳朵", 用量: 0.5, 明细: [{ 物料编号: "57001644", 使用数量: 1 }] },
        ]);
      if (p === "/api/production-reports/tracking")
        return json([
          { 生产单号: "SC1", 款号: "92125-MA", 款式: "一窝猫蛋", 客户编号: "C1", 客户名称: "客户甲", 计划数量: 100, 未完成数: 80, 日期: "2026-10-01", 交货日期: "2026-10-10", 审核: "1" },
          { 生产单号: "SC0", 款号: "92125-MA", 款式: "一窝猫蛋", 客户名称: "ZURU", 计划数量: 60, 未完成数: 60, 日期: "2026-10-02", 交货日期: "2026-10-12", 审核: "0" },
        ]);
      if (p === "/api/assembly-purchase-orders" && method === "GET")
        return u.searchParams.get("size") === "1" ? json(cfg.firstList) : json(cfg.list);
      if (p === "/api/assembly-purchase-orders" && method === "POST") return json({ 单号: "ZP-NEW" }, 201);
      if (p.endsWith("/supervisor-approve") && method === "POST") return noContent();
      if (p.endsWith("/manager-approve") && method === "POST") return noContent();
      if (p.endsWith("/approve") && method === "POST") return noContent();
      if (p.endsWith("/unapprove") && method === "POST") return noContent();
      if (/^\/api\/assembly-purchase-orders\/[^/]+$/.test(p) && method === "GET") {
        const no = decodeURIComponent(p.split("/").pop()!);
        if (cfg.details[no]) return json(cfg.details[no]);
        return json({ 消息: "not found" }, 404);
      }
      if (/^\/api\/assembly-purchase-orders\/[^/]+$/.test(p) && method === "PUT") return noContent();
      if (/^\/api\/assembly-purchase-orders\/[^/]+$/.test(p) && method === "DELETE") return noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (cfg: Cfg, route = "/assembly-purchases") => {
  const calls = installFetch(cfg);
  renderWithProviders(<AssemblyPurchasePage />, route);
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

// 等待旧单水合到表单(供应商只读框回填)
const waitForm = async () =>
  waitFor(() => expect(screen.getByLabelText("供应商")).toHaveValue("S1 供应商一"));

// 进入新建态(首单列表置空,不落首进自动开单);新建自动弹「选择生产通知单」,此处关掉走空白单
const gotoNew = async (cfg: Cfg) => {
  cfg.firstList = { items: [], total: 0 };
  await waitFor(() => expect(screen.getByText("尚未打开单据")).toBeInTheDocument());
  fireEvent.click(screen.getByText("新建"));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: /选择生产通知单/ })).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: /选择生产通知单/ })).not.toBeInTheDocument(),
  );
};

// 明细区为页签结构(生产明细/明细表),查明细表先切页签
const gotoAccTab = () => fireEvent.click(screen.getByRole("button", { name: "明细表" }));

// 打开「选物料」弹窗(未关联 MA 时默认物料资料源)
const openMatPick = async () => {
  fireEvent.click(screen.getByRole("button", { name: "选物料" }));
  await waitFor(() => expect(screen.getByText("纸箱")).toBeInTheDocument());
};

// ---------- 生产明细·选物料/半成品 ----------

describe("生产明细·选物料/半成品", () => {
  it("物料资料多选入行:填空行优先,货号/名称带入,单价按记忆回填;已在明细的编号跳过", async () => {
    const cfg = baseCfg();
    cfg.prices = { B1: 1.5 }; // B1 有单价记忆,B2 无
    setup(cfg);
    await gotoNew(cfg);
    await waitFor(() => expect(screen.getByLabelText("行1 生产单号")).toBeInTheDocument());
    // 单头已移除 单价/金额 字段(行级保留)
    expect(screen.queryByLabelText("单价")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("金额")).not.toBeInTheDocument();

    await openMatPick();
    fireEvent.click(screen.getByText("纸箱")); // 多选模式点行=勾选
    fireEvent.click(screen.getByText("彩盒"));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByLabelText("行1 产品货号")).toHaveValue("B1"));
    expect(screen.getByLabelText("行2 产品货号")).toHaveValue("B2");
    expect(screen.getByLabelText("行1 产品名称")).toHaveValue("纸箱");
    expect(screen.getByLabelText("行2 产品名称")).toHaveValue("彩盒");
    // B1 记忆单价 1.5 自动带出;B2 无记忆留空
    await waitFor(() => expect(screen.getByLabelText("行1 生产明细单价")).toHaveValue("1.5"));
    expect(screen.getByLabelText("行2 生产明细单价")).toHaveValue("");

    // 再选 B1:已在明细,跳过 → 提示且不重复入行
    await openMatPick();
    fireEvent.click(screen.getByText("纸箱"));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByText("勾选的物料已在生产明细中")).toBeInTheDocument());
    const b1 = screen
      .getAllByLabelText(/^行\d+ 产品货号$/)
      .filter((i) => (i as HTMLInputElement).value === "B1");
    expect(b1).toHaveLength(1);
  });

  it("塑胶半成品源:切源后塑胶件多选入行", async () => {
    const cfg = baseCfg();
    setup(cfg);
    await gotoNew(cfg);
    await waitFor(() => expect(screen.getByLabelText("行1 生产单号")).toBeInTheDocument());

    await openMatPick();
    fireEvent.click(screen.getByRole("button", { name: "塑胶半成品" }));
    await waitFor(() => expect(screen.getByText("左耳朵")).toBeInTheDocument());
    fireEvent.click(screen.getByText("左耳朵"));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByLabelText("行1 产品货号")).toHaveValue("57001643"));
    expect(screen.getByLabelText("行1 产品名称")).toHaveValue("左耳朵");
  });

  it("关联MA 后「选半成品」:勾 MA 的半成品定义入行;选物料按 MA 前缀过滤", async () => {
    const cfg = baseCfg();
    cfg.prices = { 左耳朵: 0.8 }; // 半成品单价记忆
    setup(cfg);
    await gotoNew(cfg);
    await waitFor(() => expect(screen.getByLabelText("行1 生产单号")).toBeInTheDocument());

    // 未关联 MA 时「选半成品」禁用
    expect(screen.getByRole("button", { name: "选半成品" })).toBeDisabled();
    // 关联 92125-MA(SearchSelect 打开后点选项)
    fireEvent.click(screen.getByRole("button", { name: "关联MA" }));
    await waitFor(() => expect(screen.getByText(/92125-MA 一窝猫蛋/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/92125-MA 一窝猫蛋/));
    // 选半成品:勾 左耳朵 → 确定 → 入行(货号/名称=定义名称)
    await waitFor(() => expect(screen.getByRole("button", { name: "选半成品" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "选半成品" }));
    await waitFor(() => expect(screen.getByText("左耳朵")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "勾选 左耳朵" }));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByLabelText("行1 产品货号")).toHaveValue("左耳朵"));
    expect(screen.getByLabelText("行1 产品名称")).toHaveValue("左耳朵");
    // 半成品单价记忆自动带出
    await waitFor(() => expect(screen.getByLabelText("行1 生产明细单价")).toHaveValue("0.8"));

    // 关联 MA 后选物料=前缀模式:塑胶件 57001643 可见,无 prefix 的 B1/B2 被过滤
    fireEvent.click(screen.getByRole("button", { name: "选物料" }));
    await waitFor(() => expect(screen.getByText("左耳朵")).toBeInTheDocument());
    expect(screen.queryByText("纸箱")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
  });

  it("明细表「选物料」:物料勾入明细表(编号/名称带入,需求数手补),与生产明细同单保存", async () => {
    const cfg = baseCfg();
    const calls = setup(cfg);
    await gotoNew(cfg);
    await waitFor(() => expect(screen.getByLabelText("行1 生产单号")).toBeInTheDocument());

    // 明细表页签选物料:勾 纸箱/彩盒 入行
    gotoAccTab();
    await waitFor(() => expect(screen.getByLabelText("明细1 物料编号")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "选物料" }));
    await waitFor(() => expect(screen.getByText("纸箱")).toBeInTheDocument());
    fireEvent.click(screen.getByText("纸箱"));
    fireEvent.click(screen.getByText("彩盒"));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByLabelText("明细1 物料编号")).toHaveValue("B1"));
    expect(screen.getByLabelText("明细1 物料名称")).toHaveValue("纸箱");
    expect(screen.getByLabelText("明细2 物料编号")).toHaveValue("B2");
    fireEvent.change(screen.getByLabelText("明细1 需求数(个)"), { target: { value: "30" } });

    // 再勾 B1:已在明细表,跳过
    fireEvent.click(screen.getByRole("button", { name: "选物料" }));
    await waitFor(() => expect(screen.getByText("纸箱")).toBeInTheDocument());
    fireEvent.click(screen.getByText("纸箱"));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByText("勾选的物料已在明细表中")).toBeInTheDocument());

    // 保存:物料明细带 B1/B2,与生产明细同一张 POST
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url === "/api/assembly-purchase-orders"),
      ).toBe(true),
    );
    const post = calls.find(
      (c) => c.method === "POST" && c.url === "/api/assembly-purchase-orders",
    )!;
    const 物料明细 = post.body!.物料明细 as Record<string, unknown>[];
    expect(物料明细.map((m) => [m.物料编号, m.需求数量])).toEqual([
      ["B1", 30],
      ["B2", 0],
    ]);
  });

  it("货号/名称可手改;数量改动后 金额=数量x单价", async () => {
    const cfg = baseCfg();
    setup(cfg);
    await gotoNew(cfg);
    await waitFor(() => expect(screen.getByLabelText("行1 生产单号")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("行1 产品货号"), { target: { value: "B9" } });
    fireEvent.change(screen.getByLabelText("行1 产品名称"), { target: { value: "手工件" } });
    fireEvent.change(screen.getByLabelText("行1 生产明细加工数量"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("行1 生产明细单价"), { target: { value: "3" } });
    const row = screen.getByLabelText("行1 产品货号").closest("tr")!;
    expect(row.textContent).toContain("21.00");
  });

  it("行头「绑生产单」:未审核单也可绑;已有内容的行补挂单号、货号/数量不动;徽标显示当前绑定", async () => {
    const cfg = baseCfg();
    setup(cfg);
    await gotoNew(cfg);
    await waitFor(() => expect(screen.getByLabelText("行1 生产单号")).toBeInTheDocument());

    // 行1 先录半成品+数量,再行头绑生产单
    fireEvent.change(screen.getByLabelText("行1 产品货号"), { target: { value: "左耳朵" } });
    fireEvent.change(screen.getByLabelText("行1 产品名称"), { target: { value: "左耳朵" } });
    fireEvent.change(screen.getByLabelText("行1 生产明细加工数量"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "绑生产单" }));
    // 未审核的通知单也列出(委托加工绑定生产通知单,不限已审核)
    await waitFor(() => expect(screen.getByText("SC1")).toBeInTheDocument());
    expect(screen.getByText("SC0").closest("tr")!.textContent).toContain("未审核");
    fireEvent.click(screen.getByText("SC1").closest("tr")!);
    // 行1 内容原样,只补挂 单号/接单日期
    expect(screen.getByLabelText("行1 产品货号")).toHaveValue("左耳朵");
    expect(screen.getByLabelText("行1 生产明细加工数量")).toHaveValue("50");
    expect(screen.getByLabelText("行1 生产单号")).toHaveValue("SC1");
    expect(screen.getByLabelText("行1 生产单号").closest("tr")!.textContent).toContain("2026-10-01");
    // 客户/徽标带出
    await waitFor(() => expect(screen.getByLabelText("客户")).toHaveValue("C1"));
  });

  it("新建自动弹「选择生产通知单」:选单带出 客户/关联MA(不带 MA 产品行),选半成品入行沿用单号", async () => {
    const cfg = baseCfg();
    setup(cfg);
    cfg.firstList = { items: [], total: 0 };
    await waitFor(() => expect(screen.getByText("尚未打开单据")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));
    // 新建即自动弹出选择生产通知单
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /选择生产通知单/ })).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText("SC1")).toBeInTheDocument());
    fireEvent.click(screen.getByText("SC1").closest("tr")!);
    // 基础信息带出:客户=C1(客户甲);关联MA=92125-MA(选半成品可用);
    // 首行保持空白——不绑 MA 产品行(整只 MA 范围太大,半成品/物料由用户勾选)
    await waitFor(() => expect(screen.getByLabelText("客户")).toHaveValue("C1"));
    expect(screen.getByLabelText("行1 生产单号")).toHaveValue("");
    expect(screen.getByLabelText("行1 产品货号")).toHaveValue("");
    await waitFor(() => expect(screen.getByRole("button", { name: "选半成品" })).toBeEnabled());
    // 选半成品入行:进行1 并自动沿用 SC1;加工数量=订单数量100×用量1
    fireEvent.click(screen.getByRole("button", { name: "选半成品" }));
    await waitFor(() => expect(screen.getByText("左耳朵")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "勾选 左耳朵" }));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByLabelText("行1 产品货号")).toHaveValue("左耳朵"));
    expect(screen.getByLabelText("行1 生产单号")).toHaveValue("SC1");
    expect(screen.getByLabelText("行1 生产明细加工数量")).toHaveValue("100");
  });

  it("绑生产单后,选半成品入行自动沿用 单号/接单日期,加工数量=订单数量×用量", async () => {
    const cfg = baseCfg();
    setup(cfg);
    await gotoNew(cfg);
    await waitFor(() => expect(screen.getByLabelText("行1 生产单号")).toBeInTheDocument());

    // 行头绑 SC1(计划数量 100)
    fireEvent.click(screen.getByRole("button", { name: "绑生产单" }));
    await waitFor(() => expect(screen.getByText("SC1")).toBeInTheDocument());
    fireEvent.click(screen.getByText("SC1").closest("tr")!);

    // 绑定已带出 关联MA(92125-MA),直接选半成品:勾 左耳朵(用量1)/右耳朵(用量0.5) → 入行自动沿用 SC1,数量=100×用量
    await waitFor(() => expect(screen.getByRole("button", { name: "选半成品" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "选半成品" }));
    await waitFor(() => expect(screen.getByText("左耳朵")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "勾选 左耳朵" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "勾选 右耳朵" }));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    // 行1=左耳朵 100×1=100;行2=右耳朵 100×0.5=50,均自动带 SC1/接单日期
    await waitFor(() => expect(screen.getByLabelText("行1 产品货号")).toHaveValue("左耳朵"));
    expect(screen.getByLabelText("行1 生产单号")).toHaveValue("SC1");
    expect(screen.getByLabelText("行1 生产明细加工数量")).toHaveValue("100");
    expect(screen.getByLabelText("行1 生产单号").closest("tr")!.textContent).toContain("2026-10-01");
    expect(screen.getByLabelText("行2 产品货号")).toHaveValue("右耳朵");
    expect(screen.getByLabelText("行2 生产明细加工数量")).toHaveValue("50");
    expect(screen.getByLabelText("行2 生产单号")).toHaveValue("SC1");
  });
});

// ---------- 保存 ----------

describe("保存", () => {
  it("POST 生产明细带 款号/产品名称/加工数量/单价,物料明细带 物料编号/需求数量", async () => {
    const cfg = baseCfg();
    const calls = setup(cfg);
    await gotoNew(cfg);
    await openMatPick();
    fireEvent.click(screen.getByText("纸箱"));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByLabelText("行1 产品货号")).toHaveValue("B1"));
    fireEvent.change(screen.getByLabelText("行1 生产明细加工数量"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("行1 生产明细单价"), { target: { value: "2" } });
    // 明细表手工一行
    gotoAccTab();
    fireEvent.change(screen.getByLabelText("明细1 物料编号"), { target: { value: "M1" } });
    fireEvent.change(screen.getByLabelText("明细1 物料名称"), { target: { value: "轮子" } });
    fireEvent.change(screen.getByLabelText("明细1 需求数(个)"), { target: { value: "10" } });

    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url === "/api/assembly-purchase-orders"),
      ).toBe(true),
    );
    const post = calls.find(
      (c) => c.method === "POST" && c.url === "/api/assembly-purchase-orders",
    )!;
    const 生产明细 = post.body!.生产明细 as Record<string, unknown>[];
    expect(生产明细).toHaveLength(1);
    expect(生产明细[0]).toMatchObject({ 款号: "B1", 产品名称: "纸箱", 加工数量: 5, 单价: 2 });
    const 物料明细 = post.body!.物料明细 as Record<string, unknown>[];
    expect(物料明细).toHaveLength(1);
    expect(物料明细[0]).toMatchObject({ 物料编号: "M1", 物料名称: "轮子", 需求数量: 10, 单位: "个" });
    await waitFor(() => expect(screen.getByText(/已保存，单号 ZP-NEW/)).toBeInTheDocument());
  });

  it("校验:无生产明细也无物料明细时拦截保存,不发请求", async () => {
    const cfg = baseCfg();
    const calls = setup(cfg);
    await gotoNew(cfg);
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(screen.getByText("请先在明细中加入物料/半成品，再保存")).toBeInTheDocument(),
    );
    expect(
      calls.some((c) => c.method === "POST" && c.url === "/api/assembly-purchase-orders"),
    ).toBe(false);
  });
});

// ---------- 明细页签 + 行操作 ----------

describe("明细页签+行操作", () => {
  it("默认生产明细页签;插入/删/添加行;明细表页签独立行操作", async () => {
    const cfg = baseCfg();
    setup(cfg);
    await gotoNew(cfg);
    await waitFor(() => expect(screen.getByLabelText("行1 生产单号")).toBeInTheDocument());

    // 默认生产明细页签,12 行空行
    expect(screen.getAllByLabelText(/^行\d+ 生产单号$/)).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: /添加行/ }));
    expect(screen.getAllByLabelText(/^行\d+ 生产单号$/)).toHaveLength(13);
    fireEvent.click(screen.getAllByRole("button", { name: "删" })[0]);
    expect(screen.getAllByLabelText(/^行\d+ 生产单号$/)).toHaveLength(12);
    fireEvent.click(screen.getAllByRole("button", { name: "插入" })[0]);
    expect(screen.getAllByLabelText(/^行\d+ 生产单号$/)).toHaveLength(13);

    // 切明细表页签:生产明细卸载,物料行可手工编辑+添加行
    gotoAccTab();
    expect(screen.queryByLabelText("行1 生产单号")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("明细1 物料编号")).toBeInTheDocument());
    expect(screen.getAllByLabelText(/^明细\d+ 物料编号$/)).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: /添加行/ }));
    expect(screen.getAllByLabelText(/^明细\d+ 物料编号$/)).toHaveLength(11);
    fireEvent.change(screen.getByLabelText("明细1 物料编号"), { target: { value: "X1" } });
    expect(screen.getByLabelText("明细1 物料编号")).toHaveValue("X1");
  });
});

// ---------- 打开旧单:逐行还原 + 明细表快照 ----------

describe("打开旧单", () => {
  it("?单号= 直开:生产明细逐行还原,明细表读快照", async () => {
    setup(baseCfg(), "/assembly-purchases?单号=ZP-OLD");
    await waitForm();

    // 默认生产明细页签:K1/K2 两行还原
    expect(screen.getByLabelText("行1 产品货号")).toHaveValue("K1");
    expect(screen.getByLabelText("行1 产品名称")).toHaveValue("玩具车");
    expect(screen.getByLabelText("行2 产品货号")).toHaveValue("K2");
    expect(screen.getByLabelText("行2 产品名称")).toHaveValue("玩具船");
    // 明细表读快照(999 原样)
    gotoAccTab();
    expect(screen.getByLabelText("明细1 需求数(个)")).toHaveValue("999");
    expect(screen.getByLabelText("明细2 需求数(个)")).toHaveValue("60");
    // 未审核:保存修改/删除/主管审核 入口在
    expect(screen.getByText("保存修改")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "主管审核" })).toBeInTheDocument();
  });

  it("打开弹窗:列表列(开单日期/单号/供应商/客户/数量/金额/状态) + 点行载入", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [], total: 0 };
    setup(cfg);
    await waitFor(() => expect(screen.getByText("尚未打开单据")).toBeInTheDocument());

    fireEvent.click(screen.getByText("打开"));
    await waitFor(() => expect(screen.getByText("ZP-OLD")).toBeInTheDocument());
    expect(screen.getByText("供应商一")).toBeInTheDocument();
    expect(screen.getByText("未审核")).toBeInTheDocument();

    fireEvent.click(screen.getByText("ZP-OLD"));
    await waitForm();
  });

  it("保存修改:未审核单改备注,PUT 载荷带生产明细行", async () => {
    const calls = setup(baseCfg());
    await waitForm();
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "急" } });
    fireEvent.click(screen.getByText("保存修改"));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "PUT" && c.url === "/api/assembly-purchase-orders/ZP-OLD"),
      ).toBe(true),
    );
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body!.备注).toBe("急");
    const 生产明细 = put.body!.生产明细 as Record<string, unknown>[];
    expect(生产明细).toHaveLength(2);
    expect(生产明细[0]).toMatchObject({ 款号: "K1", 产品名称: "玩具车", 加工数量: 10 });
    expect(生产明细[1]).toMatchObject({ 款号: "K2", 产品名称: "玩具船", 加工数量: 20 });
    await waitFor(() =>
      expect(screen.getByText(/委托加工单 ZP-OLD 已保存/)).toBeInTheDocument(),
    );
  });
});

// ---------- 审核链 / 删除 / 打印 ----------

describe("查看态操作", () => {
  const chainDetail = (h: Record<string, unknown>): AssemblyPurchaseOrderDetail => ({
    ...DETAIL_OLD,
    单头: { ...DETAIL_OLD.单头!, ...h },
  });

  it("三级审核链:主管审核 -> 经理审核 -> 审核(下发),按钮按流转切换", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) => {
      if (c.url.endsWith("/supervisor-approve"))
        cfg.details["ZP-OLD"] = chainDetail({ 主管审核: "1", 主管审核人: "主管" });
      if (c.url.endsWith("/manager-approve"))
        cfg.details["ZP-OLD"] = chainDetail({ 主管审核: "1", 主管审核人: "主管", 经理审核: "1", 经理审核人: "经理" });
      if (c.url.endsWith("/approve"))
        cfg.details["ZP-OLD"] = chainDetail({ 主管审核: "1", 经理审核: "1", 审核: "1", 审核人: "经理" } as never);
      return undefined;
    };
    const calls = setup(cfg);
    await waitForm();

    fireEvent.click(screen.getByRole("button", { name: "主管审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/assembly-purchase-orders/ZP-OLD/supervisor-approve")).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "经理审核" })).toBeInTheDocument());
    expect(screen.getByText(/主管已审\(主管\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "经理审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/assembly-purchase-orders/ZP-OLD/manager-approve")).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "审核(下发)" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "审核(下发)" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/assembly-purchase-orders/ZP-OLD/approve")).toBe(true),
    );
    // 已审核:只读单头卡 + 反审核/打印,编辑入口消失
    await waitFor(() => expect(screen.getByText("反审核")).toBeInTheDocument());
    expect(screen.getByText("打印")).toBeInTheDocument();
    expect(screen.queryByText("保存修改")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("已审核:禁删禁改只读(单头卡+只读生产明细),反审核 POST 后回到可编辑态", async () => {
    const cfg = baseCfg();
    cfg.details["ZP-OLD"] = chainDetail({ 审核: "1", 审核人: "经理" });
    cfg.onCall = (c) => {
      if (c.url.endsWith("/unapprove")) cfg.details["ZP-OLD"] = DETAIL_OLD;
      return undefined;
    };
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getAllByText("已审核").length).toBeGreaterThan(0));

    expect(screen.queryByText("保存修改")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    // 只读生产明细(默认页签):K1/K2 行可见
    expect(screen.getByText("玩具车")).toBeInTheDocument();
    expect(screen.getByText("玩具船")).toBeInTheDocument();

    fireEvent.click(screen.getByText("反审核"));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/assembly-purchase-orders/ZP-OLD/unapprove")).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("保存修改")).toBeInTheDocument());
  });

  it("删除:未审核单确认后 DELETE,回到新建态", async () => {
    const calls = setup(baseCfg());
    await waitForm();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.getByText("删除委托加工单")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认删除"));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url === "/api/assembly-purchase-orders/ZP-OLD"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("已删除")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("供应商")).toHaveValue(""));
  });

  it("打印:取最新详情开新窗口按「委托加工合同」格式打印", async () => {
    const cfg = baseCfg();
    cfg.details["ZP-OLD"] = chainDetail({ 审核: "1" });
    const written: string[] = [];
    vi.spyOn(window, "open").mockReturnValue({
      document: { write: (s: string) => written.push(s), close: () => {} },
      focus: () => {},
      print: () => {},
    } as unknown as Window);
    setup(cfg);
    await waitFor(() => expect(screen.getByText("打印")).toBeInTheDocument());

    fireEvent.click(screen.getByText("打印"));
    await waitFor(() => expect(written.length).toBe(1));
    const text = written[0].replace(/<[^>]+>/g, "");
    expect(text).toContain("委托加工合同");
    expect(text).toContain("加工厂：供应商一");
    expect(text).toContain("订单单号：ZP-OLD");
  });
});

// ---------- 权限 ----------

describe("权限位", () => {
  it("无 款号资料·打开:整页无权访问", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_OPEN;
    setup(cfg);
    await waitFor(() => expect(screen.getByText("无权访问委托加工单")).toBeInTheDocument());
    expect(screen.getByText(/缺少「款号资料·打开」权限/)).toBeInTheDocument();
  });

  it("无 委托加工单·保存:不渲染新建/保存入口", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_SAVE;
    setup(cfg);
    await waitForm();
    expect(screen.queryByText("保存修改")).not.toBeInTheDocument();
    expect(screen.queryByText("新建")).not.toBeInTheDocument();
    // 非保存位按钮仍在
    expect(screen.getByRole("button", { name: "打开" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });
});

// ---------- 纯函数 ----------

describe("纯函数", () => {
  it("collectProductionLines:空行不进载荷,字段原样收集(行级客户/装配方式 不再逐行带)", () => {
    const lines = collectProductionLines([
      { key: 1, 生产单号: "MO-1", 产品货号: "K1", 加工数量: 10 },
      { key: 2 }, // 空行过滤
      { key: 3, 产品货号: "B1", 产品名称: "纸箱", 加工数量: 5, 单价: 2 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ 生产单号: "MO-1", 款号: "K1", 加工数量: 10 });
    expect(lines[1]).toMatchObject({ 款号: "B1", 产品名称: "纸箱", 加工数量: 5, 单价: 2 });
    expect(lines[1].客户编号).toBeUndefined();
    expect(lines[1].装配方式).toBeUndefined();
  });

  it("adjacentDocNo:前单=较小单号,后单=较大单号(zh 排序)", () => {
    const nos = ["ZP-3", "ZP-1", "ZP-10", "ZP-2"];
    expect(adjacentDocNo(nos, "ZP-2", false)).toBe("ZP-1");
    expect(adjacentDocNo(nos, "ZP-2", true)).toBe("ZP-3");
    expect(adjacentDocNo(nos, "ZP-1", false)).toBeUndefined();
    expect(adjacentDocNo(nos, "ZP-10", true)).toBeUndefined();
  });
});

// ---------- 委托加工合同 打印模板契约(对照 web/src/__tests__/printContracts.test.ts 装配段) ----------

const ASM_DETAIL: AssemblyPurchaseOrderDetail = {
  单头: {
    单号: "ZP20260905001", 供应商名称: "龙昌加工厂", 出单日期: "2026-09-05",
    单价: 1.5, 金额: 1500, 收货人: "李四", 备注: "注意静电",
    开始交货日期: "2026-09-06", 每天交货: 500, 完成日期: "2026-09-10",
    操作员: "admin", 供应商联系人: "王五", 供应商电话: "0769-11111111", 供应商传真: "0769-22222222",
  },
  产品明细: [{ 产品货号: "DS2609", 装配方式: "包装(已装箱)", 加工数量: 1000 }],
  生产明细: [
    { 生产单号: "MO-1", 产品货号: "DS2609", 产品装配名称: "恐龙套装", 加工数量: 1000, 单价: 1.5, 金额: 1500 },
  ],
  辅料表: [
    { 序号: 1, 辅料名称: "锡线", 需求数克: 2500 },
    { 序号: 2, 辅料名称: "锡线", 需求数克: 1500 },
    { 序号: 3, 辅料名称: "胶水", 需求数克: 500 },
  ],
};

describe("委托加工合同打印模板契约", () => {
  it("抬头/双方信息/交货行/明细/备注框/物料汇总/注意事项齐全(老系统 DS261005 版式)", () => {
    const html = buildAssemblyContractPrintHtml(ASM_DETAIL);
    // 取值压在下划线 span 里,断言前先剥标签只验文本
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("委托加工合同");
    expect(text).toContain("加工厂：龙昌加工厂");
    expect(text).toContain("联系人：王五");
    expect(text).toContain("订单单号：ZP20260905001");
    expect(text).toContain("联系人：admin");
    // 日期中文(对照原单)
    expect(text).toContain("开始交货日期：2026年09月06日");
    expect(text).toContain("每天交货数量：500");
    expect(text).toContain("完成日期：2026年09月10日");
    // 数量千分位/金额千分位两位小数
    expect(text).toContain("加工总数量：1,000");
    expect(text).toContain("单价(￥)：1.5");
    expect(text).toContain("金额(￥)：1,500.00");
    expect(text).toContain("恐龙套装");
    expect(text).toContain("包装(已装箱)");
    expect(text).toContain("备注：注意静电");
    expect(text).toContain("锡线总需求量：");
    expect(text).toContain("1、2026年09月10日 前交货货送 A栋三楼 处，收货人：李四");
    // 物料汇总:锡线 (2500+1500)/1000 = 4.00 KG,胶水 0.50 KG
    expect(text).toContain("〖锡线〗 总重：4.00 KG");
    expect(text).toContain("〖胶水〗 总重：0.50 KG");
    expect(text).toContain("注意事项：");
    for (const n of PRINT_NOTES) expect(text).toContain(n);
    expect(text).toContain("供应商确认：");
    // 版式:宋体 + 下划线取值框 + A4 无页边距(去浏览器页眉页脚)
    expect(html).toContain('font-family:"SimSun"');
    expect(html).toContain("@page{size:A4 portrait;margin:0}");
  });

  it("明细不足 10 行时补空行到 10 行(空行序号预填)", () => {
    const html = buildAssemblyContractPrintHtml(ASM_DETAIL);
    const bodyRows = (html.match(/<tr>/g) ?? []).length;
    // 明细表头 1 + 明细 10 + 备注框 4 + 汇总 1 + 空备注框 1 = 17
    expect(bodyRows).toBe(17);
    // 空行序号预填到 10
    expect(html).toContain('<tr><td class="ctr">10</td>');
  });
});
