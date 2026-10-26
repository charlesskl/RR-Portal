"use client";

import { useEffect, useState, useRef } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { staleWhileRevalidate } from "@/lib/clientCache";
import type { OrderRow } from "@/lib/orderFilter";
import OrdersTable from "./OrdersTable";

type Summary = {
  id: number; scheduled: boolean; firstPlanDate: string | null; scheduleFinishDate: string | null;
  scheduleCovered: boolean; plannedQty: number; recordedQty: number; demandQty: number; progressPct: number;
  planProductionDays: number; finishedQty: number; remainingQty: number; inProductionRemainingQty: number;
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
    inProductionRemainingQty: summary.inProductionRemainingQty,
    riskLevel,
    riskText,
  };
}

export default function OrdersDataLoader({ initialRows, today, isAdmin, canEdit }: { initialRows: OrderRow[]; today: string; isAdmin: boolean; canEdit: boolean }) {
  const [rows, setRows] = useState(initialRows);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    const initialRevision = revision.current;
    let freshApplied = false;
    setRows(initialRows);
    const apply = (summaries: Summary[]) => {
      if (!active || initialRevision !== revision.current) return;
      const byId = new Map(summaries.map((summary) => [summary.id, summary]));
      freshApplied = true;
      setRows(initialRows.map((row) => enrich(row, byId.get(row.id), today)));
    };
    staleWhileRevalidate<Summary[]>("/api/orders/overview", 60_000, apply).then((stale) => {
      if (stale && !freshApplied) apply(stale);
    });
    return () => { active = false; };
  }, [initialRows, today]);
  async function onSaved(id: number, changes: { deliveryDate?: string; totalQty?: number }) {
    // 保存后原地回读汇总，保留筛选和其他订单尚未保存的编辑。
    revision.current++;
    const response = await apiFetch("/api/orders/overview", { cache: "no-store" });
    if (!response.ok) throw new Error("订单已保存，但汇总刷新失败，请刷新页面查看");
    const summaries = await response.json() as Summary[];
    const byId = new Map(summaries.map(summary => [summary.id, summary]));
    setRows(current => current.map(row => {
      const updated = row.id === id ? {
        ...row,
        ...(changes.deliveryDate !== undefined ? { deliveryDate: changes.deliveryDate || null } : {}),
        ...(changes.totalQty !== undefined ? { totalQty: changes.totalQty } : {}),
      } : row;
      return enrich(updated, byId.get(row.id), today);
    }));
  }
  return <OrdersTable orders={rows} isAdmin={isAdmin} canEdit={canEdit} onSaved={onSaved} />;
}
