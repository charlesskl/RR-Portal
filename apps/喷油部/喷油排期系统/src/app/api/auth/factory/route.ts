import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "只有管理员可以切换厂区" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (body.factoryId !== "XINGXIN" && body.factoryId !== "HUADENG")
    return NextResponse.json({ error: "厂区无效" }, { status: 400 });

  const res = NextResponse.json({ factoryId: body.factoryId });
  res.cookies.set("sprayplan_factory", body.factoryId, {
    httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
