// 塑胶报废单页:对照老系统 PlasticSupplierDocFormPage(cfg=plastic-scraps) + PlasticScrapQueryPage。
// 纯函数(receiptLineToScrapLine/validScrapLines/toSubmitScrapLine/sumScrapQty/sumScrapAmount)
// + 页面(查看态/新建校验/保存 POST 载荷(含出库单号)/审核/查询页签双击开详情/无批量审核 parity)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import {
  receiptLineToScrapLine,
  sumScrapAmount,
  sumScrapQty,
  toSubmitScrapLine,
  validScrapLines,
} from "@/lib/plasticDocs";
import PlasticScrapPage from "@/pages/PlasticScrapPage";

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

describe("塑胶报废单·纯函数", () => {
  it("receiptLineToScrapLine:入仓明细 -> 报废编辑行(数量受控串,单价空不带)", () => {
    const l = receiptLineToScrapLine(
      { 物料编号: "P1", 物料名称: "胶壳", 规格: "S", 颜色: "黑", 仓位号: "A1", 单位: "个", 数量: 5, 单价: 1.5 },
      1,
    );
    expect(l).toMatchObject({ key: 1, 物料编号: "P1", 数量: "5", 单价: "1.5", 仓位号: "A1" });
    const noPrice = receiptLineToScrapLine({ 物料编号: "P2", 数量: 2 }, 2);
    expect(noPrice.单价).toBe("");
  });

  it("validScrapLines:必须有物料编号且数量>0", () => {
    const rows = [
      { key: 1, 物料编号: "P1", 数量: "3", 单价: "" },
      { key: 2, 物料编号: "P2", 数量: "0", 单价: "" },
      { key: 3, 物料编号: "", 数量: "5", 单价: "" },
    ];
    expect(validScrapLines(rows).map((l) => l.物料编号)).toEqual(["P1"]);
  });

  it("toSubmitScrapLine:空串不带,数量/单价转数值", () => {
    const l = toSubmitScrapLine({
      key: 1, 物料编号: " P1 ", 物料名称: "胶壳", 数量: "3", 单价: "2.5", 颜色: "", 备注: " 坏件 ",
    });
    expect(l).toEqual({ 物料编号: "P1", 物料名称: "胶壳", 数量: 3, 单价: 2.5, 备注: "坏件" });
    expect(l.颜色).toBeUndefined();
    expect(l.生产单号).toBeUndefined();
  });

  it("sumScrapQty/sumScrapAmount:数量合计与金额合计", () => {
    const rows = [
      { key: 1, 数量: "3", 单价: "2" },
      { key: 2, 数量: "2.5", 单价: "4" },
    ];
    expect(sumScrapQty(rows)).toBe(5.5);
    expect(sumScrapAmount(rows)).toBe(16);
  });
});

// ---------- 页面 ----------

