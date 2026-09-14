import { NextRequest, NextResponse } from "next/server";
import { backendHeaders } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";
const backend = process.env.VOYAGEPLEX_API_BASE_URL || "http://127.0.0.1:5088";

export async function GET(request: NextRequest) {
  try {
    const response = await fetch(`${backend}/api/shipments/completed/summary/export${request.nextUrl.search}`, { headers:backendHeaders(request), cache: "no-store" });
    const headers = new Headers();
    headers.set("content-type", response.headers.get("content-type") || "application/octet-stream");
    const disposition = response.headers.get("content-disposition");
    if (disposition) headers.set("content-disposition", disposition);
    return new NextResponse(await response.arrayBuffer(), { status: response.status, headers });
  } catch (error) {
    return NextResponse.json({ error: `后台服务连接失败：${error instanceof Error ? error.message : "未知错误"}` }, { status: 502 });
  }
}
