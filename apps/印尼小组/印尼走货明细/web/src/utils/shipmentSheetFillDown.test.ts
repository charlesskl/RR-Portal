import { expect, it } from 'vitest'
import { applyShipmentSheetEdits, sheetFillDownEdits } from './shipmentSheet'

const fields = ['', 'qty', 'currency', 'product_use']
const rows = [
  { qty: 12.345678, currency: 'US$', product_use: '' },
  { qty: 2, currency: '¥', product_use: '模具' },
  { qty: 3, currency: 'HK$', product_use: '其他' },
]
const valueAt = (row: number, field: string) => rows[row][field as keyof typeof rows[number]]
it('single cell copies only the immediately preceding row with full precision', () => {
  expect(sheetFillDownEdits({ row: 1, col: 1 }, { row: 1, col: 1 }, 3, fields, valueAt))
    .toEqual([{ row: 1, field: 'qty', value: '12.345678' }])
  expect(sheetFillDownEdits({ row: 2, col: 1 }, { row: 2, col: 1 }, 3, fields, valueAt))
    .toEqual([{ row: 2, field: 'qty', value: '2' }])
})
it('single-row horizontal selection copies the cells above, skipping protected columns', () => {
  expect(sheetFillDownEdits({ row: 1, col: 0 }, { row: 1, col: 3 }, 3, fields, valueAt)).toEqual([
    { row: 1, field: 'qty', value: '12.345678' }, { row: 1, field: 'currency', value: 'US$' },
    { row: 1, field: 'product_use', value: '' },
  ])
})
it.each([false, true])('multi-row range always uses its top row, including reverse selection (%s)', reverse => {
  const start = { row: 0, col: 1 }, end = { row: 2, col: 1 }
  expect(sheetFillDownEdits(reverse ? end : start, reverse ? start : end, 3, fields, valueAt)).toEqual([
    { row: 1, field: 'qty', value: '12.345678' }, { row: 2, field: 'qty', value: '12.345678' },
  ])
})
it('first row, no selection, protected cells and stale bounds cannot produce writes', () => {
  expect(() => sheetFillDownEdits({ row: 0, col: 1 }, { row: 0, col: 1 }, 3, fields, valueAt)).toThrow('第一行')
  expect(() => sheetFillDownEdits(null, null, 3, fields, valueAt)).toThrow('先点击')
  expect(() => sheetFillDownEdits({ row: 1, col: 0 }, { row: 1, col: 0 }, 3, fields, valueAt)).toThrow('没有可填充')
  expect(() => sheetFillDownEdits({ row: 1, col: 1 }, { row: 3, col: 1 }, 3, fields, valueAt)).toThrow('已变化')
})
it('single-cell fill runs existing calculation without changing outbound identity or the source row', () => {
  const items = [{ material_id: 1, outbound_id: 71, qty: 12, kg: 2.4 }, { material_id: 1, outbound_id: 72, qty: 2, kg: .4 }]
  const edits = sheetFillDownEdits({ row: 1, col: 1 }, { row: 1, col: 1 }, 2, fields, (r) => items[r].qty)
  const result = applyShipmentSheetEdits(items, new Map([[1, { unit_kg: 'KGM', net_per_pc: .2 }]]), edits)
  expect(result.items[0]).toEqual(items[0])
  expect(result.items[1]).toMatchObject({ outbound_id: 72, qty: 12, kg: 2.4 })
  expect(items[1].qty).toBe(2)
})
