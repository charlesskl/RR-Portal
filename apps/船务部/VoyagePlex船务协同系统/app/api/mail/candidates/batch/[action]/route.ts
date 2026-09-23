import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";

export const dynamic="force-dynamic";
export async function POST(request:NextRequest,context:{params:Promise<{action:string}>}){
  try{return proxyResponse(await backendFetch(request,`/api/mail/candidates/batch/${(await context.params).action}`,{method:"POST",headers:{"content-type":"application/json"},body:await request.text()}));}
  catch{return NextResponse.json({error:"后台服务连接失败"},{status:502});}
}
