import { shipmentKgWeight } from './shipmentWeight'

interface DeclarationMaterial { unit_kg?: string; name_zh?: string; net_per_pc?: number }
interface DeclarationItem {
  material_id?: number; material_snapshot?: unknown; outbound_id?: number
  qty?: number; kg?: number; price?: number
}

export function isShipmentCountUnit(unit: unknown) {
  return ['PCE', 'PCS', 'PC', '个', '件', 'SET', '套', 'MTR', 'M', '米'].includes(String(unit || '').trim().toUpperCase())
}

/** Change the declaration basis, never the physical quantity or source PO price. */
export function rebaseShipmentDeclaration<T extends DeclarationItem>(item: T, quantity: number, preserveImportedAmount = true): T {
  if (Number(item.kg) === quantity && item.kg != null) return item
  const next = { ...item, kg: quantity }
  // Unlinked Excel rows quote per declaration unit. A legacy kg -> pcs repair
  // must not multiply the invoice/purchase amount by the pcs/kg conversion.
  if (preserveImportedAmount && item.material_snapshot && !(Number(item.outbound_id) > 0)
    && Number(item.kg) > 0 && quantity > 0 && Number.isFinite(item.price))
    next.price = Number(item.price) * Number(item.kg) / quantity
  return next
}

export function normalizeShipmentDeclaration<T extends DeclarationItem>(item: T, material?: DeclarationMaterial): T {
  if (!material?.unit_kg) return item // Metadata has not loaded: do not guess a unit.
  if (!isShipmentCountUnit(material.unit_kg)) return item // Keep actual measured kg/tonnes, including an explicit zero.
  if (item.qty == null || !Number.isFinite(Number(item.qty)) || Number(item.qty) < 0) return item
  return rebaseShipmentDeclaration(item, shipmentKgWeight(material.unit_kg, item.qty, material.net_per_pc, material.name_zh))
}

export function normalizeShipmentDeclarations<T extends DeclarationItem>(items: readonly T[], materials: ReadonlyMap<number, DeclarationMaterial>): T[] {
  return items.map(item => normalizeShipmentDeclaration(item, materials.get(item.material_id!)
    || (item.material_snapshot && typeof item.material_snapshot === 'object' ? item.material_snapshot as DeclarationMaterial : undefined)))
}
