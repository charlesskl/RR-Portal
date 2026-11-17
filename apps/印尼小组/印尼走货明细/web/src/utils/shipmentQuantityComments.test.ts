import { expect, it } from 'vitest'
import { shipmentQuantityComments } from './shipmentQuantityComments'

it('按采购数量标注360pcs备品，不把申报重量当件数', () => {
  expect(shipmentQuantityComments([{ outbound_id: 1, qty: 38328, kg: 4178, purchase_charge_ratio: 37968 / 38328 }], 'PCS'))
    .toEqual([{ author: 'RR-Portal', text: '360pcs备品' }])
})
it('合并来源先汇总备品，再去除浮点尾差；纯备品和非件数单位沿用采购数量', () => {
  expect(shipmentQuantityComments([{ qty: 9000, purchase_charge_ratio: 15100 / 15251 },
    { qty: 6251, purchase_charge_ratio: 15100 / 15251 }], '个')[0].text).toBe('151pcs备品')
  expect(shipmentQuantityComments([{ qty: 2.5, purchase_charge_ratio: 0 }], '卷')[0].text).toBe('2.5卷备品')
  expect(shipmentQuantityComments([{ qty: 1, purchase_charge_ratio: .9999 }], '米')[0].text).toBe('0.0001米备品')
  expect(shipmentQuantityComments([{ qty: 1, purchase_charge_ratio: 1 }], '个')).toEqual([])
})
it('未关联的导入行保留原批注，不从申报金额重新推算或重复折扣', () => {
  const material_snapshot = { import_source: { cells: [{ label: '送货数量\nProduct quantity',
    comments: [{ author: 'Administrator', text: '360pcs备品' }, { author: '审核人', text: '已核对<数量>&单位' }] }] } }
  expect(shipmentQuantityComments([{ qty: 38328, kg: 4178, purchase_charge_ratio: .5, material_snapshot }], 'PCS'))
    .toEqual(material_snapshot.import_source.cells[0].comments)
  expect(shipmentQuantityComments([{ qty: 38328, kg: 4178, material_snapshot: {} }], 'PCS')).toEqual([])
  expect(shipmentQuantityComments([{ qty: 38328 }], 'PCS')).toEqual([])
})
it('已关联的真实备品比例更新旧备品批注，人工核对备注保留', () => {
  const source = { outbound_id: 1, qty: 100, purchase_charge_ratio: .9, material_snapshot: { import_source: { cells: [
    { label: '送货数量', comments: [{ author: 'Administrator', text: '360pcs备品' }, { author: '审核人', text: '已核对' }] },
    { label: '申报数量', comments: [{ author: 'Administrator', text: '不要写入送货数量的批注' }] },
  ] } } }
  expect(shipmentQuantityComments([source], 'PCS')).toEqual([
    { author: '审核人', text: '已核对' }, { author: 'RR-Portal', text: '10pcs备品' },
  ])
})
