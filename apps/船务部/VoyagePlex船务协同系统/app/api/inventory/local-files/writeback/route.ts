import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const parser = process.env.EMAIL_PARSER_BASE_URL || "http://127.0.0.1:8091";

export async function POST(request: NextRequest) {
  try {
    const response = await fetch(`${parser}/v1/local-inventory-files/writeback`, {
      method:"POST", body:await request.formData(), signal:AbortSignal.timeout(300_000),
    });
    return new NextResponse(await response.arrayBuffer(), { status:response.status,
      headers:{"content-type":response.headers.get("content-type")||"application/json"} });
  } catch (error) {
    return NextResponse.json({error:`库存写回服务连接失败：${error instanceof Error?error.message:"未知错误"}`},{status:502});
  }
}
