// 塑胶采购分析页:对照老系统 web/src/pages/plastics/PlasticMaterialAnalysisPage.tsx。
// 场景:生产单列表(点已审核行开采购下单抽屉,basis 预填+默认勾选规则;未审核行拦截 toast)、
// 加工件发外需求(计算 -> 勾选 -> 加工厂必填校验 -> 生成加工采购单 POST 载荷,跳过提示)、
// 无「单价」位不出单价列、无权访问。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticMaterialAnalysisPage from "@/pages/PlasticMaterialAnalysisPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [
  { 组: "塑胶采购", 菜单: "塑胶物料单", 打开: true, 保存: true, 单价: true },
  // 采购下单抽屉权限菜单=塑胶采购订单(与塑胶采购订单页共用)
  { 组: "塑胶采购", 菜单: "塑胶采购订单", 打开: true, 保存: true },
];

const ORDERS = {
  items: [
    { ID: 1, 生产单号: "MO-1", 款号: "K1", 款式: "玩具车", 客户名称: "客户A", 合同号: "HT-1", 计划数量: 1000, 日期: "2026-09-01", 交货日期: "2026-09-20", 审核: "1", 已下单: false },
    { ID: 2, 生产单号: "MO-2", 款号: "K2", 款式: "飞机", 客户名称: "客户B", 合同号: "HT-2", 计划数量: 500, 日期: "2026-09-02", 审核: "0", 已下单: false },
    { ID: 3, 生产单号: "MO-3", 款号: "K3", 款式: "轮船", 客户名称: "客户C", 合同号: "HT-3", 计划数量: 300, 日期: "2026-09-03", 审核: "1", 已下单: true, 采购单号: "PPO-X" },
  ],
  total: 3,
};

// basis:M1 已订 5(默认不勾),M2 库存够(默认不勾),M3 正常(默认勾);M1/M3 同模 GM1(一套模明细面板用)
const BASIS = [
  { 生产单号: "MO-1", 款号: "K1", 物料编号: "M1", 物料名称: "齿轮", 计划数量: 1000, 用量: 0.2, 合同号: "HT-1", 已订数量: 5, 可用库存: 0, 模具编号: "GM1", 出模数: 4 },
  { 生产单号: "MO-1", 款号: "K1", 物料编号: "M2", 物料名称: "胶壳", 计划数量: 100, 用量: 1, 合同号: "HT-1", 可用库存: 500 },
  { 生产单号: "MO-1", 款号: "K1", 物料编号: "M3", 物料名称: "胶盖", 计划数量: 100, 用量: 1, 合同号: "HT-1", 可用库存: 0, 模具编号: "GM1", 出模数: 2 },
];

const DEMAND = [
  { 生产单号: "MO-1", 款号: "K1", 工模编号: "MJ1", 物料编号: "D1", 物料名称: "喷油件", 颜色: "黑", 加工内容: "喷油", 加工次序: "第一次", 加工字母: "D", 需求量: 100, 白件库存: 20, 已发未回: 10, 需发数量: 70, 出模数: 8 },
  { 生产单号: "MO-1", 款号: "K1", 工模编号: "MJ2", 物料编号: "D2", 物料名称: "电镀件", 颜色: "银", 加工内容: "电镀", 需求量: 50, 白件库存: 50, 已发未回: 0, 需发数量: 0 },
];

const PRODUCTIONS = {
  items: [
    { 生产单号: "MO-1", 款号: "K1", 客户名称: "客户A", 审核: "1" },
    { 生产单号: "MO-2", 款号: "K2", 客户名称: "客户B", 审核: "0" },
  ],
  total: 2,
};

const FACTORIES = { items: [{ 加工厂编号: "F1", 加工厂名称: "龙昌加工厂" }], total: 1 };

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/plastic-material-docs/orders") {
        // 服务端按 下单情况 分组过滤(未下单=未保存/已下单=已保存)
        const q = new URL(url, "http://test").searchParams.get("下单情况");
        const items = ORDERS.items.filter((r) =>
          q === "已下单" ? r.已下单 : q === "未下单" ? !r.已下单 : true,
        );
        return json({ items, total: items.length });
      }
      if (p === "/api/production") return json(PRODUCTIONS);
      if (p === "/api/master/factories") return json(FACTORIES);
      if (p === "/api/plastic-process-demand") return json(DEMAND);
      if (p === "/api/plastic-process-demand/create-orders")
        return json({ 单号列表: ["PO-D1"], 跳过: 1 });
      if (p === "/api/plastic-purchase-orders/basis") return json(BASIS);
      if (p === "/api/plastic-purchase-orders/processing-contents") return json(["喷油"]);
      if (p === "/api/plastic-purchase-orders") return json({ 单号: "PPO-NEW" });
      if (p === "/api/master/suppliers")
        return json({ items: [{ 供应商编号: "S1", 供应商名称: "恒科" }], total: 1 });
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (perms?: unknown) => {
  const calls = installFetch(perms ?? PERMS_FULL);
  renderWithProviders(<PlasticMaterialAnalysisPage />, "/plastic-material-analysis");
  return calls;
};

