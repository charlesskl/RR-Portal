// 包装数量属于走货行；同一物料在不同行可以使用不同包装数量。
export function shipmentGrossPerPc(weightPerCarton: unknown, qtyPerCarton: unknown, materialName?: unknown): number {
  const weight = Number(weightPerCarton)
  // 纸绳以米录入装箱数量，但单个毛/净重以每 1000 米（1 卷）为单位。
  const quantity = shipmentWeightQuantity(materialName, qtyPerCarton)
  if (!Number.isFinite(weight) || !Number.isFinite(quantity) || weight <= 0 || quantity <= 0) return 0
  const gross = weight / quantity
  return Number.isFinite(gross) ? gross : 0
}

export function isPaperRope(materialName: unknown): boolean {
  return String(materialName ?? '').replace(/\s+/g, '').includes('纸绳')
}

// 纸绳的毛净重以卷计：每 1000 米为 1 卷；其它物料按原数量计重。
export function shipmentWeightQuantity(materialName: unknown, quantity: unknown): number {
  const qty = Number(quantity)
  if (!Number.isFinite(qty) || qty <= 0) return 0
  return isPaperRope(materialName) ? qty / 1000 : qty
}
