// 客户排期表全量对齐:逐场景对照老系统
// web/src/pages/scheduling/SchedulingPage.tsx + ScheduleProductionModal.tsx,
// 测试契约对齐 web/src/__tests__/schedulingPage.render.test.tsx 与 scheduleProductionPoBinding.test.tsx。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import SchedulingPage from "@/pages/SchedulingPage";

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

const PERMS_FULL = [
  { 组: "业务部", 菜单: "生产排期", 打开: true, 保存: true, 删除: true },
  { 组: "工程部", 菜单: "生产制单", 打开: true, 保存: true },
];
const PERMS_NO_IMPORT = [
  { 组: "业务部", 菜单: "生产排期", 打开: true, 保存: false, 删除: true },
  { 组: "工程部", 菜单: "生产制单", 打开: true, 保存: true },
];
const PERMS_NO_PRODUCE = [
  { 组: "业务部", 菜单: "生产排期", 打开: true, 保存: true, 删除: true },
  { 组: "工程部", 菜单: "生产制单", 打开: true, 保存: false },
];
const PERMS_NO_DELETE = [
  { 组: "业务部", 菜单: "生产排期", 打开: true, 保存: true, 删除: false },
  { 组: "工程部", 菜单: "生产制单", 打开: true, 保存: true },
];

const ROW = {
  ID: 1, 批次ID: 1, 排期客户: "MOOSE", 状态: "在排",
  接单日期: "2026-06-23T00:00:00", 客户名称: "ROSS", 国家: "美国",
  PO号: "1053032", 客PO: "60308543", 货号: "18060", 品名: "车子+公仔",
  数量: 6000, 总箱数: 3000, 走货期: "2026-09-25T00:00:00", 验货期: "2026-09-18T00:00:00",
  来源工作表: "排期", 备注: "测试备注", 原始数据: JSON.stringify({ 货号: "18060", 柜型: "40HQ" }),
};

const BOM = { 款号: "18060", 款式: "车子+公仔", 客户编号: "C-1", 客户名称: "客户一", 默认单价: "5" };

interface Cfg {
  perms: unknown;
  list: unknown;
  customers: unknown;
  summary: unknown;
  files: unknown;
  batches: unknown;
  bomHeaders: unknown;
  poBindings: unknown;
  pending?: unknown;        // 状态变更待审数+是否经理
  statusChanges?: unknown;  // 状态变更申请列表
  putPends?: boolean;       // PUT /api/scheduling/:id 返回 状态待审核
  onCall?: (c: Call) => Response | undefined;
}

