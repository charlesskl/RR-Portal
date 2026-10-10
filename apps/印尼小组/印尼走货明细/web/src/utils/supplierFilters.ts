import type { SupplierDict } from '../api/client'
import { supplierCustomsCompany } from './supplierProfiles'

export type SupplierFilterField = 'displayName' | 'customsCompany'
export function supplierFilterValue(row: SupplierDict, field: SupplierFilterField): string {
  return field === 'displayName' ? (row.keyword || row.full || '').trim() : supplierCustomsCompany(row)
}
export function supplierFilterOptions(rows: SupplierDict[], field: SupplierFilterField) {
  return [...new Set(rows.map(row => supplierFilterValue(row, field)))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map(value => ({ text: value || '（未填写）', value }))
}
