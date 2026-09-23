import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";

export const dynamic="force-dynamic";
export async function GET(request:NextRequest){try{return proxyResponse(await backendFetch(request,"/api/mail/settings"));}catch{return NextResponse.json({error:"后台服务连接失败"},{status:502});}}
export async function PATCH(request:NextRequest){try{return proxyResponse(await backendFetch(request,"/api/mail/settings",{method:"PATCH",headers:{"content-type":"application/json"},body:await request.text()}));}catch{return NextResponse.json({error:"后台服务连接失败"},{status:502});}}
