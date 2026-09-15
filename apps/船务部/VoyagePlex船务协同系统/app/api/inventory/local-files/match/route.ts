import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
const parser = process.env.EMAIL_PARSER_BASE_URL || "http://127.0.0.1:8091";

export async function POST(request: NextRequest) {
  const auth=await requireRole(request,["admin","warehouse"]); if(auth.response)return auth.response;
  try {
    const response = await fetch(`${parser}/v1/local-inventory-files/match`, { method:"POST", body:await request.formData() });
    return new NextResponse(await response.arrayBuffer(), { status:response.status,
      headers:{"content-type":response.headers.get("content-type")||"application/json"} });
  } catch (error) {
    return NextResponse.json({error:`库存查询服务连接失败：${error instanceof Error?error.message:"未知错误"}`},{status:502});
  }
}
