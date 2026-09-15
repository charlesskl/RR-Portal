import { NextRequest, NextResponse } from "next/server";
import { MappingRecord, readMappings, writeMappings } from "@/lib/inspection-mapping-store";
import { requireRole } from "@/lib/backend-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth=await requireRole(request,["admin","shipping"]); if(auth.response)return auth.response;
  const id=Number((await context.params).id); const rows=await readMappings(); const index=rows.findIndex(row => row.id===id);
  if (index<0) return NextResponse.json({error:"记录不存在"},{status:404});
  rows[index]={...(await request.json() as MappingRecord),id}; await writeMappings(rows);
  return NextResponse.json(rows[index]);
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth=await requireRole(request,["admin","shipping"]); if(auth.response)return auth.response;
  const id=Number((await context.params).id); const rows=await readMappings(); const filtered=rows.filter(row => row.id!==id);
  if (filtered.length===rows.length) return NextResponse.json({error:"记录不存在"},{status:404});
  await writeMappings(filtered); return new NextResponse(null,{status:204});
}
