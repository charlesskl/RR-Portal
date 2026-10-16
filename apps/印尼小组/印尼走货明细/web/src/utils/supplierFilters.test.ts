import { expect, it } from 'vitest'
import { sortSuppliersByDisplayName, supplierFilterOptions, supplierFilterValue } from './supplierFilters'

it('sorts displayed names by pinyin without changing source order, putting blanks last', () => {
  const rows = [{ keyword: '深圳' }, { keyword: ' ', full: '东莞' }, { keyword: '保士特10' }, { keyword: '' }, { keyword: '保士特2' }]
  const original = [...rows]
  expect(sortSuppliersByDisplayName(rows).map(r => supplierFilterValue(r, 'displayName')))
    .toEqual(['保士特2', '保士特10', '东莞', '深圳', ''])
  expect(rows).toEqual(original)
})

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

it('uses pinyin and natural numeric ordering for mixed Chinese and English display names', () => {
  const rows = [{ keyword: 'Zeta' }, { keyword: '东莞' }, { keyword: '保士特10' }, { keyword: 'alpha10' }, { keyword: 'Alpha2' }, { keyword: '保士特2' }, { keyword: '深圳' }]
  expect(sortSuppliersByDisplayName(rows).map(row => row.keyword))
    .toEqual(['保士特2', '保士特10', '东莞', '深圳', 'Alpha2', 'alpha10', 'Zeta'])
})

it('keeps equal names and blank names in original order and preserves row identity', () => {
  const rows = [
    { id: 5, keyword: 'ＡLPHA' }, { id: 2, keyword: '' },
    { id: 8, keyword: 'alpha' }, { id: 4, keyword: ' ', full: ' ' },
    { id: 1, keyword: 'Alpha' },
  ]
  const sorted = sortSuppliersByDisplayName(rows)
  expect(sorted.map(row => row.id)).toEqual([5, 8, 1, 2, 4])
  expect(sorted[0]).toBe(rows[0])
  expect(rows.map(row => row.id)).toEqual([5, 2, 8, 4, 1])
})

it('trims whitespace before choosing the displayed name and handles empty input', () => {
  expect(supplierFilterValue({ keyword: ' \t', full: ' 东莞 ' }, 'displayName')).toBe('东莞')
  expect(supplierFilterValue({ keyword: ' 台聚 ', full: ' 东莞台聚 ' }, 'displayName')).toBe('台聚')
  expect(sortSuppliersByDisplayName([])).toEqual([])
})
