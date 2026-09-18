import { NextRequest, NextResponse } from "next/server";
import { backendHeaders } from "@/lib/backend-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const backend = process.env.VOYAGEPLEX_API_BASE_URL || "http://127.0.0.1:5088";

export async function GET(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  try {
    const { batchId } = await context.params;
    const response = await fetch(`${backend}/api/imports/email/${encodeURIComponent(batchId)}`, {
      headers: backendHeaders(request), cache: "no-store",
    });
    return new NextResponse(await response.arrayBuffer(), { status: response.status,
      headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "后台服务连接失败" }, { status: 502 });
  }
}
