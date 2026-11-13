import { getSession } from "@/lib/session";
import { canEditPlanDates } from "@/lib/planDateAdjustment";
import { redirect } from "next/navigation";
import PlanWorkbench from "./PlanWorkbench";

export default async function TableSchedulePage({ searchParams }: { searchParams?: { orderId?: string } }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  if (!canEditPlanDates(session.role)) redirect("/schedule");
  const id = Number(searchParams?.orderId);
  return <PlanWorkbench orderId={Number.isSafeInteger(id) && id > 0 ? id : undefined} />;
}
