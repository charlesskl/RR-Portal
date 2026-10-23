import type { Material, SupplierDict } from '../api/client'
import { purchaseItemCodes, sameSupplier } from './purchaseCustoms'

interface WeightLine {
  material_id?: number; product_code?: string; material_name?: string; spec?: string
  net_per_pc?: number; ship_unit?: string
}
const norm = (value?: string) => (value || '').trim().toLocaleLowerCase()

function resolveMaterial(original: WeightLine, materials: Material[], supplier: string, profiles: SupplierDict[]): { material?: Material; reason: string; matchedBy: string } {
  const unique = [...new Map(materials.filter(m => m.id != null).map(m => [Number(m.id), m])).values()]
    const fail = (reason: string) => ({ reason, matchedBy: '' })
    const codes = purchaseItemCodes(original.product_code, unique.map(m => m.product_code))
    if (codes.length > 1) return fail('多货号合并行，请先取消合并，再分别回填净重')
    let material = unique.find(m => Number(m.id) === Number(original.material_id))
    let matchedBy = '已有物料关联'
    // An explicitly selected material ID is authoritative: schedule product codes
    // may include customer suffixes that differ from the source library code.
    if (!material) {
      if (codes.length !== 1 || !norm(original.material_name)) return fail('缺少物料关联，需补齐货号及物料名称')
      const candidates = unique.filter(m => norm(m.product_code) === norm(codes[0])
        && norm(m.name_zh) === norm(original.material_name) && norm(m.spec) === norm(original.spec)
        && sameSupplier(m.supplier || '', supplier, profiles))
      if (candidates.length !== 1) return fail(candidates.length
        ? '匹配到多条物料，请核对物料关联，不能自动选取'
        : '未找到唯一物料，请核对完整货号、名称、规格及供应商')
      material = candidates[0]
      matchedBy = '按货号、名称、规格及供应商唯一匹配（补齐关联）'
    }
    return { material, matchedBy, reason: '' }
}

export function autoLinkPurchaseMaterials<T extends WeightLine>(items: T[], materials: Material[], supplier: string, profiles: SupplierDict[]) {
  const issues: string[] = []
  let linked = 0
  const next = items.map((item, index) => {
    if (materials.some(m => Number(m.id) === Number(item.material_id))) return item
    const match = resolveMaterial(item, materials, supplier, profiles)
    if (!match.material) { issues.push(`第 ${index + 1} 行：${match.reason}`); return item }
    linked++
    // Restore identity only; missing weight does not mean a material cannot be linked.
    return { ...item, material_id: Number(match.material.id) }
  })
  return { items: next, linked, issues }
}

export function planPurchaseNetWeight<T extends WeightLine>(items: T[], materials: Material[], supplier: string, profiles: SupplierDict[]) {
  return items.map((original, index) => {
    const fail = (reason: string) => ({ index, original, next: original, reason, matchedBy: '', ready: false })
    const { material, matchedBy, reason } = resolveMaterial(original, materials, supplier, profiles)
    if (!material) return fail(reason)
    const net = Number(material.net_per_pc)
    if (!Number.isFinite(net) || net <= 0) return fail('货号库单净重为空或不大于 0，请补齐该物料的单净重后重试')
    return { index, original, ready: true, reason: '', matchedBy,
      next: { ...original, material_id: Number(material.id), net_per_pc: net,
        ship_unit: material.unit_kg?.trim() || original.ship_unit?.trim() || 'KGM' } }
  })
}
