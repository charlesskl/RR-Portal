// 登出接口
// POST /api/auth/logout
// 行为：清掉登录 Cookie（迁移后登录态是 .NET 签发的 JWT），返回 { ok: true }
//   （客户端 fetch 后 router.push("/login")）
import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Cookie path must match the Portal sub-path used by the .NET login response.
  res.cookies.set("sprayplan_session", "", {
    path: process.env.NEXT_PUBLIC_BASE_PATH || "/",
    maxAge: 0,
  });
  return res;
}
