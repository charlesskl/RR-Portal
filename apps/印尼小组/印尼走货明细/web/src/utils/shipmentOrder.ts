import type { Material } from '../api/client'

export const CUSTOMS_FIXED = '深圳市华胜益出口贸易有限公司'
export function effectiveCustomsCompany(
  item: { customs_company?: string }, material?: Pick<Material, 'customs_company'>, fallback = CUSTOMS_FIXED,
) {
  return (item.customs_company || material?.customs_company || fallback || CUSTOMS_FIXED).trim()
}

interface ShipmentOrderSource { outbound_id?: number; material_snapshot?: unknown }

export function shipmentKeepsSourceOrder(items: readonly (ShipmentOrderSource & { sources?: readonly ShipmentOrderSource[] })[]) {
  const fromSource = (item: ShipmentOrderSource) => Number(item.outbound_id) > 0 || !!(item.material_snapshot && typeof item.material_snapshot === 'object'
    && 'import_source' in item.material_snapshot && item.material_snapshot.import_source)
  return items.some(item => fromSource(item) || item.sources?.some(fromSource))
}

// Excel imports and outbound pulls keep their saved/source order in editor
// and export. An outbound allocation already has a meaningful append order;
// grouping by company/supplier here would silently rearrange it after pulling.
// Catalog-only shipments retain the original company/supplier ordering.
export function sortShipmentItems<T extends { outbound_id?: number; material_id?: number; customs_company?: string; supplier?: string; carton_group?: string; material_snapshot?: unknown }>(
  items: readonly T[], materials: ReadonlyMap<number, Material>, fallback = CUSTOMS_FIXED,
): T[] {
  if (shipmentKeepsSourceOrder(items)) return [...items]
  const mat = (it: T) => it.material_id != null ? materials.get(it.material_id) : undefined
  const ordered = [...items].sort((a, b) => {
    const ca = effectiveCustomsCompany(a, mat(a), fallback), cb = effectiveCustomsCompany(b, mat(b), fallback)
    const wa = ca === CUSTOMS_FIXED ? 0 : (ca ? 1 : 2)
    const wb = cb === CUSTOMS_FIXED ? 0 : (cb ? 1 : 2)
    return wa - wb || ca.localeCompare(cb, 'zh') ||
      (a.supplier || mat(a)?.supplier || '').trim().localeCompare((b.supplier || mat(b)?.supplier || '').trim(), 'zh')
  })
  const groups = new Map<string, T[]>()
  const result: T[] = []
  for (const item of ordered) {
    const key = cartonGroupKey(item, materials, fallback)
    if (key) groups.set(key, [...(groups.get(key) || []), item])
  }
  const seen = new Set<string>()
  for (const item of ordered) {
    const key = cartonGroupKey(item, materials, fallback)
    if (!key) result.push(item)
    else if (!seen.has(key)) { result.push(...groups.get(key)!); seen.add(key) }
  }
  return result
}

export type CartonItem = { material_id?: number; customs_company?: string; supplier?: string; carton_group?: string; cartons?: number }
export function shipmentScope(item: CartonItem, materials: ReadonlyMap<number, Material>, fallback = CUSTOMS_FIXED) {
  const m = item.material_id == null ? undefined : materials.get(item.material_id)
  return JSON.stringify([effectiveCustomsCompany(item, m, fallback), (item.supplier || m?.supplier || '').trim()])
}
export function cartonGroupKey(item: CartonItem, materials: ReadonlyMap<number, Material>, fallback = CUSTOMS_FIXED) {
  return item.carton_group ? JSON.stringify([shipmentScope(item, materials, fallback), item.carton_group]) : ''
}
export function cartonLayout(items: readonly CartonItem[], materials: ReadonlyMap<number, Material>, fallback = CUSTOMS_FIXED) {
  const seen = new Set<string>()
  return items.map((item, index) => {
    const key = cartonGroupKey(item, materials, fallback)
    if (!key) return { span: 1, count: item.cartons || 0 }
    // Merge only consecutive members: source-file order can separate a shared
    // carton group with unrelated goods. Count that physical group just once.
    if (index > 0 && cartonGroupKey(items[index - 1], materials, fallback) === key) return { span: 0, count: 0 }
    const count = seen.has(key) ? 0 : item.cartons || 0
    seen.add(key)
    let end = index + 1
    while (end < items.length && cartonGroupKey(items[end], materials, fallback) === key) end++
    return { span: end - index, count }
  })
}
