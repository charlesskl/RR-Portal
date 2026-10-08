// BOM物料设置页全量对齐:场景清单对照老系统
// web/src/pages/styles/BomSetupPage.tsx + web/src/__tests__/bomSetupPoBinding.test.ts
// (待绑定PO号)+ bomSetupAssemblyPersistence.test.ts(BOM 入口不持久化 扩展/报价)+ bomImport.test.ts(纯函数,另文件)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import BomSetupPage from "@/pages/BomSetupPage";
import { buildCloseTarget } from "@/lib/bomSetup";
import { CELL_CAP_CH } from "@/lib/cellWidth";

// ---------- fetch 路由桩 ----------

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [
  { 组: "基础资料", 菜单: "款号资料", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 单价: true },
];

const MATERIAL = {
  物料编号: "MAT-1", 物料名称: "彩盒", 物料类别: "纸品", 规格: "S", 颜色: "白",
  单位: "盒", 使用数量: 1, 工模编号: "TM-1", 备注: "行注",
  客户编号: "C-1", 客户名称: "客户一", 日期: "2026-07-13",
};

function fullView(款号: string, extra: Record<string, unknown> = {}) {
  return { 款号, 款式: "产品一", 物料: [{ ...MATERIAL }], 单头: null, ...extra };
}

interface Cfg {
  perms?: unknown;
  view?: unknown; // /styles/{款号}/materials 响应;404 用 status
  viewStatus?: number;
  styles?: unknown;
  customers?: unknown;
  bomHeaders?: unknown;
  semiOptions?: unknown;
  semiSetups?: unknown;
  quoteCategories?: unknown;
  saveResult?: unknown;
  // 可返回 Promise<Response>(竞态测试的延迟响应)
  onCall?: (c: Call) => Response | Promise<Response> | undefined;
}

