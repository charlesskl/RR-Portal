import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
export async function PUT(request: NextRequest, context: { params:Promise<{ id:string }> }) {
  try { const {id}=await context.params; return proxyResponse(await backendFetch(request, `/api/users/${id}`, { method:"PUT", headers:{"content-type":"application/json"}, body:await request.text() })); }
  catch (error) { return NextResponse.json({ error:`后台服务连接失败：${error instanceof Error ? error.message : "未知错误"}` }, { status:502 }); }
}