function baseCfg(): Cfg {
  return {
    perms: PERMS_FULL,
    list: { items: [ROW], total: 1 },
    customers: ["MOOSE", "ZURU"],
    summary: [{ 排期客户: "MOOSE", 状态: "在排", 行数: 1, 数量: 6000 }],
    files: [
      { ID: 1, 排期客户: "MOOSE", 文件名: "2026年MOOSE排期8-15.xlsx", 导入日期: "2026-09-01T10:00:00", 操作员: "admin", 行数: 1, 货号数: 1, 在排: 1, 已走货: 0, 已取消: 0 },
    ],
    batches: [
      { ID: 1, 排期客户: "MOOSE", 文件名: "2026年MOOSE排期8-15.xlsx", 导入日期: "2026-09-01T10:00:00", 操作员: "admin", 新增: 1, 更新: 0, 行数: 1 },
    ],
    bomHeaders: [BOM],
    poBindings: [],
    pending: { 待审数: 0, 是否经理: true },
    statusChanges: [],
    putPends: false,
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
      if (p === "/api/scheduling" && method === "GET") return json(cfg.list);
      if (p === "/api/scheduling" && method === "POST") return json({ id: 99 });
      if (/^\/api\/scheduling\/\d+$/.test(p) && method === "PUT")
        return json({ 状态待审核: cfg.putPends ?? false });
      if (/^\/api\/scheduling\/\d+$/.test(p) && method === "DELETE") return noContent();
      if (p === "/api/scheduling/status-changes/pending") return json(cfg.pending);
      if (p === "/api/scheduling/status-changes" && method === "GET")
        return json(cfg.statusChanges);
      if (/^\/api\/scheduling\/status-changes\/\d+\/(approve|reject)$/.test(p))
        return noContent();
      if (p === "/api/scheduling/customers") return json(cfg.customers);
      if (p === "/api/scheduling/summary") return json(cfg.summary);
      if (p === "/api/scheduling/files") return json(cfg.files);
      if (p === "/api/scheduling/batches" && method === "GET") return json(cfg.batches);
      if (p === "/api/scheduling/import" && method === "POST")
        return json({ 批次ID: 2, 新增: 1, 更新: 0, 跳过: 0, 失败: 0, 失败明细: [] });
      if (/^\/api\/scheduling\/batches\/\d+$/.test(p) && method === "DELETE") return noContent();
      if (p === "/api/styles/bom-headers") return json(cfg.bomHeaders);
      if (/^\/api\/styles\/.+\/po-bindings$/.test(p)) return json(cfg.poBindings);
      if (p === "/api/production" && method === "POST")
        return json({ 生产单号: "SC-T10" }, 201);
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

// /production 用桩页替代,验证「成功后跳 /production 打开新单」
const setup = (cfg: Cfg) => {
  const calls = installFetch(cfg);
  renderWithProviders(
    <Routes>
      <Route path="/scheduling" element={<SchedulingPage />} />
      <Route path="/production" element={<div>生产通知单页STUB</div>} />
    </Routes>,
    "/scheduling",
  );
  return calls;
};

// /bom-setup 桩页:回传完整 URL(pathname+search)验证「去建 BOM」跳转参数
function BomSetupStub({ onUrl }: { onUrl: (url: string) => void }) {
  const loc = useLocation();
  useEffect(() => {
    onUrl(loc.pathname + loc.search);
  }, [loc, onUrl]);
  return <div>BOM设置页STUB</div>;
}

// 等首屏列表加载完成
const waitList = async () =>
  waitFor(() => expect(screen.getByText("18060")).toBeInTheDocument());

// 从排期行打开生产下单弹窗并等 BOM 检查结束(预填备注出现 PO=1053032)
const openProdDialog = async (cfg = baseCfg()) => {
  const calls = setup(cfg);
  await waitList();
  fireEvent.click(screen.getByText("生产下单"));
  await waitFor(() =>
    expect(screen.getByText(/排期行生成生产通知单/)).toBeInTheDocument(),
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

// ---------- 列表渲染(对齐 schedulingPage.render.test.tsx) ----------

describe("排期列表", () => {
  it("表格渲染出列头与数据行 + 状态统计", async () => {
    setup(baseCfg());
    await waitList();
    // 列头(筛选栏有同名 label,用 getAllByText)
    for (const h of ["状态", "品名", "走货期", "验货期", "排期客户", "来源工作表"])
      expect(screen.getAllByText(h).length).toBeGreaterThanOrEqual(1);
    // 数据行
    expect(screen.getByText("车子+公仔")).toBeInTheDocument();
    // MOOSE 出现在行数据里;筛选下拉(SearchSelect)的选项打开后才渲染,单独验证后 Esc 关闭
    expect(screen.getAllByText("MOOSE").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByLabelText("排期客户"));
    expect(screen.getByRole("option", { name: "MOOSE" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("1053032")).toBeInTheDocument();
    // 状态统计与视图切换(统计胶囊=按钮,文案跨多个子元素,用函数匹配器)
    const pill = (t: string) =>
      screen.getByText((_, el) => el?.tagName === "BUTTON" && el.textContent === t);
    expect(pill("在排 1")).toBeInTheDocument();
    expect(screen.getByText("按排期表")).toBeInTheDocument();
    expect(screen.getByText("生产下单")).toBeInTheDocument();
  });

  it("冻结列:点钉按钮冻结到该列(前 N 列 sticky),再点取消,选择持久化", async () => {
    setup(baseCfg());
    await waitList();
    // 冻结到「品名」列(第 3 列,含 展开/货号/品名)
    fireEvent.click(screen.getByLabelText("冻结到 品名 列"));
    const ths = document.querySelectorAll<HTMLElement>("thead th");
    expect(ths[0].style.position).toBe("sticky");
    expect(ths[1].style.position).toBe("sticky");
    expect(ths[2].style.position).toBe("sticky");
    expect(ths[3].style.position).not.toBe("sticky");
    const tds = document
      .querySelectorAll("tbody tr")[0]
      .querySelectorAll<HTMLElement>("td");
    expect(tds[0].style.position).toBe("sticky");
    expect(tds[1].style.position).toBe("sticky");
    expect(tds[2].style.position).toBe("sticky");
    expect(tds[3].style.position).not.toBe("sticky");
    expect(localStorage.getItem("web2.freeze.scheduling")).toBe("3");
    // 再点边界列的钉 = 取消冻结
    fireEvent.click(screen.getByLabelText("冻结到 品名 列"));
    expect(document.querySelectorAll<HTMLElement>("thead th")[2].style.position).not.toBe("sticky");
    expect(localStorage.getItem("web2.freeze.scheduling")).toBe("0");
  });

  it("点行展开原始数据(原表头->原值,万全兜底)", async () => {
    setup(baseCfg());
    await waitList();
    fireEvent.click(screen.getByText("车子+公仔"));
    await waitFor(() => expect(screen.getByText("原表头")).toBeInTheDocument());
    expect(screen.getByText("柜型")).toBeInTheDocument();
    expect(screen.getByText("40HQ")).toBeInTheDocument();
  });

  it("筛选:关键字/状态/走货期区间/排期客户进入查询参数", async () => {
    const calls = setup(baseCfg());
    await waitList();
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "18060" } });
    pickOption("状态", "在排");
    fireEvent.change(screen.getByLabelText("走货期从"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("走货期至"), { target: { value: "2026-09-30" } });
    pickOption("排期客户", "MOOSE");
    fireEvent.click(screen.getByText("查询"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.includes("/api/scheduling?") &&
            c.url.includes("keyword=18060") &&
            c.url.includes("%E7%8A%B6%E6%80%81=") && // 状态
            c.url.includes("2026-09-01"),
        ),
      ).toBe(true),
    );
  });

  it("点状态统计胶囊=按该状态筛选(再点取消),与状态下拉联动", async () => {
    const calls = setup(baseCfg());
    await waitList();
    const pill = (t: string) =>
      screen.getByText((_, el) => el?.tagName === "BUTTON" && el.textContent === t);
    // 点「已取消」→ 查询参数带 状态=已取消(URL 编码),且筛选栏下拉同步
    fireEvent.click(pill("已取消 0"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("/api/scheduling?") && decodeURIComponent(c.url).includes("状态=已取消"),
        ),
      ).toBe(true),
    );
    expect(screen.getByLabelText("状态")).toHaveTextContent("已取消");
    // 再点一次 → 取消筛选(状态参数消失)
    calls.length = 0;
    fireEvent.click(pill("已取消 0"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("/api/scheduling?") && !c.url.includes("%E7%8A%B6%E6%80%81"),
        ),
      ).toBe(true),
    );
    expect(screen.getByLabelText("状态")).toHaveTextContent("全部");
  });

  it("单类型:MA单绿标/实单关联MA蓝标(点击按 MA 货号查),单类型筛选入查询参数", async () => {
    const cfg = baseCfg();
    cfg.list = {
      items: [
        { ...ROW, ID: 11, 货号: "92125-MA", 品名: "MA模板", 单类型: "MA单" },
        { ...ROW, ID: 12, 货号: "92125-S001", 品名: "实单一", 单类型: "实单", 关联MA货号: "92125-MA", 关联MA状态: "在排" },
        { ...ROW, ID: 13, 货号: "92125-S002", 品名: "实单二", 单类型: "实单", 关联MA货号: "92125-MA", 关联MA状态: null },
      ],
      total: 3,
    };
    const calls = setup(cfg);
    // 徽标:MA单绿标;实单→关联MA(在排蓝标/未排期灰标)
    await waitFor(() => expect(screen.getByText("MA单")).toBeInTheDocument());
    expect(screen.getByText("→92125-MA·在排")).toBeInTheDocument();
    expect(screen.getByText("→92125-MA·未排期")).toBeInTheDocument();
    // 单类型筛选 → 查询参数带 单类型=MA单
    pickOption("单类型", "MA单");
    fireEvent.click(screen.getByText("查询"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("/api/scheduling?") && decodeURIComponent(c.url).includes("单类型=MA单"),
        ),
      ).toBe(true),
    );
    // 点关联MA徽标 → 关键字=MA 货号并触发查询
    calls.length = 0;
    fireEvent.click(screen.getByText("→92125-MA·在排"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("/api/scheduling?") && c.url.includes("keyword=92125-MA"),
        ),
      ).toBe(true),
    );
    expect(screen.getByLabelText("关键字")).toHaveValue("92125-MA");
  });

  it("BOM 关联徽标:已绑本PO/已建未绑/未建,点击跳 BOM 页(未建带 品名/客户/PO)", async () => {
    const cfg = baseCfg();
    cfg.list = {
      items: [
        { ...ROW, ID: 21, 货号: "92125-MA", PO号: "PO-MA", 单类型: "MA单", BOM款号: "92125-MA", 绑定PO数: 1, 已绑本PO: true },
        { ...ROW, ID: 22, 货号: "92125-S001", PO号: "PO-S1", 单类型: "实单", 关联MA货号: "92125-MA", 关联MA状态: "在排", BOM款号: "92125-S001", 绑定PO数: 2, 已绑本PO: false },
        { ...ROW, ID: 23, 货号: "92125-S002", PO号: "PO-S2", 单类型: "实单", 关联MA货号: "92125-MA", BOM款号: null, 绑定PO数: 0, 已绑本PO: false },
      ],
      total: 3,
    };
    installFetch(cfg);
    let bomUrl = "";
    const renderApp = () =>
      renderWithProviders(
        <Routes>
          <Route path="/scheduling" element={<SchedulingPage />} />
          <Route path="/bom-setup" element={<BomSetupStub onUrl={(u) => (bomUrl = u)} />} />
        </Routes>,
        "/scheduling",
      );

    // 徽标全部渲染
    renderApp();
    await waitFor(() => expect(screen.getByText("BOM·已绑PO")).toBeInTheDocument());
    expect(screen.getByText("BOM")).toBeInTheDocument();
    expect(screen.getByText("未建BOM")).toBeInTheDocument();
    // 已绑本PO → 查看 BOM(款号=92125-MA)
    fireEvent.click(screen.getByText("BOM·已绑PO"));
    await waitFor(() => expect(bomUrl).toBe("/bom-setup?款号=92125-MA"));
    cleanup();

    // 已建未绑 → 查看 BOM(款号=92125-S001)
    bomUrl = "";
    renderApp();
    await waitFor(() => expect(screen.getByText("BOM·已绑PO")).toBeInTheDocument());
    fireEvent.click(screen.getByText("BOM"));
    await waitFor(() => expect(bomUrl).toBe("/bom-setup?款号=92125-S001"));
    cleanup();

    // 未建 → 跳建档,带 品名/客户/PO/return/单类型/关联MA货号(实单跳入 BOM 页自动切实单版+预选关联MA)
    bomUrl = "";
    renderApp();
    await waitFor(() => expect(screen.getByText("未建BOM")).toBeInTheDocument());
    fireEvent.click(screen.getByText("未建BOM"));
    await waitFor(() => expect(bomUrl).toContain("/bom-setup?款号=92125-S002"));
    expect(bomUrl).toContain("po=PO-S2");
    expect(bomUrl).toContain("return=%2Fscheduling");
    expect(bomUrl).toContain(encodeURIComponent("车子+公仔"));
    expect(bomUrl).toContain(`单类型=${encodeURIComponent("实单")}`);
    expect(bomUrl).toContain("关联MA货号=92125-MA");
  });
});

