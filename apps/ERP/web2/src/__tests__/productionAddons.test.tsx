// 生产通知单六项补齐(Batch 0D):一键启动 / 下推领料 / MO单录入 / 图片备注 /
// 工序物料页签 / 新建态 BOM 实时预览。逐场景对照老系统
// web/src/pages/production/ProductionNoticePage.tsx + ProductionStartupModal.tsx + ImageNotesPanel.tsx。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import ProductionPage from "@/pages/ProductionPage";
import type { ProductionDetail, ProductionHeader } from "@/api/types";

// ---------- 测试基建:fetch 路由桩 ----------

type Call = { url: string; method: string; body?: Record<string, unknown>; formData?: FormData };

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [
  {
    组: "工程部",
    菜单: "生产制单",
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
const PERMS_NO_SAVE = [{ ...PERMS_FULL[0], 保存: false }];

const HDR: ProductionHeader = {
  id: 1,
  生产单号: "SC20260915003",
  客户款号: "92125A-S001",
  客户编号: "C01",
  客户名称: "测试客户",
  合同号: "PO-1",
  交货日期: "2026-09-30",
  接单数量: 100,
  计划数量: 100,
  订单类型: "正式单",
  标识: "正单",
  制单人: "admin",
  下单日期: "2026-09-15",
  日期: "2026-09-15",
  审核: "1",
  审核人: "经理",
  跟单员: "小李",
  默认单价: "HK 12.5",
};

const DETAIL: ProductionDetail = {
  单头: HDR,
  货号明细: [
    { 货号: "92125A-S001", BOM款号: "92125A-S001", 款号名称: "暹罗猫", 数量: 100, 比例: 1, 分析: true },
  ],
  数量: [{ 货号: "92125A-S001", 颜色: "白", 尺码: "M", 数量: 100 }],
  工序: [
    { 货号: "92125A-S001", 工序号: "01", 工序名称: "裁剪", 单价: 1.5, 工序类型: "内作" },
    { 货号: "OTHER", 工序号: "02", 工序名称: "别的货号工序", 单价: 2, 工序类型: "外发" },
  ],
  物料: [
    {
      货号: "92125A-S001", 物料编号: "M-1", 物料名称: "布料", 规格: "S", 颜色: "白", 单位: "码",
      总数量: 100, 库存数量: 40, 需订数量: 60, 预算单价: 2.5, 金额: 250, 供应商名称: "供应商A",
    },
    { 货号: "OTHER", 物料编号: "M-9", 物料名称: "别的物料", 总数量: 5 },
  ],
};

const BOM_HEADERS = [
  { 款号: "92125A-S001", 款式: "暹罗猫", 客户编号: "C01", 客户名称: "测试客户", 默认单价: "HK 12.5" },
];

const MO_ROWS = [
  {
    接单日期: "2026-09-01", 正单合同号: "MO-1", 产品货号: "92125A-S001", 产品名称: "暹罗猫",
    接单数量: 40, 装箱方式: "100PCS/CTN", 订单总箱数: 4, 验货日期: "2026-09-20", 备注: "急",
  },
];

const ISSUE_BASIS = [
  { 生产单号: "SC20260915003", 款号: "92125A-S001", 物料编号: "M-1", 物料名称: "布料", 规格: "S", 颜色: "白", 单位: "码", 数量: 100 },
  { 生产单号: "SC20260915003", 款号: "92125A-S001", 物料编号: "M-2", 物料名称: "五金", 规格: null, 颜色: null, 单位: "个", 数量: 50 },
];

const BOM_MATERIALS = {
  款号: "92125A-S001",
  款式: "暹罗猫",
  物料: [
    { 物料编号: "M-1", 物料名称: "布料", 规格: "S", 颜色: "白", 单位: "码", 使用数量: 0.5 },
    { 物料编号: "M-2", 物料名称: "五金", 规格: null, 颜色: null, 单位: "个", 使用数量: 2 },
    { 物料编号: "", 物料名称: "空编号行(应被过滤)", 使用数量: 1 },
  ],
};

const IMAGE_NOTES = [
  {
    ID: 7, 模块: "生产单", 单号: "SC20260915003", 文件名: "a.png",
    存储路径: "uploads/生产单/x.png", 备注: "样衣照", 上传人: "admin", 上传时间: "2026-09-10T10:00:00",
  },
];

interface Cfg {
  perms: unknown;
  firstList: unknown;
  detail: ProductionDetail;
  mo: unknown;
  issueBasis: unknown;
  matInv: unknown;
  plasticInv: unknown;
  bomMaterials: unknown;
  imageNotes: unknown;
  onCall?: (c: Call) => Response | undefined;
}

function baseCfg(): Cfg {
  return {
    perms: PERMS_FULL,
    firstList: { items: [HDR], total: 1 },
    detail: DETAIL,
    mo: MO_ROWS,
    issueBasis: ISSUE_BASIS,
    matInv: [{ 物料编号: "M-1", 库存数量: 40 }],
    plasticInv: [{ 物料编号: "M-1", 库存数量: 20 }, { 物料编号: "M-2", 库存数量: 100 }],
    bomMaterials: BOM_MATERIALS,
    imageNotes: IMAGE_NOTES,
  };
}

function installFetch(cfg: Cfg) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const call: Call = { url, method };
      if (init?.body instanceof FormData) call.formData = init.body;
      else if (init?.body) call.body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push(call);
      const custom = cfg.onCall?.(call);
      if (custom) return custom;
      const u = new URL(url, "http://test");
      const p = u.pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(cfg.perms));
      if (p === "/api/production" && method === "GET") return json(cfg.firstList);
      if (/^\/api\/production\/[^/]+\/mo$/.test(p) && method === "GET") return json(cfg.mo);
      if (/^\/api\/production\/[^/]+\/mo$/.test(p) && method === "PUT") return noContent();
      if (/^\/api\/production\/[^/]+\/issue-basis$/.test(p)) return json(cfg.issueBasis);
      if (/^\/api\/production\/[^/]+$/.test(p) && method === "GET") return json(cfg.detail);
      if (p === "/api/material-inventory") return json(cfg.matInv);
      if (p === "/api/plastic-inventory") return json(cfg.plasticInv);
      if (p === "/api/styles/bom-headers") return json(BOM_HEADERS);
      if (/^\/api\/styles\/.+\/po-bindings$/.test(p)) return json([]);
      if (/^\/api\/styles\/.+\/materials$/.test(p)) return json(cfg.bomMaterials);
      if (p === "/api/image-notes" && method === "GET") return json(cfg.imageNotes);
      if (p === "/api/image-notes" && method === "POST")
        return json({ ...IMAGE_NOTES[0], ID: 8, 备注: call.formData?.get("备注") ?? null });
      if (/^\/api\/image-notes\/\d+$/.test(p) && method === "DELETE") return noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

// 路由探针:断言跳转型按钮(下推领料)的目标地址
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>;
}

