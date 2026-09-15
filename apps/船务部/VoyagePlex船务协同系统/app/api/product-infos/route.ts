import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse, requireRole } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
export async function GET(request:NextRequest) { const auth=await requireRole(request,["admin"]); if(auth.response)return auth.response; return proxyResponse(await backendFetch(request,`/api/product-infos?${request.nextUrl.searchParams}`)); }
export async function POST(request:NextRequest) { const auth=await requireRole(request,["admin"]); if(auth.response)return auth.response; try{return proxyResponse(await backendFetch(request,"/api/product-infos",{method:"POST",headers:{"content-type":"application/json"},body:await request.text()}));}catch{return NextResponse.json({error:"后台服务连接失败"},{status:502});} }
