// 工序/工艺固定 4 项（部位级，与拉别工艺同一套；排期据此匹配拉别）
export const CRAFTS = ["手喷", "移印", "自动喷", "UV"];

// 产品核价表部位成本计算工具（spec §1.7）
// 综合成本 = 核价 + 人工价 + 油漆价（部位不再有色加价，特殊色加价归订单）
// 总核价（业务方口径）= 核价 + 油漆价（不含人工，与手工核价表一致）
export function totalCost(parts: PartCostInput[]): number {
  return parts.reduce((s, p) => s + p.unitCost + p.paintCost, 0);
}

export type PartCostInput = {
  unitCost: number;
  laborPrice: number;
  paintCost: number;
};

export type PartQuoteInput = { quotedPrice: number };

export function comprehensiveCost(part: PartCostInput): number {
  return part.unitCost + part.laborPrice + part.paintCost;
}

export function sumUnitCost(parts: PartCostInput[]): number {
  return parts.reduce((s, p) => s + p.unitCost, 0);
}

export function sumLaborPrice(parts: PartCostInput[]): number {
  return parts.reduce((s, p) => s + p.laborPrice, 0);
}

export function sumPaintCost(parts: PartCostInput[]): number {
  return parts.reduce((s, p) => s + p.paintCost, 0);
}

export function sumQuotedPrice(parts: PartQuoteInput[]): number {
  return parts.reduce((s, p) => s + p.quotedPrice, 0);
}

// 产品审核状态显示元数据：待审核 / 已生效 / 作废
// 配色沿用订单状态体系（待审核=琥珀, 已生效=青柠绿, 作废=灰）
export const PRODUCT_STATUS_META: Record<string, { text: string; cls: string }> = {
  draft:    { text: "待审核", cls: "bg-[#FFF8E1] text-[#8a6d1a]" },
  active:   { text: "已生效", cls: "bg-[#E3F4EC] text-[#2E8B6B]" },
  archived: { text: "作废",   cls: "bg-[#f3f4f6] text-[#6b7280]" },
};

// 产品列表按"货号"模糊搜索（前端本地过滤，忽略大小写、去首尾空格）
export function filterProducts<T extends { productNo: string }>(
  list: T[],
  keyword: string,
): T[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return list;
  return list.filter((p) => p.productNo.toLowerCase().includes(kw));
}
