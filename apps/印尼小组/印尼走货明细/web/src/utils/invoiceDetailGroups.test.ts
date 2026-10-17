import { expect, it } from 'vitest'
import { invoiceDetailGroups } from './invoiceDetailGroups'

it.each(['螺丝', '螺母', '五金配件', '塑胶件', '搪胶件', '毛绒裁片'])('merges %s with matching HS/unit', name => {
  expect(invoiceDetailGroups([0, 1].map(index => ({ index, name, hs: '001', unit: 'KGM' })))).toEqual([[0, 1]])
})
it('keeps different HS, units, names, missing keys and unlisted names separate', () => {
  const rows = [
    { name: '螺丝', hs: '001', unit: 'KGM' },
    { name: '螺丝', hs: '002', unit: 'KGM' },
    { name: '螺丝', hs: '001', unit: 'PCE' },
    { name: '螺母', hs: '001', unit: 'KGM' },
    ...Array(2).fill({ name: '彩盒', hs: '003', unit: 'KGM' }),
    ...Array(2).fill({ name: '螺丝', hs: '', unit: 'KGM' }),
    ...Array(2).fill({ name: '螺丝', hs: '001', unit: '' }),
  ].map((row, index) => ({ ...row, index }))
  expect(invoiceDetailGroups(rows)).toEqual(rows.map(row => [row.index]))
})
it('preserves first-appearance order and non-contiguous source indices', () => {
  const rows = ['螺丝', '螺母', '螺丝'].map((name, index) => ({ index, name, hs: '001', unit: 'KGM' }))
  expect(invoiceDetailGroups(rows)).toEqual([[0, 2], [1]])
  expect(rows).toHaveLength(3)
})
