import { NextResponse } from "next/server";

// 健康检查端点：用于确认 API 路由工作正常，可用于部署 liveness probe
export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