const setup = (cfg: Cfg, route = "/production") => {
  const calls = installFetch(cfg);
  renderWithProviders(
    <>
      <ProductionPage />
      <LocationProbe />
    </>,
    route,
  );
  return calls;
};

// 等待自动打开的首单详情就位(已审核查看态)
const waitDoc = async () =>
  waitFor(() => expect(screen.getByText(/· SC20260915003/)).toBeInTheDocument());

beforeEach(() => {
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ---------- 1. 一键启动 ----------

describe("一键启动", () => {
  it("查看态有「一键启动」;点击打开面板,并行拉 issue-basis(不带档)+两仓库存,统计与缺口行正确", async () => {
    const calls = setup(baseCfg());
    await waitDoc();

    fireEvent.click(screen.getByText("一键启动"));
    await waitFor(() =>
      expect(screen.getByText("生产启动 · SC20260915003")).toBeInTheDocument(),
    );

    const basisReq = calls.find((c) => c.url.includes("/issue-basis"))!;
    expect(basisReq.url).toBe("/api/production/SC20260915003/issue-basis"); // 不带档=全部
    expect(calls.some((c) => c.url.startsWith("/api/material-inventory"))).toBe(true);
    expect(calls.some((c) => c.url.startsWith("/api/plastic-inventory"))).toBe(true);

    // 统计:物料种类 2 / 应领总量 150 / 缺口种类 1 / 缺口总量 40(断言数值本身)
    await waitFor(() => expect(screen.getByText("缺口种类")).toBeInTheDocument());
    const statVal = (label: string) =>
      screen.getByText(label).nextElementSibling?.textContent;
    expect(statVal("物料种类")).toBe("2");
    expect(statVal("应领总量")).toBe("150");
    expect(statVal("缺口种类")).toBe("1");
    expect(statVal("缺口总量")).toBe("40");
    // M-1:应领 100,库存 40+20=60,缺口 40;M-2:库存 100 够
    expect(screen.getByText("缺 40")).toBeInTheDocument();
    expect(screen.getByText("够")).toBeInTheDocument();
    // 表头契约:sticky 在每个 th 上(thead sticky Chrome 不生效),不透明底 + z-10
    for (const th of within(screen.getByRole("dialog")).getAllByRole("columnheader")) {
      expect(th.className).toContain("sticky top-0 z-10");
      expect(th.className).toContain("bg-white");
    }
  });

  it("面板底部「下推领料·来料仓/塑胶仓」分别跳 ?basis= 深链", async () => {
    setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByText("一键启动"));
    await waitFor(() => expect(screen.getByText("缺 40")).toBeInTheDocument());

    fireEvent.click(screen.getByText("下推领料·塑胶仓"));
    await waitFor(() =>
      expect(screen.getByTestId("loc").textContent).toBe(
        "/plastic-issues?basis=SC20260915003",
      ),
    );
  });

  it("面板底部「去采购分析(补缺口)」跳 /purchase-material-analysis(Batch 6 落地后补回)", async () => {
    setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByText("一键启动"));
    await waitFor(() => expect(screen.getByText("缺 40")).toBeInTheDocument());

    fireEvent.click(screen.getByText("去采购分析(补缺口)"));
    await waitFor(() =>
      expect(screen.getByTestId("loc").textContent).toBe("/purchase-material-analysis"),
    );
  });

  it("新建态没有「一键启动」", async () => {
    setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByText("新建"));
    expect(screen.queryByText("一键启动")).not.toBeInTheDocument();
  });
});

