"use client";

import { useState } from "react";
import PlanDateAdjuster from "./PlanDateAdjuster";
import ScheduleOverview from "./ScheduleOverview";

type ScheduleOrderFilter = { orderId: number; orderNo: string; from?: string; to?: string };

export default function ScheduleTabs({ orderFilter }: { orderFilter?: ScheduleOrderFilter }) {
  const [revision, setRevision] = useState(0);
  return <>{orderFilter && <PlanDateAdjuster orderId={orderFilter.orderId} onSaved={() => setRevision(value => value + 1)} />}
    <ScheduleOverview key={revision} orderFilter={orderFilter} /></>;
}
