import { NextResponse } from "next/server";
import { queryInventory } from "@/lib/inventory";
import { requireLogin } from "@/lib/guard";

export async function GET() {
  const denied = await requireLogin();
  if (denied) return denied;

  try {
    const rows = await queryInventory();
    return NextResponse.json(rows);
  } catch (err) {
    console.error("库存查询失败:", err);
    return NextResponse.json({ error: "库存查询失败" }, { status: 500 });
  }
}
