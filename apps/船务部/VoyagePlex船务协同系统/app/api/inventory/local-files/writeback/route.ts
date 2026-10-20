import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { backendFetch, proxyResponse, requireRole } from "@/lib/backend-proxy";
export const dynamic="force-dynamic";
export const maxDuration=300;
const parser=process.env.EMAIL_PARSER_BASE_URL||"http://127.0.0.1:8091";
type Output={filename:string;content_base64:string;backup_base64:string;backup_filename:string};
export async function POST(request:NextRequest){
  const auth=await requireRole(request,["admin","warehouse"]);if(auth.response)return auth.response;
  let operationId="";
  try{
    const form=await request.formData();
    const begin=await backendFetch(request,"/api/inventory/writebacks/begin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({taskIds:JSON.parse(String(form.get("task_ids")||"[]")),ownerConfirmations:JSON.parse(String(form.get("owner_confirmations")||"{}"))})});
    if(!begin.ok)return proxyResponse(begin);
    const started=await begin.json();operationId=started.operationId;
    form.delete("task_ids");form.delete("owner_confirmations");form.set("payload",JSON.stringify(started.payload));
    const response=await fetch(`${parser}/v1/local-inventory-files/writeback`,{method:"POST",body:form,signal:AbortSignal.timeout(300_000)});
    if(!response.ok){await backendFetch(request,"/api/inventory/writebacks/cancel",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operationId,ownerConfirmations:started.ownerConfirmations})});return proxyResponse(response);}
    const result=await response.json();
    const files=(result.files as Output[]).map(file=>({filename:file.filename,backup_filename:file.filename.replace(/(\.[^.]+)$/,`.回写前备份-${operationId}$1`),beforeHash:createHash("sha256").update(Buffer.from(file.backup_base64,"base64")).digest("hex"),afterHash:createHash("sha256").update(Buffer.from(file.content_base64,"base64")).digest("hex")}));
    const prepared=await backendFetch(request,"/api/inventory/writebacks/prepared",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operationId,ownerConfirmations:started.ownerConfirmations,result:{...result,files}})});
    if(!prepared.ok)return proxyResponse(prepared);
    return NextResponse.json({...result,operationId,files:result.files.map((file:Output,index:number)=>({...file,...files[index]}))});
  }catch{return NextResponse.json({error:operationId?"回写方案未完成，后台已保留记录；请在待恢复记录中核对，不要重复回写":"回写服务连接失败，请检查待恢复记录后重试"},{status:502});}
}