// ---------- 2. 下推领料 ----------

describe("下推领料", () => {
  it("查看态工具条两个下推按钮:来料仓跳 /material-issues?basis=,塑胶仓跳 /plastic-issues?basis=", async () => {
    setup(baseCfg());
    await waitDoc();

    fireEvent.click(screen.getByText("下推领料(来料仓)"));
    await waitFor(() =>
      expect(screen.getByTestId("loc").textContent).toBe(
        "/material-issues?basis=SC20260915003",
      ),
    );
  });

  it("下推领料(塑胶仓)跳 /plastic-issues?basis=", async () => {
    setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByText("下推领料(塑胶仓)"));
    await waitFor(() =>
      expect(screen.getByTestId("loc").textContent).toBe(
        "/plastic-issues?basis=SC20260915003",
      ),
    );
  });

  it("新建态没有下推按钮", async () => {
    setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByText("新建"));
    expect(screen.queryByText("下推领料(来料仓)")).not.toBeInTheDocument();
    expect(screen.queryByText("下推领料(塑胶仓)")).not.toBeInTheDocument();
  });
});

// ---------- 3. MO单录入 ----------

describe("MO单录入", () => {
  it("打开单据时 GET /mo 并在「MO单录入」页签渲染行;剩余数量=计划数量-合计", async () => {
    const calls = setup(baseCfg());
    await waitDoc();
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "GET" && c.url === "/api/production/SC20260915003/mo"),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "MO单录入" }));
    await waitFor(() => expect(screen.getByDisplayValue("MO-1")).toBeInTheDocument());
    expect(screen.getByDisplayValue("暹罗猫")).toBeInTheDocument();
    // 计划数量 100 - 已录 40 = 60
    expect(screen.getByText(/MO单剩余数量:60/)).toBeInTheDocument();
  });

  it("添加行+填字段+保存MO单:PUT /mo 载荷照抄老系统(日期 YYYY-MM-DD,空串转 undefined)", async () => {
    const calls = setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByRole("button", { name: "MO单录入" }));
    await waitFor(() => expect(screen.getByDisplayValue("MO-1")).toBeInTheDocument());

    fireEvent.click(screen.getByText("添加行"));
    fireEvent.change(screen.getAllByLabelText("正单合同号")[1], { target: { value: "MO-2" } });
    fireEvent.change(screen.getAllByLabelText("接单数量")[1], { target: { value: "25" } });
    fireEvent.change(screen.getAllByLabelText("接单日期")[1], { target: { value: "2026-09-16" } });
    fireEvent.click(screen.getByText("保存MO单"));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "PUT" && c.url === "/api/production/SC20260915003/mo"),
      ).toBe(true),
    );
    const put = calls.find((c) => c.method === "PUT" && c.url.endsWith("/mo"))!;
    expect(Array.isArray(put.body)).toBe(true);
    const lines = put.body as unknown as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ 接单日期: "2026-09-16", 正单合同号: "MO-2", 接单数量: 25 });
    await waitFor(() => expect(screen.getByText("MO单已保存")).toBeInTheDocument());
    // 剩余数量随录入变化:100 - 40 - 25 = 35
    expect(screen.getByText(/MO单剩余数量:35/)).toBeInTheDocument();
  });

  it("新建态:MO单录入页签提示先保存,不发 /mo 请求", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [], total: 0 }; // 关掉首单自动打开,防历史调用干扰
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getByText("尚未打开单据")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));
    fireEvent.click(screen.getByRole("button", { name: "MO单录入" }));
    expect(screen.getByText("保存生产通知单后录入MO单")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/mo"))).toBe(false);
  });

  it("无「保存」位:不渲染保存MO单按钮", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_SAVE;
    setup(cfg);
    await waitDoc();
    fireEvent.click(screen.getByRole("button", { name: "MO单录入" }));
    await waitFor(() => expect(screen.getByDisplayValue("MO-1")).toBeInTheDocument());
    expect(screen.queryByText("保存MO单")).not.toBeInTheDocument();
  });
});

