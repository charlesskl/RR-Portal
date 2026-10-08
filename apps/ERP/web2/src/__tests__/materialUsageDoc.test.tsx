// 退料单/报废单页(通用 MaterialUsageDocPage):对照老系统
// web/src/pages/materials/{MaterialDocPage,MaterialDocCreateDrawer,MaterialDocDetailDrawer}.tsx
// (materialDocConfigs material-returns/material-scraps) + MaterialReturnQueryPage/MaterialScrapQueryPage。
// 场景:首进自动开单、单级审核/反审核/删除、新建保存载荷(部门/人/仓库/明细)、复制单、
// 批量审核(只列未审核)、查询页签(明细/汇总/筛选参数/导出列/双击回单据页签)、报废侧字段名与端点。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import { downloadCsv, printTable } from "@/lib/tableExport";
import MaterialReturnPage from "@/pages/MaterialReturnPage";
import MaterialScrapPage from "@/pages/MaterialScrapPage";

// jsdom 无布局,虚拟滚动桩成全量渲染(同 inventory.test.tsx)
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

vi.mock("@/lib/tableExport", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tableExport")>();
  return { ...mod, downloadCsv: vi.fn(), printTable: vi.fn() };
});

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const PERMS_RETURN = [
  { 组: "物料管理", 菜单: "退料单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
];
const PERMS_SCRAP = [
  { 组: "物料管理", 菜单: "报废单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true },
];

const RET_LIST = {
  items: [
    { id: 1, 单号: "TL20260901001", 日期: "2026-09-01", 退料部门: "装配部", 退料人: "陈明", 仓库: "来料仓", 数量: 8, 金额: null, 操作员: "op1", 审核: "0", 备注: "多余退回" },
    { id: 2, 单号: "TL20260802001", 日期: "2026-08-02", 退料部门: "包装部", 退料人: "李华", 仓库: "来料仓", 数量: 2, 金额: 20, 操作员: "op2", 审核: "1", 审核人: "仓管王" },
  ],
  total: 2,
};
const RET_DETAIL = {
  单头: RET_LIST.items[0],
  明细: [
    { id: 11, 物料编号: "M-001", 物料名称: "布料", 规格: "S", 颜色: "红", 单位: "米", 数量: 8, 单价: null, 金额: null, 生产单号: "MO-1", 款号: "K-1", 备注: "" },
  ],
};
const RET_QUERY_DETAIL = [
  { 生产单号: "MO-1", 款号: "K-1", 日期: "2026-09-01", 单号: "TL20260901001", 退料部门: "装配部", 退料人: "陈明", 物料编号: "M-001", 物料名称: "布料", 物料类别: "面料", 规格: "S", 颜色: "红", 单位: "米", 数量: 8, 备注: "", 审核: "0" },
];
const RET_QUERY_SUMMARY = [
  { 生产单号: "MO-1", 款号: "K-1", 物料编号: "M-001", 物料名称: "布料", 物料类别: "面料", 规格: "S", 颜色: "红", 单位: "米", 退料数量: 8 },
];

const SCRAP_LIST = {
  items: [
    { id: 9, 单号: "BF20260901001", 日期: "2026-09-01", 报废部门: "装配部", 报废人: "陈明", 仓库: "来料仓", 数量: 3, 金额: null, 操作员: "op1", 审核: "0" },
  ],
  total: 1,
};
const SCRAP_DETAIL = { 单头: SCRAP_LIST.items[0], 明细: [{ id: 91, 物料编号: "M-9", 物料名称: "坏件", 数量: 3 }] };
const SCRAP_QUERY_DETAIL = [
  { 生产单号: "MO-2", 款号: "", 日期: "2026-09-01", 单号: "BF20260901001", 报废部门: "装配部", 报废人: "陈明", 物料编号: "M-9", 物料名称: "坏件", 物料类别: "辅料", 规格: "", 颜色: "", 单位: "个", 数量: 3, 备注: "损坏", 审核: "0" },
];
const SCRAP_QUERY_SUMMARY = [
  { 生产单号: "MO-2", 款号: "", 物料编号: "M-9", 物料名称: "坏件", 物料类别: "辅料", 规格: "", 颜色: "", 单位: "个", 报废数量: 3 },
];

type Call = { url: string; method: string; body?: string };

function installFetch(kind: "return" | "scrap", perms: unknown) {
  const calls: Call[] = [];
  const base = kind === "return" ? "/api/material-returns" : "/api/material-scraps";
  const querySeg = kind === "return" ? "return-query" : "scrap-query";
  const list = kind === "return" ? RET_LIST : SCRAP_LIST;
  const qDetail = kind === "return" ? RET_QUERY_DETAIL : SCRAP_QUERY_DETAIL;
  const qSummary = kind === "return" ? RET_QUERY_SUMMARY : SCRAP_QUERY_SUMMARY;
  // 有状态审核:POST approve/unapprove 后详情翻转(验证审核后重取)
  let approved = false;
  const detail = () =>
    kind === "return"
      ? { ...RET_DETAIL, 单头: { ...RET_DETAIL.单头, 审核: approved ? "1" : "0", 审核人: approved ? "仓管王" : null } }
      : { ...SCRAP_DETAIL, 单头: { ...SCRAP_DETAIL.单头, 审核: approved ? "1" : "0" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      const u = new URL(url, "http://test");
      const p = u.pathname;
      const m = init?.method ?? "GET";
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === `${base}/${querySeg}/detail`) return json(qDetail);
      if (p === `${base}/${querySeg}/summary`) return json(qSummary);
      if (p === base && m === "GET") return json(list);
      if (p === base && m === "POST") return json({ 单号: kind === "return" ? "TL20260918001" : "BF20260918001" });
      if (p.startsWith(`${base}/`)) {
        if (m === "DELETE") return new Response(null, { status: 204 });
        if (m === "POST") {
          if (p.endsWith("/approve")) approved = true;
          if (p.endsWith("/unapprove")) approved = false;
          return new Response(null, { status: 204 });
        }
        return json(detail());
      }
      if (p === "/api/material-master/categories") return json([{ 类别: "面料", 数量: 3 }]);
      if (p === "/api/material-master") return json({ items: [], total: 0 });
      if (p === "/api/master/employees") return json({ items: [{ 姓名: "陈明", 职称: "仓管" }], total: 1 });
      if (p === "/api/material-inventory") return json([]);
      if (p === "/api/production-reports/tracking") return json([]);
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
  vi.mocked(downloadCsv).mockClear();
  vi.mocked(printTable).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("退料单(单据页签)", () => {
  it("首进自动打开最新一单:单头卡 + 明细 + 未审核徽章", async () => {
    installFetch("return", PERMS_RETURN);
    renderWithProviders(<MaterialReturnPage />, "/material-returns");
    await screen.findByText("退料单 · TL20260901001");
    expect(screen.getByText("装配部")).toBeInTheDocument();
    expect(screen.getByText("陈明")).toBeInTheDocument();
    expect(screen.getByText("M-001")).toBeInTheDocument();
    expect(screen.getByText("未审核")).toBeInTheDocument();
    // 流程条:开单 -> 审核
    expect(screen.getByText("开单")).toBeInTheDocument();
  });

  it("审核:POST approve 后重取明细,徽章翻已审核并出现反审核", async () => {
    const calls = installFetch("return", PERMS_RETURN);
    renderWithProviders(<MaterialReturnPage />, "/material-returns");
    await screen.findByText("退料单 · TL20260901001");
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.url === "/api/material-returns/TL20260901001/approve" && c.method === "POST"),
      ).toBe(true);
    });
    // 详情重取后徽章翻转为已审核,并出现反审核按钮
    await screen.findByRole("button", { name: "反审核" });
    // 反审核:POST unapprove
    fireEvent.click(screen.getByRole("button", { name: "反审核" }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.url === "/api/material-returns/TL20260901001/unapprove" && c.method === "POST"),
      ).toBe(true);
    });
  });

  it("新建保存:载荷带 退料部门/退料人/仓库/明细(数量>0 过滤)", async () => {
    const calls = installFetch("return", PERMS_RETURN);
    renderWithProviders(<MaterialReturnPage />, "/material-returns");
    await screen.findByText("退料单 · TL20260901001");
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    await screen.findByText("还没有明细行,点「加一行」手选物料,或「按生产单带入」应领明细");
    fireEvent.change(screen.getByLabelText("退料部门"), { target: { value: "装配部" } });
    fireEvent.change(screen.getByLabelText("仓库"), { target: { value: "来料仓" } });
    fireEvent.click(screen.getByRole("button", { name: "加一行" }));
    fireEvent.change(screen.getByLabelText("物料编号"), { target: { value: "M-100" } });
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url === "/api/material-returns" && c.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.退料部门).toBe("装配部");
      expect(body.仓库).toBe("来料仓");
      expect(body.明细).toHaveLength(1);
      expect(body.明细[0]).toMatchObject({ 物料编号: "M-100", 数量: 4 });
    });
    await screen.findByText(/退料单已创建:TL20260918001/);
  });

  it("新建不填仓库:前端拦截(请填写仓库),不发 POST", async () => {
    const calls = installFetch("return", PERMS_RETURN);
    renderWithProviders(<MaterialReturnPage />, "/material-returns");
    await screen.findByText("退料单 · TL20260901001");
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.click(screen.getByRole("button", { name: "加一行" }));
    fireEvent.change(screen.getByLabelText("物料编号"), { target: { value: "M-100" } });
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请填写仓库");
    expect(calls.some((c) => c.url === "/api/material-returns" && c.method === "POST")).toBe(false);
  });

  it("复制单:带出头字段与明细行,清掉单号进入新建态", async () => {
    installFetch("return", PERMS_RETURN);
    renderWithProviders(<MaterialReturnPage />, "/material-returns");
    await screen.findByText("退料单 · TL20260901001");
    fireEvent.click(screen.getByRole("button", { name: "复制单" }));
    await screen.findByText("退料单(新建)");
    expect(screen.getByLabelText("退料部门")).toHaveValue("装配部");
    expect(screen.getByLabelText("退料人")).toHaveValue("陈明");
    expect(screen.getByLabelText("仓库")).toHaveValue("来料仓");
    // 明细行带出
    expect(screen.getByLabelText("物料编号")).toHaveValue("M-001");
    expect(screen.getByText(/已复制为未保存新单/)).toBeInTheDocument();
  });

  it("删除:确认弹窗后 DELETE 并回新建/清空", async () => {
    const calls = installFetch("return", PERMS_RETURN);
    renderWithProviders(<MaterialReturnPage />, "/material-returns");
    await screen.findByText("退料单 · TL20260901001");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await screen.findByText("确认删除该退料单?");
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.url === "/api/material-returns/TL20260901001" && c.method === "DELETE"),
      ).toBe(true);
    });
    await screen.findByText("已删除");
  });

  it("批量审核:只列未审核单,全选后逐张 POST approve", async () => {
    const calls = installFetch("return", PERMS_RETURN);
    renderWithProviders(<MaterialReturnPage />, "/material-returns");
    await screen.findByText("退料单 · TL20260901001");
    fireEvent.click(screen.getByRole("button", { name: "批量审核" }));
    const dlg = await screen.findByRole("dialog");
    // 已审核的 TL20260802001 不在可选列表;等未审核单加载出来
    await within(dlg).findByLabelText("选择 TL20260901001");
    expect(within(dlg).queryByText("TL20260802001")).not.toBeInTheDocument();
    fireEvent.click(within(dlg).getByLabelText("全选本页"));
    fireEvent.click(within(dlg).getByRole("button", { name: "批量审核" }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.url === "/api/material-returns/TL20260901001/approve" && c.method === "POST"),
      ).toBe(true);
    });
    await screen.findByText("已审核 1 张");
  });
});

