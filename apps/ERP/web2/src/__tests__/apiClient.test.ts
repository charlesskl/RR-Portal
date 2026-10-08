import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";

const stubFetch = (status: number, body: string, contentType = "application/json") =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status, headers: { "Content-Type": contentType } })),
  );

afterEach(() => vi.unstubAllGlobals());

describe("api 客户端错误兜底", () => {
  it("后端 500 返回 text/plain(如 SqlException 原文)时给状态码文案,不抛 JSON 解析错", async () => {
    stubFetch(500, "Microsoft.Data.SqlClient.SqlException: Invalid column name 'MA货号'", "text/plain; charset=utf-8");
    const err = (await api("/styles/77772/materials").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.message).toBe("请求失败 (500)");
  });

  it("错误体是 JSON 时仍取 {消息} 字段", async () => {
    stubFetch(400, JSON.stringify({ 消息: "款号已存在" }));
    const err = (await api("/x").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("款号已存在");
  });

  it("2xx 但响应非 JSON 时抛 响应格式异常,不抛 SyntaxError", async () => {
    stubFetch(200, "not json", "text/plain");
    const err = (await api("/x").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("响应格式异常");
  });

  it("正常 JSON 响应不受影响", async () => {
    stubFetch(200, JSON.stringify({ 款号: "77772" }));
    await expect(api<{ 款号: string }>("/x")).resolves.toEqual({ 款号: "77772" });
  });
});