// ---------- 4. 图片备注 ----------

describe("图片备注", () => {
  it("页签内 GET /image-notes(模块=生产单)渲染备注/上传人", async () => {
    const calls = setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByRole("button", { name: "图片备注" }));

    await waitFor(() => expect(screen.getByText("样衣照")).toBeInTheDocument());
    const req = calls.find((c) => c.url.startsWith("/api/image-notes"))!;
    expect(req.url).toBe(
      `/api/image-notes?${encodeURIComponent("模块")}=${encodeURIComponent("生产单")}&${encodeURIComponent("单号")}=SC20260915003`,
    );
    expect(screen.getByText(/admin 2026-09-10/)).toBeInTheDocument();
  });

  it("上传:选文件后 POST multipart(模块/单号/备注/file),成功后重新列表", async () => {
    const calls = setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByRole("button", { name: "图片备注" }));
    await waitFor(() => expect(screen.getByText("样衣照")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/备注\(可选/), { target: { value: "包装图" } });
    const file = new File(["png-bytes"], "b.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择图片"), { target: { files: [file] } });

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/image-notes")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/image-notes")!;
    expect(post.formData).toBeInstanceOf(FormData);
    expect(post.formData!.get("模块")).toBe("生产单");
    expect(post.formData!.get("单号")).toBe("SC20260915003");
    expect(post.formData!.get("备注")).toBe("包装图");
    expect(post.formData!.get("file")).toBeInstanceOf(File);
    await waitFor(() => expect(screen.getByText("已上传")).toBeInTheDocument());
  });

  it("删除:确认后 DELETE /image-notes/{id}", async () => {
    const calls = setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByRole("button", { name: "图片备注" }));
    await waitFor(() => expect(screen.getByText("样衣照")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "删除图片 样衣照" }));
    await waitFor(() => expect(screen.getByText("确认删除该图片?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认删除"));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url === "/api/image-notes/7"),
      ).toBe(true),
    );
  });

  it("新建态(无单号):空提示,不发列表请求", async () => {
    const cfg = baseCfg();
    cfg.firstList = { items: [], total: 0 }; // 关掉首单自动打开,防历史调用干扰
    const calls = setup(cfg);
    await waitFor(() => expect(screen.getByText("尚未打开单据")).toBeInTheDocument());
    fireEvent.click(screen.getByText("新建"));
    fireEvent.click(screen.getByRole("button", { name: "图片备注" }));
    expect(screen.getByText("请先打开一个生产通知单")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/image-notes"))).toBe(false);
  });

  it("无「保存」位:不渲染上传控件与删除按钮", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_SAVE;
    setup(cfg);
    await waitDoc();
    fireEvent.click(screen.getByRole("button", { name: "图片备注" }));
    await waitFor(() => expect(screen.getByText("样衣照")).toBeInTheDocument());
    expect(screen.queryByText("上传图片")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /删除图片/ })).not.toBeInTheDocument();
  });
});

