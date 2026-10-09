import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params:Promise<{ id:string }> }) {
  try { const {id}=await context.params; return proxyResponse(await backendFetch(request, `/api/users/${id}/mailbox-test`, { method:"POST", headers:{"content-type":"application/json"}, body:await request.text() })); }
  catch { return NextResponse.json({error:"邮箱测试服务连接失败，请稍后重试"},{status:502}); }
}
