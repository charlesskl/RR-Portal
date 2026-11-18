import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildCustomsWorkbook } from './customsExport'
import { planOutboundPull } from './shipmentOutboundRemaining'
import { CUSTOMS_FIXED, cartonLayout, sortShipmentItems } from './shipmentOrder'
import { consolidateShipmentItems } from './shipmentConsolidation'

const materials = new Map([
  [1, { id: 1, product_code: 'SYN-Z', name_zh: '合成物料Z', unit_kg: 'PCE' }],
  [2, { id: 2, product_code: 'SYN-A', name_zh: '合成物料A', unit_kg: 'PCE' }],
  [3, { id: 3, product_code: 'SYN-M', name_zh: '合成物料M', unit_kg: 'PCE' }],
])
const sources = [
  { outbound_id: 109, material_id: 1, allocatable_qty: 10, price: 2, supplier: 'Z', customs_company: 'Z' },
  { outbound_id: 101, material_id: 2, allocatable_qty: 20, price: 3, supplier: 'A', customs_company: CUSTOMS_FIXED },
  { outbound_id: 105, material_id: 3, allocatable_qty: 30, price: 4, supplier: 'B', customs_company: 'A' },
]
const pulled = () => planOutboundPull(sources, [], [105, 101, 109]).map(source => ({ ...source,
  qty: source.remaining_qty, kg: source.remaining_qty, cartons: 1, purchase_unit: '个', currency: 'US$',
}))

it('多次拉入保留既有行位置，合并物料保留首次来源位置，箱数只统计一次', () => {
  const rows = pulled()
  const later = { ...rows[0], outbound_id: 201, qty: 5, kg: 5 }
  const ordered = sortShipmentItems([...rows, later], materials)
  const before = structuredClone(ordered)
  expect(ordered.map(row => row.outbound_id)).toEqual([109, 101, 105, 201])
  const consolidated = consolidateShipmentItems(ordered, materials)
  expect(consolidated.map(row => row.material_id)).toEqual([1, 2, 3])
  expect(consolidated[0].outbound_ids).toEqual([109, 201])
  expect(consolidated[0].qty).toBe(15)
  const shared = ordered.map((row, i) => ({ ...row, supplier: 'S', customs_company: 'S', carton_group: i === 1 ? undefined : 'G' }))
  expect(sortShipmentItems(shared, materials)).toEqual(shared)
  expect(cartonLayout(shared, materials).reduce((sum, row) => sum + row.count, 0)).toBe(2)
  expect(ordered).toEqual(before)
})

it.each(['rri', 'rrm', 'legacy'].flatMap(variant => [true, false].map(mainOnly => ({ variant, mainOnly }))))('出库按列表顺序拉入，JSON保存重开与导出顺序一致（$variant，mainOnly=$mainOnly）', async ({ variant, mainOnly }) => {
  const items = pulled().map((row, index) => ({ ...row, seq: index + 1 }))
  const saved = JSON.parse(JSON.stringify(items))
  expect(sortShipmentItems(saved, materials).map(row => row.outbound_id)).toEqual([109, 101, 105])
  const template = variant === 'legacy' ? 'template-customs.xlsx' : `template-customs-${variant}.xlsx`
  const blob = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/' + template, import.meta.url))).buffer,
    items: saved, materials, productHs: new Map(), images: new Map(), mainOnly,
    form: { customer: variant === 'rri' ? 'RRI' : 'RRM', containerNo: 'OUTBOUND-ORDER', rate: 1 },
  })
  const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['OUTBOUND-ORDER']
  expect([sheet.D4.v, sheet.D5.v, sheet.D6.v]).toEqual(['SYN-Z', 'SYN-A', 'SYN-M'])
  expect([sheet.A4.v, sheet.A5.v, sheet.A6.v]).toEqual([1, 2, 3])
  expect([sheet.L4.v, sheet.L5.v, sheet.L6.v]).toEqual([10, 20, 30])
  expect([sheet.AP4.v, sheet.AP5.v, sheet.AP6.v]).toEqual([20, 60, 120])
  expect(items).toEqual(saved)
}, 60000)
