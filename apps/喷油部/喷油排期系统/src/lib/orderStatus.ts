// 订单状态的单一真相：枚举 + 文案 + pill 颜色（多处复用，避免散落不一致）
// 颜色取自 UI 设计：已接单蓝 / 已排期紫 / 在产金 / 完工青柠绿 / 作废灰
export const ORDER_STATUSES = ["received", "scheduled", "in_production", "completed", "archived"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// 正常单视图里可筛选的状态（不含作废——作废单在回收站）
export const ACTIVE_STATUSES: OrderStatus[] = ["received", "scheduled", "in_production", "completed"];

export const STATUS_META: Record<string, { text: string; cls: string }> = {
  received:      { text: "已接单", cls: "bg-[#F0F7FF] text-[#2563EB]" },
  scheduled:     { text: "已排期", cls: "bg-[#F3E8FB] text-[#9333EA]" },
  in_production: { text: "在产",   cls: "bg-[#FFF8E1] text-[#8A6D1A]" },
  completed:     { text: "完工",   cls: "bg-[#E3F4EC] text-[#2E8B6B]" },
  archived:      { text: "作废",   cls: "bg-[#f3f4f6] text-[#9ca3af]" },
};
