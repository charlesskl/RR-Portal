import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildCustomsWorkbook } from './customsExport'
import { planOutboundPull } from './shipmentOutboundRemaining'
import { CUSTOMS_FIXED, cartonLayout, sortShipmentItems } from './shipmentOrder'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { orderOutboundByShipmentImport } from './shipmentOutboundOrder'

const importSource = (row: number, sheet = '源明细', file = 'synthetic.xlsx') => ({ file, sheet, row, cells: [], context: [] })

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

it('按 Excel 原行号排序，即使旧保存顺序、出库编号和接口返回顺序都不一致', () => {
  const items = [
    { material_id: -1, material_snapshot: { id: 1, import_source: importSource(17) } },
    { material_id: -2, material_snapshot: { id: 2, import_source: importSource(36) } },
    { material_id: -3, material_snapshot: { id: 3, import_source: importSource(8) } },
  ]
  const before = structuredClone({ sources, items })
  expect(orderOutboundByShipmentImport(sources, items, new Map()).map(row => row.outbound_id)).toEqual([105, 109, 101])
  expect({ sources, items }).toEqual(before)
})

it('未确认物料 ID 的导入行使用货号、名称、规格、供应商及 PO；同料不同 PO 不串序，未匹配保持原序排后', () => {
  const source = { outbound_id: 20, code: 'A', name_zh: '合成螺丝', spec: 'M2', supplier: 'S', po_no: 'P1' }
  const candidates = [source, { ...source, outbound_id: 21, po_no: 'P2' },
    { ...source, outbound_id: 22, spec: 'M3' }, { ...source, outbound_id: 23, supplier: 'Other' },
    { ...source, outbound_id: 24, name_zh: '别的物料' }, { ...source, outbound_id: 25, code: 'B' }]
  const snapshot = { product_code: ' a ', name_zh: '合成螺丝', spec: 'm2', supplier: 's' }
  const items = ['P2', 'P1'].map((po_no, i) => ({ po_no, material_snapshot: { ...snapshot, import_source: importSource(i + 8) } }))
  expect(orderOutboundByShipmentImport(candidates, items, new Map()).map(row => row.outbound_id))
    .toEqual([21, 20, 22, 23, 24, 25])
})

it('同一导入行的多个出库批次沿用批次原序；缺少导入表时沿用接口原序', () => {
  const candidates = [...sources, { ...sources[0], outbound_id: 201 }]
  const items = [{ material_id: -1, material_snapshot: { id: 1, import_source: importSource(8) } }]
  expect(orderOutboundByShipmentImport(candidates, items, new Map()).map(row => row.outbound_id)).toEqual([109, 201, 101, 105])
  expect(orderOutboundByShipmentImport(candidates, [], materials)).toEqual(candidates)
})

it('已明确关联的出库按其 Excel 行序排列，不被其他相同物料导入行抢先匹配', () => {
  const candidates = [...sources, { ...sources[0], outbound_id: 201 }]
  const items = [
    { material_snapshot: { id: 1, import_source: importSource(8) } },
    { outbound_id: 105, material_snapshot: { id: 3, import_source: importSource(17) } },
    { outbound_id: 109, material_snapshot: { id: 1, import_source: importSource(36) } },
  ]
  expect(orderOutboundByShipmentImport(candidates, items, new Map()).map(row => row.outbound_id)).toEqual([201, 105, 109, 101])
})

it('文件和工作表保持导入组顺序，原行号只在各自工作表内比较', () => {
  const items = [
    { material_snapshot: { id: 1, import_source: importSource(100, 'SheetA') } },
    { material_snapshot: { id: 2, import_source: importSource(2, 'SheetB') } },
    { material_snapshot: { id: 3, import_source: importSource(1, 'SheetA', 'later.xlsx') } },
  ]
  expect(orderOutboundByShipmentImport([...sources].reverse(), items, new Map()).map(row => row.outbound_id)).toEqual([109, 101, 105])
})

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

it.each(['rri', 'rrm', 'legacy'].flatMap(variant => [true, false].map(mainOnly => ({ variant, mainOnly }))))('出库按 Excel 原行序拉入，JSON保存重开与导出顺序一致（$variant，mainOnly=$mainOnly）', async ({ variant, mainOnly }) => {
  const imported = [3, 1, 2].map((id, i) => ({ material_snapshot: { id, import_source: importSource(i + 8) } }))
  const ordered = orderOutboundByShipmentImport(sources, imported, new Map())
  const items = planOutboundPull(ordered, [], [101, 109, 105]).map((row, index) => ({ ...row,
    seq: index + 1, qty: row.remaining_qty, kg: row.remaining_qty, cartons: 1, purchase_unit: '个', currency: 'US$',
  }))
  const saved = JSON.parse(JSON.stringify(items))
  expect(sortShipmentItems(saved, materials).map(row => row.outbound_id)).toEqual([105, 109, 101])
  const template = variant === 'legacy' ? 'template-customs.xlsx' : `template-customs-${variant}.xlsx`
  const blob = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/' + template, import.meta.url))).buffer,
    items: saved, materials, productHs: new Map(), images: new Map(), mainOnly,
    form: { customer: variant === 'rri' ? 'RRI' : 'RRM', containerNo: 'OUTBOUND-ORDER', rate: 1 },
  })
  const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['OUTBOUND-ORDER']
  expect([sheet.D4.v, sheet.D5.v, sheet.D6.v]).toEqual(['SYN-M', 'SYN-Z', 'SYN-A'])
  expect([sheet.A4.v, sheet.A5.v, sheet.A6.v]).toEqual([1, 2, 3])
  expect([sheet.L4.v, sheet.L5.v, sheet.L6.v]).toEqual([30, 10, 20])
  expect([sheet.AP4.v, sheet.AP5.v, sheet.AP6.v]).toEqual([120, 20, 60])
  expect(items).toEqual(saved)
}, 60000)
