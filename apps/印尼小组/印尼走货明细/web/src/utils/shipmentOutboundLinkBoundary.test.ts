import { describe, expect, it } from 'vitest'
import { linkShipmentOutbound } from './shipmentOutboundLink'

const material = { id: 66, name_zh: '纸绳', product_code: 'PAPER', spec: '2mm' }
const materials = new Map([[66, material]])
const row = { _rowKey: 1, id: 11, material_id: 66, qty: 20, kg: .004, cartons: 1 }
const source = { outbound_id: 75, material_id: 66, allocatable_qty: 30, purchase_unit: '米' }

describe('existing visible quantity unit is preserved when linking', () => {
  it('uses the table paper-rope metre fallback when purchase_unit was not saved', () => {
    expect(linkShipmentOutbound([row], 1, source, material, materials)[0]).toMatchObject({ ...row, outbound_id: 75, purchase_unit: '米' })
  })
  it('also keeps the established metre fallback when the PO source unit is absent', () => {
    expect(linkShipmentOutbound([row], 1, { ...source, purchase_unit: undefined }, material, materials)[0]).toMatchObject({ purchase_unit: '米' })
  })
  it('does not override an explicit row unit with a material-name fallback', () => {
    expect(linkShipmentOutbound([{ ...row, purchase_unit: 'pcs' }], 1, { ...source, purchase_unit: '个' }, material, materials)[0]).toMatchObject({ outbound_id: 75 })
  })
  it('does not interpret an existing paper-rope metre quantity as pieces', () => {
    expect(() => linkShipmentOutbound([row], 1, { ...source, purchase_unit: '个' }, material, materials)).toThrow('单位')
  })
  it('uses the current imported snapshot name for the fallback before mapping identity', () => {
    const imported = { ...row, material_id: -1, material_snapshot: { name_zh: '纸绳', length: 22 } }
    const mapped = new Map([[-1, imported.material_snapshot]])
    expect(linkShipmentOutbound([imported], 1, source, material, mapped)[0].material_snapshot).toMatchObject({ id: 66, length: 22 })
    expect(() => linkShipmentOutbound([imported], 1, { ...source, purchase_unit: '个' }, material, mapped)).toThrow('单位')
  })
})
