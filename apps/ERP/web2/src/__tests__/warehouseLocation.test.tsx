// 仓库位置设置页:对照老系统 web/src/pages/system/WarehouseLocationPage.tsx。
// 服务端分页列表(page/size/keyword)/搜索重置到第 1 页/双击选中后编辑(无 GET 详情,行数据直填)/删除/
// 编号必填前端校验/无「保存」「删除」位时按钮隐藏。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import WarehouseLocationPage from "@/pages/WarehouseLocationPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const ROWS = [
  { id: 1, 编号: "A仓", 名称: "主仓", 备注: "一楼" },
  { id: 2, 编号: "B-01", 名称: "副仓", 备注: "" },
];

const PERMS_FULL = [{ 组: "系统管理", 菜单: "仓库位置设置", 打开: true, 保存: true, 删除: true }];
const PERMS_RDONLY = [{ 组: "系统管理", 菜单: "仓库位置设置", 打开: true }];

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
      if (p === "/api/master/warehouse-locations" && method === "GET") return json({ items: ROWS, total: 2 });
      if (p === "/api/master/warehouse-locations" && method === "POST") return json({ id: 3 });
      if (/^\/api\/master\/warehouse-locations\/\d+$/.test(p) && method === "PUT") return json({});
      if (/^\/api\/master\/warehouse-locations\/\d+$/.test(p) && method === "DELETE") return noContent();
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
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

describe("WarehouseLocationPage", () => {
  it("分页列表渲染(page=1,size=10),共 N 条", async () => {
    const calls = installFetch();
    renderWithProviders(<WarehouseLocationPage />, "/system/warehouse-locations");
    await waitFor(() => expect(screen.getByText("A仓")).toBeInTheDocument());
    expect(screen.getByText("B-01")).toBeInTheDocument();
    expect(screen.getByText("共 2 条")).toBeInTheDocument();
    const list = calls.find((c) => c.url.includes("/master/warehouse-locations?"));
    expect(list!.url).toContain("page=1");
    expect(list!.url).toContain("size=10");
  });

  it("搜索关键字随请求发送并重置页码", async () => {
    const calls = installFetch();
    renderWithProviders(<WarehouseLocationPage />, "/system/warehouse-locations");
    await waitFor(() => expect(screen.getByText("A仓")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("搜索仓库位置"), { target: { value: "主仓" } });
    await waitFor(() => {
      const q = calls.filter((c) => c.url.includes("keyword="));
      expect(q.length).toBeGreaterThan(0);
      expect(q.at(-1)!.url).toContain("keyword=%E4%B8%BB%E4%BB%93");
      expect(q.at(-1)!.url).toContain("page=1");
    });
  });

  it("新增:编号必填前端校验;通过后 POST", async () => {
    const calls = installFetch();
    renderWithProviders(<WarehouseLocationPage />, "/system/warehouse-locations");
    await waitFor(() => expect(screen.getByText("A仓")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /新增/ }));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByText("请输入编号")).toBeInTheDocument());
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(screen.getByLabelText("编号"), { target: { value: "C仓" } });
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "新仓" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/master/warehouse-locations"));
      expect(post!.body).toEqual({ 编号: "C仓", 名称: "新仓", 备注: "" });
    });
    await waitFor(() => expect(screen.getByText("已保存")).toBeInTheDocument());
  });

  it("双击选中后编辑:行数据直填,PUT 更新", async () => {
    const calls = installFetch();
    renderWithProviders(<WarehouseLocationPage />, "/system/warehouse-locations");
    await waitFor(() => expect(screen.getByText("A仓")).toBeInTheDocument());
    fireEvent.doubleClick(screen.getByText("A仓"));
    await waitFor(() => expect(screen.getByText("已选中:A仓")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    await waitFor(() => expect(screen.getByLabelText("编号")).toHaveValue("A仓"));
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "二楼" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put!.url).toContain("/master/warehouse-locations/1");
      expect(put!.body).toEqual({ 编号: "A仓", 名称: "主仓", 备注: "二楼" });
    });
  });

  it("删除走确认弹窗,DELETE 后重载", async () => {
    const calls = installFetch();
    renderWithProviders(<WarehouseLocationPage />, "/system/warehouse-locations");
    await waitFor(() => expect(screen.getByText("B-01")).toBeInTheDocument());
    fireEvent.doubleClick(screen.getByText("B-01"));
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    await waitFor(() => expect(screen.getByText(/确认删除该仓库位置/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/warehouse-locations/2"))).toBe(true);
    });
    await waitFor(() => expect(screen.getByText("已删除")).toBeInTheDocument());
  });

  it("无保存/删除位:只读列表,操作按钮隐藏", async () => {
    installFetch(PERMS_RDONLY);
    renderWithProviders(<WarehouseLocationPage />, "/system/warehouse-locations");
    await waitFor(() => expect(screen.getByText("A仓")).toBeInTheDocument());
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /新增/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /编辑/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /删除/ })).not.toBeInTheDocument();
    });
  });
});