function baseCfg(): Required<Omit<Cfg, "onCall" | "viewStatus" | "saveResult">> & Cfg {
  return {
    perms: PERMS_FULL,
    view: fullView("STYLE-1"),
    styles: { items: [{ id: 1, 款号: "STYLE-1", 款式: "产品一" }], total: 1 },
    customers: { items: [{ id: 1, 客户编号: "C-1", 客户名称: "客户一" }], total: 1 },
    bomHeaders: [{ 款号: "STYLE-1", 款式: "产品一", 客户编号: "C-1" }],
    semiOptions: [],
    semiSetups: [],
    quoteCategories: { items: [], total: 0 },
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
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(cfg.perms ?? PERMS_FULL));
      if (p === "/api/master/styles") return json(cfg.styles ?? { items: [], total: 0 });
      if (p === "/api/master/customers") return json(cfg.customers ?? { items: [], total: 0 });
      if (p === "/api/master/quote-categories")
        return json(cfg.quoteCategories ?? { items: [], total: 0 });
      if (p === "/api/master/materials") return json({ items: [], total: 0 });
      if (p === "/api/styles/bom-headers") return json(cfg.bomHeaders ?? []);
      if (p === "/api/styles/semi-options") return json(cfg.semiOptions ?? []);
      if (p === "/api/semi-setups") return json(cfg.semiSetups ?? []);
      if (p === "/api/image-notes") return json([]);
      const m = /^\/api\/styles\/(.+?)\/materials$/.exec(p);
      if (m && method === "GET") {
        if (cfg.viewStatus === 404) return json({ 消息: "不存在" }, 404);
        return json(cfg.view ?? fullView(decodeURIComponent(m[1])));
      }
      if (m && method === "PUT") return json(cfg.saveResult ?? { 警告: [] });
      if (m && method === "DELETE") return noContent();
      if (/^\/api\/styles\/.+\/bom-audit$/.test(p)) return noContent();
      if (/^\/api\/styles\/.+\/bom-reverse-audit-request$/.test(p)) return noContent();
      if (/^\/api\/styles\/.+\/copy$/.test(p)) return noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (cfg: Cfg, route = "/bom-setup?款号=STYLE-1") => {
  const calls = installFetch(cfg);
  renderWithProviders(
    <Routes>
      <Route path="/bom-setup" element={<BomSetupPage />} />
      <Route path="/scheduling" element={<div>排期页STUB</div>} />
    </Routes>,
    route,
  );
  return calls;
};

// 等载入完成(明细行物料编号出现)
const waitLoaded = () => waitFor(() => expect(screen.getByDisplayValue("MAT-1")).toBeInTheDocument());

// SearchSelect 选择(与其它测试文件同模式:点触发钮 → 点选项)
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

// ---------- 打开/渲染 ----------

describe("打开与渲染", () => {
  it("按 URL 款号参数载入 BOM:单头/明细水合,审核状态显示", async () => {
    setup(baseCfg());
    await waitLoaded();
    expect(screen.getByLabelText("产品货号")).toHaveValue("STYLE-1");
    expect(screen.getByLabelText("产品名称")).toHaveValue("产品一");
    expect(screen.getByLabelText("单位")).toHaveTextContent("盒");
    expect(screen.getByText("未审核")).toBeInTheDocument();
    // 明细行字段
    expect(screen.getByDisplayValue("彩盒")).toBeInTheDocument();
    expect(screen.getByDisplayValue("TM-1")).toBeInTheDocument();
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup({ ...baseCfg(), perms: [] }, "/bom-setup");
    await waitFor(() => expect(screen.getByText("无权访问 BOM物料设置")).toBeInTheDocument());
  });

  it("404 新款号(排期去建 BOM 跳入):预填货号/品名并提示建档", async () => {
    setup(
      { ...baseCfg(), viewStatus: 404 },
      "/bom-setup?款号=NEW-9&品名=新品名&po=PO-9",
    );
    await waitFor(() =>
      expect(screen.getByText(/尚未建 BOM/)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("产品货号")).toHaveValue("NEW-9");
    expect(screen.getByLabelText("产品名称")).toHaveValue("新品名");
  });

  it("客户名称参数:客户资料加载后按名称回填客户编号", async () => {
    setup(
      { ...baseCfg(), viewStatus: 404 },
      "/bom-setup?款号=NEW-9&客户名称=客户一",
    );
    await waitFor(() =>
      // SearchSelect 触发钮显示当前客户名称
      expect(screen.getByRole("button", { name: "客户" })).toHaveTextContent("客户一"),
    );
  });

  it("404 新款号:按货号前缀从物料资料自动带出明细(92125-MA → 92125-*)", async () => {
    setup(
      {
        ...baseCfg(),
        viewStatus: 404,
        onCall: (c) => {
          const u = new URL(c.url, "http://test");
          if (u.pathname === "/api/master/materials")
            return json({
              items: [
                { ID: 1, 物料编号: "07020464", 物料名称: "92125-吊卡(3L版本)", 规格: "90*55MM", 物料类别: "利宝说明书", 颜色: "1C", 单位: "PCS", 备注: "材料:250g双铜纸" },
                { ID: 2, 物料编号: "07020465", 物料名称: "92125-猫脸贴纸", 规格: "103*105MM", 物料类别: "利宝说明书", 单位: "PCS", 备注: "材料:80铜纸" },
                // 不同前缀(92125UQ1-)与无关料不带出
                { ID: 3, 物料编号: "08020752", 物料名称: "92125UQ1-PDQ", 单位: "PCS" },
                { ID: 4, 物料编号: "X-1", 物料名称: "其他货号物料", 单位: "PCS" },
                // 「/」分词共用料:92125/92119 命中 92125;92119/92120-共用件 与 92125 无关不带出
                { ID: 5, 物料编号: "10020290", 物料名称: "92125/92119", 规格: "150MM", 物料类别: "辅料", 颜色: "透明", 单位: "个" },
                { ID: 6, 物料编号: "10029999", 物料名称: "92119/92120-共用件", 单位: "个" },
              ],
              total: 6,
            });
          if (u.pathname === "/api/plastic-material-master")
            return json({
              items: [
                { ID: 11, 物料编号: "57001621", 物料名称: "紫猫公仔", 款号: "92125", 单位: "PCS", 颜色: "半透珠光935C" },
                // 斜杠分词命中;77772 不命中
                { ID: 12, 物料编号: "57001539", 物料名称: "手链蛋黄形件", 款号: "92119/92125", 单位: "PCS" },
                { ID: 13, 物料编号: "57009999", 物料名称: "别家塑胶件", 款号: "77772", 单位: "PCS" },
              ],
              total: 3,
            });
          return undefined;
        },
      },
      "/bom-setup?款号=92125-MA",
    );
    await waitFor(() =>
      expect(screen.getByText(/已按前缀「92125-」带出 5 条物料/)).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("07020464")).toBeInTheDocument();
    expect(screen.getByDisplayValue("92125-猫脸贴纸")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("08020752")).not.toBeInTheDocument();
    // 「/」分词共用料:92125/92119 带出;92119/92120-共用件(无 92125 词)不带出
    expect(screen.getByDisplayValue("10020290")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("10029999")).not.toBeInTheDocument();
    // 塑胶仓物料按 款号(塑胶货号)带出:92125 精确 + 92119/92125 分词,77772 不带出
    expect(screen.getByDisplayValue("57001621")).toBeInTheDocument();
    expect(screen.getByDisplayValue("57001539")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("57009999")).not.toBeInTheDocument();
    // 备注前缀「材料:X」拆到 材料 列,不留在备注
    expect(screen.getByDisplayValue("250g双铜纸")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("材料:250g双铜纸")).not.toBeInTheDocument();
  });
});

// ---------- 保存(待绑定PO号 / 载荷形状) ----------

describe("保存载荷", () => {
  it("URL 带 po 参数:保存 payload 带 待绑定PO号", async () => {
    const calls = setup(baseCfg(), "/bom-setup?款号=STYLE-1&po=PO-9");
    await waitLoaded();
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT" && c.url.includes("/styles/STYLE-1/materials"))).toBe(true),
    );
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/materials"))!;
    expect(put.body!.待绑定PO号).toBe("PO-9");
  });

  it("URL 不带 po 参数:保存 payload 不含 待绑定PO号;不含 扩展/报价(BOM 入口)", async () => {
    const calls = setup(baseCfg());
    await waitLoaded();
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT" && c.url.includes("/materials"))).toBe(true),
    );
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/materials"))!;
    expect(put.body).not.toHaveProperty("待绑定PO号");
    expect(put.body).not.toHaveProperty("扩展");
    expect(put.body).not.toHaveProperty("报价");
    // 明细字段映射:材料→物料类别,用量→使用数量
    expect(put.body!.明细).toMatchObject([
      { 物料编号: "MAT-1", 物料类别: "纸品", 使用数量: 1, 工模编号: "TM-1" },
    ]);
  });

  it("明细全空时保存被拒绝(不发出 PUT)", async () => {
    const calls = setup(baseCfg(), "/bom-setup");
    await waitFor(() => expect(screen.getByLabelText("产品货号")).toHaveValue(""));
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("请先选择产品货号")).toBeInTheDocument());
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("用量支持分数输入:行内填 1/6,显示回 1/6,保存 payload 为 1/6 小数", async () => {
    const calls = setup(baseCfg());
    await waitLoaded();
    const qty = screen.getByLabelText("行1 用量");
    expect(qty).toHaveValue("1"); // 整数原样显示
    fireEvent.focus(qty);
    fireEvent.change(qty, { target: { value: "1/6" } });
    fireEvent.blur(qty);
    // 失焦后显示回分数
    await waitFor(() => expect(qty).toHaveValue("1/6"));
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT" && c.url.includes("/materials"))).toBe(true),
    );
    const put = calls.find((c) => c.method === "PUT" && c.url.includes("/materials"))!;
    const d0 = (put.body!.明细 as { 使用数量: number }[])[0];
    expect(d0.使用数量).toBeCloseTo(1 / 6, 10);
  });
});

