// 白件领料单页:对照老系统 PlasticWhitePartIssuePage + LineTable 场景。
// 重点:新建默认值(日期/操作员/领料备注=生产领料)、领料人必填、调入清单(数量默认 0)、
// 保存只提交有效行、查看态只读、列表行内三级流转。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import PlasticWhitePartIssuePage from "@/pages/PlasticWhitePartIssuePage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [
  { 组: "发外加工", 菜单: "白件领料单", 打开: true, 保存: true, 删除: true, 审核: true, 反审核: true, 打印: true },
];

const HEADER = {
  id: 1, 单号: "BJ-01", 日期: "2026-09-01", 领料部门: "龙昌喷油厂", 领料人: "张三",
  数量: 8, 审核: "0", 主管审核: "0", 经理审核: "0", 操作员: "tester", 领料备注: "生产领料",
};
const DETAIL = {
  单头: HEADER,
  明细: [
    { id: 11, 生产单号: "MO1", 款号: "K1", 物料编号: "M1", 物料名称: "白件A", 颜色: "红", 用料名称: "ABS", 单位: "PCS", 数量: 8, 备注: "" },
  ],
};
const BASIS = [
  { 生产单号: "MO1", 款号: "K1", 模具编号: "GM-1", 物料编号: "M1", 物料名称: "白件A", 颜色: "红", 用料名称: "ABS", 单位: "PCS" },
  { 生产单号: "MO1", 款号: "K1", 模具编号: "GM-2", 物料编号: "M2", 物料名称: "白件B", 颜色: "蓝", 用料名称: "PP", 单位: "PCS" },
];
const FACTORIES = { items: [{ 加工厂编号: "F1", 加工厂名称: "龙昌喷油厂" }], total: 1 };
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
      if (p === "/api/master/employees")
        return json({ items: [{ 编号: "E1", 姓名: "李四", 部门编号: "装配部", 职称: "拉长" }], total: 1 });
      if (p === "/api/plastic-white-part-issue/basis") return json(BASIS);
      if (p === "/api/plastic-white-part-issue") {
        if (init?.method === "POST") return json({ 单号: "BJ-NEW" });
        return json({ items: [HEADER], total: 1 });
      }
      if (p === "/api/plastic-white-part-issue/BJ-01") return json(DETAIL);
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

describe("PlasticWhitePartIssuePage", () => {
  it("新建态默认 日期=今天/操作员=当前用户/领料备注=生产领料;部门下拉选项来自加工厂资料", async () => {
    installFetch();
    renderWithProviders(<PlasticWhitePartIssuePage />, "/plastic-white-part-issue");
    await screen.findByText("白件领料单(新建)");
    expect(screen.getByLabelText("日期")).toHaveValue(new Date().toISOString().slice(0, 10));
    expect(screen.getByLabelText("操作员")).toHaveValue("tester");
    expect(screen.getByLabelText("领料备注")).toHaveTextContent("生产领料");
    // 部门=加工厂下拉(value=名称,label=编号+名称)
    fireEvent.click(screen.getByLabelText("领料部门"));
    await screen.findByRole("option", { name: "F1 龙昌喷油厂" });
  });

  it("调入清单:basis 带白件 BOM(数量默认 0);未选领料人保存拦截「请选领料人」", async () => {
    installFetch();
    renderWithProviders(<PlasticWhitePartIssuePage />, "/plastic-white-part-issue");
    await screen.findByText("白件领料单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "调入清单" }));
    const dlg = await screen.findByRole("dialog", { name: "选择生产制单(仅列已审核)" });
    fireEvent.click(await within(dlg).findByText("MO1"));
    await screen.findByText("已调入生产单 MO1 的白件清单");
    expect(screen.getByLabelText("物料编号 1")).toHaveValue("M1");
    expect(screen.getByLabelText("物料编号 2")).toHaveValue("M2");
    expect(screen.getByLabelText("数量 1")).toHaveValue(0);

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选领料人");
  });

  it("保存:选领料人(人事档案)后 POST 载荷只含 物料编号+数量>0 的有效行", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticWhitePartIssuePage />, "/plastic-white-part-issue");
    await screen.findByText("白件领料单(新建)");
    fireEvent.click(screen.getByRole("button", { name: "调入清单" }));
    const dlg = await screen.findByRole("dialog", { name: "选择生产制单(仅列已审核)" });
    fireEvent.click(await within(dlg).findByText("MO1"));
    await screen.findByText("已调入生产单 MO1 的白件清单");
    // 只给第一行填数量,第二行 0 应被过滤
    fireEvent.change(screen.getByLabelText("数量 1"), { target: { value: "8" } });

    fireEvent.click(screen.getByRole("button", { name: "领料人选择" }));
    const empDlg = await screen.findByRole("dialog", { name: "选择人员(人事档案)" });
    fireEvent.click(await within(empDlg).findByText("李四"));
    await waitFor(() => expect(screen.getByLabelText("领料人")).toHaveValue("李四"));

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === "/api/plastic-white-part-issue" && c.method === "POST"),
      ).toBe(true),
    );
    const post = calls.find((c) => c.url === "/api/plastic-white-part-issue" && c.method === "POST")!;
    const body = JSON.parse(post.body!);
    expect(body.领料人).toBe("李四");
    expect(body.领料备注).toBe("生产领料");
    expect(body.明细).toHaveLength(1);
    expect(body.明细[0]).toMatchObject({ 物料编号: "M1", 数量: 8 });
    await screen.findByText("白件领料单已创建");
  });

  it("点列表单号打开查看态:标题带单号,明细只读,保存禁用", async () => {
    installFetch();
    renderWithProviders(<PlasticWhitePartIssuePage />, "/plastic-white-part-issue");
    await screen.findByText("BJ-01");
    fireEvent.click(screen.getByRole("button", { name: "BJ-01" }));
    await screen.findByText("白件领料单(查看 BJ-01)");
    expect(screen.getByLabelText("领料人")).toHaveValue("张三");
    expect(screen.getByLabelText("物料编号 1")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "加一行" })).not.toBeInTheDocument();
  });

  it("列表行内三级流转:未审核行显示「主管审核」,点击 POST supervisor-approve", async () => {
    const calls = installFetch();
    renderWithProviders(<PlasticWhitePartIssuePage />, "/plastic-white-part-issue");
    await screen.findByText("BJ-01");
    expect(screen.queryByRole("button", { name: "审核(下发)" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "主管审核" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/plastic-white-part-issue/BJ-01/supervisor-approve")),
      ).toBe(true),
    );
    await screen.findByText("主管已审核");
  });
});
