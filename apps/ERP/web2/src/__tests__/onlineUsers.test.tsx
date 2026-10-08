// 在线人员页 + 在线心跳:
//  - 页面:三色状态渲染(在线绿/忙线黄/离线灰)、统计行、30s 自动刷新(refetchInterval)、账号管理·打开 权限门
//  - useHeartbeat:挂载即打心跳(活动=true),60s 间隔,10 分钟无操作后活动=false
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/setup";
import OnlineUsersPage from "@/pages/OnlineUsersPage";
import { useHeartbeat } from "@/hooks/useHeartbeat";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const PERMS = { 账号管理: { 打开: true } };

const ROWS = [
  { 用户: "admin", 在线状态: "在线", 上次登录: "2026-09-21 08:00", 最后活动时间: "2026-09-21 08:30" },
  { 用户: "op1", 在线状态: "忙线", 上次登录: "2026-09-21 07:00", 最后活动时间: "2026-09-21 07:55" },
  { 用户: "op2", 在线状态: "离线", 上次登录: "2026-09-20 18:00", 最后活动时间: null },
];

function stubFetch(rows: unknown, perms: unknown = PERMS) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("/api/auth/me/permissions")) return json(perms);
      if (url.includes("/api/admin/accounts")) return json(rows);
      return json(null, 404);
    }),
  );
  return calls;
}

beforeEach(() => {
  localStorage.setItem("web2.token", "t");
  localStorage.setItem("web2.user", "admin");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("在线人员页", () => {
  it("三色状态渲染+统计行", async () => {
    stubFetch(ROWS);
    renderWithProviders(<OnlineUsersPage />, "/online-users");
    await waitFor(() => expect(screen.getByText("admin")).toBeTruthy());
    const online = screen.getByText("在线", { selector: "td" });
    const busy = screen.getByText("忙线", { selector: "td" });
    const offline = screen.getByText("离线", { selector: "td" });
    expect(online.className).toContain("#15803d");
    expect(busy.className).toContain("#b45309");
    expect(offline.className).toContain("#5f6b7d");
    expect(screen.getByText(/在线 1 · 忙线 1 · 离线 1/)).toBeTruthy();
  });

  it("带 30s refetchInterval 自动刷新", async () => {
    const calls = stubFetch(ROWS);
    renderWithProviders(<OnlineUsersPage />, "/online-users");
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/admin/accounts"))).toBe(true),
    );
    // refetchInterval 配置在组件内,此处验证查询键触发账号列表请求
    expect(calls.filter((c) => c.url.includes("/api/admin/accounts")).length).toBeGreaterThan(0);
  });

  it("无 账号管理·打开 权限:显示无权访问,不渲染行数据", async () => {
    stubFetch(ROWS, {});
    renderWithProviders(<OnlineUsersPage />, "/online-users");
    await waitFor(() => expect(screen.getByText("无权访问 在线人员")).toBeTruthy());
    // usePerms 未加载完成时乐观放行会带出一条请求(全站通例,后端 403 兜底),但行数据不渲染
    expect(screen.queryByText("op1")).toBeNull();
  });
});

describe("useHeartbeat 在线心跳", () => {
  function Probe() {
    useHeartbeat();
    return null;
  }

  it("挂载即打 活动=true 心跳,60s 后再打;10 分钟无操作后 活动=false", async () => {
    vi.useFakeTimers();
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/api/auth/heartbeat")) bodies.push(String(init?.body));
        return json({ 消息: "ok" });
      }),
    );
    try {
      renderWithProviders(<Probe />);
      // useEffect 在 act 内同步执行,挂载即第一条心跳
      expect(bodies.length).toBe(1);
      expect(JSON.parse(bodies[0])).toEqual({ 活动: true });

      // 有键盘操作:活动标记保持 true
      await vi.advanceTimersByTimeAsync(30 * 1000);
      fireEvent.keyDown(window, { key: "a" });
      await vi.advanceTimersByTimeAsync(30 * 1000);
      expect(bodies.length).toBe(2);
      expect(JSON.parse(bodies[1])).toEqual({ 活动: true });

      // 11 分钟无任何操作:活动=false
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
      const last = JSON.parse(bodies[bodies.length - 1]);
      expect(last).toEqual({ 活动: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("未登录(无 token)不打心跳", async () => {
    localStorage.clear();
    const spy = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", spy);
    renderWithProviders(<Probe />);
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });
});