// ---------- BOM 台头审核/反审核申请 ----------

describe("BOM审核与反审核申请", () => {
  it("未审核:点 BOM审核 调 /styles/{款号}/bom-audit", async () => {
    const calls = setup(baseCfg());
    await waitLoaded();
    fireEvent.click(screen.getByText("BOM审核"));
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/styles/STYLE-1/bom-audit" && c.method === "POST")).toBe(true),
    );
  });

  it("已审核:删除禁用,出现 申请BOM反审核;申请必填原因,提交 POST bom-reverse-audit-request", async () => {
    const auditedCfg = {
      ...baseCfg(),
      view: fullView("STYLE-1", {
        单头: { 审核: "1", 客户编号: "C-1", 客户名称: "客户一", 日期: "2026-07-13" },
      }),
    };
    const calls = setup(auditedCfg);
    await waitLoaded();
    expect(screen.getByText("已审核")).toBeInTheDocument();
    expect(screen.getByText("删除")).toBeDisabled();
    expect(screen.queryByText("BOM审核")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("申请BOM反审核"));
    // 原因为空:提交按钮禁用
    expect(screen.getByText("提交申请")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("反审核原因"), { target: { value: "要改料" } });
    fireEvent.click(screen.getByText("提交申请"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url === "/api/styles/STYLE-1/bom-reverse-audit-request" &&
            c.method === "POST" &&
            c.body?.原因 === "要改料",
        ),
      ).toBe(true),
    );
  });

  it("反审核申请中:显示待批标记,不再出现 申请BOM反审核", async () => {
    const cfg = {
      ...baseCfg(),
      view: fullView("STYLE-1", {
        单头: { 审核: "1", 反审核申请: "1", 反审核申请人: "小李" },
      }),
    };
    setup(cfg);
    await waitLoaded();
    expect(screen.getByText(/BOM反审核申请中/)).toBeInTheDocument();
    expect(screen.queryByText("申请BOM反审核")).not.toBeInTheDocument();
  });
});

// ---------- 删除/复制 ----------

