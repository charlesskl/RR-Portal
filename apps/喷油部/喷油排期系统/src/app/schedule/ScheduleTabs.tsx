"use client";
// 排期页 Tab 外壳：总览看计划，月排自动生成，周排承担手工新建/调整/急单处理。
// 月排不选拉别（后端 commit 自动占位），故 MonthlyScheduler 不需要 lines。
import { useState } from "react";
import type { SchedulablePart } from "@/lib/schedule";
import WeeklyScheduler from "./WeeklyScheduler";
import MonthlyScheduler from "./MonthlyScheduler";
import ScheduleOverview from "./ScheduleOverview";

// lines/orders 类型对齐 page.tsx 传入 ScheduleEditor 的实际结构（ScheduleEditor 内部 Line / OrderLite）
type Machine = { id: number; machineNo: string; isUV: boolean };
type Line = {
  id: number;
  name: string;
  workshop: string;
  leaderName: string | null;
  craftType: string;
  machines: Machine[];
};
type OrderLite = {
  id: number;
  externalOrderNo: string;
  productNo: string;
  isMA: boolean;
  isUrgent: boolean;
  scheduled: boolean;
  parts: SchedulablePart[];
};
// 待排急单：带交货日 + 是否已排 + 部位展开（传给 UrgentScheduler）
type UrgentOrderLite = {
  id: number;
  externalOrderNo: string;
  productNo: string;
  deliveryDate: string | null;
  scheduled: boolean;
  parts: SchedulablePart[];
};
type WeeklyTarget = { planId: number; date: string; lineId: number };

export default function ScheduleTabs({ lines, orders, urgentOrders }: { lines: Line[]; orders: OrderLite[]; urgentOrders: UrgentOrderLite[] }) {
  const [tab, setTab] = useState<"overview" | "monthly" | "weekly">("overview");
  const [weeklyMode, setWeeklyMode] = useState<"adjust" | "create" | "urgent">("adjust");
  const [weeklyTarget, setWeeklyTarget] = useState<WeeklyTarget | null>(null);
  const cls = (a: boolean) => `px-4 py-2 rounded-btn text-sm ${a ? "bg-mint-50 text-mint-700 font-semibold" : "text-text-secondary"}`;
  // 待排急单数 = 还没排进计划的急单
  const pendingUrgent = urgentOrders.filter((o) => !o.scheduled).length;
  const pendingOrders = orders.filter((o) => !o.isUrgent && !o.scheduled).length;
  return (
    <div>
      {/* 急单待排红标签：勾了急单且未排时出现，点进周排内的排急单视图 */}
      {pendingUrgent > 0 && !(tab === "weekly" && weeklyMode === "urgent") && (
        <div className="flex items-center gap-3 bg-[#fdf2f4] border border-[#E88EA0] rounded-[10px] px-4 py-3 mb-4">
          <span className="text-sm font-bold text-[#C91D32]">🔴 有 {pendingUrgent} 张急单待排</span>
          <button onClick={() => { setTab("weekly"); setWeeklyMode("urgent"); }}
            className="ml-auto bg-[#E88EA0] hover:opacity-90 text-white font-bold rounded-btn px-4 py-1.5 text-sm">去周排处理</button>
        </div>
      )}

      <div className="flex gap-2 mb-5">
        <button className={cls(tab === "overview")} onClick={() => setTab("overview")}>📊 排期总览</button>
        <button className={cls(tab === "monthly")} onClick={() => setTab("monthly")}>📅 月排（自动）</button>
        <button className={cls(tab === "weekly")} onClick={() => setTab("weekly")}>🗓 周排（手工）{pendingUrgent > 0 ? ` · 急单${pendingUrgent}` : ""}</button>
      </div>
      {tab === "monthly" && <MonthlyScheduler />}
      {tab === "overview" && (
        <ScheduleOverview
          pendingOrderCount={pendingOrders}
          pendingUrgentCount={pendingUrgent}
          onCreatePlan={() => {
            setWeeklyMode("create");
            setTab("weekly");
          }}
          onPlanUrgent={() => {
            setWeeklyMode("urgent");
            setTab("weekly");
          }}
          onAdjustPlan={(target) => {
            setWeeklyTarget(target);
            setWeeklyMode("adjust");
            setTab("weekly");
          }}
        />
      )}
      {tab === "weekly" && (
        <WeeklyScheduler
          lines={lines}
          orders={orders}
          urgentOrders={urgentOrders}
          mode={weeklyMode}
          onModeChange={setWeeklyMode}
          target={weeklyTarget}
        />
      )}
    </div>
  );
}
