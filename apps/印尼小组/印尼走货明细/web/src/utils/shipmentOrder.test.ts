import { expect, it } from 'vitest'
import { CUSTOMS_FIXED, shipmentKeepsSourceOrder, sortShipmentItems } from './shipmentOrder'

it('出库拉入后保留追加及保存顺序，不按报关公司、供应商或 OUT 编号重新排序', () => {
  const rows = [
    { material_id: 1, outbound_id: 109, customs_company: 'Z', supplier: 'Z' },
    { material_id: 2, outbound_id: 101, customs_company: CUSTOMS_FIXED, supplier: 'A' },
    { material_id: 3, outbound_id: 105, customs_company: 'A', supplier: 'B' },
  ]
  const before = structuredClone(rows)
  expect(sortShipmentItems(rows, new Map())).toEqual(before)
  const saved = rows.map((row, index) => ({ ...row, seq: index + 1 }))
  expect(sortShipmentItems(JSON.parse(JSON.stringify(saved)), new Map())).toEqual(saved)
  expect(shipmentKeepsSourceOrder([{ sources: [rows[0]] }])).toBe(true)
  expect(rows).toEqual(before)
})

it('华胜益置顶，其他报关公司和供应商排序，同组保留原顺序', () => {
  const rows = [
    { material_id: 1, customs_company: 'B', supplier: 'B' },
    { material_id: 2, customs_company: CUSTOMS_FIXED, supplier: 'B' },
    { material_id: 3, customs_company: 'A', supplier: 'A' },
    { material_id: 4, customs_company: CUSTOMS_FIXED, supplier: 'A' },
    { material_id: 5, customs_company: 'B', supplier: 'B' },
  ]
  const sorted = sortShipmentItems(rows, new Map())
  expect(sorted.map(r => r.material_id)).toEqual([4, 2, 3, 1, 5])
  expect(rows.map(r => r.material_id)).toEqual([1, 2, 3, 4, 5])
})
it('主资料回退、空公司回退和行覆盖与导出相同', () => {
  const mats = new Map([[1, { customs_company: 'B', supplier: 'B' }]])
  expect(sortShipmentItems([{ material_id: 1 }, { material_id: 2 }], mats).map(r => r.material_id)).toEqual([2, 1])
  expect(sortShipmentItems([{ material_id: 1, customs_company: 'A' }, { material_id: 2, customs_company: 'B' }], mats).map(r => r.material_id)).toEqual([1, 2])
})
