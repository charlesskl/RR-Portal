import { NextRequest, NextResponse } from "next/server";
import { backendFetch, proxyResponse } from "@/lib/backend-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let value: unknown;
  try { value = await request.json(); } catch { return NextResponse.json({ error: "无效请求" }, { status: 400 }); }
  const ids = value && typeof value === "object" && "itemIds" in value ? value.itemIds : null;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5 || new Set(ids).size !== ids.length || !ids.every(id => Number.isSafeInteger(id) && id > 0)) {
    return NextResponse.json({ error: "请选择 1 至 5 封不同的失败邮件" }, { status: 400 });
  }
  try {
    // The API rechecks the authenticated admin, mailbox scope and exact mail state.
    const response = await backendFetch(request, "/api/imports/email/mailbox/retry-failed", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemIds: ids }), signal: request.signal,
    });
    const result = await proxyResponse(response);
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  } catch {
    return NextResponse.json({ error: "未能确认补信结果，请刷新列表核对后再操作" }, { status: 502 });
  }
}
