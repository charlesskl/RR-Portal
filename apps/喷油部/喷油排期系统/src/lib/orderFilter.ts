// 订单总览的纯筛选逻辑（与 UI 解耦，便于单测）。
// 日期一律用 'YYYY-MM-DD' 字符串，按字典序比较即等价于日期先后。
export type OrderRow = {
  id: number;
  externalOrderNo: string;
  productNo: string;
  orderDate: string;            // YYYY-MM-DD
  deliveryDate: string | null;  // YYYY-MM-DD | null
  status: string;
  isMA: boolean;
  isUrgent: boolean;            // 急单（原计划外、临时插入）
  totalQty: number;
  pendingProduct: boolean;      // 待补产品（PDF导入新货号，只登记了订单头）
  scheduled?: boolean;
  firstPlanDate?: string | null;
  expectedOutDate?: string | null;
  scheduleFinishDate?: string | null;
  scheduleCovered?: boolean;
  plannedQty?: number;
  recordedQty?: number;
  demandQty?: number;
  progressPct?: number;
  riskLevel?: "none" | "missing_due" | "unscheduled" | "late" | "overdue";
  riskText?: string;
};

export type OrderFilter = {
  view: "normal" | "recycle" | "pending";
  keyword?: string;
  status?: string;                 // 仅正常单视图生效
  ma?: "" | "ma" | "formal";
  risk?: "" | "overdue" | "late" | "unscheduled" | "urgent";
  orderFrom?: string;
  orderTo?: string;
  deliveryFrom?: string;
  deliveryTo?: string;
};

export function filterOrders(rows: OrderRow[], f: OrderFilter): OrderRow[] {
  const kw = (f.keyword ?? "").trim().toLowerCase();
  // 先按视图分流：
  //   回收站 = 仅作废；待补产品 = 非作废且 pendingProduct；正常单 = 非作废且非待补产品
  const base = rows.filter((r) => {
    if (f.view === "recycle") return r.status === "archived";
    if (r.status === "archived") return false;
    if (f.view === "pending") return r.pendingProduct;
    return !r.pendingProduct;   // normal
  });

  return base.filter((r) => {
    if (kw && !(
      r.externalOrderNo.toLowerCase().includes(kw) ||
      r.productNo.toLowerCase().includes(kw)
    )) return false;
    if (f.view === "normal" && f.status && r.status !== f.status) return false;
    if (f.ma === "ma" && !r.isMA) return false;
    if (f.ma === "formal" && r.isMA) return false;
    if (f.risk === "overdue" && r.riskLevel !== "overdue") return false;
    if (f.risk === "late" && r.riskLevel !== "late") return false;
    if (f.risk === "unscheduled" && r.scheduled !== false) return false;
    if (f.risk === "urgent" && !r.isUrgent) return false;
    if (f.orderFrom && r.orderDate < f.orderFrom) return false;
    if (f.orderTo && r.orderDate > f.orderTo) return false;
    if (f.deliveryFrom && (!r.deliveryDate || r.deliveryDate < f.deliveryFrom)) return false;
    if (f.deliveryTo && (!r.deliveryDate || r.deliveryDate > f.deliveryTo)) return false;
    return true;
  });
}
