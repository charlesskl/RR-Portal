// 路由鉴权守卫（集中复用，避免每个 route 重复写）
// 用法：const denied = await requireClerkOrAdmin(); if (denied) return denied;
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

// 主管专属（沿用 P0 用户管理的规则）
export async function requireAdmin() {
  const session = await getSession();
  if (session.role !== "admin") {
    return NextResponse.json({ error: "需要主管权限" }, { status: 403 });
  }
  return null;
}

// 文员或主管可写（工艺模板录入：clerk + admin；viewer 只读 → 拒绝）
export async function requireClerkOrAdmin() {
  const session = await getSession();
  if (session.role !== "clerk" && session.role !== "admin") {
    return NextResponse.json({ error: "需要文员或主管权限" }, { status: 403 });
  }
  return null;
}

// 任意已登录用户（读操作）；未登录返回 401
export async function requireLogin() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  return null;
}
