export interface ShipmentPurchaseItem {
  price?: number; qty?: number; kg?: number; outbound_id?: number; material_snapshot?: unknown
}

// Imported customs sheets already quote per declaration unit (K column).
// Linking an imported row replaces that price with the source PO's unit price.
export function shipmentUsesDeclarationPrice(item: ShipmentPurchaseItem) {
  return !!item.material_snapshot && !(Number(item.outbound_id) > 0)
}

// qty is the allocated outbound quantity in the PO's purchase unit (pcs, m,
// kg, sets, etc.). Never multiply a per-piece price by declaration weight.
export function shipmentPurchaseAmount(item: ShipmentPurchaseItem) {
  return (Number(item.price) || 0) * (Number(shipmentUsesDeclarationPrice(item) ? item.kg : item.qty) || 0)
}

// K is the declaration quantity: kilograms, tonnes, pieces, etc. according to J.
// Do not round here; the workbook formats the display without losing precision.
export function shipmentDeclarationPrice(item: ShipmentPurchaseItem) {
  const quantity = Number(item.kg) || 0
  if (quantity > 0 && shipmentUsesDeclarationPrice(item)) return Number(item.price) || 0
  return quantity > 0 ? shipmentPurchaseAmount(item) / quantity : 0
}
