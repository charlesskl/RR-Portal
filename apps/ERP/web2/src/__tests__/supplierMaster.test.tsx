// 供应商资料页:对照老系统 web/src/pages/master/SupplierMasterPage.tsx。
// 左树类别(全部供应商(N) + 类别(归属计数),按 类别/名称 双值匹配)/关键字前端过滤/
// 新增(默认带选中类别,编号名称必填)/编辑(GET 详情预填,PUT)/删除/
// 新增类别(类别=名称 同值,受「供应商类别·保存」位)/无打开位提示。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import SupplierMasterPage from "@/pages/SupplierMasterPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const PERMS_FULL = [
  { 组: "基础资料", 菜单: "供应商资料", 打开: true, 保存: true, 删除: true },
  { 组: "基础资料", 菜单: "供应商类别", 保存: true },
];

const ROWS = [
  { id: 1, 供应商编号: "S001", 供应商名称: "恒科", 供应商类别: "原料", 联系人: "王五", 手机: "13711111111", 电话: "0755-1", 付款方式: "月结", 备注: "" },
  { id: 2, 供应商编号: "S002", 供应商名称: "远大", 供应商类别: "包装", 联系人: "赵六", 手机: "13722222222", 电话: "", 付款方式: "", 备注: "" },
];

const CATS = [
  { id: 9, 类别: "原料", 名称: "原料" },
  { id: 10, 类别: "包装", 名称: "包装" },
];

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
      const p = new URL(url, "http://test").pathname;
      if (p.endsWith("/me/permissions")) return json(permRowsToMap(perms));
      if (p === "/api/master/supplier-categories" && method === "GET") return json({ items: CATS, total: 2 });
      if (p === "/api/master/supplier-categories" && method === "POST") return json({ id: 11 });
      if (p === "/api/master/suppliers" && method === "GET") return json({ items: ROWS, total: 2 });
      if (p === "/api/master/suppliers" && method === "POST") return json({ id: 3 });
      if (p === "/api/master/suppliers/1" && method === "GET") return json(ROWS[0]);
      if (/^\/api\/master\/suppliers\/\d+$/.test(p) && method === "PUT") return json(body);
      if (/^\/api\/master\/suppliers\/\d+$/.test(p) && method === "DELETE") return noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

const setup = (perms?: unknown) => {
  const calls = installFetch(perms);
  renderWithProviders(<SupplierMasterPage />, "/master/供应商资料");
  return calls;
};

const waitList = () => waitFor(() => expect(screen.getByText("S001")).toBeInTheDocument());

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SupplierMasterPage", () => {
  it("列表 + 左树类别计数渲染(一次拉全量)", async () => {
    const calls = setup();
    await waitList();
    expect(calls.some((c) => c.url.includes("size=2000"))).toBe(true);
    expect(screen.getByText("恒科")).toBeInTheDocument();
    expect(screen.getByText("远大")).toBeInTheDocument();
    expect(screen.getByText("全部供应商(2)")).toBeInTheDocument();
    expect(screen.getByText("原料(1)")).toBeInTheDocument();
    expect(screen.getByText("包装(1)")).toBeInTheDocument();
  });

  it("选中类别:前端过滤只显示该类别供应商(不再请求)", async () => {
    const calls = setup();
    await waitList();
    const before = calls.filter((c) => c.url.includes("/api/master/suppliers")).length;
    fireEvent.click(screen.getByText("包装(1)"));
    await waitFor(() => expect(screen.queryByText("恒科")).not.toBeInTheDocument());
    expect(screen.getByText("远大")).toBeInTheDocument();
    expect(calls.filter((c) => c.url.includes("/api/master/suppliers")).length).toBe(before);
  });

  it("关键字过滤:编号/名称/联系人 模糊匹配", async () => {
    setup();
    await waitList();
    fireEvent.change(screen.getByLabelText("搜索供应商"), { target: { value: "赵六" } });
    await waitFor(() => expect(screen.queryByText("恒科")).not.toBeInTheDocument());
    expect(screen.getByText("远大")).toBeInTheDocument();
  });

  it("新增:默认带选中类别,编号/名称必填,保存 POST /master/suppliers", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByText("原料(1)"));
    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    await waitFor(() => expect(screen.getByLabelText("供应商编号")).toBeInTheDocument());
    expect(screen.getByLabelText("供应商类别")).toHaveTextContent("原料");
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await screen.findByText("请输入供应商编号");
    fireEvent.change(screen.getByLabelText("供应商编号"), { target: { value: "S003" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await screen.findByText("请输入供应商名称");
    fireEvent.change(screen.getByLabelText("供应商名称"), { target: { value: "新供应商" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/master/suppliers" &&
            c.body?.供应商编号 === "S003" &&
            c.body?.供应商类别 === "原料",
        ),
      ).toBe(true),
    );
  });

  it("双击选中后编辑:GET 详情预填,保存 PUT /master/suppliers/{id}", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("S001"));
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    await waitFor(() => expect(screen.getByLabelText("供应商名称")).toHaveValue("恒科"));
    fireEvent.change(screen.getByLabelText("供应商名称"), { target: { value: "恒科新材" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "PUT" && c.url === "/api/master/suppliers/1" && c.body?.供应商名称 === "恒科新材",
        ),
      ).toBe(true),
    );
  });

  it("删除:确认后 DELETE /master/suppliers/{id}", async () => {
    const calls = setup();
    await waitList();
    fireEvent.doubleClick(screen.getByText("S001"));
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /确认删除/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/master/suppliers/1")).toBe(true),
    );
  });

  it("新增类别:类别/名称 同值 POST /master/supplier-categories", async () => {
    const calls = setup();
    await waitList();
    fireEvent.click(screen.getByRole("button", { name: "新增子类别" }));
    await waitFor(() => expect(screen.getByLabelText("类别名称")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("类别名称"), { target: { value: "五金" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url === "/api/master/supplier-categories" &&
            c.body?.类别 === "五金" &&
            c.body?.名称 === "五金",
        ),
      ).toBe(true),
    );
  });

  it("无「供应商类别·保存」位:类别新增按钮不渲染", async () => {
    setup([{ 组: "基础资料", 菜单: "供应商资料", 打开: true, 保存: true, 删除: true }]);
    await waitList();
    expect(screen.queryByRole("button", { name: "新增子类别" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新增同级类别" })).not.toBeInTheDocument();
  });

  it("无「打开」位:无权访问提示", async () => {
    setup([{ 组: "基础资料", 菜单: "供应商资料" }]);
    await screen.findByText("无权访问供应商资料");
  });
});
