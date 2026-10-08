// 塑胶加工采购订单页:对照老系统 PlasticProcessPurchaseOrderPage + LineTable + factoryProcessMatch 场景。
// 重点:调入加工清单二次加工展开+厂类别过滤、保存只下可见有效行、?单号= 查看态、列表三级流转、价格列按「单价」位裁剪。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticProcessPurchaseOrderPage from "@/pages/PlasticProcessPurchaseOrderPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [
  { 组: "发外加工", 菜单: "塑胶加工采购单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: true },
];
const PERMS_NO_PRICE = [
  { 组: "发外加工", 菜单: "塑胶加工采购单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true, 单价: false },
];

const HEADER = {
  id: 1, 单号: "JG-PO1", 日期: "2026-09-01", 加工厂编号: "F9", 加工厂名称: "伟力电镀厂",
  客户名称: "ZURU", 数量: 15, 审核: "0", 主管审核: "0", 经理审核: "0", 操作员: "tester",
};
const DETAIL = {
  单头: HEADER,
  明细: [
    { id: 11, 生产单号: "MO1", 款号: "K1", 物料编号: "M1", 物料名称: "白件A", 加工内容: "喷油", 数量: 15, 单价: 2, 备注: "" },
  ],
};
// basis:一行普通(喷油) + 一行二次加工 BD(电镀->印喷,展开两条)
const BASIS = [
  { 生产单号: "MO1", 款号: "K1", 物料编号: "M1", 物料名称: "白件A", 加工内容: "喷油", 单价: 2 },
  { 生产单号: "MO1", 款号: "K1", 物料编号: "M2", 物料名称: "二加件B", 加工内容: "电镀", 二次加工内容: "印喷", 二次加工类别: "BD", 单价: 1.5 },
];
const FACTORIES = {
  items: [{ 加工厂编号: "F1", 加工厂名称: "龙昌喷油厂", 加工厂类别: "印刷加工" }],
  total: 1,
};
const PRODUCTIONS = [{ 生产单号: "MO1", 款号: "K1", 款式: "恐龙", 客户名称: "ZURU", 计划数量: 100, 交货日期: "2026-10-01" }];

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
      if (p === "/api/master/factories") return json(FACTORIES);
      if (p === "/api/production-reports/tracking") return json(PRODUCTIONS);
      if (p === "/api/plastic-process-purchase-orders/basis") return json(BASIS);
      if (p === "/api/plastic-process-purchase-orders") {
        if (init?.method === "POST") return json({ 单号: "JG-NEW" });
        return json({ items: [HEADER], total: 1 });
      }
      if (p === "/api/plastic-process-purchase-orders/JG-PO1") return json(DETAIL);
      if (p.endsWith("/supervisor-approve") || p.endsWith("/manager-approve")) return json({});
      if (p.endsWith("/approve") || p.endsWith("/unapprove")) return json({});
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

describe("PlasticProcessPurchaseOrderPage", () => {
  it("新建态默认 日期=今天/操作员=当前用户;未选加工厂保存拦截「请选加工厂」", async () => {
    installFetch();
    renderWithProviders(<PlasticProcessPurchaseOrderPage />, "/plastic-process-purchase-orders");
    await screen.findByText("塑胶加工采购订单(新建)");
    expect(screen.getByLabelText("日期")).toHaveValue(new Date().toISOString().slice(0, 10));
    expect(screen.getByLabelText("操作员")).toHaveValue("tester");
    // 列表加载并显示状态徽章
    await screen.findByText("JG-PO1");
    expect(screen.getByText("未审核")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选加工厂");
  });

  it("调入加工清单:二次加工 BD 行展开 第一次(电镀,B)/第二次(印喷,D);选厂后按厂类别过滤,保存只下可见有效行", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticProcessPurchaseOrderPage />, "/plastic-process-purchase-orders");
    await screen.findByText("塑胶加工采购订单(新建)");

    // 调入清单(生产制单选择器选 MO1)
    fireEvent.click(screen.getByRole("button", { name: "调入加工清单" }));
    const prodDlg = await screen.findByRole("dialog", { name: "选择生产制单(仅列已审核)" });
    fireEvent.click(await within(prodDlg).findByText("MO1"));
    await screen.findByText("已调入生产单 MO1 的加工清单 3 行");
    // 展开 3 行:喷油 + 电镀(第一次,B) + 印喷(第二次,D)
    expect(screen.getByLabelText("加工次序 2")).toHaveTextContent("第一次");
    expect(screen.getByLabelText("加工字母 2")).toHaveValue("B");
    expect(screen.getByLabelText("加工次序 3")).toHaveTextContent("第二次");
    expect(screen.getByLabelText("加工字母 3")).toHaveValue("D");
    // 三行都填数量(含即将被厂类别隐藏的电镀行)
    fireEvent.change(screen.getByLabelText("数量 1"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("数量 2"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("数量 3"), { target: { value: "30" } });

    // 选加工厂(厂类别=印刷加工):喷油/印喷行可见(2 行),电镀行隐藏但清单不销毁
    fireEvent.click(screen.getByRole("button", { name: "选择加工厂" }));
    const facDlg = await screen.findByRole("dialog", { name: "选择加工厂" });
    fireEvent.click(await within(facDlg).findByText("龙昌喷油厂"));
    await screen.findByText("按厂类别[印刷加工]显示 2 行明细(清单共 3 行)");
    expect(screen.queryByLabelText("加工次序 3")).not.toBeInTheDocument();
    expect(screen.getByLabelText("加工次序 2")).toHaveTextContent("第二次"); // 印喷行顶上

    // 保存:载荷只含可见有效行(喷油 10 + 印喷 30),隐藏的电镀行不下单
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/plastic-process-purchase-orders" && c.method === "POST"),
      ).toBe(true),
    );
    const post = calls.find(
      (c) => c.url === "/api/plastic-process-purchase-orders" && c.method === "POST",
    )!;
    const body = JSON.parse(post.body!);
    expect(body.加工厂编号).toBe("F1");
    expect(body.加工厂名称).toBe("龙昌喷油厂");
    expect(body.明细).toHaveLength(2);
    expect(body.明细[0]).toMatchObject({ 物料编号: "M1", 加工内容: "喷油", 数量: 10 });
    expect(body.明细[1]).toMatchObject({
      物料编号: "M2",
      加工内容: "印喷",
      加工次序: "第二次",
      加工字母: "D",
      数量: 30,
    });
    await screen.findByText("塑胶加工采购单已创建");
  });

  it("厂类别不一致且可见行无有效明细时,保存文案带厂类别(逐字)", async () => {
    installFetch();
    renderWithProviders(<PlasticProcessPurchaseOrderPage />, "/plastic-process-purchase-orders");
    await screen.findByText("塑胶加工采购订单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "调入加工清单" }));
    const prodDlg = await screen.findByRole("dialog", { name: "选择生产制单(仅列已审核)" });
    fireEvent.click(await within(prodDlg).findByText("MO1"));
    await screen.findByText("已调入生产单 MO1 的加工清单 3 行");
    fireEvent.click(screen.getByRole("button", { name: "选择加工厂" }));
    const facDlg = await screen.findByRole("dialog", { name: "选择加工厂" });
    fireEvent.click(await within(facDlg).findByText("龙昌喷油厂"));
    // 可见喷油/印喷行数量均为 0 -> 无效
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("没有与厂类别[印刷加工]一致的有效物料明细(物料编号+数量),无法下单");
  });

  it("?单号= 直开查看态:标题带单号,表单只读,保存禁用", async () => {
    installFetch();
    renderWithProviders(<PlasticProcessPurchaseOrderPage />, "/plastic-process-purchase-orders?单号=JG-PO1");
    await screen.findByText("塑胶加工采购订单(查看 JG-PO1)");
    expect(screen.getByLabelText("客户名称")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByLabelText("数量 1")).toBeDisabled();
    // 明细行带出(白件A 喷油 15)
    expect(screen.getByLabelText("物料编号 1")).toHaveValue("M1");
  });

  it("列表行内三级流转:点「主管审核」POST supervisor-approve 并刷新列表", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticProcessPurchaseOrderPage />, "/plastic-process-purchase-orders");
    await screen.findByText("JG-PO1");
    fireEvent.click(screen.getByRole("button", { name: "主管审核" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/plastic-process-purchase-orders/JG-PO1/supervisor-approve")),
      ).toBe(true),
    );
    await screen.findByText("主管已审核");
  });

  it("无「单价」位:单价/金额列与金额合计不渲染", async () => {
    installFetch(PERMS_NO_PRICE);
    renderWithProviders(<PlasticProcessPurchaseOrderPage />, "/plastic-process-purchase-orders?单号=JG-PO1");
    await screen.findByText("塑胶加工采购订单(查看 JG-PO1)");
    expect(screen.queryByText("单价")).not.toBeInTheDocument();
    expect(screen.queryByText("金额")).not.toBeInTheDocument();
    expect(screen.queryByText(/金额合计/)).not.toBeInTheDocument();
    expect(screen.getByText(/数量合计/)).toBeInTheDocument();
  });
});
