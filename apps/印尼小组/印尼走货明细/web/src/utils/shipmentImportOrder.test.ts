import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import * as XLSX from 'xlsx'
import type { Material } from '../api/client'
import { parseShipmentWorkbook, planShipmentImport } from './shipmentImport'
import { applyShipmentImport } from './shipmentImportApply'
import { CUSTOMS_FIXED, cartonLayout, sortShipmentItems } from './shipmentOrder'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { buildCustomsWorkbook } from './customsExport'
import { withShipmentInvoicePrices } from './shipmentInvoice'

function file(names: string[]) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['货号', '产品中文名称', '规格', '供应商', '报关出口公司', '申报单位', '送货数量', '申报数量', '采购单价', '币种'],
    ...names.map((name, index) => [name, name, 'TEST', index % 2 ? 'A' : 'Z',
      index % 2 ? CUSTOMS_FIXED : '其他公司', 'PCE', 10, 10, 2, 'USD']),
  ]), '源明细')
  return parseShipmentWorkbook(book).rows.map(row => row.item)
}
function importRows(names: string[]) {
  return file(names).map((row, index) => ({ ...row, material_id: -index - 1, _rowKey: index + 1 }))
}

it('new file and later batches retain source order across different companies and suppliers', () => {
  const first = file(['Z-first', 'A-second', 'M-third'])
  const before = structuredClone(first)
  const rows = applyShipmentImport([], new Map(), first, [-1, -1, -1])
  const next = applyShipmentImport(rows, new Map(), file(['B-fourth', 'C-fifth']), [-1, -1])
  expect(sortShipmentItems(next, new Map()).map(row => row.material_snapshot?.name_zh))
    .toEqual(['Z-first', 'A-second', 'M-third', 'B-fourth', 'C-fifth'])
  expect(first).toEqual(before)
  const ordinary = { supplier: 'Z', customs_company: 'Other' }
  expect(sortShipmentItems([{ ...ordinary, sources: [rows[0]] }, { supplier: 'A', customs_company: CUSTOMS_FIXED }], new Map())[0])
    .toMatchObject(ordinary)
  // The server persists the submitted array as seq and returns it in seq order.
  const saved = next.map((row, index) => ({ ...row, seq: index + 1 }))
  expect(sortShipmentItems(JSON.parse(JSON.stringify(saved)), new Map())).toEqual(saved)
})

it('reimport interleaves updates and additions in file order without deleting unrelated rows', () => {
  const existing = importRows(['before', 'B', 'unselected', 'A', 'after'])
  const incoming = file(['A', 'new', 'B']).map(row => ({ ...row, supplier: undefined, customs_company: undefined,
    material_snapshot: { ...row.material_snapshot, supplier: undefined } }))
  // Use the same identities as the selected original rows.
  const materialMap = new Map(existing.map(row => [row.material_id, { ...row.material_snapshot, supplier: undefined }]))
  const matching = existing.map(row => ({ ...row, supplier: undefined, material_snapshot: materialMap.get(row.material_id) }))
  const targets = planShipmentImport(incoming, matching)
  expect(targets).toEqual([3, -1, 1])
  const before = structuredClone(matching)
  const updated = applyShipmentImport(matching, materialMap, incoming, targets)
  expect(updated.map(row => row.material_snapshot?.name_zh)).toEqual(['before', 'A', 'new', 'B', 'unselected', 'after'])
  expect(updated.map(row => row._rowKey)).toEqual([1, 4, undefined, 2, 3, 5])
  expect(matching).toEqual(before)
})

it('consolidation stays at first source position and nonconsecutive shared cartons never merge across other goods', () => {
  const rows = importRows(['first', 'middle', 'first', 'last']).map((row, index) => ({ ...row,
    outbound_id: index + 1, qty: 10, kg: 10, price: 2, supplier: 'same', customs_company: 'same',
    material_snapshot: { ...row.material_snapshot, id: index === 2 ? 1 : index + 1, supplier: 'same', customs_company: 'same' },
  }))
  const materials = new Map<number, Material>(rows.map(row => [row.material_id, row.material_snapshot]))
  const consolidated = consolidateShipmentItems(rows, materials)
  expect(consolidated.map(row => row.material_snapshot.name_zh)).toEqual(['first', 'middle', 'last'])
  expect(consolidated[0].qty).toBe(20)
  expect(consolidated[0].sources.map(row => row.outbound_id)).toEqual([1, 3])
  const shared = rows.map((row, index) => ({ ...row, cartons: index === 1 ? 3 : 2,
    carton_group: index === 1 ? undefined : 'shared' }))
  const ordered = sortShipmentItems(shared, materials)
  expect(ordered).toEqual(shared)
  const layout = cartonLayout(ordered, materials)
  expect(layout).toEqual([{ span: 1, count: 2 }, { span: 1, count: 3 }, { span: 2, count: 0 }, { span: 0, count: 0 }])
  expect(layout.reduce((sum, row) => sum + row.count, 0)).toBe(5)
})

