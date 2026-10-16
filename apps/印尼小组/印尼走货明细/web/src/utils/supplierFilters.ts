import type { SupplierDict } from '../api/client'
import { supplierCustomsCompany } from './supplierProfiles'

export type SupplierFilterField = 'displayName' | 'customsCompany'
export function supplierFilterValue(row: SupplierDict, field: SupplierFilterField): string {
  return field === 'displayName' ? (row.keyword?.trim() || row.full?.trim() || '') : supplierCustomsCompany(row)
}
const supplierNameCollator = new Intl.Collator('zh-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' })
export function sortSuppliersByDisplayName<T extends SupplierDict>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const left = supplierFilterValue(a, 'displayName')
    const right = supplierFilterValue(b, 'displayName')
    if (!left || !right) return left ? -1 : right ? 1 : 0
    return supplierNameCollator.compare(left, right)
  })
}
export function supplierFilterOptions(rows: SupplierDict[], field: SupplierFilterField) {
  return [...new Set(rows.map(row => supplierFilterValue(row, field)))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map(value => ({ text: value || '（未填写）', value }))
}
