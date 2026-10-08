// 装配物料设置(/assembly-material-setup,BomSetupPage 装配模式):
// 2026-09-30 改版=「装配BOM」:台头=BOM 式共用字段+类别+数量,老的扩展字段(配件编号等)与报价网格
// 不再渲染,但已水合的 扩展/报价 随保存原样回传(不丢存量数据);明细=「关联MA + 选半成品」勾选。
// BOM 入口侧(不持久化 扩展/报价)由 bomSetup.test.tsx 覆盖。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import AssemblyMaterialSetupPage from "@/pages/AssemblyMaterialSetupPage";
import BomSetupPage from "@/pages/BomSetupPage";

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [
  { 组: "基础资料", 菜单: "款号资料", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 单价: true },
];

const MATERIAL = {
  物料编号: "MAT-1", 物料名称: "彩盒", 物料类别: "纸品", 规格: "S", 颜色: "白",
  单位: "盒", 使用数量: 1, 工模编号: "TM-1", 备注: "",
  客户编号: "C-1", 客户名称: "客户一", 日期: "2026-07-13",
};

const EXTENSION = {
  配件编号: "PT-1", 共用物料编号: "CM-1", 装配方式: "组装半成品", 产品装配名称: "恐龙套装",
  类别: "半成品", 库存单价HK: 2.5, 其他成本HK: 0.3, 需求用量: 2,
  半成品计算库存: true, 备注内容: "装配备注", 调整审核: false,
};

const QUOTE = {
  ID: 7, 物料编号: "MAT-1", 物料名称: "彩盒", 合作方类型: "加工厂",
  合作方编号: "F01", 合作方名称: "龙昌加工厂", 报价日期: "2026-09-01", 货币: "RMB",
  单价: 1.2, 港币价: 1.3, 是否默认: true, 顺序: 1, 备注: "报价注",
};

function fullView(款号: string, extra: Record<string, unknown> = {}) {
  return { 款号, 款式: "产品一", 物料: [{ ...MATERIAL }], 单头: null, ...extra };
}

interface Cfg {
  perms?: unknown;
  view?: unknown;
  bomHeaders?: unknown;
  semiSetups?: unknown;
  schedRows?: unknown;
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
      calls.push({ url, method, body });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(cfg.perms ?? PERMS_FULL));
      if (p === "/api/master/styles") return json({ items: [], total: 0 });
      if (p === "/api/master/customers") return json({ items: [], total: 0 });
      if (p === "/api/master/quote-categories") return json({ items: [], total: 0 });
      if (p === "/api/master/materials") return json({ items: [], total: 0 });
      if (p === "/api/styles/bom-headers") return json(cfg.bomHeaders ?? []);
      if (p === "/api/styles/semi-options") return json([]);
      if (p === "/api/semi-setups") return json(cfg.semiSetups ?? []);
      if (p === "/api/scheduling") return json(cfg.schedRows ?? { items: [], total: 0 });
      if (p === "/api/image-notes") return json([]);
      const m = /^\/api\/styles\/(.+?)\/materials$/.exec(p);
      if (m && method === "GET") return json(cfg.view ?? fullView(decodeURIComponent(m[1])));
      if (m && method === "PUT") return json({ 警告: [] });
      if (/^\/api\/styles\/.+\/audit$/.test(p)) return noContent();
      if (/^\/api\/styles\/.+\/reverse-audit$/.test(p)) return noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (cfg: Cfg, route = "/assembly-material-setup?款号=STYLE-1") => {
  const calls = installFetch(cfg);
  renderWithProviders(
    <Routes>
      <Route path="/assembly-material-setup" element={<AssemblyMaterialSetupPage />} />
      <Route path="/bom-setup" element={<BomSetupPage />} />
    </Routes>,
    route,
  );
  return calls;
};

const waitLoaded = () => waitFor(() => expect(screen.getByDisplayValue("MAT-1")).toBeInTheDocument());
const lastPut = (calls: Call[]) => calls.findLast((c) => c.method === "PUT" && c.url.includes("/materials"));