it.each(['rri', 'rrm'])('exported main table preserves imported order and correct shared-carton cells (%s)', async customer => {
  vi.stubGlobal('DOMParser', DOMParser)
  try {
    const items = importRows(['Z-first', 'A-second', 'M-third', 'B-fourth'])
      .map((row, index) => ({ ...row, supplier: 'same', customs_company: 'Other', cartons: index === 1 ? 3 : 2,
        carton_group: index === 1 ? undefined : 'shared' }))
    const materials = new Map(items.map(row => [row.material_id, row.material_snapshot]))
    const blob = await buildCustomsWorkbook({
      templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/template-customs-' + customer + '.xlsx', import.meta.url))).buffer,
      items, materials, productHs: new Map(), images: new Map(),
      form: { customer: customer.toUpperCase(), containerNo: 'SOURCE-ORDER', rate: .93 }, mainOnly: true,
    })
    const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['SOURCE-ORDER']
    expect([4, 5, 6, 7].map(row => sheet['F' + row]?.v)).toEqual(['Z-first', 'A-second', 'M-third', 'B-fourth'])
    expect([4, 5, 6, 7].map(row => sheet['AT' + row]?.v || 0)).toEqual([2, 3, 0, 0])
    expect(sheet['!merges']).toContainEqual({ s: { r: 5, c: 45 }, e: { r: 6, c: 45 } })
    expect(sheet['!merges']).not.toContainEqual({ s: { r: 3, c: 45 }, e: { r: 5, c: 45 } })
  } finally { vi.unstubAllGlobals() }
}, 60000)

it.each(['rri', 'rrm'])('first-position imported consolidation retains source contract surcharge in editor and export (%s)', async customer => {
  const items = importRows(['first', 'middle', 'first']).map((row, index) => ({ ...row,
    outbound_id: index + 1, qty: 10, kg: 10, price: 2, supplier: 'same', customs_company: CUSTOMS_FIXED,
    contract_no: index === 1 ? 'B' : 'A', invoice_no: index === 1 ? 'B' : 'A', currency: 'USD',
    material_snapshot: { ...row.material_snapshot, id: index === 1 ? 2 : 1, supplier: 'same', customs_company: CUSTOMS_FIXED },
  }))
  const materials = new Map<number, Material>(items.map(row => [row.material_id, row.material_snapshot]))
  const original = withShipmentInvoicePrices(items, materials)
  const consolidated = withShipmentInvoicePrices(consolidateShipmentItems(items, materials), materials)
  expect(consolidated.map(row => row.contract_no)).toEqual(['A', 'B'])
  for (const contract of ['A', 'B']) {
    const amount = (rows: typeof original) => rows.filter(row => row.contract_no === contract)
      .reduce((sum, row) => sum + row.kg * row.invoice_price, 0)
    expect(amount(consolidated)).toBeCloseTo(amount(original), 9)
  }
  const blob = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/template-customs-' + customer + '.xlsx', import.meta.url))).buffer,
    items, materials, productHs: new Map(), images: new Map(),
    form: { customer: customer.toUpperCase(), containerNo: 'IMPORT-SURCHARGE', rate: .93 },
  })
  const book = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
  const sheet = book.Sheets['IMPORT-SURCHARGE']
  expect([sheet.F4.v, sheet.F5.v]).toEqual(['first', 'middle'])
  expect(sheet.Z4.f).toContain('1248')
  expect(sheet.Z5.f).not.toContain('1248')
  expect(sheet.AA4.v).toBeCloseTo(consolidated[0].kg * consolidated[0].invoice_price, 9)
  expect(sheet.AA5.v).toBeCloseTo(consolidated[1].kg * consolidated[1].invoice_price, 9)
}, 60000)
