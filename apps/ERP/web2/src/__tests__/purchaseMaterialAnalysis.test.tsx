// 采购物料分析页(单据式双模式):
// 列表模式——分页/分析审核徽章/点行进详情;详情模式(?mo=)——表头卡 + 可编辑明细(需订数量/供应商)
// + 保存(PUT) + 审核/反审核 + 按供应商分组下单 + 双门拦截(文案逐字) + 价格位裁剪。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PurchaseMaterialAnalysisPage from "@/pages/PurchaseMaterialAnalysisPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [
  { 组: "业务单据", 菜单: "生产制单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
  { 组: "物料管理", 菜单: "采购订单", 打开: true, 保存: true, 单价: true },
];
const PERMS_NO_PRICE = [{ 组: "业务单据", 菜单: "生产制单", 打开: true, 保存: true, 单价: false }];
const PERMS_NO_AUDIT = [
  { 组: "业务单据", 菜单: "生产制单", 打开: true, 保存: true, 审核: false, 反审核: false, 单价: true },
  { 组: "物料管理", 菜单: "采购订单", 打开: true, 保存: true, 单价: true },
];

const PRODUCTIONS = {
  items: [
    { ID: 1, 生产单号: "MO-OK", 款号: "K1", 款式: "恐龙", 客户款号: "CK1", 合同号: "HT1", 日期: "2026-09-01", 交货日期: "2026-10-01", 计划数量: 100, 制单人: "tester", 审核: "1", 采购分析审核: "1", 采购分析审核人: "boss", 采购分析审核时间: "2026-09-03 10:00:00" },
    { ID: 2, 生产单号: "MO-NO", 款号: "K2", 款式: "小车", 客户款号: "CK2", 合同号: "HT2", 日期: "2026-09-02", 交货日期: "2026-10-02", 计划数量: 50, 制单人: "tester", 审核: "0", 采购分析审核: "0" },
    { ID: 3, 生产单号: "MO-PEND", 款号: "K3", 款式: "卡车", 客户款号: "CK3", 合同号: "HT3", 日期: "2026-09-03", 交货日期: "2026-10-03", 计划数量: 60, 制单人: "tester", 审核: "1", 采购分析审核: "0" },
  ],
  total: 3,
};

const HEAD_OF: Record<string, unknown> = {
  "MO-OK": {
    单头: { 生产单号: "MO-OK", 款号: "K1", 款式: "恐龙", 客户名称: "客户甲", 客户款号: "CK1", 合同号: "HT1", 日期: "2026-09-01", 交货日期: "2026-10-01", 计划数量: 100, 制单人: "tester", 审核: "1", 采购分析审核: "1", 采购分析审核人: "boss" },
  },
  "MO-NO": {
    单头: { 生产单号: "MO-NO", 款号: "K2", 款式: "小车", 客户名称: "客户乙", 客户款号: "CK2", 合同号: "HT2", 日期: "2026-09-02", 交货日期: "2026-10-02", 计划数量: 50, 制单人: "tester", 审核: "0", 采购分析审核: "0" },
  },
  "MO-PEND": {
    单头: { 生产单号: "MO-PEND", 款号: "K3", 款式: "卡车", 客户名称: "客户丙", 客户款号: "CK3", 合同号: "HT3", 日期: "2026-09-03", 交货日期: "2026-10-03", 计划数量: 60, 制单人: "tester", 审核: "1", 采购分析审核: "0" },
  },
};

const ANALYSIS = [
  // M1 已下满(已订80=需订80)→ 显示「已下单」徽标,默认不勾可手勾追加;M2 不足默认勾;M3 库存0锁定必勾
  { ID: 1, 生产单号: "MO-OK", 物料编号: "M1", 物料名称: "彩盒", 规格: "大", 颜色: "红", 单位: "PCS", 总数量: 100, 可用库存: 120, 需订数量: 80, 预算单价: 1.5, 金额: 119.5, 供应商编号: "S1", 供应商名称: "供应商甲", 已订数量: 80 },
  { ID: 2, 生产单号: "MO-OK", 物料编号: "M2", 物料名称: "说明书", 规格: "", 颜色: "", 单位: "PCS", 总数量: 100, 可用库存: 10, 需订数量: 90, 预算单价: 0.5, 金额: 45, 供应商编号: "S2", 供应商名称: "供应商乙", 已订数量: 0 },
  { ID: 3, 生产单号: "MO-OK", 物料编号: "M3", 物料名称: "胶带", 规格: "", 颜色: "", 单位: "PCS", 总数量: 30, 可用库存: 0, 需订数量: 20, 预算单价: 0.2, 金额: 6, 供应商编号: "", 供应商名称: "", 已订数量: 0 },
];

