import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";

export const dynamic="force-dynamic";
export async function POST(request:NextRequest,context:{params:Promise<{itemId:string;action:string}>}){
  try{const {itemId,action}=await context.params;return proxyResponse(await backendFetch(request,`/api/mail/candidates/${itemId}/${action}`,{method:"POST"}));}
  catch{return NextResponse.json({error:"后台服务连接失败"},{status:502});}
}
