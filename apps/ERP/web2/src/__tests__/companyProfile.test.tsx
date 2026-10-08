// 基本资料页:对照老系统 web/src/pages/system/CompanyProfilePage.tsx。
// GET 渲染键值表单(标签来自后端)/保存=PUT 全量键值/无「基本资料·保存」位时输入框只读且无保存按钮/
// 完全无权限(打开+保存皆无)显示无权面板/加载失败 toast。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import CompanyProfilePage from "@/pages/CompanyProfilePage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const ITEMS = [
  { 键: "公司.名称", 标签: "公司名称", 值: "永恒玩具厂" },
  { 键: "公司.地址", 标签: "地址", 值: "深圳市宝安区" },
  { 键: "公司.电话", 标签: "电话", 值: null },
];

const PERMS_FULL = [{ 组: "系统管理", 菜单: "基本资料", 打开: true, 保存: true }];
const PERMS_RDONLY = [{ 组: "系统管理", 菜单: "基本资料", 打开: true, 保存: false }];

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
      if (p === "/api/company-profile" && method === "GET") return json(ITEMS);
      if (p === "/api/company-profile" && method === "PUT") return json({ 消息: "已保存" });
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

describe("CompanyProfilePage", () => {
  it("GET 渲染后端返回的键值表单(null 值显示为空)", async () => {
    installFetch();
    renderWithProviders(<CompanyProfilePage />, "/system/company-profile");
    await waitFor(() => expect(screen.getByLabelText("公司名称")).toHaveValue("永恒玩具厂"));
    expect(screen.getByLabelText("地址")).toHaveValue("深圳市宝安区");
    expect(screen.getByLabelText("电话")).toHaveValue("");
  });

  it("保存=PUT /company-profile,body 为 {值:{键:值}} 全量", async () => {
    const calls = installFetch();
    renderWithProviders(<CompanyProfilePage />, "/system/company-profile");
    await waitFor(() => expect(screen.getByLabelText("公司名称")).toHaveValue("永恒玩具厂"));
    fireEvent.change(screen.getByLabelText("电话"), { target: { value: "0755-123" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT" && c.url.includes("/company-profile"));
      expect(put).toBeTruthy();
      expect(put!.body).toEqual({
        值: { "公司.名称": "永恒玩具厂", "公司.地址": "深圳市宝安区", "公司.电话": "0755-123" },
      });
    });
    await waitFor(() => expect(screen.getByText("已保存")).toBeInTheDocument());
  });

  it("无「保存」位:输入框只读且无保存按钮", async () => {
    installFetch(PERMS_RDONLY);
    renderWithProviders(<CompanyProfilePage />, "/system/company-profile");
    await waitFor(() => expect(screen.getByLabelText("公司名称")).toHaveValue("永恒玩具厂"));
    await waitFor(() => expect(screen.getByLabelText("公司名称")).toBeDisabled());
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });

  it("打开/保存皆无:显示无权面板", async () => {
    installFetch([]);
    renderWithProviders(<CompanyProfilePage />, "/system/company-profile");
    await waitFor(() => expect(screen.getByText("无权访问基本资料")).toBeInTheDocument());
  });

  it("GET 失败显示错误 toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const p = new URL(String(input), "http://test").pathname;
        if (p.endsWith("/me/permissions")) return json(permRowsToMap(PERMS_FULL));
        return json({ 消息: "boom" }, 500);
      }),
    );
    renderWithProviders(<CompanyProfilePage />, "/system/company-profile");
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });
});
