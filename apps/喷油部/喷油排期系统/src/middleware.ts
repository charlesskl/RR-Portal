// 全局登录拦截中间件
// 目的：作为统一鉴权入口，未登录用户访问任何受保护资源都会被拦截。
//   - 受保护页面（HTML）→ 302 跳转到 /login
//   - 受保护接口（/api/*）→ 返回 401 JSON
// 公共路径（登录页 / 登录接口 / 健康检查）直通，不做鉴权。
//
// 实现说明：
//   登录已迁移到 .NET 后端，凭证是 .NET 签发的 JWT（存 HttpOnly Cookie sprayplan_session）。
//   Next.js middleware 跑在 Edge runtime，不能用 Node 的 crypto，所以用 jose 验签
//   （jose 同时兼容 Edge 与 Node）。验签通过即视为已登录；细粒度角色校验由各页面/路由负责。
import { NextResponse, type NextRequest } from "next/server";

// 不需要登录就能访问的路径前缀
// - /login：登录页本身
// - /api/auth/login：登录接口（鸡生蛋：登录前必然没有凭证；此路径已代理到 .NET）
// - /api/health：健康检查（监控系统会无 token 调用）
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];

// 与 .NET 后端写入的 cookie 名一致
const SESSION_COOKIE_NAME = "sprayplan_session";
const DOTNET_API_URL = process.env.DOTNET_API_URL || "http://localhost:5080";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const SCHEDULE_OVERVIEW_PATH = "/api/schedule/overview";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const appPath = BASE_PATH && pathname.startsWith(BASE_PATH)
    ? pathname.slice(BASE_PATH.length) || "/"
    : pathname;

  // 1. 公共路径直接放行
  if (PUBLIC_PATHS.some((p) => appPath === p || appPath.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // 2. API requests are validated again by ASP.NET Core. For pages, validate
  // the cookie against the internal API so the Edge bundle never embeds the
  // production JWT secret at image-build time.
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  let loggedIn = false;
  if (token) {
    if (appPath.startsWith("/api")) {
      loggedIn = true;
    } else {
      try {
        const validation = await fetch(new URL("/api/auth/session", DOTNET_API_URL), {
          headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
          cache: "no-store",
        });
        loggedIn = validation.ok;
      } catch {
        loggedIn = false;
      }
    }
  }

  // 3. 已登录 → 放行
  if (loggedIn) {
    if (appPath === SCHEDULE_OVERVIEW_PATH) {
      const upstreamUrl = new URL(SCHEDULE_OVERVIEW_PATH, DOTNET_API_URL);
      upstreamUrl.search = req.nextUrl.search;
      return NextResponse.rewrite(upstreamUrl);
    }
    return NextResponse.next();
  }

  // 4. 未登录：API 返回 401 JSON，页面 302 跳转到 /login
  if (appPath.startsWith("/api")) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const loginUrl = new URL(`${BASE_PATH}/login`, req.url);
  return NextResponse.redirect(loginUrl);
}

// 路由匹配器：跳过 Next.js 内部静态资源
// - _next/static：构建后的 JS/CSS chunk
// - _next/image：图片优化端点
// - favicon.ico：站点图标
// 其余所有请求都会进入 middleware
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