describe("退料单(查询页签)", () => {
  it("明细查询渲染 + 筛选参数下发 + 导出列对照老系统", async () => {
    const calls = installFetch("return", PERMS_RETURN);
    renderWithProviders(<MaterialReturnPage />, "/material-returns");
    await screen.findByText("退料单 · TL20260901001");
    fireEvent.click(screen.getByRole("button", { name: "退料单查询" }));
    await screen.findByText("TL20260901001", { selector: "td" });
    expect(calls.some((c) => c.url.includes("/api/material-returns/return-query/detail?"))).toBe(true);
    // 审核情况/类别/关键字进参数
    pickOption("审核情况", "未审核");
    fireEvent.click(screen.getByLabelText("物料类别"));
    fireEvent.click(await screen.findByRole("option", { name: "面料(3)" }));
    fireEvent.change(screen.getByLabelText("关键字"), { target: { value: "M-001" } });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => {
      const hit = calls.find(
        (c) => c.url.includes("return-query/detail?") && c.url.includes("keyword=M-001"),
      );
      expect(hit?.url).toContain("%E5%AE%A1%E6%A0%B8%E6%83%85%E5%86%B5=%E6%9C%AA%E5%AE%A1%E6%A0%B8");
      expect(hit?.url).toContain("%E7%89%A9%E6%96%99%E7%B1%BB%E5%88%AB=%E9%9D%A2%E6%96%99");
    });
    // 导出列对照老系统 detailExportCols
    fireEvent.click(screen.getByRole("button", { name: "导出EXCEL" }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [fname, cols] = vi.mocked(downloadCsv).mock.calls[0];
    expect(fname).toBe("退料明细.csv");
    expect(cols.map((c) => c.title)).toEqual([
      "生产单号", "款号", "日期", "单号", "退料部门", "退料人", "物料编号", "物料名称",
      "规格", "材料", "颜色", "单位", "数量", "备注", "审核",
    ]);
  });

  it("汇总页签按 退料数量 合并列,双击明细行回单据页签打开整单", async () => {
    installFetch("return", PERMS_RETURN);
    renderWithProviders(<MaterialReturnPage />, "/material-returns");
    await screen.findByText("退料单 · TL20260901001");
    fireEvent.click(screen.getByRole("button", { name: "退料单查询" }));
    await screen.findByText("TL20260901001", { selector: "td" });
    fireEvent.click(screen.getByRole("button", { name: "汇总查询" }));
    await screen.findByText("退料数量", { selector: "th" });
    // 双击明细行 -> 单据页签 + 打开整单
    fireEvent.click(screen.getByRole("button", { name: "明细查询" }));
    const cell = await screen.findByText("TL20260901001", { selector: "td" });
    fireEvent.doubleClick(cell.closest("tr")!);
    await screen.findByText("退料单 · TL20260901001");
  });
});

describe("报废单", () => {
  it("单据页签:报废字段名 + 单级审核端点 material-scraps", async () => {
    const calls = installFetch("scrap", PERMS_SCRAP);
    renderWithProviders(<MaterialScrapPage />, "/material-scraps");
    await screen.findByText("报废单 · BF20260901001");
    expect(screen.getByText("报废部门")).toBeInTheDocument();
    expect(screen.getByText("报废人")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.url === "/api/material-scraps/BF20260901001/approve" && c.method === "POST"),
      ).toBe(true);
    });
  });

  it("查询页签:scrap-query 端点 + 汇总 报废数量", async () => {
    const calls = installFetch("scrap", PERMS_SCRAP);
    renderWithProviders(<MaterialScrapPage />, "/material-scraps");
    await screen.findByText("报废单 · BF20260901001");
    fireEvent.click(screen.getByRole("button", { name: "报废单查询" }));
    await screen.findByText("BF20260901001", { selector: "td" });
    expect(calls.some((c) => c.url.includes("/api/material-scraps/scrap-query/detail?"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "汇总查询" }));
    await screen.findByText("报废数量", { selector: "th" });
    expect(calls.some((c) => c.url.includes("/api/material-scraps/scrap-query/summary?"))).toBe(true);
    // 导出汇总列对照老系统 summaryExportCols
    fireEvent.click(screen.getByRole("button", { name: "导出EXCEL" }));
    const [fname, cols] = vi.mocked(downloadCsv).mock.calls[0];
    expect(fname).toBe("报废汇总.csv");
    expect(cols.map((c) => c.title)).toEqual([
      "生产单号", "款号", "物料编号", "物料名称", "规格", "材料", "颜色", "单位", "报废数量",
    ]);
  });

  it("无「打开」权限:查询页签给无权提示", async () => {
    installFetch("scrap", []);
    renderWithProviders(<MaterialScrapPage />, "/material-scraps");
    fireEvent.click(await screen.findByRole("button", { name: "报废单查询" }));
    await screen.findByText("无权访问报废单查询");
  });
});
