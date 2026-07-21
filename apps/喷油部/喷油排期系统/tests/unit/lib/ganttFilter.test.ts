import { describe, it, expect } from "vitest";
import { orderInMonth, isOverdue, filterGanttOrders } from "@/lib/ganttFilter";
import type { GanttOrder } from "@/lib/scheduleData";

// 构造 GanttOrder 的辅助函数：只填关心的字段，其余给默认值
function mk(o: Partial<GanttOrder> & { id: number }): GanttOrder {
  return {
    id: o.id,
    externalOrderNo: o.externalOrderNo ?? `NO-${o.id}`,
    productNo: o.productNo ?? `P-${o.id}`,
    status: o.status ?? "scheduled",
    deliveryDate: o.deliveryDate ?? null,
    scheduled: o.scheduled ?? true,
    firstPlanDate: o.firstPlanDate ?? null,
    expectedOutDate: o.expectedOutDate ?? null,
    plans: o.plans ?? [],
    demandParts: o.demandParts ?? [],
  };
}

// A：纯 6 月（不逾期）            B：跨 5/6 月（不逾期）
// C：纯 5 月（逾期）              D：待排期（无计划日期）
// E：纯 6 月（逾期）
const A = mk({ id: 1, externalOrderNo: "ZWZ-AAA", productNo: "P-AAA", firstPlanDate: "2026-06-03", expectedOutDate: "2026-06-07", deliveryDate: "2026-06-09" });
const B = mk({ id: 2, firstPlanDate: "2026-05-28", expectedOutDate: "2026-06-02", deliveryDate: "2026-06-10" });
const C = mk({ id: 3, firstPlanDate: "2026-05-10", expectedOutDate: "2026-05-20", deliveryDate: "2026-05-15" });
const D = mk({ id: 4, scheduled: false, firstPlanDate: null, expectedOutDate: null, deliveryDate: "2026-06-01" });
const E = mk({ id: 5, firstPlanDate: "2026-06-15", expectedOutDate: "2026-06-20", deliveryDate: "2026-06-01" });
const all = [A, B, C, D, E];

describe("isOverdue", () => {
  it("预计出单日晚于交期 = 逾期", () => {
    expect(isOverdue(C)).toBe(true); // 05-20 > 05-15
    expect(isOverdue(E)).toBe(true); // 06-20 > 06-01
  });
  it("预计出单日不晚于交期 = 不逾期", () => {
    expect(isOverdue(A)).toBe(false); // 06-07 < 06-09
    expect(isOverdue(B)).toBe(false); // 06-02 < 06-10
  });
  it("缺日期 = 不逾期", () => {
    expect(isOverdue(D)).toBe(false);
  });
});

describe("orderInMonth（口径：排产区间与所选月有交叉，month 为 0-11）", () => {
  it("纯当月订单：属于该月、不属于别的月", () => {
    expect(orderInMonth(A, 2026, 5)).toBe(true);  // 6 月
    expect(orderInMonth(A, 2026, 4)).toBe(false); // 5 月
  });
  it("跨月订单：两个月都算属于", () => {
    expect(orderInMonth(B, 2026, 4)).toBe(true); // 5 月
    expect(orderInMonth(B, 2026, 5)).toBe(true); // 6 月
  });
  it("待排期订单：不属于任何月", () => {
    expect(orderInMonth(D, 2026, 5)).toBe(false);
    expect(orderInMonth(D, 2026, 4)).toBe(false);
  });
});

describe("filterGanttOrders（年月 + 状态 + 搜索叠加）", () => {
  it("全部状态·6 月：只留 6 月在产的（待排期隐藏）", () => {
    const r = filterGanttOrders(all, { year: 2026, month: 5, filterStatus: "全部状态" });
    expect(r.map((x) => x.id)).toEqual([1, 2, 5]);
  });
  it("全部状态·5 月：跨月单 B 和纯 5 月单 C", () => {
    const r = filterGanttOrders(all, { year: 2026, month: 4, filterStatus: "全部状态" });
    expect(r.map((x) => x.id)).toEqual([2, 3]);
  });
  it("待排期：忽略月份，显示全部待排期单", () => {
    const r = filterGanttOrders(all, { year: 2026, month: 5, filterStatus: "待排期" });
    expect(r.map((x) => x.id)).toEqual([4]);
  });
  it("逾期·6 月：只留 6 月在产且逾期的", () => {
    const r = filterGanttOrders(all, { year: 2026, month: 5, filterStatus: "逾期" });
    expect(r.map((x) => x.id)).toEqual([5]);
  });
  it("已排期·6 月：6 月在产的本就都是已排期", () => {
    const r = filterGanttOrders(all, { year: 2026, month: 5, filterStatus: "已排期" });
    expect(r.map((x) => x.id)).toEqual([1, 2, 5]);
  });
  it("搜索按订单号/款号（不分大小写）叠加在月份之上", () => {
    expect(
      filterGanttOrders(all, { year: 2026, month: 5, filterStatus: "全部状态", searchText: "aaa" }).map((x) => x.id)
    ).toEqual([1]);
    expect(
      filterGanttOrders(all, { year: 2026, month: 5, filterStatus: "全部状态", searchText: "p-aaa" }).map((x) => x.id)
    ).toEqual([1]);
  });
});
