import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";
export const dynamic="force-dynamic";
type Context={params:Promise<{action?:string[]}>};
async function forward(request:NextRequest,context:Context){
  const {action=[]}=await context.params;
  if(action.length>1)return NextResponse.json({error:"操作路径无效"},{status:400});
  try{return proxyResponse(await backendFetch(request,`/api/inventory/writebacks${action.length?`/${encodeURIComponent(action[0])}`:""}`,{method:request.method,...(request.method==="POST"?{headers:{"content-type":"application/json"},body:await request.text()}:{})}));}
  catch{return NextResponse.json({error:"回写记录服务连接失败，请勿重复扣库存"},{status:502});}
}
export const GET=forward;
export const POST=forward;
