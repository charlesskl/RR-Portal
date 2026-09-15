import { NextRequest, NextResponse } from "next/server";

export const backendBaseUrl = process.env.VOYAGEPLEX_API_BASE_URL || "http://127.0.0.1:5088";

export function backendHeaders(request: Request, values?: HeadersInit) {
  const headers = new Headers(values);
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

export async function backendFetch(request: Request, path: string, init: RequestInit = {}) {
  return fetch(`${backendBaseUrl}${path}`, {
    ...init,
    headers: backendHeaders(request, init.headers),
    cache: "no-store",
  });
}

export async function proxyResponse(response: Response) {
  const headers = new Headers();
  headers.set("content-type", response.headers.get("content-type") || "application/json");
  const disposition = response.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);
  return new NextResponse(await response.arrayBuffer(), { status: response.status, headers });
}

export async function requireRole(request: NextRequest, roles: Array<"admin" | "shipping" | "warehouse">) {
  try {
    const response = await backendFetch(request, "/api/auth/me");
    if (!response.ok) return { response: NextResponse.json({ error:"请先登录" }, { status:401 }) };
    const user = await response.json() as { role:"admin" | "shipping" | "warehouse" };
    if (!roles.includes(user.role)) return { response: NextResponse.json({ error:"当前账号无权使用此功能" }, { status:403 }) };
    return { user };
  } catch {
    return { response: NextResponse.json({ error:"后台服务连接失败" }, { status:502 }) };
  }
}
