// PDF 订单导入页（独立页）—— 鉴权后渲染客户端核对组件
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import ImportClient from "./ImportClient";

export default async function ImportPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  // 写权限角色（文员/主管）才能导入；viewer 退回订单总览
  if (session.role !== "clerk" && session.role !== "admin") redirect("/orders");
  return <ImportClient />;
}
