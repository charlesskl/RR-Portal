import { roundPurchaseContractAmount } from './purchaseAmount'

export interface ShipmentPurchaseItem {
  price?: number; qty?: number; kg?: number; outbound_id?: number; material_snapshot?: unknown
  purchase_charge_ratio?: number
  purchase_basis_id?: number
  purchase_charge_limit?: number | null
}

/** Fresh server limits replace stale editor limits without replacing PO prices. */
export function refreshShipmentPurchaseBasis<T extends ShipmentPurchaseItem>(items: readonly T[],
  basis: readonly { purchase_basis_id: number; purchase_charge_limit: number | null }[]): T[] {
  const limits = new Map(basis.map(row => [row.purchase_basis_id, row.purchase_charge_limit]))
  return withShipmentPurchaseBasis(items.map(item => {
    if (!(Number(item.purchase_basis_id) > 0) || shipmentUsesDeclarationPrice(item)) return item
    if (!limits.has(item.purchase_basis_id!)) throw new Error('采购计费明细已变化，请重新加载走货资料')
    return { ...item, purchase_charge_limit: limits.get(item.purchase_basis_id!),
      purchase_charge_ratio: limits.get(item.purchase_basis_id!) == null ? 1 : item.purchase_charge_ratio }
  }))
}

/** Allocate the PO line's remaining paid stock once across this container. */
export function withShipmentPurchaseBasis<T extends ShipmentPurchaseItem>(items: readonly T[]): T[] {
  const limits = new Map<number, number>(), used = new Map<number, number>()
  for (const item of items) {
    if (shipmentUsesDeclarationPrice(item) || item.purchase_charge_limit == null) continue
    const id = Number(item.purchase_basis_id), limit = Number(item.purchase_charge_limit)
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(limit) || limit < 0)
      throw new Error('采购计费数量无效，请重新加载采购或出库资料')
    // Newly pulled rows can have a newer limit than existing editor rows.
    // Use the lower limit until save/export refreshes every row together.
    limits.set(id, Math.min(limit, limits.get(id) ?? limit))
  }
  return items.map(item => {
    const id = Number(item.purchase_basis_id), limit = limits.get(id)
    if (shipmentUsesDeclarationPrice(item) || limit == null) return item
    const quantity = Math.max(0, Number(item.qty) || 0)
    const remaining = Math.max(0, Number((limit - (used.get(id) || 0)).toPrecision(15)))
    const paid = Math.min(quantity, remaining)
    used.set(id, (used.get(id) || 0) + paid)
    return { ...item, purchase_charge_limit: limit, purchase_charge_ratio: quantity > 0 ? paid / quantity : 1 }
  })
}

// Derived metadata, never an editable price/quantity or a replacement for stock.
export function receiptChargeRatio(item?: { received_qty?: number; spare_qty?: number; purchase_charge_ratio?: number }) {
  const paid = Math.max(0, Number(item?.received_qty) || 0)
  const spare = Math.max(0, Number(item?.spare_qty) || 0)
  const ratio = item?.purchase_charge_ratio ?? (paid + spare > 0 ? paid / (paid + spare) : 1)
  if (!Number.isFinite(Number(ratio)) || Number(ratio) < 0 || Number(ratio) > 1)
    throw new Error('采购计费比例无效，请重新加载采购或出库资料')
  return Number(ratio)
}

export function shipmentChargeQuantity(item: ShipmentPurchaseItem) {
  const quantity = Number(shipmentUsesDeclarationPrice(item) ? item.kg : item.qty) || 0
  // An unlinked imported sheet already contains a declaration-unit amount;
  // do not discount it a second time without a confirmed purchase source.
  return quantity * (shipmentUsesDeclarationPrice(item) ? 1 : receiptChargeRatio(item))
}

// Imported customs sheets already quote per declaration unit (K column).
// Linking an imported row replaces that price with the source PO's unit price.
export function shipmentUsesDeclarationPrice(item: ShipmentPurchaseItem) {
  return !!item.material_snapshot && !(Number(item.outbound_id) > 0)
}

// qty is the allocated outbound quantity in the PO's purchase unit (pcs, m,
// kg, sets, etc.). Never multiply a per-piece price by declaration weight.
export function shipmentPurchaseAmount(item: ShipmentPurchaseItem) {
  return (Number(item.price) || 0) * shipmentChargeQuantity(item)
}

// Round only the final, consolidated line, as in the purchase contract. Keep
// the raw calculation above for allocation and declaration-unit conversion.
export function shipmentPurchaseLineAmount(item: ShipmentPurchaseItem) {
  return roundPurchaseContractAmount(shipmentPurchaseAmount(item))
}

export function shipmentPurchaseTotal(items: readonly ShipmentPurchaseItem[]) {
  const cents = items.reduce((sum, item) => sum + Math.round(shipmentPurchaseLineAmount(item) * 100), 0)
  return roundPurchaseContractAmount(cents / 100)
}

// K is the declaration quantity: kilograms, tonnes, pieces, etc. according to J.
// Do not round here; the workbook formats the display without losing precision.
export function shipmentDeclarationPrice(item: ShipmentPurchaseItem) {
  const quantity = Number(item.kg) || 0
  if (quantity > 0 && shipmentUsesDeclarationPrice(item)) return Number(item.price) || 0
  return quantity > 0 ? shipmentPurchaseAmount(item) / quantity : 0
}