// ---------- 权限门 ----------

describe("权限门", () => {
  it("无「生产排期·保存」:不渲染「导入排期」", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_IMPORT;
    setup(cfg);
    await waitList();
    expect(screen.queryByText("导入排期")).not.toBeInTheDocument();
    expect(screen.getByText("生产下单")).toBeInTheDocument();
  });

  it("无「生产制单·保存」:行操作不渲染「生产下单」", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_PRODUCE;
    setup(cfg);
    await waitList();
    expect(screen.queryByText("生产下单")).not.toBeInTheDocument();
    expect(screen.getByText("导入排期")).toBeInTheDocument();
  });
});

// ---------- 排期行手工 CRUD ----------

describe("排期行手工 CRUD", () => {
  // 弹窗里的「排期客户」是 input,筛选栏同名是 SearchSelect 按钮,按标签类型区分
  const dlgInput = (label: string) =>
    screen.getAllByLabelText(label).find((el) => el.tagName === "INPUT")!;

  it("新增:必填拦截 → 填排期客户/货号提交 POST /api/scheduling", async () => {
    const calls = setup(baseCfg());
    await waitList();
    fireEvent.click(screen.getByText("新增"));
    // PickerDialog 标题渲染两次(Title + sr-only Description),用 getAllByText 判定
    await waitFor(() =>
      expect(screen.getAllByText("新增排期行").length).toBeGreaterThanOrEqual(1),
    );

    // 排期客户为空 → 前端拦截,不发请求
    fireEvent.click(screen.getByText("确定"));
    expect(screen.getByText("排期客户不能为空")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/scheduling")).toBe(false);

    fireEvent.change(dlgInput("排期客户"), { target: { value: "ZURU" } });
    fireEvent.change(screen.getByLabelText("货号"), { target: { value: "H-NEW" } });
    fireEvent.click(screen.getByText("确定"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/scheduling")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/scheduling")!;
    expect(post.body!.排期客户).toBe("ZURU");
    expect(post.body!.货号).toBe("H-NEW");
    expect(post.body!.状态).toBe("在排"); // 默认状态
    await waitFor(() => expect(screen.getByText("已保存")).toBeInTheDocument());
  });

  it("编辑:弹窗带回原值,改备注提交 PUT /api/scheduling/1", async () => {
    const calls = setup(baseCfg());
    await waitList();
    fireEvent.click(screen.getByText("编辑"));    await waitFor(() =>
      expect(screen.getAllByText("编辑排期行 [18060]").length).toBeGreaterThanOrEqual(1),
    );
    expect(dlgInput("排期客户")).toHaveValue("MOOSE");
    expect(screen.getByLabelText("备注")).toHaveValue("测试备注");
    expect(screen.getByLabelText("走货期")).toHaveValue("2026-09-25");

    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "改过的备注" } });
    fireEvent.click(screen.getByText("确定"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PUT" && c.url === "/api/scheduling/1")).toBe(true),
    );
    const put = calls.find((c) => c.method === "PUT" && c.url === "/api/scheduling/1")!;
    expect(put.body!.排期客户).toBe("MOOSE");
    expect(put.body!.备注).toBe("改过的备注");
    await waitFor(() => expect(screen.getByText("已保存")).toBeInTheDocument());
  });

  it("双击行直接打开编辑弹窗", async () => {
    setup(baseCfg());
    await waitList();
    fireEvent.doubleClick(screen.getByText("车子+公仔"));
    await waitFor(() =>
      expect(screen.getAllByText("编辑排期行 [18060]").length).toBeGreaterThanOrEqual(1),
    );
    expect(dlgInput("排期客户")).toHaveValue("MOOSE");
  });

  it("删除:确认弹窗 → DELETE /api/scheduling/1", async () => {
    const calls = setup(baseCfg());
    await waitList();
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() =>
      expect(screen.getByText(/确认删除排期行 \[18060\]/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("确认删除"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/scheduling/1")).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("已删除")).toBeInTheDocument());
  });

  it("权限门:无保存 → 无「新增/编辑」;无删除 → 无「删除」", async () => {
    const cfg = baseCfg();
    cfg.perms = PERMS_NO_IMPORT; // 保存=false,删除=true
    setup(cfg);
    await waitList();
    expect(screen.queryByText("新增")).not.toBeInTheDocument();
    expect(screen.queryByText("编辑")).not.toBeInTheDocument();
    expect(screen.getByText("删除")).toBeInTheDocument();
    cleanup();

    const cfg2 = baseCfg();
    cfg2.perms = PERMS_NO_DELETE; // 保存=true,删除=false
    setup(cfg2);
    await waitList();
    expect(screen.getByText("新增")).toBeInTheDocument();
    expect(screen.getByText("编辑")).toBeInTheDocument();
    expect(screen.queryByText("删除")).not.toBeInTheDocument();
  });
});

// ---------- 状态变更经理审核 ----------

describe("状态变更经理审核", () => {
  const CH = {
    ID: 7, 排期ID: 1, 原状态: "在排", 新状态: "已走货", 审核状态: "待审核",
    申请人: "ut", 申请日期: "2026-09-20T10:00:00",
    排期客户: "MOOSE", PO号: "1053032", 货号: "18060", 品名: "车子+公仔",
  };

  it("改状态被后端挂起(状态待审核=true):提示「待经理审核」", async () => {
    const cfg = baseCfg();
    cfg.putPends = true;
    setup(cfg);
    await waitList();
    fireEvent.click(screen.getByText("编辑"));
    await waitFor(() =>
      expect(screen.getAllByText("编辑排期行 [18060]").length).toBeGreaterThanOrEqual(1),
    );
    // 筛选栏也有「状态」下拉(显「全部」),弹窗里的带回行值「在排」,按当前文案区分
    const statusBtn = screen
      .getAllByLabelText("状态")
      .find((el) => el.textContent === "在排")!;
    fireEvent.click(statusBtn);
    fireEvent.click(screen.getByRole("option", { name: "已走货" }));
    fireEvent.click(screen.getByText("确定"));
    await waitFor(() =>
      expect(screen.getByText(/状态修改待经理审核/)).toBeInTheDocument(),
    );
  });

  it("行有可待审变更:状态列显「→已走货·待审」;页头「状态审核」带待审数徽章", async () => {
    const cfg = baseCfg();
    cfg.list = { items: [{ ...ROW, 待审新状态: "已走货" }], total: 1 };
    cfg.pending = { 待审数: 2, 是否经理: false };
    setup(cfg);
    await waitList();
    expect(screen.getByText("→已走货·待审")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
  });

  it("经理:审核弹窗列待审申请,点「通过」POST approve", async () => {
    const cfg = baseCfg();
    cfg.pending = { 待审数: 1, 是否经理: true };
    cfg.statusChanges = [CH];
    const calls = setup(cfg);
    await waitList();
    fireEvent.click(screen.getByText("状态审核"));
    await waitFor(() => expect(screen.getByText("ut")).toBeInTheDocument());
    expect(screen.getByText("申请人")).toBeInTheDocument();
    fireEvent.click(screen.getByText("通过"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url === "/api/scheduling/status-changes/7/approve"),
      ).toBe(true),
    );
  });

  it("非经理:审核弹窗只读(无通过/驳回按钮)", async () => {
    const cfg = baseCfg();
    cfg.pending = { 待审数: 1, 是否经理: false };
    cfg.statusChanges = [CH];
    setup(cfg);
    await waitList();
    fireEvent.click(screen.getByText("状态审核"));
    await waitFor(() => expect(screen.getByText("ut")).toBeInTheDocument());
    expect(screen.queryByText("通过")).not.toBeInTheDocument();
    expect(screen.queryByText("驳回")).not.toBeInTheDocument();
    expect(screen.getByText(/仅经理可审核/)).toBeInTheDocument();
  });
});

// ---------- 下生产通知单:三条路径 ----------

describe("排期生成生产通知单 · BOM 按 PO 绑定", () => {
  it("a) BOM 已设且无绑定冲突:直接带入预填,可生成并跳 /production?mo=", async () => {
    const calls = await openProdDialog();
    await waitFor(() =>
      expect(
        (screen.getByLabelText("备注") as HTMLTextAreaElement).value,
      ).toContain("PO=1053032"),
    );
    expect(screen.getByLabelText("计划数量")).toHaveValue(6000);
    expect(screen.getByLabelText("客户编号")).toHaveValue("C-1");
    expect(screen.getByLabelText("客户名称")).toHaveValue("客户一");
    expect(screen.getByLabelText("交货日期")).toHaveValue("2026-09-25");
    expect(screen.getByLabelText("下单日期")).toHaveValue("2026-06-23");
    expect(screen.getByLabelText("订单总箱数")).toHaveValue(3000);

    fireEvent.click(screen.getByText("生成生产通知单"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/production")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/production")!;
    expect(post.body!.合同号).toBe("1053032");
    expect(post.body!.标识).toBe("正单");
    expect(post.body!.客户款号).toBe("18060");
    expect(post.body!.默认单价).toBe("5");
    const lines = post.body!.货号明细 as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0].BOM款号).toBe("18060");
    expect(lines[0].分析).toBe(true);
    expect(lines[0].数量明细).toEqual([{ 数量: 6000 }]);
    // 成功后跳 /production 打开新单
    await waitFor(() =>
      expect(screen.getByText("生产通知单页STUB")).toBeInTheDocument(),
    );
  });

  it("b) BOM 未设:「去建 BOM」真实跳转 /bom-setup(带 款号/品名/客户名称/po/return/单类型/关联MA货号 参数)", async () => {
    const cfg = baseCfg();
    cfg.list = {
      items: [{ ...ROW, 单类型: "实单", 关联MA货号: "18060-MA" }],
      total: 1,
    };
    cfg.bomHeaders = [];
    const calls = installFetch(cfg);
    let bomSetupUrl = "";
    renderWithProviders(
      <Routes>
        <Route path="/scheduling" element={<SchedulingPage />} />
        <Route path="/production" element={<div>生产通知单页STUB</div>} />
        <Route
          path="/bom-setup"
          element={
            <BomSetupStub onUrl={(u) => (bomSetupUrl = u)} />
          }
        />
      </Routes>,
      "/scheduling",
    );
    await waitList();
    fireEvent.click(screen.getByText("生产下单"));
    await waitFor(() =>
      expect(screen.getByText(/该货号还没有建 BOM/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("去建 BOM"));
    // 已跳到 BOM 设置页桩,URL 参数齐全(po 参数供 BOM 保存时作 待绑定PO号)
    await waitFor(() => expect(screen.getByText("BOM设置页STUB")).toBeInTheDocument());
    expect(bomSetupUrl).toContain("/bom-setup?");
    expect(bomSetupUrl).toContain("款号=18060");
    expect(bomSetupUrl).toContain("po=1053032");
    expect(bomSetupUrl).toContain("return=%2Fscheduling");
    // 实单跳入:BOM 页据此自动切实单版 + 预选关联 MA
    expect(bomSetupUrl).toContain(`单类型=${encodeURIComponent("实单")}`);
    expect(bomSetupUrl).toContain("关联MA货号=18060-MA");
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/production")).toBe(false);
  });

  it("c) BOM 已绑别的 PO:弹确认列出已绑定 PO 号,确认前不带入;「取消」停留不带入", async () => {
    const cfg = baseCfg();
    cfg.poBindings = [{ PO号: "PO-OTHER", 绑定时间: "2026-09-01" }];
    const calls = await openProdDialog(cfg);
    await waitFor(() =>
      expect(screen.getByText(/款号 18060 的 BOM 已绑定其他 PO/)).toBeInTheDocument(),
    );
    expect(screen.getByText("PO-OTHER")).toBeInTheDocument();
    expect(screen.getByText(/已绑定 PO：PO-OTHER，是否继续使用？/)).toBeInTheDocument();
    // 确认前表单不带入
    expect(screen.queryByLabelText("备注")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("取消"));
    await waitFor(() =>
      expect(screen.getByText(/该 BOM 已绑定其他 PO,已取消带入/)).toBeInTheDocument(),
    );
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/production")).toBe(false);
  });

  it("c) 点「继续使用」后按原流程带入(与当前 PO 双绑),可生成生产单", async () => {
    const cfg = baseCfg();
    cfg.poBindings = [{ PO号: "PO-OTHER", 绑定时间: "2026-09-01" }];
    const calls = await openProdDialog(cfg);
    await waitFor(() =>
      expect(screen.getByText(/款号 18060 的 BOM 已绑定其他 PO/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("继续使用"));
    await waitFor(() => expect(screen.getByLabelText("备注")).toBeInTheDocument());
    expect((screen.getByLabelText("备注") as HTMLTextAreaElement).value).toContain(
      "PO=1053032",
    );
    fireEvent.click(screen.getByText("生成生产通知单"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/production")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/production")!;
    expect(post.body!.合同号).toBe("1053032");
  });

  it("BOM 仅绑定当前 PO:不弹确认直接带入", async () => {
    const cfg = baseCfg();
    cfg.poBindings = [{ PO号: "1053032", 绑定时间: "2026-09-01" }];
    await openProdDialog(cfg);
    await waitFor(() => expect(screen.getByLabelText("备注")).toBeInTheDocument());
    expect(screen.queryByText(/的 BOM 已绑定其他 PO/)).not.toBeInTheDocument();
  });

  it("po-bindings 查询失败:不阻塞流程,直接带入", async () => {
    const cfg = baseCfg();
    cfg.onCall = (c) =>
      c.url.includes("po-bindings") ? json({ 消息: "boom" }, 500) : undefined;
    await openProdDialog(cfg);
    await waitFor(() => expect(screen.getByLabelText("备注")).toBeInTheDocument());
    expect(screen.queryByText(/的 BOM 已绑定其他 PO/)).not.toBeInTheDocument();
  });
});

// ---------- 排期导入 ----------

describe("排期导入弹窗", () => {
  const CSV = [
    "接单期,国家/客名,Customer,PO号,货号,数量,客PO期,计划验货期",
    "2026-06-23,ROSS,60308543,1053032,18060,6000,2026-09-25,2026-09-18",
  ].join("\n");

  it("选 CSV -> 预览 -> 确认导入 -> POST /scheduling/import -> 结果提示", async () => {
    const calls = setup(baseCfg());
    await waitList();
    fireEvent.click(screen.getByText("导入排期"));
    await waitFor(() => expect(screen.getByText("导入客户排期表")).toBeInTheDocument());

    const file = new File([CSV], "2026年MOOSE排期8-15.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("排期文件"), { target: { files: [file] } });

    // 预览:解析出排期行,文件名猜出排期客户
    await waitFor(() => expect(screen.getByText(/可导入 1 行/)).toBeInTheDocument());
    expect(screen.getByLabelText("导入排期客户")).toHaveValue("MOOSE");

    fireEvent.click(screen.getByText("确认导入"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/scheduling/import")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/scheduling/import")!;
    expect(post.body!.排期客户).toBe("MOOSE");
    expect(post.body!.文件名).toBe("2026年MOOSE排期8-15.csv");
    const rows = post.body!.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].货号).toBe("18060");
    expect(rows[0].数量).toBe(6000);
    expect(rows[0].客PO).toBe("60308543");
    expect(rows[0].走货期).toBe("2026-09-25");
    expect(typeof rows[0].原始数据).toBe("string");
    expect(rows[0].错误).toBeUndefined();

    await waitFor(() =>
      expect(screen.getByText(/导入完成:新增 1 条/)).toBeInTheDocument(),
    );
  });

  it("无排期数据文件:提示未解析到排期数据,不发请求", async () => {
    const calls = setup(baseCfg());
    await waitList();
    fireEvent.click(screen.getByText("导入排期"));
    await waitFor(() => expect(screen.getByText("导入客户排期表")).toBeInTheDocument());

    const file = new File(["a,b\n1,2"], "note.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("排期文件"), { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByText(/未解析到排期数据/)).toBeInTheDocument(),
    );
    expect(calls.some((c) => c.url === "/api/scheduling/import")).toBe(false);
  });
});

// ---------- 按排期表(文件)视图 ----------

describe("按排期表视图", () => {
  it("文件列表 + 展开看货号明细", async () => {
    setup(baseCfg());
    await waitList();
    fireEvent.click(screen.getByText("按排期表"));
    await waitFor(() =>
      expect(screen.getByText("2026年MOOSE排期8-15.xlsx")).toBeInTheDocument(),
    );
    expect(screen.getByText("在排 1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("2026年MOOSE排期8-15.xlsx"));
    await waitFor(() => expect(screen.getByText("18060")).toBeInTheDocument());
    expect(screen.getByText("车子+公仔")).toBeInTheDocument();
  });
});

// ---------- 批次管理 ----------

describe("批次管理", () => {
  it("批次列表 + 确认删除(DELETE /scheduling/batches/{id})", async () => {
    const calls = setup(baseCfg());
    await waitList();
    fireEvent.click(screen.getByText("批次"));
    await waitFor(() =>
      expect(screen.getByText("排期导入批次")).toBeInTheDocument(),
    );
    // 批次列表异步加载,等数据行出现
    await waitFor(() =>
      expect(screen.getByText("2026年MOOSE排期8-15.xlsx")).toBeInTheDocument(),
    );

    // 行操作列也有「删除」按钮;批次弹窗 portal 挂在 body 末尾,取最后一个
    const delBtns = screen.getAllByText("删除");
    fireEvent.click(delBtns[delBtns.length - 1]);
    await waitFor(() =>
      expect(screen.getByText(/删除批次 #1 及其全部 1 行排期/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("确认删除"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url === "/api/scheduling/batches/1"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("批次已删除")).toBeInTheDocument());
  });
});
