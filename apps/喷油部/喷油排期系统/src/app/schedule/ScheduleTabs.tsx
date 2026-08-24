"use client";

import ScheduleOverview from "./ScheduleOverview";

type ScheduleOrderFilter = { orderId: number; orderNo: string; from?: string; to?: string };

export default function ScheduleTabs({ orderFilter }: { orderFilter?: ScheduleOrderFilter }) {
  return <ScheduleOverview orderFilter={orderFilter} />;
}