// SearchSelect 选择(与其它测试文件同模式:点触发钮 → 点选项)
const pickOption = (label: string, option: string | RegExp) => {
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

describe("装配物料设置 台头(装配BOM 版式)", () => {
  it("只渲染 BOM 式字段+类别+数量;老的扩展字段与报价网格不渲染,但扩展/报价随保存原样回传", async () => {
    const calls = setup({ view: fullView("STYLE-1", { 扩展: EXTENSION, 报价: [QUOTE] }) });
    await waitLoaded();
    // 老扩展字段与报价网格不再渲染
    expect(screen.queryByLabelText("配件编号")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("共用物料编号")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("装配方式")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("产品装配名称")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("库存单价(HK$)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("其他成本(HK$)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("半成品计算库存")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("需求用量")).not.toBeInTheDocument();
    expect(screen.queryByText(/暂无报价行/)).not.toBeInTheDocument();
    // 保留字段:类别/数量(=扩展段 需求用量)/备注/审核状态
    expect(screen.getByLabelText("类别")).toHaveTextContent("半成品");
    expect(screen.getByLabelText("数量")).toHaveValue(2);
    expect(screen.getByLabelText("备注")).toHaveValue("装配备注");
    expect(screen.getByText("审核状态")).toBeInTheDocument();
    expect(screen.getAllByText("未审核").length).toBeGreaterThanOrEqual(1);
    // 保存:水合的 扩展/报价 全字段原样回传(不丢存量数据)
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(lastPut(calls)).toBeTruthy());
    const put = lastPut(calls)!;
    expect(put.body!.扩展).toMatchObject({
      配件编号: "PT-1", 装配方式: "组装半成品", 类别: "半成品",
      库存单价HK: 2.5, 其他成本HK: 0.3, 需求用量: 2, 半成品计算库存: true, 备注内容: "装配备注",
    });
    expect(put.body!.报价).toMatchObject([
      {
        ID: 7, 物料编号: "MAT-1", 合作方类型: "加工厂", 合作方编号: "F01",
        合作方名称: "龙昌加工厂", 货币: "RMB", 单价: 1.2, 港币价: 1.3, 是否默认: true,
      },
    ]);
  });

  it("响应缺 扩展/报价:类别回落默认,保存不带两段", async () => {
    const calls = setup({ view: fullView("STYLE-1") });
    await waitLoaded();
    expect(screen.getByLabelText("类别")).toHaveTextContent("未包装半成品");
    expect(screen.getByLabelText("数量")).toHaveValue(1);
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(lastPut(calls)).toBeTruthy());
    expect(lastPut(calls)!.body).not.toHaveProperty("扩展");
    expect(lastPut(calls)!.body).not.toHaveProperty("报价");
  });

  it("缺段时用户编辑 数量 后:保存带 扩展(仍不带 报价)", async () => {
    const calls = setup({ view: fullView("STYLE-1") });
    await waitLoaded();
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "3" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(lastPut(calls)).toBeTruthy());
    expect(lastPut(calls)!.body!.扩展).toMatchObject({ 需求用量: 3 });
    expect(lastPut(calls)!.body).not.toHaveProperty("报价");
  });

  it("无 单价 位:保存时扩展价格与报价价格字段强制 null", async () => {
    const perms = [
      { 组: "基础资料", 菜单: "款号资料", 打开: true, 保存: true, 审核: true, 反审核: true, 单价: false },
    ];
    const calls = setup({ perms, view: fullView("STYLE-1", { 扩展: EXTENSION, 报价: [QUOTE] }) });
    await waitLoaded();
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(lastPut(calls)).toBeTruthy());
    const put = lastPut(calls)!;
    expect(put.body!.扩展).toMatchObject({ 库存单价HK: null, 其他成本HK: null, 需求用量: 2 });
    expect(put.body!.报价).toMatchObject([{ 单价: null, 港币价: null }]);
  });

  it("本厂报价行随保存回传:合作方编号/名称=null", async () => {
    const inHouse = { ...QUOTE, 合作方类型: "本厂", 合作方编号: null, 合作方名称: null };
    const calls = setup({ view: fullView("STYLE-1", { 扩展: EXTENSION, 报价: [inHouse] }) });
    await waitLoaded();
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(lastPut(calls)).toBeTruthy());
    expect(lastPut(calls)!.body!.报价).toMatchObject([
      { 合作方类型: "本厂", 合作方编号: null, 合作方名称: null },
    ]);
  });
});