describe("删除与复制单", () => {
  it("删除:确认后 DELETE /styles/{款号}/materials", async () => {
    const calls = setup(baseCfg());
    await waitLoaded();
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => expect(screen.getByText(/确认删除产品货号/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认删除"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url.includes("/styles/STYLE-1/materials")),
      ).toBe(true),
    );
  });

  it("复制单:选择目标货号后 POST /copy;409 已有 BOM 时弹覆盖确认,确认后带 覆盖=true", async () => {
    const cfg = {
      ...baseCfg(),
      styles: {
        items: [
          { id: 1, 款号: "STYLE-1", 款式: "产品一" },
          { id: 2, 款号: "STYLE-2", 款式: "产品二" },
        ],
        total: 2,
      },
      onCall: (c: Call) =>
        c.url.includes("/copy") && c.method === "POST" && c.body?.覆盖 !== true
          ? json({ 消息: "目标款号 STYLE-2 已有 BOM" }, 409)
          : undefined,
    };
    const calls = setup(cfg);
    await waitLoaded();
    fireEvent.click(screen.getByText("复制单"));
    await waitFor(() => expect(screen.getByLabelText("目标产品货号")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("目标产品货号"));
    fireEvent.click(await screen.findByRole("option", { name: /STYLE-2/ }));
    fireEvent.click(screen.getByText("复制"));
    await waitFor(() => expect(screen.getByText("目标货号已有 BOM")).toBeInTheDocument());
    fireEvent.click(screen.getByText("覆盖"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("/styles/STYLE-1/copy") && c.body?.覆盖 === true,
        ),
      ).toBe(true),
    );
  });
});

// ---------- 权限 ----------

describe("权限位", () => {
  it("无 保存 位:不渲染 保存/新建/导入;无 审核 位:不渲染 BOM审核", async () => {
    setup({
      ...baseCfg(),
      perms: [{ 组: "基础资料", 菜单: "款号资料", 打开: true, 保存: false, 审核: false }],
    });
    await waitLoaded();
    expect(screen.queryByText("保存")).not.toBeInTheDocument();
    expect(screen.queryByText("新建")).not.toBeInTheDocument();
    expect(screen.queryByText("导入")).not.toBeInTheDocument();
    expect(screen.queryByText("BOM审核")).not.toBeInTheDocument();
    // 打开/打印/关闭不受权限位控制
    expect(screen.getByText("打开")).toBeInTheDocument();
    expect(screen.getByText("打印")).toBeInTheDocument();
  });
});

// ---------- 实单版 ----------

