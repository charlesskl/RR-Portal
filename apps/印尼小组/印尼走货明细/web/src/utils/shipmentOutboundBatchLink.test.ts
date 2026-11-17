import { describe, expect, it } from 'vitest'
import { linkShipmentOutboundBatches, type ShipmentOutboundAllocation } from './shipmentOutboundBatchLink'
import { shipmentPurchaseAmount } from './shipmentPurchase'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { cartonLayout } from './shipmentOrder'
import { applyMergedShipmentEdits } from './shipmentMergedEditor'
import type { Material } from '../api/client'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { buildCustomsWorkbook } from './customsExport'
import type { LinkableShipmentRow } from './shipmentOutboundLink'
import { shipmentDecimalTicks } from './shipmentDecimal'

const material: Material = { id: 926, product_code: 'L21106', name_zh: '收缩袋', spec: '0.03*430*640MM',
  supplier: '供应商A', unit_kg: 'KGM', net_per_pc: .001, length: 30, width: 20, height: 10 }
const snapshot: Material = { ...material, id: undefined, hs_cn: '3923210000', length: 35 }
const row = { _rowKey: 1, id: 13, material_id: -1, material_snapshot: snapshot,
  outbound_id: undefined as number | undefined, po_no: undefined as string | undefined,
  purchase_charge_ratio: undefined as number | undefined, carton_group: undefined as string | undefined,
  qty: 29000, kg: 10.208, cartons: 3, qty_per_carton: '1-2/10000 3/9000', carton_no: '1-3', pallet: '1/3卡',
  supplier: '供应商A', customs_company: '报关A', purchase_unit: '个', price: 100, currency: 'US$' }
const materials = new Map([[-1, snapshot]])
const sources = [
  { outbound_id: 70, material_id: 926, allocatable_qty: 9000, purchase_unit: '个', po_no: 'IRRIHS1',
    po_date: '2026-10-01', supplier: '供应商A', customs_company: '报关A', price: .2, currency: 'US$', purchase_charge_ratio: 1 },
  { outbound_id: 71, material_id: 926, allocatable_qty: 20000, purchase_unit: '个', po_no: 'IRRIHS2',
    po_date: '2026-10-10', supplier: '供应商A', customs_company: '报关A', price: .3, currency: 'US$', purchase_charge_ratio: .9 },
]
const allocations = sources.map(source => ({ source, qty: source.allocatable_qty }))
function link(input = row, selected: ShipmentOutboundAllocation[] = allocations, rows = [input]) {
  return linkShipmentOutboundBatches(rows, 1, selected, material, materials, 'physical-packing')
}
function editorRows(result: ReturnType<typeof link>) {
  // Mirror the editor assigning unique local row/material keys after an atomic update.
  const items = result.map((item, index) => ({ ...item, _rowKey: index + 1, material_id: -(index + 1) }))
  const mats = new Map(items.map(item => [item.material_id, item.material_snapshot!]))
  return { items, mats }
}

