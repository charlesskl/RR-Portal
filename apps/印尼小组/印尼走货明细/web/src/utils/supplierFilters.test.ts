import { expect, it } from 'vitest'
import { supplierFilterOptions, supplierFilterValue } from './supplierFilters'

it('filters supplier display name, falling back to full company name', () => {
  expect(supplierFilterValue({ keyword: '台聚', full: '东莞台聚' }, 'displayName')).toBe('台聚')
  expect(supplierFilterValue({ keyword: '', full: '东莞台聚' }, 'displayName')).toBe('东莞台聚')
})
it('uses the displayed customs company including defaults and normalized Huashengyi', () => {
  expect(supplierFilterValue({ keyword: '台聚', full: '东莞台聚' }, 'customsCompany')).toBe('东莞台聚')
  const rows = [{ keyword: '甲', customs: '华胜益' }, { keyword: '乙', customs: '深圳市华胜益出口贸易有限公司' }]
  expect(supplierFilterOptions(rows, 'customsCompany')).toEqual([
    { text: '深圳市华胜益出口贸易有限公司', value: '深圳市华胜益出口贸易有限公司' },
  ])
})
it('keeps empty values selectable and removes duplicate options', () => {
  expect(supplierFilterOptions([{ keyword: '' }, { keyword: '' }], 'displayName')).toEqual([{ text: '（未填写）', value: '' }])
})