const SUPPLIERS = {
  items: [
    { 供应商编号: "S1", 供应商名称: "供应商甲" },
    { 供应商编号: "S2", 供应商名称: "供应商乙" },
    { 供应商编号: "S3", 供应商名称: "供应商丙" },
  ],
  total: 3,
};

type Call = { url: string; method: string; body?: Record<string, unknown> };

function installFetch(perms: unknown = PERMS_FULL, analysis: unknown = ANALYSIS) {
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
      const u = new URL(url, "http://test");
      const p = u.pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/production") return json(PRODUCTIONS);
      if (p === "/api/production-reports/purchase-analysis" && method === "GET")
        return json(analysis);
      if (p === "/api/production-reports/purchase-analysis" && method === "PUT")
        return json({ 更新行数: (body?.明细 as unknown[] | undefined)?.length ?? 0 });
      if (p.endsWith("/purchase-analysis-audit") && method === "POST")
        return new Response(null, { status: 204 });
      if (p.endsWith("/purchase-analysis-unaudit") && method === "POST")
        return new Response(null, { status: 204 });
      if (p === "/api/master/suppliers") return json(SUPPLIERS);
      const moMatch = p.match(/^\/api\/production\/([^/]+)$/);
      if (moMatch && method === "GET") {
        const mo = decodeURIComponent(moMatch[1]);
        return HEAD_OF[mo] ? json(HEAD_OF[mo]) : json({ 消息: "不存在" }, 404);
      }
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>;
}

const setup = (perms?: unknown, start = "/purchase-material-analysis", analysis?: unknown) => {
  const calls = installFetch(perms, analysis);
  renderWithProviders(
    <>
      <PurchaseMaterialAnalysisPage />
      <LocationProbe />
    </>,
    start,
  );
  return calls;
};

