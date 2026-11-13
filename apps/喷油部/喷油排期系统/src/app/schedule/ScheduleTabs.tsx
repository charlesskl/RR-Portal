"use client";

import { useState } from "react";
import Link from "next/link";
import PlanDateAdjuster from "./PlanDateAdjuster";
import ScheduleOverview from "./ScheduleOverview";

type ScheduleOrderFilter = { orderId: number; orderNo: string; from?: string; to?: string };

export default function ScheduleTabs({ orderFilter, canEdit = false }: { orderFilter?: ScheduleOrderFilter; canEdit?: boolean }) {
  const [revision, setRevision] = useState(0);
  return <>{canEdit && <div className="mb-4 flex justify-end"><Link className="rounded-btn border border-mint-400 bg-mint-50 px-4 py-2 text-sm font-semibold text-mint-700" href={`/schedule/table${orderFilter ? `?orderId=${orderFilter.orderId}` : ""}`}>表格排期 · 批量调整</Link></div>}{orderFilter && canEdit && <PlanDateAdjuster key={orderFilter.orderId} orderId={orderFilter.orderId} onSaved={() => setRevision(value => value + 1)} />}
    <ScheduleOverview key={`${orderFilter?.orderId ?? "all"}:${revision}`} orderFilter={orderFilter} canAdjustDates={canEdit} /></>;
}
