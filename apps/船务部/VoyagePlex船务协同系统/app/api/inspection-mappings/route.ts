import { NextRequest, NextResponse } from "next/server";
import { MappingRecord, readMappings, writeMappings } from "@/lib/inspection-mapping-store";
import { requireRole } from "@/lib/backend-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request:NextRequest) { const auth=await requireRole(request,["admin","shipping"]); if(auth.response)return auth.response; return NextResponse.json(await readMappings()); }
export async function POST(request: NextRequest) {
  const auth=await requireRole(request,["admin","shipping"]); if(auth.response)return auth.response;
  const rows = await readMappings();
  const value = await request.json() as MappingRecord;
  value.id = rows.reduce((max,row) => Math.max(max,row.id),0) + 1;
  rows.push(value); await writeMappings(rows);
  return NextResponse.json(value, { status:201 });
}
