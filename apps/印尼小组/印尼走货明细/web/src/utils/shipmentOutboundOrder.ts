import type { Material } from '../api/client'

interface ImportedShipmentRow {
  material_id?: number; material_snapshot?: Material; outbound_id?: number; po_no?: string; supplier?: string
}
interface OutboundOrderSource {
  outbound_id: number; material_id?: number; code?: string; name_zh?: string; spec?: string; po_no?: string; supplier?: string
}
const normalized = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()

/** Presentation order only: matching never links stock or changes quantities. */
export function orderOutboundByShipmentImport<T extends OutboundOrderSource>(
  sources: readonly T[], items: readonly ImportedShipmentRow[], materials: ReadonlyMap<number, Material>,
): T[] {
  const groups = new Map<string, number>()
  const imported = items.flatMap((item, index) => {
    const material = materials.get(item.material_id!) || item.material_snapshot
    const source = material?.import_source
    if (!material || !source) return []
    // Preserve file/sheet encounter order, then restore the original Excel row
    // even if an older saved shipment had been sorted by supplier/company.
    const key = JSON.stringify([source.file || '', source.sheet])
    if (!groups.has(key)) groups.set(key, groups.size)
    return [{ item, material, index, group: groups.get(key)!, row: Number(source.row) || index + 1 }]
  }).sort((a, b) => a.group - b.group || a.row - b.row || a.index - b.index)
  if (!imported.length) return [...sources]
  const matches = (source: T, item: ImportedShipmentRow, material: Material) => {
    if (Number(item.outbound_id) > 0) return item.outbound_id === source.outbound_id
    if (item.po_no && normalized(item.po_no) !== normalized(source.po_no)) return false
    const knownId = item.material_snapshot ? material.id : item.material_id
    if (Number(knownId) > 0) return knownId === source.material_id
    if (!normalized(material.name_zh) || normalized(material.name_zh) !== normalized(source.name_zh)) return false
    const code = material.product_code || material.related_product_code
    if (code && normalized(code) !== normalized(source.code)) return false
    if (material.spec && normalized(material.spec) !== normalized(source.spec)) return false
    const supplier = item.supplier || material.supplier
    return !supplier || normalized(supplier) === normalized(source.supplier)
  }
  return sources.map((source, index) => {
    // An explicitly linked row takes precedence over a similar unlinked row.
    const linked = imported.findIndex(row => row.item.outbound_id === source.outbound_id)
    const rank = linked >= 0 ? linked : imported.findIndex(row => matches(source, row.item, row.material))
    return { source, index, rank: rank < 0 ? imported.length : rank }
  }).sort((a, b) => a.rank - b.rank || a.index - b.index).map(row => row.source)
}
