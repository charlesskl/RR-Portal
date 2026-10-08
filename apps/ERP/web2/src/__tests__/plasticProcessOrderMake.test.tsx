// 塑胶加工订单制作页:对照老系统 PlasticProcessOrderMakePage 场景。
// 重点:起/止/关键字参数、价格列按「单价」位裁剪、接收订单弹窗按采购单号聚合、
// 接收并带入(未接收 POST receive)、带入后制作表=该单明细(订购数量=订单数量)、加工次序筛选。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticProcessOrderMakePage from "@/pages/PlasticProcessOrderMakePage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

// SearchSelect 下拉选择:点触发钮 → 点选项(portal 到 body)
const pickOption = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole("option", { name: option }));
};

const PERMS_FULL = [
  { 组: "发外加工", 菜单: "塑胶加工订单制作", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
];
const PERMS_NO_PRICE = [
  { 组: "发外加工", 菜单: "塑胶加工订单制作", 打开: true, 单价: false },
];

const DEMAND = [
  { 单据日期: "2026-09-01", 生产单号: "MO1", 款号: "K1", 塑胶货号: "P1", 工模编号: "GM1", 物料编号: "M1", 物料名称: "白件A", 颜色: "红", 色粉号: "C1", 加工内容: "喷油", 加工次序: "第一次", 用料名称: "油漆", 单位: "PCS", 用量: 0.5, 计划数量: 100, 订购数量: 50, 加工单价: 2, 金额: 100 },
  { 单据日期: "2026-09-01", 生产单号: "MO1", 款号: "K1", 塑胶货号: "P1", 工模编号: "GM1", 物料编号: "M2", 物料名称: "白件B", 颜色: "蓝", 色粉号: "C2", 加工内容: "印喷", 加工次序: "第二次", 用料名称: "油墨", 单位: "PCS", 用量: 0.2, 计划数量: 100, 订购数量: 20, 加工单价: 1, 金额: 20 },
];
const RECV = [
  { 采购单号: "PO1", 单据日期: "2026-09-02", 交货日期: "2026-09-10", 供应商名称: "喷油一厂", 生产单号: "MO1", 款号: "K1", 物料编号: "M1", 物料名称: "白件A", 模具编号: "GM1", 颜色: "红", 色粉号: "C1", 用料名称: "油漆", 数量: 10, 加工内容: "喷油", 喷油接收: "0" },
  { 采购单号: "PO1", 单据日期: "2026-09-02", 交货日期: "2026-09-10", 供应商名称: "喷油一厂", 生产单号: "MO1", 款号: "K1", 物料编号: "M2", 物料名称: "白件B", 模具编号: "GM1", 颜色: "蓝", 色粉号: "C2", 用料名称: "油墨", 数量: 20, 加工内容: "印喷", 喷油接收: "0" },
  { 采购单号: "PO2", 单据日期: "2026-09-03", 交货日期: "2026-09-12", 供应商名称: "喷油二厂", 生产单号: "MO2", 款号: "K2", 物料编号: "M3", 物料名称: "白件C", 模具编号: "GM2", 颜色: "绿", 色粉号: "C3", 用料名称: "油漆", 数量: 5, 加工内容: "喷油", 喷油接收: "1", 喷油接收人: "张三", 喷油接收时间: "2026-09-03T10:00:00" },
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
      if (p === "/api/plastic-process-order-make") return json(DEMAND);
      if (p === "/api/plastic-process-order-make/received") return json(RECV);
      if (p === "/api/plastic-process-order-make/receive") return json({});
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

// 主表(制作表)作用域:以「订购数量」列表头定位(QueryTable 首张表),收件表同名物料不串场
const mainTable = () => screen.getByRole("columnheader", { name: "订购数量" }).closest("table")!;

describe("PlasticProcessOrderMakePage", () => {
  it("首屏:主表 BOM 需求行 + 请求带 起/止;已下喷油订单按采购单号合并接收状态(PO1 两行只一枚徽章)", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticProcessOrderMakePage />, "/plastic-process-order-make");
    await screen.findAllByText("白件A");
    const req = calls.find((c) => c.url.startsWith("/api/plastic-process-order-make?"))!;
    expect(decodeURIComponent(req.url)).toContain("起=");
    expect(decodeURIComponent(req.url)).toContain("止=");
    expect(screen.getByText("共 2 条")).toBeInTheDocument();

    // 收件区:PO1 两明细行共享一枚「待接收」徽章(rowSpan 合并),PO2 已接收带接收人
    await screen.findByText("已下喷油订单(3)");
    expect(screen.getAllByText("待接收")).toHaveLength(1);
    expect(screen.getByText(/已接收 张三/)).toBeInTheDocument();
  });

  it("无「单价」位:加工单价/金额列不渲染", async () => {
    installFetch(PERMS_NO_PRICE);
    renderWithProviders(<PlasticProcessOrderMakePage />, "/plastic-process-order-make");
    await screen.findAllByText("白件A");
    expect(screen.queryByText("加工单价")).not.toBeInTheDocument();
    expect(screen.queryByText("金额")).not.toBeInTheDocument();
  });

  it("接收并带入:弹窗按单聚合(行数 2/数量合计 30),POST receive 后主表切到该单明细(单位 个)", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticProcessOrderMakePage />, "/plastic-process-order-make");
    await screen.findByText("已下喷油订单(3)");

    fireEvent.click(screen.getByRole("button", { name: "接收订单" }));
    const dlg = await screen.findByRole("dialog", { name: "接收订单(塑胶仓已审核的喷油采购单)" });
    // 聚合行:PO1 行数 2 数量合计 30;PO2 已接收
    const po1Row = within(dlg).getByText("PO1").closest("tr")!;
    expect(within(po1Row).getByText("2")).toBeInTheDocument();
    expect(within(po1Row).getByText("30")).toBeInTheDocument();

    fireEvent.click(within(po1Row).getByText("接收并带入"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.startsWith("/api/plastic-process-order-make/receive") && c.method === "POST",
        ),
      ).toBe(true),
    );
    const recvReq = calls.find(
      (c) => c.url.startsWith("/api/plastic-process-order-make/receive?") && c.method === "POST",
    )!;
    expect(recvReq.url).toContain(encodeURIComponent("PO1"));
    await screen.findByText("已接收 PO1");
    // 带入后:主表=PO1 明细(订购数量=订单数量 10/20,单位 个),出现「已带入 PO1」标记
    await screen.findByText("已带入 PO1");
    expect(screen.getByText("共 2 条")).toBeInTheDocument();
    expect(within(mainTable()).getAllByText("个")).toHaveLength(2);
    expect(within(mainTable()).getByText("10")).toBeInTheDocument(); // 订购数量=订单数量
    // 清除带入回到 BOM 需求视图
    fireEvent.click(screen.getByRole("button", { name: "清除带入" }));
    await waitFor(() => expect(screen.queryByText("已带入 PO1")).not.toBeInTheDocument());
  });

  it("已接收的单点「带入」不再 POST receive", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticProcessOrderMakePage />, "/plastic-process-order-make");
    await screen.findByText("已下喷油订单(3)");
    fireEvent.click(screen.getByRole("button", { name: "接收订单" }));
    const dlg = await screen.findByRole("dialog", { name: "接收订单(塑胶仓已审核的喷油采购单)" });
    const po2Row = within(dlg).getByText("PO2").closest("tr")!;
    fireEvent.click(within(po2Row).getByText("带入"));
    await screen.findByText("已带入 PO2");
    expect(calls.some((c) => c.url.includes("/receive?") && c.method === "POST")).toBe(false);
    // 带入 PO2:主表只有 白件C 一行
    expect(within(mainTable()).getByText("白件C")).toBeInTheDocument();
    expect(within(mainTable()).queryByText("白件B")).not.toBeInTheDocument();
  });

  it("加工次序筛选:选 第二次 只剩印喷行", async () => {
    installFetch();
    renderWithProviders(<PlasticProcessOrderMakePage />, "/plastic-process-order-make");
    await screen.findAllByText("白件A");
    pickOption("加工次序筛选", "第二次");
    await waitFor(() =>
      expect(within(mainTable()).queryByText("白件A")).not.toBeInTheDocument(),
    );
    expect(within(mainTable()).getByText("白件B")).toBeInTheDocument();
    expect(screen.getByText("共 1 条")).toBeInTheDocument();
  });
});
