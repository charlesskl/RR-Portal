// 用户修改密码页 + 退出软件页:对照老系统 web/src/pages/ChangePasswordPage.tsx 与 system/LogoutPage.tsx。
// 修改密码:前端校验(必填/至少 6 位/不能与原密码相同/两次一致)+ POST /auth/change-password + 成功清空表单;
// 退出:清 web2.token/web2.user 并跳登录页。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/setup";
import ChangePasswordPage from "@/pages/ChangePasswordPage";
import LogoutPage from "@/pages/LogoutPage";

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

type Call = { url: string; method: string; body?: Record<string, unknown> };

function installFetch(fail = false) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ url, method, body });
      const p = new URL(url, "http://test").pathname;
      if (p === "/api/auth/change-password" && method === "POST")
        return fail ? json({ 消息: "原密码错误" }, 400) : json({ 消息: "密码修改成功" });
      return json({ 消息: `unhandled ${method} ${p}` }, 404);
    }),
  );
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("web2.user", "tester");
  localStorage.setItem("web2.token", "tok-1");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChangePasswordPage", () => {
  it("前端校验:原密码必填/新密码至少 6 位/不能与原密码相同/两次一致", async () => {
    const calls = installFetch();
    renderWithProviders(<ChangePasswordPage />, "/change-password");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("请输入原密码")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("原密码"), { target: { value: "old123" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("请输入新密码")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("新密码长度至少 6 位")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "old123" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("新密码不能与原密码相同")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new123" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new124" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("两次输入的新密码不一致")).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes("change-password"))).toBe(false);
  });

  it("成功:POST body 正确并清空表单;失败透出后端消息", async () => {
    const calls = installFetch();
    renderWithProviders(<ChangePasswordPage />, "/change-password");
    fireEvent.change(screen.getByLabelText("原密码"), { target: { value: "old123" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new123" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new123" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post!.body).toEqual({ 原密码: "old123", 新密码: "new123" });
    });
    await waitFor(() => expect(screen.getByText("密码修改成功")).toBeInTheDocument());
    expect(screen.getByLabelText("原密码")).toHaveValue("");
    cleanup();
    vi.unstubAllGlobals();
    installFetch(true);
    renderWithProviders(<ChangePasswordPage />, "/change-password");
    fireEvent.change(screen.getByLabelText("原密码"), { target: { value: "bad123" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new123" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new123" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("原密码错误")).toBeInTheDocument());
  });
});

describe("LogoutPage", () => {
  it("清令牌与用户并尝试整页跳登录", async () => {
    expect(localStorage.getItem("web2.token")).toBe("tok-1");
    renderWithProviders(<LogoutPage />, "/logout");
    await waitFor(() => expect(localStorage.getItem("web2.token")).toBeNull());
    expect(localStorage.getItem("web2.user")).toBeNull();
    expect(screen.getByText("正在退出...")).toBeInTheDocument();
  });
});
