import { expect, it } from 'vitest'
import { linkShipmentOutbound, remainingOutboundQuantity } from './shipmentOutboundLink'

const material = { id: 66, name_zh: '中边模', product_code: '46745', spec: 'A', supplier: 'A' }
const materials = new Map([[66, material]])
const source = { outbound_id: 75, material_id: 66, allocatable_qty: 10, po_no: 'IRRIHS44', supplier: 'A', price: 2, currency: 'US$', purchase_unit: '个' }
const row = { _rowKey: 1, id: 11, material_id: 66, qty: 2, kg: 4, cartons: 1, carton_no: '3-4', pallet: '1', qty_per_carton: '2', weighing_qty: 2, supplier: 'A' }
it('links in place, keeps row identity and packing, does not mutate input', () => {
  const original = [{ ...row }, { ...row, _rowKey: 2 }]
  const linked = linkShipmentOutbound(original, 1, source, material, materials)
  expect(linked).toHaveLength(2)
  expect(linked[0]).toMatchObject({ ...row, outbound_id: 75, price: 2, po_no: 'IRRIHS44' })
  expect(linked[1]).toBe(original[1])
  expect(original[0]).not.toHaveProperty('outbound_id')
})
it('maps imported snapshot to confirmed material without discarding local dimensions', () => {
  const snapshot = { name_zh: '导入中模', length: 22, weight_per_carton: 3, net_per_pc: .1, image: 'local' }
  const imported = { ...row, material_id: -1, material_snapshot: snapshot }
  const result = linkShipmentOutbound([imported], 1, source, material, new Map([[-1, { ...snapshot, length: 23 }]]))[0]
  expect(result.material_id).toBe(-1) // editor-local key; Save sends snapshot.id
  expect(result.material_snapshot).toMatchObject({ id: 66, name_zh: '中边模', product_code: '46745', length: 23, weight_per_carton: 3, net_per_pc: .1, image: 'local' })
  expect(result).toMatchObject({ qty: 2, kg: 4, carton_no: '3-4', outbound_id: 75 })
  expect(snapshot).not.toHaveProperty('id')
})
it('deducts unsaved allocations in the same container and allows exact balance', () => {
  const rows = [row, { ...row, _rowKey: 2, outbound_id: 75, qty: 8 }]
  expect(remainingOutboundQuantity(rows, 1, source)).toBe(2)
  expect(linkShipmentOutbound(rows, 1, source, material, materials)).toHaveLength(2)
  expect(() => linkShipmentOutbound(rows, 1, { ...source, allocatable_qty: 9 }, material, materials)).toThrow('超过')
})
it.each([0, -1, NaN, Infinity])('rejects invalid qty %s', qty => {
  expect(() => linkShipmentOutbound([{ ...row, qty }], 1, source, material, materials)).toThrow('大于 0')
})
it('rejects mismatched material, repeat links, deleted row and conflicting units', () => {
  expect(() => linkShipmentOutbound([row], 1, { ...source, material_id: 65 }, material, materials)).toThrow('无效')
  expect(() => linkShipmentOutbound([{ ...row, material_id: 65 }], 1, source, material, materials)).toThrow('不一致')
  expect(() => linkShipmentOutbound([{ ...row, outbound_id: 74 }], 1, source, material, materials)).toThrow('已有')
  expect(() => linkShipmentOutbound([], 1, source, material, materials)).toThrow('已变化')
  expect(() => linkShipmentOutbound([{ ...row, purchase_unit: 'KGM' }], 1, source, material, materials)).toThrow('单位')
  expect(linkShipmentOutbound([{ ...row, purchase_unit: 'pcs' }], 1, source, material, materials)[0]).toMatchObject({ outbound_id: 75 })
})
it('protects shared carton group and rejects RRI/RRM mixing', () => {
  expect(() => linkShipmentOutbound([{ ...row, carton_group: 'group' }], 1, { ...source, supplier: 'B' }, material, materials)).toThrow('合并箱数')
  expect(linkShipmentOutbound([{ ...row, carton_group: 'group' }], 1, source, material, materials)[0].carton_group).toBe('group')
  expect(() => linkShipmentOutbound([row, { ...row, _rowKey: 2, po_no: 'IRRMHS01' }], 1, source, material, materials)).toThrow('RRI')
})