// ---------- 5. 工序/物料清单页签 ----------

describe("工序/物料清单页签", () => {
  it("查看态「制单内容」页签:色码数量 + 工序工费(按选中货号过滤,null 单价显 ***)", async () => {
    setup(baseCfg());
    await waitDoc();

    // 默认就在制单内容页签
    await waitFor(() => expect(screen.getByText(/工序工费\(1\)/)).toBeInTheDocument());
    expect(screen.getByText("裁剪")).toBeInTheDocument();
    expect(screen.getByText("内作")).toBeInTheDocument();
    expect(screen.queryByText("别的货号工序")).not.toBeInTheDocument(); // 非选中货号被过滤
    // 色码数量仍在该页签
    expect(screen.getByText(/颜色x尺码数量\(货号 92125A-S001\)/)).toBeInTheDocument();
  });

  it("查看态「物料清单」页签:快照列齐全,需订数量>0 红色,按选中货号过滤", async () => {
    setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByRole("button", { name: "物料清单" }));

    const panel = screen.getByTestId("tab-material");
    await waitFor(() => expect(within(panel).getByText("布料")).toBeInTheDocument());
    expect(within(panel).queryByText("别的物料")).not.toBeInTheDocument();
    for (const h of ["物料编号", "物料名称", "规格", "颜色", "单位", "总数量", "库存数量", "需订数量", "预算单价", "金额", "供应商"]) {
      expect(within(panel).getByText(h)).toBeInTheDocument();
    }
    const owed = within(panel).getByText("60");
    expect(owed.className).toContain("text-[#dc2626]");
    expect(within(panel).getByText("供应商A")).toBeInTheDocument();
    expect(within(panel).getByText("2.5")).toBeInTheDocument();
  });

  it("无「单价/金额」位:物料清单不渲染价格列", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_PRICE;
    setup(cfg);
    await waitDoc();
    fireEvent.click(screen.getByRole("button", { name: "物料清单" }));
    await waitFor(() => expect(screen.getByText("布料")).toBeInTheDocument());
    expect(screen.queryByText("预算单价")).not.toBeInTheDocument();
    expect(screen.queryByText("金额")).not.toBeInTheDocument();
    expect(screen.queryByText("2.5")).not.toBeInTheDocument();
  });
});

// ---------- 6. 新建态 BOM 实时预览 ----------

describe("新建态 BOM 实时预览", () => {
  it("选中已建 BOM 的货号:实时 GET /styles/{款号}/materials,物料清单页签显示预览(过滤空编号行)", async () => {
    const calls = setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByText("新建"));

    fireEvent.change(screen.getByLabelText("货号"), { target: { value: "92125A-S001" } });
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/styles/92125A-S001/materials")).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "物料清单" }));
    await waitFor(() =>
      expect(screen.getByText(/BOM 预览\(2 项 · 保存后按数量展开\)/)).toBeInTheDocument(),
    );
    expect(screen.getByText("布料")).toBeInTheDocument();
    expect(screen.getByText("五金")).toBeInTheDocument();
    expect(screen.queryByText("空编号行(应被过滤)")).not.toBeInTheDocument();
    expect(screen.getByText("BOM用量")).toBeInTheDocument();
    expect(screen.getByText("0.5")).toBeInTheDocument();
  });

  it("手输新货号(不在 bom-headers):回落用 BOM款号 拉预览", async () => {
    const calls = setup(baseCfg());
    await waitDoc();
    fireEvent.click(screen.getByText("新建"));

    fireEvent.change(screen.getByLabelText("货号"), { target: { value: "NEW-X" } });
    fireEvent.change(screen.getByLabelText("BOM款号"), { target: { value: "92125A-S001" } });
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/styles/92125A-S001/materials")).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "物料清单" }));
    await waitFor(() => expect(screen.getByText("布料")).toBeInTheDocument());
  });

  it("查看态不拉预览(物料来自已展开快照)", async () => {
    const calls = setup(baseCfg());
    await waitDoc();
    expect(calls.some((c) => c.url.includes("/materials"))).toBe(false);
  });
});