describe("MA/实单双版本", () => {
  it("单头带 MA货号:自动实单版,保存 payload 带 MA货号;半成品行与物料行(包材)都保留", async () => {
    const cfg = {
      ...baseCfg(),
      view: fullView("STYLE-S001", {
        单头: { 审核: "0", MA货号: "STYLE-MA" },
        物料: [
          { ...MATERIAL, 物料编号: "半成品A", 物料名称: "半成品A", 物料类别: "半成品" },
          { ...MATERIAL, 物料编号: "MAT-9", 物料名称: "非半成品", 物料类别: "纸品" },
        ],
      }),
      semiSetups: [{ ID: 1, 货号: "STYLE-MA", 名称: "半成品A", 类型: "半成品", 顺序: 1, 创建时间: "", 明细: [] }],
    };
    const calls = setup(cfg, "/bom-setup?款号=STYLE-S001");
    await waitFor(() => expect(screen.getByDisplayValue("半成品A")).toBeInTheDocument());
    // 实单版网格:半成品行与物料行都显示(实单需采购包材)
    expect(screen.getByDisplayValue("非半成品")).toBeInTheDocument();
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT" && c.url.includes("/materials"))).toBe(true),
    );
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body!.MA货号).toBe("STYLE-MA");
    const detail = put.body!.明细 as Record<string, unknown>[];
    expect(detail.map((r) => r.物料编号)).toEqual(["半成品A", "MAT-9"]);
    // 物料行不再被剔除,无剔除提示
    expect(screen.queryByText(/其他物料未保存/)).not.toBeInTheDocument();
  });

  it("实单版「选物料」:按货号前缀列物料,勾选确定一次入行(用量可改)并随保存入库", async () => {
    const cfg = {
      ...baseCfg(),
      view: fullView("STYLE-S001", {
        单头: { 审核: "0", MA货号: "STYLE-MA" },
        物料: [{ ...MATERIAL, 物料编号: "半成品A", 物料名称: "半成品A", 物料类别: "半成品" }],
      }),
      semiSetups: [{ ID: 1, 货号: "STYLE-MA", 名称: "半成品A", 类型: "半成品", 顺序: 1, 创建时间: "", 明细: [] }],
      onCall: (c: Call) => {
        const u = new URL(c.url, "http://test");
        if (u.pathname === "/api/master/materials")
          return json({
            items: [
              { id: 9, 物料编号: "PKG-1", 物料名称: "彩盒", 款号: "STYLE", 规格: "大", 颜色: "白", 单位: "个", 物料类别: "纸品" },
              { id: 10, 物料编号: "OTHER-1", 物料名称: "别货号料", 款号: "OTHER", 单位: "个", 物料类别: "纸品" },
            ],
            total: 2,
          });
        return undefined;
      },
    };
    const calls = setup(cfg, "/bom-setup?款号=STYLE-S001");
    await waitFor(() => expect(screen.getByDisplayValue("半成品A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "选物料" }));
    const dlg = (await screen.findAllByText("选择物料 · STYLE"))[0].closest('[role="dialog"]') as HTMLElement;
    // 只列该货号(前缀)物料
    await waitFor(() => expect(within(dlg).getByText("PKG-1")).toBeInTheDocument());
    expect(within(dlg).queryByText("OTHER-1")).not.toBeInTheDocument();
    // 多选:勾选后点确定一次入行
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "勾选 PKG-1" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "确定" }));
    // 入行:编号/名称回填,用量默认可编辑(半成品行仍只读)
    await waitFor(() => expect(screen.getByDisplayValue("PKG-1")).toBeInTheDocument());
    expect(screen.getByLabelText("行1 用量")).toBeDisabled();
    expect(screen.getByLabelText("行2 用量")).not.toBeDisabled();
    // 保存:半成品行 + 物料行都入库
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT" && c.url.includes("/materials"))).toBe(true),
    );
    const detail = calls.find((c) => c.method === "PUT")!.body!.明细 as Record<string, unknown>[];
    expect(detail.map((r) => r.物料编号)).toEqual(["半成品A", "PKG-1"]);
    expect(detail[1]).toMatchObject({ 物料类别: "纸品", 单位: "个", 使用数量: 1 });
  });

  it("排期实单跳入新建(404+单类型=实单):明细不自动带 MA 物料,提示用「选物料」勾选包材", async () => {
    const cfg = {
      ...baseCfg(),
      viewStatus: 404,
      bomHeaders: [
        { 款号: "STYLE-1", 款式: "产品一", 客户编号: "C-1" },
        { 款号: "STYLE-MA", 款式: "MA产品", 客户编号: "C-1" },
      ],
      onCall: (c: Call) => {
        const u = new URL(c.url, "http://test");
        // 物料资料里有该前缀的料(MA 的物料),实单跳入也不应带出
        if (u.pathname === "/api/master/materials")
          return json({
            items: [{ id: 9, 物料编号: "MAT-9", 物料名称: "STYLE-彩盒", 款号: "STYLE", 单位: "个", 物料类别: "纸品" }],
            total: 1,
          });
        return undefined;
      },
    };
    setup(cfg, "/bom-setup?款号=STYLE-S001&品名=实单新品&单类型=实单&关联MA货号=STYLE-MA");
    await waitFor(() => expect(screen.getByText(/尚未建 BOM/)).toBeInTheDocument());
    expect(screen.getByText(/点「选物料」勾选/)).toBeInTheDocument();
    // 网格不带出任何物料行(实单版只显示半成品/物料行,空白尾行不显示)
    expect(screen.queryByDisplayValue("MAT-9")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/行\d+ 物料编号/)).not.toBeInTheDocument();
  });

  it("-MA 结尾款号:保持 MA 版(不切实单)", async () => {
    const cfg = { ...baseCfg(), view: fullView("STYLE-MA") };
    setup(cfg, "/bom-setup?款号=STYLE-MA");
    await waitLoaded();
    // MA 版也有 关联MA+选半成品(与实单版同位置,仅作勾半成品依据,不持久化 MA货号),
    // 且保留自由网格(添加行)
    expect(screen.getByText("添加行")).toBeInTheDocument();
    expect(screen.getByLabelText("关联MA")).toBeInTheDocument();
  });

  it("MA 版「选半成品」:关联 MA 后勾选入行,空白尾行保留;保存不持久化 MA货号", async () => {
    const cfg = {
      ...baseCfg(),
      view: fullView("STYLE-1"),
      bomHeaders: [
        { 款号: "STYLE-1", 款式: "产品一", 客户编号: "C-1" },
        { 款号: "STYLE-MA", 款式: "MA模板", 客户编号: "C-1" },
      ],
      semiSetups: [
        { ID: 1, 货号: "STYLE-MA", 名称: "珠子配件包", 类型: "半成品", 顺序: 1, 用量: 2, 创建时间: "", 明细: [{ 物料编号: "MAT-9" }] },
      ],
    };
    const calls = setup(cfg);
    await waitLoaded();
    // 选关联 MA → 选半成品 → 勾选确定
    pickOption("关联MA", "STYLE-MA MA模板");
    fireEvent.click(screen.getByRole("button", { name: "选半成品" }));
    const dlg = (await screen.findAllByText("选半成品 · STYLE-MA"))[0].closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "勾选 珠子配件包" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByDisplayValue("珠子配件包")).toBeInTheDocument());
    // 空白尾行保留(MA 版自由网格),原物料行不动
    expect(screen.getByDisplayValue("MAT-1")).toBeInTheDocument();
    expect(screen.getByLabelText("行3 物料编号")).toHaveValue("");
    // 保存:半成品行入库,但 MA 版不持久化 MA货号(避免重开被当成实单版)
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT" && c.url.includes("/materials"))).toBe(true),
    );
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body!.MA货号 ?? null).toBeNull();
    const detail = put.body!.明细 as Record<string, unknown>[];
    expect(detail.map((r) => r.物料编号)).toEqual(["MAT-1", "珠子配件包"]);
    expect(detail[1]).toMatchObject({ 物料类别: "半成品", 使用数量: 2 });
  });

  it("排期实单跳入新建(单类型=实单&关联MA货号):自动实单版页签 + 预选关联MA", async () => {
    const cfg = {
      ...baseCfg(),
      viewStatus: 404,
      bomHeaders: [
        { 款号: "STYLE-1", 款式: "产品一", 客户编号: "C-1" },
        { 款号: "STYLE-MA", 款式: "MA产品", 客户编号: "C-1" },
      ],
    };
    setup(cfg, "/bom-setup?款号=STYLE-S001&品名=实单新品&单类型=实单&关联MA货号=STYLE-MA");
    await waitFor(() => expect(screen.getByText(/尚未建 BOM/)).toBeInTheDocument());
    // 实单版:关联MA 选择器已预选(MA 版无此选择器)
    await waitFor(() => expect(screen.getByLabelText("关联MA")).toHaveTextContent("STYLE-MA"));
    expect(screen.queryByText("添加行")).not.toBeInTheDocument();
  });

  it("排期实单跳入但关联MA未建BOM(不在选项):切实单版但不预选", async () => {
    const cfg = { ...baseCfg(), viewStatus: 404 }; // bomHeaders 只有 STYLE-1,无 -MA 款号
    setup(cfg, "/bom-setup?款号=STYLE-S001&单类型=实单&关联MA货号=STYLE-MA");
    await waitFor(() => expect(screen.getByText(/尚未建 BOM/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("关联MA")).toBeInTheDocument());
    expect(screen.getByLabelText("关联MA")).not.toHaveTextContent("STYLE-MA");
  });

  it("实单版「选半成品」:列出半成品定义(含原包装并入的),勾入后随保存入库;无「选包装」按钮", async () => {
    const cfg = {
      ...baseCfg(),
      view: fullView("STYLE-S001", {
        单头: { 审核: "0", MA货号: "STYLE-MA" },
        物料: [{ ...MATERIAL, 物料编号: "半成品A", 物料名称: "半成品A", 物料类别: "半成品" }],
      }),
      semiSetups: [
        { ID: 1, 货号: "STYLE-MA", 名称: "半成品A", 类型: "半成品", 顺序: 1, 创建时间: "", 明细: [] },
        // 原包装定义已并入半成品(迁移 117),勾选后材料列标 半成品
        { ID: 2, 货号: "STYLE-MA", 名称: "纸袋包装B", 类型: "半成品", 顺序: 2, 创建时间: "", 明细: [{ 物料编号: "MAT-1" }] },
      ],
    };
    const calls = setup(cfg, "/bom-setup?款号=STYLE-S001");
    await waitFor(() => expect(screen.getByDisplayValue("半成品A")).toBeInTheDocument());
    // 包装功能已删除:没有「选包装」按钮
    expect(screen.queryByRole("button", { name: "选包装" })).not.toBeInTheDocument();
    // 打开「选半成品」:列出半成品定义
    fireEvent.click(screen.getByRole("button", { name: "选半成品" }));
    const dlg = (await screen.findAllByText("选半成品 · STYLE-MA"))[0].closest('[role="dialog"]') as HTMLElement;
    expect(within(dlg).getByText("纸袋包装B")).toBeInTheDocument();
    // 勾选 → 确定:行加入网格(材料列=半成品,编号=名称)
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "勾选 纸袋包装B" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByDisplayValue("纸袋包装B")).toBeInTheDocument());
    // 保存:勾入行不被剔除,随明细入库
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT" && c.url.includes("/materials"))).toBe(true),
    );
    const detail = calls.find((c) => c.method === "PUT")!.body!.明细 as Record<string, unknown>[];
    expect(detail).toHaveLength(2);
    expect(detail.map((r) => r.物料编号)).toEqual(["半成品A", "纸袋包装B"]);
    expect(detail[1]).toMatchObject({ 物料类别: "半成品", 单位: "个" });
  });
});

