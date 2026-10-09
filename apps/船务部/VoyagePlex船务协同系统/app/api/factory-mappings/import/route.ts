import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse, requireRole } from "@/lib/backend-proxy";
export const dynamic = "force-dynamic";
export async function POST(request:NextRequest) {
  const auth=await requireRole(request,["admin","shipping"]); if(auth.response)return auth.response;
  try {
    let payload;
    if(request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form=await request.formData(); const file=form.get("file");
      if(!(file instanceof File)||file.size>10*1024*1024)return NextResponse.json({error:"请选择不超过10MB的Excel"},{status:400});
      const parser=await backendFetch(request,"/api/factory-mappings/parse",{method:"POST",body:form});
      if(!parser.ok)return proxyResponse(parser);
      const parsed=await parser.json(); payload={rows:parsed.rows,preview:true};
    } else { payload=await request.json(); }
    return proxyResponse(await backendFetch(request,"/api/factory-mappings/import",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}));
  } catch { return NextResponse.json({error:"导入失败，请检查表格或后台连接"},{status:502}); }
}
