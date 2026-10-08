// 原料生产需求表 + 原料生产需求汇总:对照老系统 PlasticRawMaterialDemandPage/DemandSummaryPage。
// 需求表:保存校验(制单人必填/至少一行有效明细)、POST 载荷、?open= 直开查看、审核/反审核 POST、
// 选原料带出 原料名称/单位、合计行。
// 汇总:默认本月 + 列表渲染 + 合计(需求数量KG/包)、双击行弹原料需求表详情(单头+明细+合计)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticRawMaterialDemandPage from "@/pages/PlasticRawMaterialDemandPage";
import PlasticRawMaterialDemandSummaryPage from "@/pages/PlasticRawMaterialDemandSummaryPage";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => {
    const size = opts.estimateSize();
    return {
      getTotalSize: () => opts.count * size,
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, i) => ({ index: i, start: i * size, size, key: i })),
      measure: () => {},
    };
  },
}));

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const PERMS = [
  { 组: "原料仓库", 菜单: "原料生产需求表", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true },
  { 组: "原料报表", 菜单: "原料生产需求汇总", 打开: true },
];

const HEADER = {
  id: 1,
  单号: "D-001",
  啤机生产单号: "PJ-100",
  开单日期: "2026-09-10",
  制单人: "张三",
  领料备注: "生产领料",
  生产车间: "一车间",
  操作员: "tester",
  数量KG: 50,
  数量包: 2,
  审核: "0",
};
const DETAIL = {
  单头: HEADER,
  明细: [
    { id: 11, 原料编号: "RM-1", 原料名称: "ABS 757", 每包重量: 25, 单位: "KG", 需求数量KG: 50, 需求数量包: 2, 备注: "急" },
  ],
};
const SUMMARY_ROW = {
  单号: "D-001",
  开单日期: "2026-09-10",
  生产车间: "一车间",
  领料备注: "生产领料",
  啤机生产单号: "PJ-100",
  原料编号: "RM-1",
  原料名称: "ABS 757",
  每包重量: 25,
  单位: "KG",
  需求数量KG: 50,
  需求数量包: 2,
  备注: "急",
  制单人: "张三",
  操作员: "tester",
  审核: "1",
};

type Call = { url: string; method: string; body?: string };

function installFetch(perms: unknown[] = PERMS) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/plastic-raw-material-demand/summary") return json([SUMMARY_ROW]);
      if (p === "/api/plastic-raw-material-demand") {
        if (init?.method === "POST") return json({ 单号: "D-NEW" });
        return json({ items: [HEADER], total: 1 });
      }
      if (p === "/api/plastic-raw-material-demand/D-001") return json(DETAIL);
      if (p.endsWith("/approve") || p.endsWith("/unapprove")) return json({});
      if (p === "/api/master/employees") return json({ items: [{ 编号: "E1", 姓名: "张三" }], total: 1 });
      if (p === "/api/plastic-raw-material-master")
        return json({
          items: [{ ID: 7, 物料编号: "RM-1", 物料名称: "ABS 757", 规格: "25KG/包", 单位: "KG", 库存: 350 }],
          total: 1,
        });
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlasticRawMaterialDemandPage(原料生产需求表)", () => {
  it("保存校验:制单人必填 -> 至少一行有效明细;选原料带出名称/单位后 POST 载荷", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialDemandPage />, "/plastic-raw-material-demand");
    await screen.findByText("原料生产需求表(新建)");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选制单人");
    // 选制单人(人事档案选择器)
    const pickBtns = screen.getAllByRole("button", { name: "选择" });
    fireEvent.click(pickBtns[0]);
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("张三"));
    fireEvent.click(screen.getByText("张三").closest("tr")!);
    await waitFor(() => expect(screen.getByLabelText("制单人")).toHaveValue("张三"));
    // 无明细仍拦截
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请至少录入一行有效明细(原料编号+需求数量)");
    // 加行 + 选原料 + 填数量
    fireEvent.click(screen.getByRole("button", { name: "加一行" }));
    fireEvent.click(screen.getByRole("button", { name: "选原料" }));
    const matDlg = await screen.findByRole("dialog");
    await waitFor(() => expect(matDlg).toHaveTextContent("RM-1"));
    fireEvent.click(screen.getByText("ABS 757").closest("tr")!);
    await waitFor(() => expect(screen.getByLabelText("原料编号")).toHaveValue("RM-1"));
    fireEvent.change(screen.getByLabelText("需求数量(KG)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("需求数量(包)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url.endsWith("/plastic-raw-material-demand") && c.method === "POST",
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.制单人).toBe("张三");
      expect(body.领料备注).toBe("生产领料");
      expect(body.明细).toEqual([
        expect.objectContaining({ 原料编号: "RM-1", 原料名称: "ABS 757", 单位: "KG", 需求数量KG: 50, 需求数量包: 2 }),
      ]);
    });
    await screen.findByText("原料生产需求表已创建");
  });

  it("?open= 直开查看模式:表单回填只读,合计行正确;审核 POST 后刷新", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialDemandPage />, "/plastic-raw-material-demand?open=D-001");
    await screen.findByText("原料生产需求表 · D-001");
    expect(screen.getByLabelText("啤机生产单号")).toHaveValue("PJ-100");
    expect(screen.getByLabelText("生产车间")).toBeDisabled();
    expect(screen.getByText("需求数量(KG)合计:")).toHaveTextContent("50");
    expect(screen.getByText("需求数量(包)合计:")).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/plastic-raw-material-demand/D-001/approve"))).toBe(true),
    );
  });

  it("无「打开」权限:整页无权提示", async () => {
    installFetch([]);
    renderWithProviders(<PlasticRawMaterialDemandPage />, "/plastic-raw-material-demand");
    await screen.findByText("无权访问该页面");
  });
});

describe("PlasticRawMaterialDemandSummaryPage(原料生产需求汇总)", () => {
  it("列表渲染 + 合计(KG/包);双击行弹原料需求表详情(单头+明细+合计)", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticRawMaterialDemandSummaryPage />, "/plastic-raw-material-demand-summary");
    await screen.findByText("PJ-100");
    expect(screen.getByText("ABS 757")).toBeInTheDocument();
    expect(screen.getAllByText("已审核").length).toBeGreaterThan(0);
    // 首屏带本月 起/止
    const hit = calls.find((c) => c.url.includes("/plastic-raw-material-demand/summary?"));
    expect(hit).toBeTruthy();
    const u = new URL(hit!.url, "http://test");
    expect(u.searchParams.get("起")).toMatch(/^\d{4}-\d{2}-01$/);
    // 合计
    expect(screen.getByText(/需求数量\(KG\) 50/)).toBeInTheDocument();
    // 双击行弹详情
    fireEvent.doubleClick(screen.getByText("PJ-100").closest("tr")!);
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("原料需求表(D-001)"));
    expect(dlg).toHaveTextContent("一车间");
    expect(dlg).toHaveTextContent("合计");
    // 领料备注过滤即时下发
    pickOption("领料备注", "样品领料");
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.includes("/plastic-raw-material-demand/summary?") &&
            decodeURIComponent(c.url).includes("领料备注=样品领料"),
        ),
      ).toBe(true),
    );
  });
});