// ---------- 物料选择器 ----------

describe("物料选择器", () => {
  it("点放大镜打开选择器,点行回填该明细行", async () => {
    const cfg = {
      ...baseCfg(),
      onCall: (c: Call) => {
        const u = new URL(c.url, "http://test");
        if (u.pathname === "/api/master/materials")
          return json({
            items: [
              { id: 9, 物料编号: "MAT-P1", 物料名称: "吸塑", 款号: "STYLE-1", 规格: "大", 颜色: "透明", 单位: "个", 物料类别: "塑胶" },
            ],
            total: 1,
          });
        return undefined;
      },
    };
    setup(cfg);
    await waitLoaded();
    // 行2 是空尾行,点它的放大镜
    fireEvent.click(screen.getByLabelText("行2 选择物料"));
    // PickerDialog 标题渲染两份(可见 Title + sr-only Description)
    await waitFor(() =>
      expect(screen.getAllByText("选择该货号的物料/下级半成品").length).toBeGreaterThanOrEqual(1),
    );
    await waitFor(() => expect(screen.getByText("吸塑")).toBeInTheDocument());
    fireEvent.click(screen.getByText("吸塑"));
    await waitFor(() => expect(screen.getByDisplayValue("MAT-P1")).toBeInTheDocument());
    expect(screen.getByDisplayValue("吸塑")).toBeInTheDocument();
  });

  it("半成品设置弹窗:加一行点放大镜从物料资料选料(只显示该货号物料),回填该行并自动勾选", async () => {
    setup({
      ...baseCfg(),
      onCall: (c: Call) => {
        const u = new URL(c.url, "http://test");
        if (u.pathname === "/api/master/materials")
          return json({
            items: [
              { ID: 9, 物料编号: "10020309", 物料名称: "STYLE-鱼形珠子", 物料类别: "辅料", 规格: "15MM", 颜色: "红色", 单位: "个" },
              { ID: 10, 物料编号: "01030008", 物料名称: "PB螺丝", 物料类别: "五金", 规格: "", 颜色: "", 单位: "个" },
            ],
            total: 2,
          });
        return undefined;
      },
    });
    await waitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "设置半成品" }));
    const dlg = await screen.findByRole("dialog");
    // 弹窗行 = BOM 行(MAT-1)+空尾行;加一行后点最后一行的放大镜
    fireEvent.click(within(dlg).getByRole("button", { name: "加一行" }));
    const pickBtns = within(dlg).getAllByRole("button", { name: /行\d+ 选物料/ });
    fireEvent.click(pickBtns[pickBtns.length - 1]);
    // 嵌套物料选择弹窗:只列该货号物料(他货号料被过滤);点行选料(标题渲染两份:Title + sr-only Description)
    const pickTitle = (await screen.findAllByText("选择物料 · STYLE-1"))[0];
    const pickDlg = pickTitle.closest('[role="dialog"]') as HTMLElement;
    expect(within(pickDlg).queryByText("PB螺丝")).not.toBeInTheDocument();
    fireEvent.click(await within(pickDlg).findByText("STYLE-鱼形珠子"));
    // 回填新加行 + 自动勾选(不勾选的行保存会被丢弃)
    await waitFor(() =>
      expect(within(dlg).getByDisplayValue("10020309")).toBeInTheDocument(),
    );
    expect(within(dlg).getByDisplayValue("STYLE-鱼形珠子")).toBeInTheDocument();
    expect(within(dlg).getByRole("checkbox", { name: "勾选 10020309" })).toBeChecked();
  });
});

