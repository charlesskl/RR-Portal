import type { Material } from '../api/client'

export const toolKinds = ['工具', '机器设备'] as const
const norm = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/×/g, '*')
export type ToolImportRow = { incoming: Material; candidates: Material[]; choice: number | 'new' | 'skip' }

export function planToolImport(existing: Material[], incoming: Material[]): ToolImportRow[] {
  const plans = incoming.map(m => {
    const coded = m.material_code ? existing.filter(e => norm(e.material_code) === norm(m.material_code)) : []
    const sameName = existing.filter(e => norm(e.name_zh) === norm(m.name_zh))
    const candidates = coded.length ? coded : sameName
    const exact = candidates.filter(e => coded.length || (
      norm(e.spec) === norm(m.spec) && norm(e.related_product_code) === norm(m.related_product_code) &&
      (!m.supplier || norm(e.supplier) === norm(m.supplier)) && (!m.tool_kind || e.tool_kind === m.tool_kind)))
    const choice: ToolImportRow['choice'] = exact.length === 1 ? exact[0].id! : candidates.length ? 'skip' : 'new'
    return { incoming: m, candidates, choice }
  })
  // 同一目标被源文件多次命中时，不让后行静默覆盖前行。
  const counts = new Map<number, number>()
  for (const p of plans) if (typeof p.choice === 'number') counts.set(p.choice, (counts.get(p.choice) || 0) + 1)
  return plans.map(p => typeof p.choice === 'number' && counts.get(p.choice)! > 1 ? { ...p, choice: 'skip' } : p)
}

export function mergeToolMaterial(existing: Material | undefined, incoming: Material): Material {
  // 空白不擦除旧档案；导入无图片保留旧图；保留 ID、启用状态、版本。
  const fields = Object.fromEntries(Object.entries(incoming).filter(([key, v]) =>
    !['id', 'revision', 'active', 'product_code', 'usage_qty', 'sort_order', 'image_id'].includes(key) &&
    v != null && v !== ''))
  return { ...existing, ...fields, active: existing?.active ?? true }
}