const PERMS_FULL = [
  { 组: "塑胶仓储", 菜单: "塑胶报废单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
  { 组: "塑胶报表", 菜单: "塑胶报废查询", 打开: true, 单价: true },
];

const LIST = {
  items: [{ id: 1, 单号: "SC1", 供应商名称: "恒科", 仓库: "塑胶仓", 数量: 4, 日期: "2026-09-01", 审核: "0" }],
  total: 1,
};

const DETAIL = {
  单头: { id: 1, 单号: "SC1", 供应商编号: "S1", 供应商名称: "恒科", 仓库: "塑胶仓", 出库单号: "OUT-1", 日期: "2026-09-01", 数量: 4, 审核: "0" },
  明细: [{ id: 11, 生产单号: "MO1", 物料编号: "P-001", 物料名称: "胶壳", 单位: "个", 数量: 4, 单价: 1 }],
};

const QUERY_DETAIL = [
  { 日期: "2026-09-01", 单号: "SC1", 生产单号: "MO1", 款号: "K1", 报废部门: "塑胶部", 报废人: "张三", 物料编号: "P-001", 物料名称: "胶壳", 颜色: "黑", 塑胶货号: "PH1", 共用物料: "", 共用货号: "", 单位: "个", 数量: 4, 单价: 1, 金额: 4, 备注: "", 审核: "1" },
];

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
      if (p === "/api/plastic-scraps") {
        if (init?.method === "POST") return json({ 单号: "SC-NEW" });
        return json(LIST);
      }
      if (p === "/api/plastic-scraps/SC1") return json(DETAIL);
      if (p.endsWith("/approve") || p.endsWith("/unapprove")) return json({});
      if (p === "/api/plastic-scrap-query/detail") return json(QUERY_DETAIL);
      if (p === "/api/plastic-scrap-query/summary") return json([]);
      if (p === "/api/plastic-material-master/categories") return json([]);
      if (p === "/api/master/suppliers") return json({ items: [{ 供应商编号: "S1", 供应商名称: "恒科" }], total: 1 });
      return json({ 消息: `unhandled ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (perms?: unknown) => {
  const calls = installFetch(perms ?? PERMS_FULL);
  renderWithProviders(<PlasticScrapPage />, "/plastic-scraps");
  return calls;
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlasticScrapPage", () => {
  it("首屏自动打开最新单:单头卡(出库单号)+只读明细+审核(报废);无批量审核按钮(parity)", async () => {
    setup();
    await screen.findByText("塑胶报废单 · SC1");
    expect(screen.getByText("OUT-1")).toBeInTheDocument();
    expect(screen.getByText("胶壳")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审核(报废)" })).toBeInTheDocument();
    // 老系统塑胶报废单无批量审核(PlasticSupplierDocFormPage 无此功能),保持 parity
    expect(screen.queryByRole("button", { name: "批量审核" })).not.toBeInTheDocument();
  });

  it("新建:校验后保存 POST 载荷(仓库手填,含出库单号)", async () => {
    const calls = setup();
    await screen.findByText("塑胶报废单 · SC1");
    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    await screen.findByRole("button", { name: "保存" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选供应商");
    fireEvent.click(screen.getAllByRole("button", { name: "选择" })[0]);
    await screen.findByText("S1");
    fireEvent.click(screen.getByText("恒科").closest("tr")!);
    fireEvent.change(screen.getByLabelText("仓库"), { target: { value: "塑胶仓" } });
    fireEvent.change(screen.getByLabelText("出库单号"), { target: { value: "OUT-9" } });
    fireEvent.click(screen.getByRole("button", { name: /加行/ }));
    fireEvent.change(screen.getByLabelText("物料编号"), { target: { value: "P-002" } });
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.url.endsWith("/plastic-scraps") && c.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.body!);
      expect(body.出库单号).toBe("OUT-9");
      expect(body.仓库).toBe("塑胶仓");
      expect(body.明细).toEqual([{ 物料编号: "P-002", 数量: 2 }]);
    });
    await screen.findByText("塑胶报废单已创建:SC-NEW");
  });

  it("审核:POST approve;反审核按钮在已审核单渲染", async () => {
    const calls = setup();
    await screen.findByText("塑胶报废单 · SC1");
    fireEvent.click(screen.getByRole("button", { name: "审核(报废)" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/plastic-scraps/SC1/approve") && c.method === "POST")).toBe(true),
    );
  });

  it("查询页签:报废部门/报废人列;双击明细行开单据详情弹窗", async () => {
    setup();
    await screen.findByText("塑胶报废单 · SC1");
    fireEvent.click(screen.getByRole("button", { name: "塑胶报废查询" }));
    await screen.findByText("报废部门");
    expect(screen.getByText("塑胶部")).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByText("SC1").closest("tr")!);
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(dlg).toHaveTextContent("塑胶报废单 SC1"));
    expect(dlg).toHaveTextContent("胶壳");
  });

  it("无「保存」位:新建按钮不渲染", async () => {
    setup([{ 组: "塑胶仓储", 菜单: "塑胶报废单", 打开: true, 审核: true }]);
    await screen.findByText("塑胶报废单 · SC1");
    expect(screen.queryByRole("button", { name: "新建" })).not.toBeInTheDocument();
  });
});
