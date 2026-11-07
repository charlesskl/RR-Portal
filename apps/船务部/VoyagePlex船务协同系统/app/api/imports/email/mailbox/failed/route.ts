import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const page = request.nextUrl.searchParams.get("page") || "1";
  if (!/^[1-9]\d{0,6}$/.test(page)) return NextResponse.json({ error: "无效页码" }, { status: 400 });
  try {
    const response = await backendFetch(request, `/api/imports/email/mailbox/failed?page=${page}`, { signal: request.signal });
    const result = await proxyResponse(response);
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  } catch {
    return NextResponse.json({ error: "无法读取失败邮件列表，请稍后重试" }, { status: 502 });
  }
}