// 从列表点款式单元格进详情
const openDetail = async (款式: string, mo: string, waitText = "彩盒") => {
  await screen.findByText(mo); // 等列表渲染
  fireEvent.click(screen.getByText(款式));
  await screen.findByText(`采购分析单 · ${mo}`, { exact: false });
  await screen.findByText(waitText);
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("列表模式", () => {
  it("渲染:分析审核徽章;点行跳详情页(?mo=)", async () => {
    setup();
    await screen.findByText("MO-OK");
    expect(screen.getByText("已审核")).toBeInTheDocument();
    expect(screen.getAllByText("未审核").length).toBe(2);
    expect(screen.getByText("共 3 条")).toBeInTheDocument();

    fireEvent.click(screen.getByText("恐龙"));
    await waitFor(() =>
      expect(screen.getByTestId("loc").textContent).toBe("/purchase-material-analysis?mo=MO-OK"),
    );
    await screen.findByText("彩盒");
    // 单据式表头卡
    expect(screen.getByText("客户甲")).toBeInTheDocument();
    expect(screen.getByText("计划数量")).toBeInTheDocument();
  });

  it("生产单号列点击跳 /production?mo=(不触发行点击)", async () => {
    setup();
    await screen.findByText("MO-OK");
    fireEvent.click(screen.getByRole("button", { name: "MO-OK" }));
    await waitFor(() =>
      expect(screen.getByTestId("loc").textContent).toBe("/production?mo=MO-OK"),
    );
  });

  it("无 打开 权限:显示无权访问", async () => {
    setup([]);
    await waitFor(() => expect(screen.getByText("无权访问该页面")).toBeInTheDocument());
  });

  it("路径门:不在本页路径时 mo 参数不生效(keep-alive 隐藏页防互踩)", async () => {
    setup(PERMS_FULL, "/production?mo=MO-OK");
    await screen.findByText("MO-OK"); // 列表模式照常渲染
    expect(screen.queryByText(/采购分析单 ·/)).toBeNull(); // 不进详情
  });
});

describe("详情模式", () => {
  it("未审核(MO-PEND):需订数量可改,改后保存发 PUT,合计实时刷新", async () => {
    const calls = setup();
    await openDetail("卡车", "MO-PEND");
    const input = screen.getByLabelText("需订数量 M1");
    expect(input).not.toBeDisabled();
    fireEvent.change(input, { target: { value: "88" } });
    // 合计 88+90+20=198
    expect(screen.getByText("198")).toBeInTheDocument();
    const saveBtn = screen.getByRole("button", { name: "保存" });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);
    await waitFor(() => {
      const put = calls.find(
        (c) => c.method === "PUT" && c.url.includes("/api/production-reports/purchase-analysis"),
      );
      expect(put).toBeTruthy();
      expect(put!.body!.生产单号).toBe("MO-PEND");
      const lines = put!.body!.明细 as { ID: number; 需订数量: number }[];
      expect(lines.find((l) => l.ID === 1)!.需订数量).toBe(88);
    });
    await screen.findByText(/采购分析已保存/);
  });

  it("已审核(MO-OK):明细只读、保存禁用、显示「反审核」不显示「审核」", async () => {
    setup();
    await openDetail("恐龙", "MO-OK");
    expect(screen.getByLabelText("需订数量 M1")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "反审核" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审核" })).toBeNull();
    expect(screen.getByText(/已审核的分析单为只读/)).toBeInTheDocument();
  });

  it("审核:未审核分析点「审核」调接口;脏数据时禁用并提示先保存", async () => {
    const calls = setup();
    await openDetail("卡车", "MO-PEND");
    const auditBtn = screen.getByRole("button", { name: "审核" });
    expect(auditBtn).not.toBeDisabled();
    // 脏数据禁用
    fireEvent.change(screen.getByLabelText("需订数量 M1"), { target: { value: "81" } });
    expect(screen.getByRole("button", { name: "审核" })).toBeDisabled();
    // 还原后点审核
    fireEvent.change(screen.getByLabelText("需订数量 M1"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" && c.url.includes("/api/production/MO-PEND/purchase-analysis-audit"),
        ),
      ).toBe(true),
    );
    await screen.findByText("采购分析单 MO-PEND 已审核");
  });

  it("生产通知单未审核(MO-NO):「审核」按钮禁用", async () => {
    setup();
    await openDetail("小车", "MO-NO");
    expect(screen.getByRole("button", { name: "审核" })).toBeDisabled();
  });

  it("反审核:已审核分析点「反审核」调接口并提示", async () => {
    const calls = setup();
    await openDetail("恐龙", "MO-OK");
    fireEvent.click(screen.getByRole("button", { name: "反审核" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url.includes("/api/production/MO-OK/purchase-analysis-unaudit"),
        ),
      ).toBe(true),
    );
    await screen.findByText(/已反审核，可修改明细后重新审核/);
  });

  it("无「审核/反审核」权限位:两个按钮都不渲染", async () => {
    setup(PERMS_NO_AUDIT);
    await openDetail("卡车", "MO-PEND");
    expect(screen.queryByRole("button", { name: "审核" })).toBeNull();
    expect(screen.queryByRole("button", { name: "反审核" })).toBeNull();
  });

  it("下采购订单:分析未审核拦截(文案逐字);已审核跳 /purchase-orders?basis= 并带勾选行", async () => {
    setup();
    await openDetail("卡车", "MO-PEND");
    fireEvent.click(screen.getByRole("button", { name: "下采购订单" }));
    await screen.findByText("采购分析单 MO-PEND 未审核，请先点「审核」");
    expect(screen.getByTestId("loc").textContent).toBe("/purchase-material-analysis?mo=MO-PEND");

    // 已审核单放行:默认勾选 M2(不足)+M3(库存0锁定),行参数=2,3
    fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
    await screen.findByText("MO-OK");
    await openDetail("恐龙", "MO-OK");
    fireEvent.click(screen.getByRole("button", { name: "下采购订单" }));
    await waitFor(() => {
      const loc = decodeURIComponent(screen.getByTestId("loc").textContent ?? "");
      expect(loc).toContain("/purchase-orders?basis=MO-OK");
      expect(loc).toContain("行=2,3");
    });
  });

  it("按供应商分组:chip 列出各组行数与需订合计;已下满组显示「已全部下单·可追加」不禁用;点供应商 chip 带参跳采购订单", async () => {
    setup();
    await openDetail("恐龙", "MO-OK");
    // M1 已下满 → 供应商甲组可追加下单(订单同时进行),不再禁用
    const gA = screen.getByRole("button", { name: /供应商甲.*已全部下单·可追加/ });
    expect(gA).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /供应商乙.*1 行.*需订90/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /未绑定供应商.*1 行.*需订20/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /供应商乙/ }));
    await waitFor(() => {
      const loc = decodeURIComponent(screen.getByTestId("loc").textContent ?? "");
      expect(loc).toContain("/purchase-orders?basis=MO-OK");
      expect(loc).toContain("供应商编号=S2");
      expect(loc).toContain("供应商名称=供应商乙");
    });
  });

  it("已下满行可追加下单:手勾后点供应商 chip 带已下满行跳采购订单(订单同时进行,不用等物料回来)", async () => {
    setup();
    await openDetail("恐龙", "MO-OK");
    // M1 已下满默认不勾;手勾后随全部勾选行带入采购订单(那边保存时再弹重复下单确认)
    const cb1 = screen.getByLabelText("订购 M1");
    expect(cb1).not.toBeChecked();
    fireEvent.click(cb1);
    fireEvent.click(screen.getByRole("button", { name: /供应商甲/ }));
    await waitFor(() => {
      const loc = decodeURIComponent(screen.getByTestId("loc").textContent ?? "");
      expect(loc).toContain("/purchase-orders?basis=MO-OK");
      expect(loc).toContain("行=1,2,3");
      expect(loc).toContain("供应商编号=S1");
    });
  });

  it("点未绑定 chip:不带供应商参数跳采购订单(带勾选行)", async () => {
    setup();
    await openDetail("恐龙", "MO-OK");
    fireEvent.click(screen.getByRole("button", { name: /未绑定供应商/ }));
    await waitFor(() => {
      const loc = decodeURIComponent(screen.getByTestId("loc").textContent ?? "");
      expect(loc).toContain("/purchase-orders?basis=MO-OK");
      expect(loc).toContain("行=2,3");
      expect(loc).not.toContain("供应商编号");
    });
  });

  it("订购勾选:已下满显示「已下单」徽标+默认不勾可手勾追加/库存0锁定必勾/不足默认勾可取消;全不勾拦截下单", async () => {
    setup();
    await openDetail("恐龙", "MO-OK");
    // M1 已订80=需订80 → 已下单徽标 + 勾选框(默认不勾,可手勾追加下单)
    expect(screen.getByText("已下单")).toBeInTheDocument();
    const cb1 = screen.getByLabelText("订购 M1");
    expect(cb1).not.toBeChecked();
    expect(cb1).not.toBeDisabled();
    // M3 可用0 需订20 → 锁定必勾;M2 10<90 → 默认勾可取消
    const cb3 = screen.getByLabelText("订购 M3");
    expect(cb3).toBeChecked();
    expect(cb3).toBeDisabled();
    const cb2 = screen.getByLabelText("订购 M2");
    expect(cb2).toBeChecked();
    expect(cb2).not.toBeDisabled();
    // 取消 M2 后只剩 M3 下单
    fireEvent.click(cb2);
    fireEvent.click(screen.getByRole("button", { name: "下采购订单" }));
    await waitFor(() => {
      const loc = decodeURIComponent(screen.getByTestId("loc").textContent ?? "");
      expect(loc).toContain("行=3");
      expect(loc).not.toContain("行=1");
    });
  });

  it("库存够且未下单的行:默认不勾可手勾(防库存时点误差)", async () => {
    // M1 库存够(120>=80)且未下单
    setup(PERMS_FULL, "/purchase-material-analysis", [
      { ID: 9, 生产单号: "MO-OK", 物料编号: "M9", 物料名称: "彩带", 单位: "PCS", 总数量: 10, 可用库存: 50, 需订数量: 10, 预算单价: 1, 金额: 10, 供应商编号: "S1", 供应商名称: "供应商甲", 已订数量: 0 },
    ]);
    await openDetail("恐龙", "MO-OK", "彩带");
    const cb = screen.getByLabelText("订购 M9");
    expect(cb).not.toBeChecked();
    expect(cb).not.toBeDisabled();
    fireEvent.click(cb);
    expect(cb).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "下采购订单" }));
    await waitFor(() => {
      const loc = decodeURIComponent(screen.getByTestId("loc").textContent ?? "");
      expect(loc).toContain("行=9");
    });
  });

  it("勾选为空:点「下采购订单」拦截(文案逐字)", async () => {
    // 只有库存够的行(默认不勾),全不勾
    setup(PERMS_FULL, "/purchase-material-analysis", [
      { ID: 9, 生产单号: "MO-OK", 物料编号: "M9", 物料名称: "彩带", 单位: "PCS", 总数量: 10, 可用库存: 50, 需订数量: 10, 预算单价: 1, 金额: 10, 供应商编号: "S1", 供应商名称: "供应商甲" },
    ]);
    await openDetail("恐龙", "MO-OK", "彩带");
    expect(screen.getByLabelText("订购 M9")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "下采购订单" }));
    await screen.findByText("请勾选要订购的物料行");
    expect(screen.getByTestId("loc").textContent).toBe("/purchase-material-analysis?mo=MO-OK");
  });

  it("行供应商绑定:选定即自动保存该行(同步默认供应商),并支持解绑自动保存", async () => {
    const calls = setup();
    await openDetail("卡车", "MO-PEND");
    // 胶带行(未绑定)点「选」→ 选择供应商丙 → 立即 PUT 单行(带同步标记)
    const tapeRow = screen.getByText("胶带").closest("tr")!;
    fireEvent.click(within(tapeRow).getByRole("button", { name: "选" }));
    const dlg = await screen.findByRole("dialog", { name: /选择供应商/ });
    fireEvent.click((await within(dlg).findByText("供应商丙")).closest("tr")!);
    await within(tapeRow).findByText("供应商丙");
    await waitFor(() => {
      const put = calls.find(
        (c) => c.method === "PUT" && c.url.includes("/api/production-reports/purchase-analysis"),
      );
      expect(put).toBeTruthy();
      expect(put!.body!.同步物料默认供应商).toBe(true);
      const lines = put!.body!.明细 as { ID: number; 供应商编号?: string }[];
      expect(lines).toHaveLength(1);
      expect(lines[0].ID).toBe(3);
      expect(lines[0].供应商编号).toBe("S3");
    });
    await screen.findByText(/已绑定供应商 供应商丙/);
    // 已自动保存 → 该行不再算脏,保存按钮禁用
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    // 解绑也即时保存(不同步主档)
    fireEvent.click(within(tapeRow).getByRole("button", { name: /解绑供应商/ }));
    await waitFor(() => {
      const puts = calls.filter(
        (c) => c.method === "PUT" && c.url.includes("/api/production-reports/purchase-analysis"),
      );
      expect(puts.length).toBe(2);
      expect(puts[1].body!.同步物料默认供应商).toBe(false);
      const lines = puts[1].body!.明细 as { ID: number; 供应商编号?: string }[];
      expect(lines[0].ID).toBe(3);
      expect(lines[0].供应商编号).toBeUndefined();
    });
    await within(tapeRow).findByText("未绑定");
  });

  it("无「单价」位:详情不渲染 预算单价/金额 列", async () => {
    setup(PERMS_NO_PRICE);
    await openDetail("恐龙", "MO-OK");
    expect(screen.queryByText("预算单价")).not.toBeInTheDocument();
    expect(screen.queryByText("金额")).not.toBeInTheDocument();
  });
});
