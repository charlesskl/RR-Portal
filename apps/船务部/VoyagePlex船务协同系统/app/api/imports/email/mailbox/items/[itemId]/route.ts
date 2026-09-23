import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, itemId: string, method: "GET" | "PATCH") {
  try {
    return proxyResponse(await backendFetch(request, `/api/imports/email/mailbox/items/${itemId}`, {
      method,
      headers: method === "PATCH" ? { "Content-Type": "application/json" } : undefined,
      body: method === "PATCH" ? await request.text() : undefined,
    }));
  } catch {
    return NextResponse.json({ error: "后台服务连接失败" }, { status: 502 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ itemId: string }> }) {
  return proxy(request, (await context.params).itemId, "GET");
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ itemId: string }> }) {
  return proxy(request, (await context.params).itemId, "PATCH");
}
