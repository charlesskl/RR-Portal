export type ShipmentPacking =
  | { mode: 'uniform'; cartons: 0; totalQty: 0; averageQty: number }
  | { mode: 'ranges'; cartons: number; totalQty: number; averageQty: number }
  | { mode: 'empty' | 'invalid'; cartons: 0; totalQty: 0; averageQty: 0 }

// 支持统一装箱数量（3000）和按箱号分段的混合写法（1-2/3000 3/4000）。
export function parseShipmentPacking(value: unknown): ShipmentPacking {
  const text = String(value ?? '').trim()
  if (!text) return { mode: 'empty', cartons: 0, totalQty: 0, averageQty: 0 }

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const qty = Number(text)
    return qty > 0
      ? { mode: 'uniform', cartons: 0, totalQty: 0, averageQty: qty }
      : { mode: 'invalid', cartons: 0, totalQty: 0, averageQty: 0 }
  }

  const tokens = text.split(/[\s,，;；]+/).filter(Boolean)
  const ranges: Array<{ start: number; end: number; qty: number }> = []
  for (const token of tokens) {
    const match = token.match(/^(\d+)(?:-(\d+))?\/(\d+(?:\.\d+)?)$/)
    if (!match) return { mode: 'invalid', cartons: 0, totalQty: 0, averageQty: 0 }
    const start = Number(match[1])
    const end = Number(match[2] ?? match[1])
    const qty = Number(match[3])
    if (start < 1 || end < start || qty <= 0) return { mode: 'invalid', cartons: 0, totalQty: 0, averageQty: 0 }
    ranges.push({ start, end, qty })
  }

  ranges.sort((a, b) => a.start - b.start)
  let cartons = 0
  let totalQty = 0
  let previousEnd = 0
  for (const range of ranges) {
    if (range.start <= previousEnd) return { mode: 'invalid', cartons: 0, totalQty: 0, averageQty: 0 }
    const count = range.end - range.start + 1
    cartons += count
    totalQty += count * range.qty
    previousEnd = range.end
  }
  if (!Number.isSafeInteger(cartons) || !Number.isFinite(totalQty) || cartons <= 0 || totalQty <= 0)
    return { mode: 'invalid', cartons: 0, totalQty: 0, averageQty: 0 }
  return { mode: 'ranges', cartons, totalQty, averageQty: totalQty / cartons }
}

export function shipmentCartonCount(shipmentQty: unknown, packingValue: unknown): number {
  const packing = parseShipmentPacking(packingValue)
  if (packing.mode === 'ranges') return packing.cartons
  const qty = Number(shipmentQty)
  if (packing.mode !== 'uniform' || !Number.isFinite(qty) || qty <= 0) return 0
  return Math.ceil(qty / packing.averageQty)
}

export function shipmentPackingAverageQty(packingValue: unknown): number {
  return parseShipmentPacking(packingValue).averageQty
}

export function formatShipmentPackingLines(value: unknown): string {
  const text = String(value ?? '')
  if (parseShipmentPacking(text).mode !== 'ranges') return text
  return text.trim().split(/[\s,，;；]+/).filter(Boolean).join('\n')
}

// 称重数量属于走货行；同一物料每次抽取称重的数量可能不同。
export function shipmentGrossPerPc(weightPerCarton: unknown, weighingQty: unknown): number {
  const weight = Number(weightPerCarton)
  const quantity = Number(weighingQty)
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