describe("装配物料设置 选半成品(装配BOM 明细)", () => {
  it("关联MA 从台头 MA货号 回填;「选半成品」勾入行进网格(保留原物料行),保存带 MA货号", async () => {
    const calls = setup({
      view: fullView("STYLE-S001", { 单头: { 审核: "0", MA货号: "STYLE-MA" } }),
      bomHeaders: [{ 款号: "STYLE-MA", 款式: "MA模板", 客户编号: "C-1" }],
      semiSetups: [
        { ID: 1, 货号: "STYLE-MA", 名称: "珠子配件包", 类型: "半成品", 顺序: 1, 用量: 2, 创建时间: "", 明细: [{ 物料编号: "MAT-9" }] },
      ],
    }, "/assembly-material-setup?款号=STYLE-S001");
    await waitLoaded();
    // 关联MA 选择器回填 + 「选半成品」可用(装配入口仍保留 添加行/自由网格)
    await waitFor(() => expect(screen.getByLabelText("关联MA")).toHaveTextContent("STYLE-MA"));
    expect(screen.getByText("添加行")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选半成品" }));
    const dlg = (await screen.findAllByText("选半成品 · STYLE-MA"))[0].closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "勾选 珠子配件包" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "确定" }));
    // 勾入行:编号=名称=定义名,材料=半成品,用量=定义用量;原物料行 MAT-1 保留
    await waitFor(() => expect(screen.getByDisplayValue("珠子配件包")).toBeInTheDocument());
    expect(screen.getByDisplayValue("MAT-1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(lastPut(calls)).toBeTruthy());
    const put = lastPut(calls)!;
    expect(put.body!.MA货号).toBe("STYLE-MA");
    const detail = put.body!.明细 as Record<string, unknown>[];
    expect(detail.map((r) => r.物料编号)).toEqual(["MAT-1", "珠子配件包"]);
    expect(detail[1]).toMatchObject({ 物料名称: "珠子配件包", 物料类别: "半成品", 使用数量: 2, 单位: "个" });
  });

  it("打开 MA 货号本身:按系列前缀猜测,关联MA 预选自身", async () => {
    setup({
      view: fullView("STYLE-MA"),
      bomHeaders: [{ 款号: "STYLE-MA", 款式: "MA模板", 客户编号: "C-1" }],
    }, "/assembly-material-setup?款号=STYLE-MA");
    await waitLoaded();
    await waitFor(() => expect(screen.getByLabelText("关联MA")).toHaveTextContent("STYLE-MA"));
  });

  it("半成品设置面板与报价网格在装配入口不渲染", async () => {
    setup({ view: fullView("STYLE-1", { 扩展: EXTENSION, 报价: [QUOTE] }) });
    await waitLoaded();
    expect(screen.queryByText(/设置半成品/)).not.toBeInTheDocument();
    expect(screen.queryByText(/选择供应商/)).not.toBeInTheDocument();
    expect(screen.queryByText(/选择加工厂/)).not.toBeInTheDocument();
  });
});

