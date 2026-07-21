// 甘特图订单过滤的纯函数：月份交叉 + 状态 + 搜索。
// 抽成独立模块以便单测（见 tests/unit/lib/ganttFilter.test.ts）。
// 口径由业务方拍板：月份按「生产安排」——订单排产区间与所选月有交叉就显示；
// 待排期订单（无计划日期）月份视图下隐藏，仅通过顶部标签提示总条数。

import type { GanttOrder } from "@/lib/scheduleData";

/** 逾期判断：预计出单日晚于交期（YYYY-MM-DD 字典序比较有效）。 */
export function isOverdue(o: GanttOrder): boolean {
  return !!(o.expectedOutDate && o.deliveryDate && o.expectedOutDate > o.deliveryDate);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 某年某月（month 为 0-11）的起止日期字符串 [月初, 月末]。 */
function monthBounds(year: number, month: number): { start: string; end: string } {
  // new Date(year, month+1, 0).getDate() = 该月天数（与 GanttView.buildMonthDates 同款）
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const m = pad2(month + 1);
  return { start: `${year}-${m}-01`, end: `${year}-${m}-${pad2(daysInMonth)}` };
}

/**
 * 订单的排产区间（开工日 ~ 预计出单日）是否与所选月有交叉。
 * 待排期订单（未排期或无开工日）不属于任何月，返回 false。
 * @param month 0-11
 */
export function orderInMonth(o: GanttOrder, year: number, month: number): boolean {
  if (!o.scheduled || !o.firstPlanDate) return false;
  const rangeStart = o.firstPlanDate;
  const rangeEnd = o.expectedOutDate ?? o.firstPlanDate; // 缺预计出单日时退化为单点
  const { start, end } = monthBounds(year, month);
  // 区间交叉：起点不晚于月末 且 终点不早于月初
  return rangeStart <= end && rangeEnd >= start;
}

export type GanttFilterOpts = {
  year: number;
  /** 0-11 */
  month: number;
  /** "全部状态" | "已排期" | "待排期" | "逾期" */
  filterStatus: string;
  searchText?: string;
};

/**
 * 甘特图订单过滤：搜索 → 状态/月份叠加。
 * - filterStatus="待排期"：忽略月份，显示全部待排期单；
 * - 其余状态：必须当月在产（自动排除待排期），再按状态细分。
 */
export function filterGanttOrders(orders: GanttOrder[], opts: GanttFilterOpts): GanttOrder[] {
  const { year, month, filterStatus, searchText } = opts;
  const q = (searchText ?? "").trim().toLowerCase();
  return orders.filter((o) => {
    if (q) {
      const hit =
        o.externalOrderNo.toLowerCase().includes(q) ||
        o.productNo.toLowerCase().includes(q);
      if (!hit) return false;
    }
    // 待排期：独立维度，忽略月份
    if (filterStatus === "待排期") return !o.scheduled;
    // 其余状态：先要求当月在产
    if (!orderInMonth(o, year, month)) return false;
    if (filterStatus === "已排期") return o.scheduled;
    if (filterStatus === "逾期") return isOverdue(o);
    return true; // 全部状态
  });
}
