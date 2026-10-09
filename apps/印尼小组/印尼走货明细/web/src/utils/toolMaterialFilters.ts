import type { Material } from '../api/client'

export const toolFilterFields = ['image', 'supplier', 'customs_company', 'tool_kind', 'name_zh', 'material_code', 'spec',
  'related_product_code', 'hs_cn', 'hs_id', 'unit_kg', 'purchase_price', 'purchase_currency', 'active'] as const
export type ToolFilterField = typeof toolFilterFields[number]
export type ToolFilters = Partial<Record<ToolFilterField, string[]>>

export function toolFilterValue(m: Material, field: ToolFilterField): string {
  if (field === 'image') return m.image ? '有图' : '无图'
  if (field === 'active') return m.active === false ? '停用' : '启用'
  return String(m[field] ?? '').trim()
}

export function toolFilterOptions(rows: Material[], field: ToolFilterField) {
  const values = field === 'image' ? ['有图', '无图'] : field === 'active' ? ['启用', '停用']
    : [...new Set(rows.map(m => toolFilterValue(m, field)))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return values.map(value => ({ value, text: value || '（未填写）' }))
}

export function filterToolMaterials(rows: Material[], filters: ToolFilters, query: string) {
  const search = query.trim().toLowerCase()
  return rows.filter(m => toolFilterFields.every(field =>
    !filters[field]?.length || filters[field]!.includes(toolFilterValue(m, field))) &&
    [...toolFilterFields, 'name_en' as const].some(field =>
      String(field === 'name_en' ? m.name_en || '' : toolFilterValue(m, field)).toLowerCase().includes(search)))
}