// ---------- 网格列宽(内容自适应 + 超长截断点击显示) ----------

describe("网格列宽", () => {
  const LONG = "超长物料名称".repeat(8); // 视觉宽 96,超 CELL_CAP_LEN
  const widthOf = (el: HTMLElement) => (el as HTMLInputElement).style.width;
  const cfg2 = (): Cfg => ({
    ...baseCfg(),
    view: fullView("STYLE-1", {
      物料: [
        { ...MATERIAL },
        { ...MATERIAL, 物料编号: "MAT-2", 物料名称: LONG, 工模编号: "TM-2" },
      ],
    }),
  });

  it("BOM 明细网格:每列统一宽=该列最长内容,超上限的字段截断为上限宽", async () => {
    setup(cfg2());
    await waitLoaded();
    // 行2 物料名称超长 → 整列封顶 CELL_CAP_CH,两行同宽
    expect(widthOf(screen.getByLabelText("行1 物料名称"))).toBe(`${CELL_CAP_CH}ch`);
    expect(widthOf(screen.getByLabelText("行2 物料名称"))).toBe(`${CELL_CAP_CH}ch`);
    // 截断单元格值完整保留,title 悬停提示完整内容
    expect(screen.getByLabelText("行2 物料名称")).toHaveValue(LONG);
    expect(screen.getByLabelText("行2 物料名称")).toHaveAttribute("title", LONG);
    // 短内容列按最长内容:工模编号 TM-1/TM-2(视觉 4)→ max(6,4)+3=9ch,两行一致
    expect(widthOf(screen.getByLabelText("行1 工模编号"))).toBe("9ch");
    expect(widthOf(screen.getByLabelText("行2 工模编号"))).toBe("9ch");
  });

  it("半成品设置弹窗:同一套列宽规则(超长截断、点击显示)", async () => {
    setup(cfg2());
    await waitLoaded();
    fireEvent.click(screen.getByRole("button", { name: "设置半成品" }));
    const dlg = await screen.findByRole("dialog");
    const q = within(dlg);
    expect(widthOf(q.getByLabelText("行1 物料名称"))).toBe(`${CELL_CAP_CH}ch`);
    expect(widthOf(q.getByLabelText("行2 物料名称"))).toBe(`${CELL_CAP_CH}ch`);
    expect(q.getByLabelText("行2 物料名称")).toHaveValue(LONG);
    expect(q.getByLabelText("行2 物料名称")).toHaveAttribute("title", LONG);
    // 物料编号 MAT-1/MAT-2(视觉 5)→ max(6,5)+3=9ch
    expect(widthOf(q.getByLabelText("行1 物料编号"))).toBe("9ch");
    expect(widthOf(q.getByLabelText("行2 物料编号"))).toBe("9ch");
  });
});

