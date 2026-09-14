import { NextRequest, NextResponse } from "next/server";
import { backendHeaders } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
const backend = process.env.VOYAGEPLEX_API_BASE_URL || "http://127.0.0.1:5088";

export async function POST(request:NextRequest) {
  try{
    const response=await fetch(`${backend}/api/imports/email/confirm`,{method:"POST",headers:backendHeaders(request,{"content-type":"application/json"}),body:await request.text(),cache:"no-store"});
    return new NextResponse(await response.arrayBuffer(),{status:response.status,headers:{"content-type":response.headers.get("content-type")||"application/json"}});
  }catch(error){return NextResponse.json({error:`后台服务连接失败：${error instanceof Error?error.message:"未知错误"}`},{status:502});}
}
