export interface ShipmentPurchaseItem {
  price?: number; qty?: number; kg?: number; outbound_id?: number; material_snapshot?: unknown
  purchase_charge_ratio?: number
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

// K is the declaration quantity: kilograms, tonnes, pieces, etc. according to J.
// Do not round here; the workbook formats the display without losing precision.
export function shipmentDeclarationPrice(item: ShipmentPurchaseItem) {
  const quantity = Number(item.kg) || 0
  if (quantity > 0 && shipmentUsesDeclarationPrice(item)) return Number(item.price) || 0
  return quantity > 0 ? shipmentPurchaseAmount(item) / quantity : 0
}
