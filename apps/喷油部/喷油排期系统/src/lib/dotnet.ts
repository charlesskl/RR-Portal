// 服务端调用 .NET 后端的统一助手（供 SSR 页面/服务端组件取数用）。
// 作用：
//   1. 自动带上当前登录用户的 JWT Cookie（sprayplan_session），让 .NET 的 [Authorize] 接口认得这次请求；
//   2. cache: "no-store" 关闭缓存，保证每次都拿最新数据（排期/实绩等数据会频繁变）。
// 用法：const lines = await dotnetGet<DotnetLine[]>("/api/lines");
import { cookies } from "next/headers";

// .NET 后端地址（开发默认 5080；部署用环境变量 DOTNET_API_URL 覆盖）。
const BASE = process.env.DOTNET_API_URL || "http://localhost:5080";

const COOKIE_NAME = "sprayplan_session";

// GET 请求 .NET 接口并返回解析后的 JSON。失败抛错（让页面的错误边界/日志能感知）。
export async function dotnetGet<T>(path: string): Promise<T> {
  const token = cookies().get(COOKIE_NAME)?.value;
  const res = await fetch(`${BASE}${path}`, {
    // 把登录 Cookie 透传给 .NET（服务端到服务端，不经浏览器）
    headers: token ? { Cookie: `${COOKIE_NAME}=${token}` } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`调用 .NET 接口失败：${path} 返回 ${res.status}`);
  }
  return res.json() as Promise<T>;
}
