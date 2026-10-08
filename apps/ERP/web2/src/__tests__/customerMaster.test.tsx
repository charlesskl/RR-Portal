// 客户资料页:对照老系统 MasterDataPage(MASTER_CONFIGS.客户资料)。
// 列表(8 列)/搜索回车/新增 POST/双击选中+编辑 PUT/删除 DELETE/无打开位提示。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import CustomerMasterPage from "@/pages/CustomerMasterPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [{ 组: "基础资料", 菜单: "客户资料", 打开: true, 保存: true, 删除: true }];

const ROW = {
  id: 1, 客户编号: "C001", 客户名称: "ZURU", 客户类别: "大客户", 联系人: "张三",
  手机: "13800000000", 电话: "0755-123456", 付款方式: "月结", 备注: "备注一",
};

type Call = { url: string; method: string; body?: Record<string, unknown> };

function installFetch(perms: unknown = PERMS_FULL) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ url, method, body });
      const u = new URL(url, "http://test");
      const p = u.pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/master/customers" && method === "GET")
        return json({ items: [ROW], total: 1 });
      if (p === "/api/master/customers" && method === "POST") return json({ id: 2 });
      if (/^\/api\/master\/customers\/\d+$/.test(p) && method === "PUT") return json(body);
      if (/^\/api\/master\/customers\/\d+$/.test(p) && method === "DELETE") return noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (perms?: unknown) => {
  const calls = installFetch(perms);
  renderWithProviders(<CustomerMasterPage />, "/master/客户资料");
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("C001")).toBeInTheDocument());

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CustomerMasterPage", () => {
  it("列表渲染:8 列字段 + 类别徽章 + 总数", async () => {
    setup();
    await waitList();
    expect(screen.getByText("ZURU")).toBeInTheDocument();
    expect(screen.getByText("大客户")).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("13800000000")).toBeInTheDocument();
    expect(screen.getByText("共 1 条")).toBeInTheDocument();
  });

  it("搜索回车:带 keyword 参数重查并回第 1 页", async () => {
    const calls = setup();
    await waitList();
    fireEvent.change(screen.getByLabelText("搜索客户资料"), { target: { value: "ZU" } });
    fireEvent.keyDown(screen.getByLabelText("搜索客户资料"), { key: "Enter" });
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("keyword=ZU") && c.url.includes("page=1"))).toBe(true),
    );
  });

  it("新增:弹窗填表 POST /master/customers", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByRole("button", { name: /新增/ }));
    await waitFor(() => expect(screen.getByLabelText("客户编号")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("客户编号"), { target: { value: "C002" } });
    fireEvent.change(screen.getByLabelText("客户名称"), { target: { value: "新客户" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/master/customers" &&
            c.body?.客户编号 === "C002" &&
            c.body?.客户名称 === "新客户",
        ),
      ).toBe(true),
    );
    await screen.findByText("已保存");
  });

  it("双击选中后编辑:表单预填,保存 PUT /master/customers/{id}", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("C001"));
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    await waitFor(() => expect(screen.getByLabelText("客户名称")).toHaveValue("ZURU"));
    fireEvent.change(screen.getByLabelText("客户名称"), { target: { value: "ZURU国际" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "PUT" && c.url === "/api/master/customers/1" && c.body?.客户名称 === "ZURU国际",
        ),
      ).toBe(true),
    );
  });

  it("删除:确认后 DELETE /master/customers/{id}", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("C001"));
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /确认删除/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/master/customers/1")).toBe(true),
    );
  });

  it("无「打开」位:无权访问提示", async () => {
    setup([{ 组: "基础资料", 菜单: "客户资料" }]);
    await screen.findByText("无权访问客户资料");
  });

  it("必填校验:编号/名称为空拦截不发请求,必填字段带 * 标识", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByRole("button", { name: /新增/ }));
    await waitFor(() => expect(screen.getByLabelText("客户编号")).toBeInTheDocument());
    // * 标识(弹窗内,表头同名列不参与)
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText("客户编号").parentElement?.textContent).toContain("*");
    expect(within(dlg).getByText("客户名称").parentElement?.textContent).toContain("*");
    // 全部留空点确定:拦截,无 POST
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await screen.findByText("客户编号不能为空");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    // 只填编号:拦截在名称
    fireEvent.change(screen.getByLabelText("客户编号"), { target: { value: "C003" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await screen.findByText("客户名称不能为空");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});