describe("装配物料设置 PO号(区分同货号不同实单)", () => {
  const SCHED = {
    items: [
      { PO号: "4500218739", 货号: "STYLE-1", 数量: 924, 状态: "正常" },
      { PO号: "4500218739", 货号: "STYLE-1", 数量: 76, 状态: "正常" },
      { PO号: "4500000001", 货号: "STYLE-OTHER", 数量: 5, 状态: "正常" },
      { PO号: "4500000002", 货号: "STYLE-1", 数量: 9, 状态: "已取消" },
    ],
    total: 4,
  };

  it("台头 PO号 从单头有效 PO 回填;排期实单作选项(同货号未取消,数量合计)", async () => {
    setup({ view: fullView("STYLE-1", { 单头: { 审核: "0", PO号: "4500218739" } }), schedRows: SCHED });
    await waitLoaded();
    await waitFor(() => expect(screen.getByLabelText("PO号")).toHaveTextContent("4500218739"));
    // 选项只有本货号未取消的 PO,且带合计数量(924+76=1000)
    fireEvent.click(screen.getByLabelText("PO号"));
    const opts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opts).toContain("4500218739(1000)");
    expect(opts.filter((o) => o?.includes("4500000001"))).toHaveLength(0);
    expect(opts.filter((o) => o?.includes("4500000002"))).toHaveLength(0);
  });

  it("选中 PO:数量 按接单数量合计自动带出;保存落 待绑定PO号 + 扩展.需求用量", async () => {
    const calls = setup({
      view: fullView("STYLE-1", { 扩展: EXTENSION, 单头: { 审核: "0" } }),
      schedRows: SCHED,
    });
    await waitLoaded();
    await waitFor(() => expect(screen.getByLabelText("PO号")).toBeInTheDocument());
    pickOption("PO号", /4500218739/);
    // 924+76=1000 自动带出到 数量
    await waitFor(() => expect(screen.getByLabelText("数量")).toHaveValue(1000));
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(lastPut(calls)).toBeTruthy());
    const put = lastPut(calls)!;
    expect(put.body!.待绑定PO号).toBe("4500218739");
    expect(put.body!.扩展).toMatchObject({ 需求用量: 1000 });
  });

  it("BOM 入口:不渲染 PO号 字段,但保存时原样回传台头 PO(不清掉待绑定)", async () => {
    const calls = setup(
      { view: fullView("STYLE-1", { 单头: { 审核: "0", PO号: "4500218739" } }) },
      "/bom-setup?款号=STYLE-1",
    );
    await waitLoaded();
    expect(screen.queryByLabelText("PO号")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(lastPut(calls)).toBeTruthy());
    expect(lastPut(calls)!.body!.待绑定PO号).toBe("4500218739");
  });
});

describe("装配物料设置 调整审核", () => {
  it("未审核:点 审核 调 /styles/{款号}/audit", async () => {
    const calls = setup({ view: fullView("STYLE-1", { 扩展: EXTENSION, 报价: [] }) });
    await waitLoaded();
    fireEvent.click(screen.getByText("审核"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/styles/STYLE-1/audit" && c.method === "POST"),
      ).toBe(true),
    );
  });

  it("已审核(扩展.调整审核):整页只读,出现 反审核,点 反审核 调 reverse-audit", async () => {
    const calls = setup({
      view: fullView("STYLE-1", { 扩展: { ...EXTENSION, 调整审核: true }, 报价: [QUOTE] }),
    });
    await waitLoaded();
    // 页头徽标 + 台头 审核状态 两处
    expect(screen.getAllByText("已审核").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("数量")).toBeDisabled();
    expect(screen.getByText("保存")).toBeDisabled();
    expect(screen.queryByText("审核")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("反审核"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/styles/STYLE-1/reverse-audit" && c.method === "POST"),
      ).toBe(true),
    );
  });

  it("BOM 入口(/bom-setup):不暴露装配 审核 按钮,扩展字段不渲染", async () => {
    setup({ view: fullView("STYLE-1", { 扩展: EXTENSION, 报价: [QUOTE] }) }, "/bom-setup?款号=STYLE-1");
    await waitLoaded();
    expect(screen.queryByLabelText("配件编号")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("类别")).not.toBeInTheDocument();
    expect(screen.queryByText("审核")).not.toBeInTheDocument(); // 只有 BOM审核
    expect(screen.getByText("BOM审核")).toBeInTheDocument();
  });
});
