import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
export async function PATCH(request:NextRequest,context:{params:Promise<{contactId:string}>}){
  try{return proxyResponse(await backendFetch(request,`/api/mail/contacts/${(await context.params).contactId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:await request.text()}));}
  catch{return NextResponse.json({error:"后台服务连接失败"},{status:502});}
}
