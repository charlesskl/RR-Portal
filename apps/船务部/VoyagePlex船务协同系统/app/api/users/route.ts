import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { return proxyResponse(await backendFetch(request, "/api/users")); }
  catch (error) { return NextResponse.json({ error:`后台服务连接失败：${error instanceof Error ? error.message : "未知错误"}` }, { status:502 }); }
}
export async function POST(request: NextRequest) {
  try { return proxyResponse(await backendFetch(request, "/api/users", { method:"POST", headers:{"content-type":"application/json"}, body:await request.text() })); }
  catch (error) { return NextResponse.json({ error:`后台服务连接失败：${error instanceof Error ? error.message : "未知错误"}` }, { status:502 }); }
}
