"use client";

import { useEffect, useState } from "react";
import { staleWhileRevalidate } from "@/lib/clientCache";
import type { OrderRow } from "@/lib/orderFilter";
import OrdersTable from "./OrdersTable";

type Summary = {
  id: number; scheduled: boolean; firstPlanDate: string | null; scheduleFinishDate: string | null;
  scheduleCovered: boolean; plannedQty: number; recordedQty: number; demandQty: number; progressPct: number;
  planProductionDays: number; finishedQty: number; remainingQty: number;
};

function enrich(row: OrderRow, summary: Summary | undefined, today: string): OrderRow {
  if (!summary) return row;
  const expectedOutDate = summary.scheduleFinishDate;
  const active = row.status !== "archived" && row.status !== "completed";
  let riskLevel: OrderRow["riskLevel"] = "none";
  let riskText = "正常";
  if (active && !row.deliveryDate) { riskLevel = "missing_due"; riskText = "缺交货日"; }
  else if (active && row.deliveryDate && expectedOutDate && expectedOutDate > row.deliveryDate) { riskLevel = "late"; riskText = "预计超期"; }
  else if (active && row.deliveryDate && row.deliveryDate < today && !summary.scheduleCovered) { riskLevel = "overdue"; riskText = "已超交期"; }
  else if (active && !summary.scheduled && !row.pendingProduct) { riskLevel = "unscheduled"; riskText = "未排期"; }
  return {
    ...row,
    scheduled: summary.scheduled,
    firstPlanDate: summary.firstPlanDate,
    expectedOutDate,
    scheduleFinishDate: summary.scheduleFinishDate,
    scheduleCovered: summary.scheduleCovered,
    plannedQty: summary.plannedQty,
    recordedQty: summary.recordedQty,
    demandQty: summary.demandQty,
    progressPct: summary.progressPct,
    planProductionDays: summary.planProductionDays,
    finishedQty: summary.finishedQty,
    remainingQty: summary.remainingQty,
    riskLevel,
    riskText,
  };
}

export default function OrdersDataLoader({ initialRows, today, isAdmin }: { initialRows: OrderRow[]; today: string; isAdmin: boolean }) {
  const [rows, setRows] = useState(initialRows);
  useEffect(() => {
    let active = true;
    const apply = (summaries: Summary[]) => {
      if (!active) return;
      const byId = new Map(summaries.map((summary) => [summary.id, summary]));
      setRows(initialRows.map((row) => enrich(row, byId.get(row.id), today)));
    };
    staleWhileRevalidate<Summary[]>("/api/orders/overview", 60_000, apply).then((stale) => {
      if (stale) apply(stale);
    });
    return () => { active = false; };
  }, [initialRows, today]);
  return <OrdersTable orders={rows} isAdmin={isAdmin} />;
}