// SearchSelect:点开按钮再点选项(替代原生 select 的 fireEvent.change)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlasticMaterialAnalysisPage", () => {
  it("生产单列表:已审核/未审核徽章;默认本月区间参数", async () => {
    const calls = setup();
    await screen.findByText("MO-1");
    expect(screen.getByText("玩具车")).toBeInTheDocument();
    expect(screen.getByText("已审核")).toBeInTheDocument();
    expect(screen.getByText("未审核")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/plastic-material-docs/orders?"))).toBe(true);
  });

  it("下单分组:默认未保存;已保存行可再开抽屉追加下单(行级已订防重)", async () => {
    const calls = setup();
    await screen.findByText("MO-1");
    // 默认「未保存」:只出未下单行,MO-3 已下单不出现;请求带 下单情况=未下单
    expect(screen.queryByText("MO-3")).not.toBeInTheDocument();
    expect(
      calls.some((c) => decodeURIComponent(c.url).includes("下单情况=未下单")),
    ).toBe(true);
    // 切「已保存」:MO-3 出现(已保存徽章+追加下单按钮),MO-1 消失
    fireEvent.click(screen.getByRole("button", { name: "已保存" }));
    await screen.findByText("MO-3");
    expect(screen.queryByText("MO-1")).not.toBeInTheDocument();
    expect(
      calls.some((c) => decodeURIComponent(c.url).includes("下单情况=已下单")),
    ).toBe(true);
    // 点已保存行:不再拦截,直接开抽屉追加下单(行内 已订数量 默认不勾防重)
    fireEvent.click(screen.getByText("MO-3").closest("tr")!);
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("塑胶采购订单(新建) · MO-3");
    expect(screen.queryByText(/不能重复下单/)).not.toBeInTheDocument();
    // 关抽屉(Esc)后切回「未保存」:MO-1 恢复可下单
    fireEvent.keyDown(dlg, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "未保存" }));
    await screen.findByText("MO-1");
  });

  it("点未审核行:拦截 toast 不开抽屉;点已审核行:开抽屉并按默认勾选规则勾选", async () => {
    setup();
    await screen.findByText("MO-2");
    fireEvent.click(screen.getByText("MO-2").closest("tr")!);
    await screen.findByText("生产通知单 MO-2 未审核,审核后才能采购下单");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("MO-1").closest("tr")!);
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("塑胶采购订单(新建) · MO-1");
    // basis 预填:数量=计划数量×用量;PO号=合同号
    await screen.findByDisplayValue("200"); // M1: 1000*0.2
    expect(screen.getByLabelText("PO号")).toHaveValue("HT-1");
    // 默认勾选:M1 已订 5 不勾,M2 库存 500>=100 不勾,M3 勾
    expect(screen.getByLabelText("选择 M1")).not.toBeChecked();
    expect(screen.getByLabelText("选择 M2")).not.toBeChecked();
    expect(screen.getByLabelText("选择 M3")).toBeChecked();
    expect(screen.getByText("已下单 5")).toBeInTheDocument();
  });

  it("抽屉:计算库存默认勾(订购数量=需求−可用库存,库存够变0);取消恢复需求;一套模明细面板联动", async () => {
    setup();
    await screen.findByText("MO-1");
    fireEvent.click(screen.getByText("MO-1").closest("tr")!);
    const dlg = await screen.findByRole("dialog");
    // 需求:M1=1000×0.2=200(库存0→200),M2=100(库存500→0),M3=100(库存0→100)
    await waitFor(() => expect(screen.getByLabelText("订购数量 M1")).toHaveValue(200));
    expect(screen.getByLabelText("订购数量 M2")).toHaveValue(0);
    expect(screen.getByLabelText("订购数量 M3")).toHaveValue(100);
    // 需求数量列原样显示基准需求
    expect(screen.getByText("胶壳").closest("tr")!.textContent).toContain("100");
    // 默认勾选按需求判定:扣减后 M2 数量为 0 仍不勾(库存已够需求)
    expect(screen.getByLabelText("选择 M2")).not.toBeChecked();
    // 取消「计算库存」:恢复全量需求;再勾回:重新扣减
    fireEvent.click(screen.getByLabelText("计算库存"));
    expect(screen.getByLabelText("订购数量 M2")).toHaveValue(100);
    fireEvent.click(screen.getByLabelText("计算库存"));
    expect(screen.getByLabelText("订购数量 M2")).toHaveValue(0);
    // 一套模明细:GM1 组两个配件(齿轮 200 件/4 出模=50 啤;胶盖 100 件/2 出模=50 啤,平衡)
    expect(dlg).toHaveTextContent("同模分组(一套模明细 · 啤数/堵模)");
    const panel = screen.getByText("同模分组(一套模明细 · 啤数/堵模)").closest("div.f-panel")!;
    const gm1 = within(panel as HTMLElement).getByText("GM1").closest("tr")!;
    expect(gm1.textContent).toContain("齿轮");
    expect(gm1.textContent).toContain("50");
    expect(panel.textContent).toContain("胶盖");
    expect(panel.textContent).toContain("平衡 · 无需堵模");
  });

  it("抽屉保存:只提交勾选行;POST /plastic-purchase-orders 载荷", async () => {
    const calls = setup();
    await screen.findByText("MO-1");
    fireEvent.click(screen.getByText("MO-1").closest("tr")!);
    await screen.findByRole("dialog");
    await screen.findByDisplayValue("200"); // M1: 1000*0.2
    // 选供应商(共享供应商选择器,/api/master/suppliers 桩)
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    await screen.findByText("S1");
    fireEvent.click(screen.getByText("恒科").closest("tr")!);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/plastic-purchase-orders") && c.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.供应商编号).toBe("S1");
      expect(body.编号).toBe("HT-1");
      expect(body.加工类型).toBe("一次加工");
      // 只有 M3 勾选
      expect(body.明细).toHaveLength(1);
      expect(body.明细[0]).toMatchObject({ 物料编号: "M3", 数量: 100, 生产单号: "MO-1" });
    });
    await screen.findByText("塑胶采购订单已创建:PPO-NEW");
  });

  it("加工件发外需求:计算 -> 行渲染(需发数量红粗) -> 加工厂必填 -> 生成 POST 载荷(只交需发>0 且勾选行)", async () => {
    const calls = setup();
    await screen.findByText("MO-1");
    // 选生产单号(下拉只列已审核)
    fireEvent.click(screen.getByLabelText("生产单号(已审核)"));
    expect(screen.getByRole("option", { name: "MO-1 K1/客户A" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /MO-2/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "MO-1 K1/客户A" }));
    fireEvent.click(screen.getByRole("button", { name: /计算发外需求/ }));
    await screen.findByText("喷油件");
    expect(screen.getByText("70").className).toContain("text-[#dc2626]");
    // 啤数=⌈需发/出模数⌉:D1 ⌈70/8⌉=9;D2 无出模数留空
    expect(screen.getByText("啤数")).toBeInTheDocument();
    const d1Row = screen.getByText("喷油件").closest("tr")!;
    expect(d1Row.textContent).toContain("9");
    const d2Row = screen.getByText("电镀件").closest("tr")!;
    expect(d2Row.textContent).not.toContain("啤");
    // 勾选两行(D1 需发 70 / D2 需发 0)
    fireEvent.click(screen.getByLabelText("选择 D1"));
    fireEvent.click(screen.getByLabelText("选择 D2"));
    // 未选加工厂 -> 拦截
    fireEvent.click(screen.getByRole("button", { name: "生成加工采购单" }));
    await screen.findByText("物料 D1 未选择加工厂");
    pickOption("加工厂 D1", "F1 龙昌加工厂");
    fireEvent.change(screen.getByLabelText("单价 D1"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "生成加工采购单" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.includes("create-orders") && c.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.生产单号).toBe("MO-1");
      // D2 需发数量 0 被滤掉
      expect(body.行).toHaveLength(1);
      expect(body.行[0]).toMatchObject({ 物料编号: "D1", 数量: 70, 加工厂编号: "F1", 加工厂名称: "龙昌加工厂", 单价: 2.5 });
    });
    await screen.findByText(/已生成加工采购单:PO-D1,跳过 1 行/);
  });

  it("无「单价」位:发外需求不出单价列", async () => {
    setup([{ 组: "塑胶采购", 菜单: "塑胶物料单", 打开: true, 保存: true }]);
    await screen.findByText("MO-1");
    pickOption("生产单号(已审核)", "MO-1 K1/客户A");
    fireEvent.click(screen.getByRole("button", { name: /计算发外需求/ }));
    await screen.findByText("喷油件");
    expect(screen.queryByLabelText("单价 D1")).not.toBeInTheDocument();
  });

  it("无「打开」权限:整页无权提示", async () => {
    setup([]);
    await screen.findByText("无权访问该页面");
  });
});