// ---------- 导入 ----------

describe("导入物料明细", () => {
  it("粘贴 TSV 解析预览,确定导入后追加到明细", async () => {
    const cfg = {
      ...baseCfg(),
      onCall: (c: Call) => {
        const u = new URL(c.url, "http://test");
        if (u.pathname === "/api/master/materials")
          return json({
            items: [{ id: 5, 物料编号: "MAT-IMP", 物料名称: "进口料", 规格: "S1", 颜色: "红", 单位: "个", 物料类别: "五金" }],
            total: 1,
          });
        return undefined;
      },
    };
    setup(cfg);
    await waitLoaded();
    fireEvent.click(screen.getByText("导入"));
    await waitFor(() =>
      expect(screen.getAllByText(/导入物料明细/).length).toBeGreaterThanOrEqual(1),
    );
    fireEvent.change(screen.getByLabelText("粘贴Excel内容"), {
      target: { value: "物料编号\t使用数量\nMAT-IMP\t3" },
    });
    fireEvent.click(screen.getByText("解析"));
    await waitFor(() => expect(screen.getByText("进口料")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确定导入"));
    await waitFor(() => expect(screen.getByDisplayValue("MAT-IMP")).toBeInTheDocument());
  });
});

// ---------- 竞态守卫 ----------

describe("载入竞态(loadVersion 守卫)", () => {
  // 对照老系统 bomSetupAssemblyPersistence.test.ts「ignores a stale document response」:
  // STYLE-1 载入在飞时切到 STYLE-2,STYLE-2 先返回生效;STYLE-1 迟到响应必须被忽略
  it("新款号先返回时,旧款号的迟到响应被忽略", async () => {
    let resolveOld!: (v: unknown) => void;
    let resolveNew!: (v: unknown) => void;
    const cfg: Cfg = {
      ...baseCfg(),
      onCall: (c) => {
        const u = new URL(c.url, "http://test");
        const m = /^\/api\/styles\/(.+?)\/materials$/.exec(u.pathname);
        if (m && c.method === "GET") {
          const key = decodeURIComponent(m[1]);
          if (key === "STYLE-1")
            return new Promise<Response>((res) => {
              resolveOld = (v) => res(json(v));
            });
          if (key === "STYLE-2")
            return new Promise<Response>((res) => {
              resolveNew = (v) => res(json(v));
            });
        }
        return undefined;
      },
    };
    setup(cfg); // 默认路由 /bom-setup?款号=STYLE-1,载入挂起
    await waitFor(() => expect(resolveOld).toBeDefined());

    // 手输 STYLE-2 失焦 → 触发第二次载入
    fireEvent.change(screen.getByLabelText("产品货号"), { target: { value: "STYLE-2" } });
    fireEvent.blur(screen.getByLabelText("产品货号"));
    await waitFor(() => expect(resolveNew).toBeDefined());

    // STYLE-2 先返回:生效
    resolveNew({ 款号: "STYLE-2", 款式: "产品二", 物料: [{ ...MATERIAL, 物料编号: "MAT-2" }], 单头: null });
    await waitFor(() => expect(screen.getByLabelText("产品名称")).toHaveValue("产品二"));

    // STYLE-1 迟到:被守卫忽略,页面保持 STYLE-2
    resolveOld({ 款号: "STYLE-1", 款式: "产品一", 物料: [{ ...MATERIAL }], 单头: null });
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByLabelText("产品名称")).toHaveValue("产品二");
    expect(screen.getByLabelText("产品货号")).toHaveValue("STYLE-2");
  });
});

// ---------- 关闭落点 ----------

describe("buildCloseTarget", () => {
  it("有 return 参数回来源页,否则 -1 后退", () => {
    expect(buildCloseTarget("/scheduling")).toBe("/scheduling");
    expect(buildCloseTarget(null)).toBe(-1);
  });
});
