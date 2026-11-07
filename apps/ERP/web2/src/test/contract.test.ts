import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authApi, messagesApi } from "@/api/endpoints";
import { ApiError } from "@/lib/api";
import { getToken, setToken } from "@/lib/auth";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});

// 只替换 fetch 边界；生产客户端的序列化、令牌头、响应解包与错误处理保持真实实现。
function transport(handler: (request: Request) => Response | Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    expect(typeof input).toBe("string");
    expect(String(input)).toMatch(/^\/api\//);
    return handler(new Request(new URL(String(input), "https://contract.invalid"), init));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => localStorage.clear());
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("离线 auth/messages HTTP 客户端契约", () => {
  it("登录按中文字段序列化并解包令牌，后续未读查询发送该令牌", async () => {
    const fetchMock = transport(async request => {
      const path = new URL(request.url).pathname;
      if (path === "/api/auth/login") {
        expect(request.method).toBe("POST");
        expect(request.headers.get("Content-Type")).toBe("application/json");
        expect(request.headers.get("Authorization")).toBeNull();
        expect(await request.json()).toEqual({ 用户: "contract-user", 密码: "fixture-only" });
        return json({ 成功: true, 令牌: "fixture-token", 用户: "contract-user" });
      }
      expect(path).toBe("/api/messages/unread-count");
      expect(request.method).toBe("GET");
      expect(request.headers.get("Authorization")).toBe("Bearer fixture-token");
      expect(await request.text()).toBe("");
      return json({ count: 3 });
    });
    const login = await authApi.login("contract-user", "fixture-only");
    expect(login).toEqual({ 成功: true, 令牌: "fixture-token", 用户: "contract-user" });
    setToken(login.令牌!);
    expect(await messagesApi.unreadCount()).toEqual({ count: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("登录被拒绝时保留后端状态与错误，不返回成功或保存令牌", async () => {
    const fetchMock = transport(() => json({ 消息: "测试账号无权登录" }, 403));
    const result = authApi.login("contract-user", "fixture-only");
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ status: 403, message: "测试账号无权登录" });
    expect(getToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("未读请求失败不解包成可用数量，也不把错误掩盖为零", async () => {
    transport(() => json({ 消息: "未读查询暂不可用" }, 503));
    await expect(messagesApi.unreadCount()).rejects.toMatchObject({ status: 503, message: "未读查询暂不可用" });
  });

  it("响应格式异常与网络失败均拒绝 Promise，不因不可达而提前通过", async () => {
    transport(() => new Response("invalid json", { status: 200 }));
    await expect(messagesApi.unreadCount()).rejects.toMatchObject({ status: 200, message: "响应格式异常" });
    const unavailable = new TypeError("fixture transport unavailable");
    transport(() => Promise.reject(unavailable));
    await expect(authApi.login("contract-user", "fixture-only")).rejects.toBe(unavailable);
  });

  it("未配置 fetch mock 会被全局拒绝，撤销 mock 后也不会恢复真实网络", async () => {
    vi.unstubAllGlobals();
    await expect(messagesApi.unreadCount()).rejects.toThrow("测试禁止未 mock 的 fetch 网络请求");
    transport(() => json({ count: 7 }));
    expect(await messagesApi.unreadCount()).toEqual({ count: 7 });
    vi.unstubAllGlobals();
    await expect(authApi.login("contract-user", "fixture-only")).rejects.toThrow("测试禁止未 mock 的 fetch 网络请求");
  });
});
