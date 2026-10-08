// 网上升级页:对照老系统 web/src/pages/system/UpgradePage.tsx。
// GET /admin/version 渲染版本四行(程序集版本/构建信息/运行时/环境);空值显示 -;失败 toast。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/setup";
import UpgradePage from "@/pages/UpgradePage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const VERSION = { 版本: "1.4.0.0", 信息版本: "1.4.0+abc123", 框架: ".NET 9.0.8", 环境: "Production" };

function installFetch(fail = false) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const p = new URL(url, "http://test").pathname;
      if (p === "/api/admin/version")
        return fail ? json({ 消息: "boom" }, 500) : json(VERSION);
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

describe("UpgradePage", () => {
  it("GET /admin/version 渲染版本信息四行", async () => {
    const calls = installFetch();
    renderWithProviders(<UpgradePage />, "/system/upgrade");
    await waitFor(() => expect(screen.getByText("1.4.0.0")).toBeInTheDocument());
    expect(screen.getByText("1.4.0+abc123")).toBeInTheDocument();
    expect(screen.getByText(".NET 9.0.8")).toBeInTheDocument();
    expect(screen.getByText("Production")).toBeInTheDocument();
    for (const label of ["程序集版本", "构建信息", "运行时", "环境"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(calls.some((u) => u.includes("/api/admin/version"))).toBe(true);
  });

  it("获取失败显示错误 toast", async () => {
    installFetch(true);
    renderWithProviders(<UpgradePage />, "/system/upgrade");
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });
});
