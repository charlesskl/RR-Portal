import { expect, it } from 'vitest'
import { allocateShipmentCartons, applyMergedShipmentEdits } from './shipmentMergedEditor'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { shipmentPurchaseAmount } from './shipmentPurchase'
import { cartonLayout } from './shipmentOrder'
import { sheetFillDownEdits, sheetPasteEdits } from './shipmentSheet'

const materials = new Map([[974, { id: 974, name_zh: 'PB螺丝', unit_kg: 'KGM', net_per_pc: .000352 }]])
const batches = [
  { _rowKey: 1, material_id: 974, outbound_id: 74, qty: 9000, kg: 3.168, cartons: 1,
    qty_per_carton: '10000', price: .002, purchase_unit: '个', po_no: 'PO-A', po_date: '2026-10-01', carton_no: '1', pallet: 'A' },
  { _rowKey: 2, material_id: 974, outbound_id: 75, qty: 20000, kg: 7.04, cartons: 2,
    qty_per_carton: '10000', price: .003, purchase_unit: '个', po_no: 'PO-B', po_date: '2026-10-02', carton_no: '2-3', pallet: 'A' },
]
const edit = (field: string, value: string, row = 0) => ({ row, field, value })
const merged = (rows = batches) => consolidateShipmentItems(rows, materials)
const apply = (edits: ReturnType<typeof edit>[], rows = batches) =>
  applyMergedShipmentEdits(rows, materials, merged(rows), edits)

it('合同、卡板、箱号直接修改后仍为一行，原始数量重量和采购来源完整保留', () => {
  const before = structuredClone(batches)
  const result = apply([edit('contract_no', 'C-NEW'), edit('pallet', '1-2/2卡'), edit('carton_no', '1-3')])
  expect(result.items.map(row => [row.outbound_id, row.qty, row.kg, row.price, row.po_no, row.po_date]))
    .toEqual(before.map(row => [row.outbound_id, row.qty, row.kg, row.price, row.po_no, row.po_date]))
  expect(result.items.every(row => (row as any).contract_no === 'C-NEW' && row.pallet === '1-2/2卡')).toBe(true)
  expect(merged(result.items)).toHaveLength(1)
  expect(merged(result.items)[0]).toMatchObject({ qty: 29000, kg: 10.208, cartons: 3, po_no: 'PO-A / PO-B', carton_no: '1-3' })
  expect(shipmentPurchaseAmount(merged(result.items)[0])).toBe(78)
  expect(batches).toEqual(before)
})
it.each(['qty', 'kg', 'po_no', 'po_date'])('粘贴/快捷键也不能覆盖合并行的受保护字段 %s，整次不写入', field => {
  const before = structuredClone(batches)
  expect(() => apply([edit('contract_no', 'C-NEW'), edit(field, field === 'po_date' ? '2026-10-28' : '1')])).toThrow()
  expect(batches).toEqual(before)
})
it('修改独立箱数按原箱数分配整数，数量重量和金额不变', () => {
  const result = apply([edit('cartons', '5')])
  expect(result.items.map(row => row.cartons)).toEqual([2, 3])
  expect(result.items.map(row => [row.qty, row.kg])).toEqual([[9000, 3.168], [20000, 7.04]])
  expect(merged(result.items)[0].cartons).toBe(5)
})
it('修改每箱数量或尺寸不会覆盖原来实测重量', () => {
  const rows = batches.map(row => ({ ...row, kg: row.kg + 1 }))
  const result = apply([edit('qty_per_carton', '5000'), edit('material:length', '30')], rows)
  expect(result.items.map(row => row.kg)).toEqual(rows.map(row => row.kg))
  expect(result.items.map(row => row.qty)).toEqual([9000, 20000])
  expect(result.materials.get(974).length).toBe(30)
  expect(merged(result.items)).toHaveLength(1)
})
it('共箱只计一次；与其他物料共箱也同步物理箱数', () => {
  const rows = [...batches.map(row => ({ ...row, carton_group: 'G', cartons: 3 })),
    { ...batches[0], _rowKey: 3, outbound_id: 76, material_id: 975, qty: 1, kg: 1, carton_group: 'G', cartons: 3 }]
  const mats = new Map([...materials, [975, { id: 975, name_zh: '其他物料', unit_kg: 'KGM', net_per_pc: 1 }]])
  const result = applyMergedShipmentEdits(rows, mats, consolidateShipmentItems(rows, mats), [edit('cartons', '7')])
  expect(result.items.map(row => row.cartons)).toEqual([7, 7, 7])
  expect(cartonLayout(consolidateShipmentItems(result.items, mats), mats).reduce((sum, row) => sum + row.count, 0)).toBe(7)
})
it('拒绝分段每箱数量及公式，避免错误复制整套批次装箱计划', () => {
  expect(() => apply([edit('qty_per_carton', '1-2/100')])).toThrow('统一数量')
  expect(() => apply([edit('contract_no', '=1+2')])).toThrow('不执行')
})
it('粘贴和向下填充按可见合并行定位，不误写相邻源批次', () => {
  const rows = [...batches, { ...batches[0], _rowKey: 3, outbound_id: 76, pallet: 'OTHER' }]
  const display = merged(rows)
  const edits = sheetPasteEdits([['C1'], ['C2']], { row: 0, col: 0 }, display.length, ['contract_no'])
  const result = applyMergedShipmentEdits(rows, materials, display, edits)
  expect(result.items.map(row => (row as any).contract_no)).toEqual(['C1', 'C1', 'C2'])
  const filled = sheetFillDownEdits({ row: 1, col: 0 }, { row: 1, col: 0 }, 2, ['carton_no'], () => 'A-1')
  const next = applyMergedShipmentEdits(rows, materials, display, filled)
  expect(next.items.map(row => row.carton_no)).toEqual(['1', '2-3', 'A-1'])
})
it('未合并的单行保持原编辑能力，并检查实际出库可用量', () => {
  const rows = [batches[0]], display = merged(rows)
  expect(() => applyMergedShipmentEdits(rows, materials, display, [edit('qty', '18000')])).toThrow('未加载')
  expect(() => applyMergedShipmentEdits(rows, materials, display, [edit('qty', '18000')],
    [{ outbound_id: 74, allocatable_qty: 10000 }])).toThrow('OUT-74')
  const result = applyMergedShipmentEdits(rows, materials, display, [edit('qty', '4500')])
  expect(result.items[0].qty).toBe(4500)
  expect(result.items[0].kg).toBe(1.584)
})
it.each([[1, [1, 2, 3]], [100, [7, 11, 13]], [0, [1, 2]], [5, [0, 0]]] as const)(
  '独立箱数分配守恒且不生成小数箱 %s', (total, weights) => {
    const result = allocateShipmentCartons(total, [...weights])
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(total)
    expect(result.every(value => value >= 0 && Number.isInteger(value))).toBe(true)
  })
