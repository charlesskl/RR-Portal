// 实绩录入：产值 / 余下数 / 完工判定 纯函数（不依赖 IO，可单测）。

/** 部位综合工价（成本侧）= 核价 + 人工价 + 油漆价 + 特殊色加价。缺字段按 0。 */
export function partUnitPrice(
  p: { unitCost?: number; laborPrice?: number; paintCost?: number },
  specialUpcharge = 0,
): number {
  return (p.unitCost || 0) + (p.laborPrice || 0) + (p.paintCost || 0) + (specialUpcharge || 0);
}

/** 产值 = 生产数 × 综合工价；任一为负兜底为 0。 */
export function productionValue(goodQty: number, unitPrice: number): number {
  if (goodQty <= 0 || unitPrice <= 0) return 0;
  return goodQty * unitPrice;
}

/** 部位累计已录良品 = Σ goodQty（null 视作未录，按 0）。 */
export function partRecordedTotal(goodQtys: Array<number | null>): number {
  return goodQtys.reduce<number>((s, q) => s + (q || 0), 0);
}

/** 部位余下数 = 总需求 − 累计已录，最小 0。 */
export function partRemainingQty(totalDemand: number, recorded: number): number {
  return Math.max(0, totalDemand - recorded);
}

/** 部位完工：需求 > 0 且累计已录 ≥ 需求。 */
export function isPartComplete(totalDemand: number, recorded: number): boolean {
  return totalDemand > 0 && recorded >= totalDemand;
}

/** 订单完工（木桶）：非空且每个部位都完工。 */
export function isOrderComplete(parts: Array<{ demand: number; recorded: number }>): boolean {
  return parts.length > 0 && parts.every((p) => isPartComplete(p.demand, p.recorded));
}
