"use client";

import { useState } from "react";
import PlanDateAdjuster from "./PlanDateAdjuster";
import ScheduleOverview from "./ScheduleOverview";

type ScheduleOrderFilter = { orderId: number; orderNo: string; from?: string; to?: string };

export default function ScheduleTabs({ orderFilter, canEdit = false }: { orderFilter?: ScheduleOrderFilter; canEdit?: boolean }) {
  const [revision, setRevision] = useState(0);
  return <>{orderFilter && canEdit && <PlanDateAdjuster key={orderFilter.orderId} orderId={orderFilter.orderId} onSaved={() => setRevision(value => value + 1)} />}
    <ScheduleOverview key={`${orderFilter?.orderId ?? "all"}:${revision}`} orderFilter={orderFilter} canAdjustDates={canEdit} /></>;
}
