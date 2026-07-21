// 订单计算工具（部位级，不分颜色/规格，无特殊色加价）
// 订单按部位填数量；基础工价从产品库带出。

export type PartQty = { partName: string; sourcePartId?: number | null; qty: number; partOrder?: number };
export type PartBase = { partName: string; unitCost: number; laborPrice: number; paintCost: number };

// 行合计：某明细行（子件）所有部位数量之和
export function lineTotalQty(partQtys: PartQty[]): number {
  return partQtys.reduce((s, q) => s + (q.qty || 0), 0);
}

// 整单总数：各行各部位数量之和
export function orderTotalQty(lines: { partQtys: PartQty[] }[]): number {
  return lines.reduce((s, l) => s + lineTotalQty(l.partQtys), 0);
}

// 部位单件综合价 = 核 + 人工 + 油漆
export function partComprehensivePrice(base: Omit<PartBase, "partName">): number {
  return base.unitCost + base.laborPrice + base.paintCost;
}

// 某子件单件综合价 = Σ 各部位(核+人工+油漆)
export function lineUnitPrice(parts: PartBase[]): number {
  return parts.reduce((s, p) => s + partComprehensivePrice(p), 0);
}
