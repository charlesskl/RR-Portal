import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// 独立实绩录入模块已取消；实绩统一在排期总览的计划明细中录入。
export default async function RecordingPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  redirect("/schedule");
}
