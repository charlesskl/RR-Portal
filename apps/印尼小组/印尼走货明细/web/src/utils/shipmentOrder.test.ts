import { expect, it } from 'vitest'
import { CUSTOMS_FIXED, sortShipmentItems } from './shipmentOrder'

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
