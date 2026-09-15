import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request:NextRequest) {
  const qcSystemUrl=process.env.QC_SYSTEM_API_URL?.trim();
  if(!qcSystemUrl)return NextResponse.json({error:"尚未配置 QC 验货系统地址（QC_SYSTEM_API_URL）"},{status:503});
  const target=new URL(qcSystemUrl);
  request.nextUrl.searchParams.forEach((value,key)=>target.searchParams.set(key,value));
  try{
    const headers=new Headers({accept:"application/json"});
    const token=process.env.QC_SYSTEM_API_TOKEN?.trim();
    if(token)headers.set("authorization",`Bearer ${token}`);
    const response=await fetch(target,{headers,cache:"no-store"});
    return new NextResponse(await response.arrayBuffer(),{status:response.status,headers:{"content-type":response.headers.get("content-type")||"application/json"}});
  }catch(error){return NextResponse.json({error:`QC 验货系统连接失败：${error instanceof Error?error.message:"未知错误"}`},{status:502});}
}