describe('one packing row linked to multiple outbound batches', () => {
  it('retains total quantity, weight, physical cartons and all source purchase amounts without mutating the input', () => {
    const before = structuredClone(row)
    const result = link()
    expect(result.map(item => [item.outbound_id, item.qty, item.po_no, item.price, item.purchase_charge_ratio]))
      .toEqual([[70, 9000, 'IRRIHS1', .2, 1], [71, 20000, 'IRRIHS2', .3, .9]])
    expect(result.reduce((sum, item) => sum + item.kg!, 0)).toBeCloseTo(10.208, 8)
    expect(result.reduce((sum, item) => sum + shipmentPurchaseAmount(item), 0)).toBe(7200)
    expect(result[1].id).toBeUndefined()
    expect(result[1]._rowKey).toBeUndefined()
    expect(result.every(item => item.carton_group === 'physical-packing' && item.cartons === 3)).toBe(true)
    expect(result[0].material_snapshot).toMatchObject({ id: 926, length: 35, hs_cn: '3923210000', shipment_outbound_link_group: 'physical-packing' })
    expect(row).toEqual(before)
    expect(snapshot.id).toBeUndefined()
  })

  it('shows one row and three physical cartons, including range packing, after Save/reload with independent snapshot keys', () => {
    const { items, mats } = editorRows(JSON.parse(JSON.stringify(link())))
    const display = consolidateShipmentItems(items, mats)
    expect(display).toHaveLength(1)
    expect(display[0]).toMatchObject({ qty: 29000, kg: 10.208, cartons: 3, qty_per_carton: row.qty_per_carton,
      carton_no: '1-3', pallet: '1/3卡', outbound_ids: [70, 71], po_no: 'IRRIHS1 / IRRIHS2' })
    expect(shipmentPurchaseAmount(display[0])).toBeCloseTo(7200, 8)
    expect(cartonLayout(items, mats).reduce((sum, item) => sum + item.count, 0)).toBe(3)
    expect(cartonLayout(display, mats)[0].count).toBe(3)
    const edited = applyMergedShipmentEdits(items, mats, display, [{ row: 0, field: 'pallet', value: '1/2卡' }])
    expect(edited.items.every(item => item.pallet === '1/2卡')).toBe(true)
    expect(edited.items.map(item => item.qty)).toEqual([9000, 20000])
    expect(edited.items.map(item => item.po_no)).toEqual(['IRRIHS1', 'IRRIHS2'])
  })

  it('accepts partial batch quantities and leaves existing allocations untouched', () => {
    const other = { ...row, _rowKey: 2, outbound_id: 70, qty: 8000 }
    const result = link({ ...row, qty: 6000, kg: 2 }, [{ source: sources[0], qty: 1000 }, { source: sources[1], qty: 5000 }], [
      { ...row, qty: 6000, kg: 2 }, other,
    ])
    expect(result.map(item => item.qty)).toEqual([1000, 5000, 8000])
    expect(result.at(-1)).toBe(other)
    expect(() => link(row, allocations, [row, other])).toThrow('OUT-70')
  })

  it('brings in allocated total only when the original quantity is zero, derives missing kg, and preserves existing measured weight', () => {
    const result = link({ ...row, qty: 0, kg: 0 })
    expect(result.reduce((sum, item) => sum + item.qty!, 0)).toBe(29000)
    expect(result.reduce((sum, item) => sum + item.kg!, 0)).toBe(29)
    expect(link({ ...row, qty: 0, kg: 12 }).reduce((sum, item) => sum + item.kg!, 0)).toBe(12)
  })

  it('does not independently round batch weights up, even for a one-tick original total', () => {
    const result = link({ ...row, qty: 3, kg: .0001 }, sources.map(source => ({ source, qty: source.outbound_id === 70 ? 1 : 2 })))
    expect(result.map(item => item.kg)).toEqual([0, .0001])
    const { items, mats } = editorRows(result)
    expect(consolidateShipmentItems(items, mats)).toHaveLength(1)
  })

  it('accepts valid four-decimal quantities despite binary multiplication dust', () => {
    const result = link({ ...row, qty: 10000001.0005, kg: 1 }, [
      { source: { ...sources[0], allocatable_qty: 10000000.0005 }, qty: 10000000.0005 },
      { source: sources[1], qty: 1 },
    ])
    expect(result.map(item => item.qty)).toEqual([10000000.0005, 1])
    expect(result.reduce((sum, item) => sum + item.kg!, 0)).toBe(1)
  })

  it('assigns exact weight remainders without unsafe intermediate Number products', () => {
    const result = link({ ...row, qty: 151202899582.6808, kg: 54946953283.4895 }, [
      { source: { ...sources[0], allocatable_qty: 61344650495.3725 }, qty: 61344650495.3725 },
      { source: { ...sources[1], allocatable_qty: 89858249087.3083 }, qty: 89858249087.3083 },
    ])
    expect(result.map(item => item.kg)).toEqual([22292572789.704, 32654380493.7855])
    const { items, mats } = editorRows(result)
    expect(consolidateShipmentItems(items, mats)[0]).toMatchObject({ qty: 151202899582.6808, kg: 54946953283.4895 })
  })

  it('parses the serialized decimal rather than a rounded binary product near the integer boundary', () => {
    expect(shipmentDecimalTicks(700000000004.206)).toBe(7000000000042060)
    const selected = [
      { source: { ...sources[0], allocatable_qty: 700000000004.206 }, qty: 700000000004.206 },
      { source: sources[1], qty: 1 },
    ]
    const { items, mats } = editorRows(link({ ...row, qty: 700000000005.206, kg: 700000000004.206 }, selected))
    const display = consolidateShipmentItems(items, mats)[0]
    expect(JSON.parse(JSON.stringify(display))).toMatchObject({ qty: 700000000005.206, kg: 700000000004.206 })
  })

  it('rejects a split whose exact fourth-decimal tick cannot survive JSON Number serialization', () => {
    expect(() => link({ ...row, qty: 1000, kg: 800000000000.0502 }, [
      { source: sources[0], qty: 999 }, { source: sources[1], qty: 1 },
    ])).toThrow('分配重量超出有效精度')
  })

  it('preserves zero-priced and entirely free spare batches without inventing a charge', () => {
    const result = link(row, [
      { source: { ...sources[0], price: 0 }, qty: 9000 },
      { source: { ...sources[1], purchase_charge_ratio: 0 }, qty: 20000 },
    ])
    expect(result.map(item => [item.price, item.purchase_charge_ratio])).toEqual([[0, 1], [.3, 0]])
    const { items, mats } = editorRows(result)
    const display = consolidateShipmentItems(items, mats)
    expect(display).toHaveLength(1)
    expect(shipmentPurchaseAmount(display[0])).toBe(0)
    expect(display[0]).toMatchObject({ qty: 29000, kg: 10.208, cartons: 3 })
  })

  it.each([[], [allocations[0]], [allocations[0], allocations[0]],
    [{ source: sources[0], qty: 0 }, allocations[1]], [{ source: sources[0], qty: NaN }, allocations[1]],
    [{ source: sources[0], qty: .00001 }, allocations[1]],
    [{ source: { ...sources[0], material_id: 999 }, qty: 9000 }, allocations[1]],
    [{ source: { ...sources[0], purchase_unit: 'KGM' }, qty: 9000 }, allocations[1]],
    [{ source: { ...sources[0], price: undefined }, qty: 9000 }, allocations[1]],
  ].map(selected => ({ selected })))('rejects invalid/mismatched/incomplete selections atomically: $selected', ({ selected }) => {
    const before = structuredClone(row)
    expect(() => link(row, selected)).toThrow()
    expect(row).toEqual(before)
  })

  it('allows RRI/RRM source batches in one packing row without losing source prices or charge ratios', () => {
    const mixed = link(row, [{ source: { ...sources[0], po_no: 'IRRMHS1' }, qty: 9000 }, allocations[1]])
    expect(mixed.map(item => [item.po_no, item.qty, item.price, item.purchase_charge_ratio]))
      .toEqual([['IRRMHS1', 9000, .2, 1], ['IRRIHS2', 20000, .3, .9]])
    expect(mixed.reduce((sum, item) => sum + shipmentPurchaseAmount(item), 0)).toBe(7200)
    expect(mixed.reduce((sum, item) => sum + item.kg!, 0)).toBeCloseTo(row.kg, 8)
  })

  it.each(['supplier', 'customs_company', 'currency'])('keeps distinct document boundaries for %s', field => {
    expect(() => link(row, [allocations[0], { source: { ...sources[1], [field]: 'different' }, qty: 20000 }])).toThrow('分别关联')
  })

  it('keeps a pre-existing shared-carton identity and prevents crossing its scope', () => {
    expect(link({ ...row, carton_group: 'original-group' }).every(item => item.carton_group === 'original-group')).toBe(true)
    expect(() => link({ ...row, carton_group: 'original-group', supplier: 'other' })).toThrow('合并箱数')
  })

  it('preserves ordinary product-HS fallbacks when creating local snapshots for linked batches', () => {
    const input = { ...row, material_id: 926, material_snapshot: undefined }
    const result: LinkableShipmentRow[] = linkShipmentOutboundBatches([input], 1, allocations, material, new Map([[926, material]]), 'native-group')
    expect(result.every(item => item.material_snapshot?.shipment_hs_product_fallback === true)).toBe(true)
    expect(material.shipment_outbound_link_group).toBeUndefined()
  })

  it.each(['rri', 'rrm'])('exports one packing row with complete PO sources and the sum of charged amounts (%s)', async customer => {
    const { items, mats } = editorRows(link())
    const templateBuffer = Uint8Array.from(readFileSync(new URL(`../../public/template-customs-${customer}.xlsx`, import.meta.url))).buffer
    const blob = await buildCustomsWorkbook({ templateBuffer, items, materials: mats, productHs: new Map(), images: new Map(),
      form: { containerNo: 'MULTI-LINK', customer: customer.toUpperCase(), rate: 1 } })
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
    const sheet = workbook.Sheets['MULTI-LINK']
    expect(sheet.L4.v).toBe(29000)
    expect(sheet.K4.v).toBe(10.21)
    expect(sheet.AP4.v).toBeCloseTo(7200, 6)
    expect(sheet.AN4.v).toBe('IRRIHS1 / IRRIHS2')
    expect(sheet.AT4.v).toBe(3)
    expect(sheet.F5?.v).not.toBe(material.name_zh)
  }, 60000)
})
