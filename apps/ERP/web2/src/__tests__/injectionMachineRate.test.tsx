// 啤机机型啤工表页:对照老系统 web/src/pages/system/InjectionMachineRatePage.tsx。
// 列表(机型/啤工价/备注)/啤工价列受「单价」位控制(无=列与表单字段都隐藏)/
// 新增 POST(啤工价空= null)/编辑 PUT/删除确认。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import InjectionMachineRatePage from "@/pages/InjectionMachineRatePage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const ROWS = [
  { id: 1, 啤机机型: "120T", 啤工价: 0.35, 备注: "白班" },
  { id: 2, 啤机机型: "168T", 啤工价: null, 备注: "" },
];

const PERMS_FULL = [{ 组: "系统管理", 菜单: "啤机机型啤工表", 打开: true, 保存: true, 删除: true, 单价: true }];
const PERMS_NOPRICE = [{ 组: "系统管理", 菜单: "啤机机型啤工表", 打开: true, 保存: true, 删除: true, 单价: false }];

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
      if (p === "/api/master/injection-machine-rates" && method === "GET") return json({ items: ROWS, total: 2 });
      if (p === "/api/master/injection-machine-rates" && method === "POST") return json({ id: 3 });
      if (/^\/api\/master\/injection-machine-rates\/\d+$/.test(p) && method === "PUT") return json({});
      if (/^\/api\/master\/injection-machine-rates\/\d+$/.test(p) && method === "DELETE") return noContent();
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

describe("InjectionMachineRatePage", () => {
  it("列表渲染机型与啤工价(null 显示空)", async () => {
    installFetch();
    renderWithProviders(<InjectionMachineRatePage />, "/system/injection-machine-rates");
    await waitFor(() => expect(screen.getByText("120T")).toBeInTheDocument());
    expect(screen.getByText("0.35")).toBeInTheDocument();
    expect(screen.getByText("168T")).toBeInTheDocument();
    expect(screen.getByText("共 2 条")).toBeInTheDocument();
  });

  it("无「单价」位:啤工价列与表单字段隐藏", async () => {
    installFetch(PERMS_NOPRICE);
    renderWithProviders(<InjectionMachineRatePage />, "/system/injection-machine-rates");
    await waitFor(() => expect(screen.getByText("120T")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("啤工价")).not.toBeInTheDocument());
    expect(screen.queryByText("0.35")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /新增/ }));
    await waitFor(() => expect(screen.getByLabelText("啤机机型")).toBeInTheDocument());
    expect(screen.queryByLabelText("啤工价")).not.toBeInTheDocument();
  });

  it("新增:机型必填;啤工价空串落 null", async () => {
    const calls = installFetch();
    renderWithProviders(<InjectionMachineRatePage />, "/system/injection-machine-rates");
    await waitFor(() => expect(screen.getByText("120T")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /新增/ }));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByText("请输入啤机机型")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("啤机机型"), { target: { value: "200T" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post!.body).toEqual({ 啤机机型: "200T", 啤工价: null, 备注: "" });
    });
  });

  it("编辑:双击选中后 PUT,啤工价字符串转数字", async () => {
    const calls = installFetch();
    renderWithProviders(<InjectionMachineRatePage />, "/system/injection-machine-rates");
    await waitFor(() => expect(screen.getByText("120T")).toBeInTheDocument());
    fireEvent.doubleClick(screen.getByText("120T"));
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    await waitFor(() => expect(screen.getByLabelText("啤工价")).toHaveValue(0.35));
    fireEvent.change(screen.getByLabelText("啤工价"), { target: { value: "0.4" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put!.url).toContain("/injection-machine-rates/1");
      expect(put!.body).toEqual({ 啤机机型: "120T", 啤工价: 0.4, 备注: "白班" });
    });
  });

  it("删除走确认弹窗", async () => {
    const calls = installFetch();
    renderWithProviders(<InjectionMachineRatePage />, "/system/injection-machine-rates");
    await waitFor(() => expect(screen.getByText("168T")).toBeInTheDocument());
    fireEvent.doubleClick(screen.getByText("168T"));
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    await waitFor(() => expect(screen.getByText(/确认删除该机型/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/injection-machine-rates/2"))).toBe(true);
    });
  });
});
