// 功能设置页:对照老系统 web/src/pages/system/FeatureSettingsPage.tsx。
// 缺键回落默认 HKD/4/2/保存=PUT 字符串化三键/无「保存」位控件只读/后端 400 消息透出。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { permRowsToMap, renderWithProviders } from "../test/setup";
import FeatureSettingsPage from "@/pages/FeatureSettingsPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const PERMS_FULL = [{ 组: "系统管理", 菜单: "功能设置", 打开: true, 保存: true }];
const PERMS_RDONLY = [{ 组: "系统管理", 菜单: "功能设置", 打开: true, 保存: false }];

type Call = { url: string; method: string; body?: Record<string, unknown> };

function installFetch(rows: unknown, perms: unknown = PERMS_FULL, putFail = false) {
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
      if (p === "/api/feature-settings" && method === "GET") return json(rows);
      if (p === "/api/feature-settings" && method === "PUT")
        return putFail ? json({ 消息: "小数位须为 0-6 的整数" }, 400) : json({ 消息: "已保存" });
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

describe("FeatureSettingsPage", () => {
  it("渲染后端值;缺键回落默认 HKD/4/2", async () => {
    installFetch([{ 键: "系统.默认货币", 标签: "默认货币", 值: "RMB" }]);
    renderWithProviders(<FeatureSettingsPage />, "/system/feature-settings");
    await waitFor(() => expect(screen.getByLabelText("默认货币")).toHaveTextContent("RMB"));
    expect(screen.getByLabelText("单价小数位")).toHaveValue(4);
    expect(screen.getByLabelText("数量小数位")).toHaveValue(2);
  });

  it("保存=PUT 三键字符串化", async () => {
    const calls = installFetch([
      { 键: "系统.默认货币", 标签: "默认货币", 值: "HKD" },
      { 键: "系统.单价小数位", 标签: "单价小数位", 值: "3" },
      { 键: "系统.数量小数位", 标签: "数量小数位", 值: "0" },
    ]);
    renderWithProviders(<FeatureSettingsPage />, "/system/feature-settings");
    await waitFor(() => expect(screen.getByLabelText("单价小数位")).toHaveValue(3));
    fireEvent.click(screen.getByLabelText("默认货币"));
    fireEvent.click(screen.getByRole("option", { name: "USD" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put!.body).toEqual({
        值: { "系统.默认货币": "USD", "系统.单价小数位": "3", "系统.数量小数位": "0" },
      });
    });
    await waitFor(() => expect(screen.getByText("已保存")).toBeInTheDocument());
  });

  it("无「保存」位:控件只读且无保存按钮", async () => {
    installFetch([], PERMS_RDONLY);
    renderWithProviders(<FeatureSettingsPage />, "/system/feature-settings");
    await waitFor(() => expect(screen.getByLabelText("默认货币")).toBeDisabled());
    expect(screen.getByLabelText("单价小数位")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });

  it("PUT 400 透出后端消息", async () => {
    installFetch([], PERMS_FULL, true);
    renderWithProviders(<FeatureSettingsPage />, "/system/feature-settings");
    await waitFor(() => expect(screen.getByLabelText("默认货币")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("小数位须为 0-6 的整数")).toBeInTheDocument());
  });
});
