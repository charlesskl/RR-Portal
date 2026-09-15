import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
const allowed = new Set(["setup-status", "setup", "login", "me", "logout"]);

async function forward(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!allowed.has(action)) return NextResponse.json({ error:"接口不存在" }, { status:404 });
  try {
    const method = request.method;
    const response = await backendFetch(request, `/api/auth/${action}`, {
      method,
      headers: method === "POST" && action !== "logout" ? { "content-type":"application/json" } : undefined,
      body: method === "POST" && action !== "logout" ? await request.text() : undefined,
    });
    return proxyResponse(response);
  } catch (error) {
    return NextResponse.json({ error:`后台服务连接失败：${error instanceof Error ? error.message : "未知错误"}` }, { status:502 });
  }
}

export const GET = forward;
export const POST = forward;
