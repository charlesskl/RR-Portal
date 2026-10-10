import type { SupplierDict } from '../api/client'

export const supplierEditableFields = [
  ['keyword', '供应商显示名称'], ['full', '公司中文名称'], ['customs', '对应报关公司'],
  ['nameEn', '公司英文名称'], ['addressZh', '中文地址'], ['addressEn', '英文地址'],
  ['phone', '电话'], ['email', '邮箱'], ['contact', '联系人'],
] as const

// Only non-empty fields actually edited by this user replace the latest profile.
export function mergeSupplierProfileEdit(latest: SupplierDict | undefined, original: Partial<SupplierDict>, draft: Partial<SupplierDict>): SupplierDict {
  const result: SupplierDict = { keyword: '', ...latest }
  for (const [key] of supplierEditableFields) {
    const value = draft[key]?.trim()
    if (value && (!latest || value !== (original[key] || '').trim())) result[key] = value
  }
  result.full ||= result.keyword
  result.keyword ||= result.full || ''
  return result
}
