import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildCustomsWorkbook } from './customsExport'
import { parseShipmentWorkbook } from './shipmentImport'
import { shipmentPurchaseAmount } from './shipmentPurchase'
import { withShipmentInvoicePrices } from './shipmentInvoice'
import { consolidateShipmentItems } from './shipmentConsolidation'

it.each(['RRI', 'RRM'])('真实模板按采购数量计价，千克单价换算及再导入金额不变（%s）', async customer => {
  const materials = new Map([
    [1, { id: 1, name_zh: 'PB螺丝2.6*6', product_code: '46720J', unit_kg: 'KGM', net_per_pc: .00029 }],
    [2, { id: 2, name_zh: '纸绳', product_code: 'R1', unit_kg: 'KGM', net_per_pc: 3 }],
    [3, { id: 3, name_zh: '工具', product_code: 'T1', unit_kg: 'PCE', net_per_pc: 1 }],
    [4, { id: 4, name_zh: '贴纸', product_code: 'P1', unit_kg: 'TNE', net_per_pc: .1 }],
    [-5, { id: 5, name_zh: '导入裁片', product_code: 'I1', unit_kg: 'KGM', net_per_pc: .0009925 }],
  ])
  const common = { currency: 'US$', supplier: '测试供应商', customs_company: '测试报关公司', qty_per_carton: '100', cartons: 1 }
  const rows = [
    { ...common, material_id: 1, outbound_id: 74, qty: 200000, kg: 58, price: .0005, purchase_unit: '个', carton_no: '1', po_no: 'PO-1', po_date: '2026-10-01' },
    { ...common, material_id: 1, outbound_id: 75, qty: 100000, kg: 29, price: .00068, purchase_unit: '个', carton_no: '2', po_no: 'PO-2', po_date: '2026-10-02' },
    { ...common, material_id: 2, qty: 1000, kg: 3, price: .03, purchase_unit: '米' },
    { ...common, material_id: 3, qty: 2, kg: 2, price: 35.34, purchase_unit: '个' },
    { ...common, material_id: 4, qty: 500, kg: .05, price: .04, purchase_unit: '个' },
    { ...common, material_id: -5, qty: 4000, kg: 3.97, price: 12.0453, purchase_unit: 'pcs', material_snapshot: materials.get(-5) },
  ]
  const before = structuredClone(rows)
  const displayed = withShipmentInvoicePrices(consolidateShipmentItems(rows, materials), materials)
  expect(displayed).toHaveLength(5)
  const expected = [168, 30, 70.68, 20, 47.819841]
  const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-' + customer.toLowerCase() + '.xlsx', import.meta.url))).buffer
  const blob = await buildCustomsWorkbook({ templateBuffer, items: rows, materials, productHs: new Map(), images: new Map(),
    form: { containerNo: 'PRICE-BASIS', customer, rate: 7.2 } })
  const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellNF: true })
  const sheet = workbook.Sheets['PRICE-BASIS']
  expected.forEach((amount, i) => {
    const row = i + 4
    expect(shipmentPurchaseAmount(displayed[i])).toBeCloseTo(amount, 9)
    expect(displayed[i].invoice_price * displayed[i].kg).toBeCloseTo(amount, 9)
    expect(sheet['AO' + row].v).toBeCloseTo(amount / displayed[i].kg, 9)
    expect(sheet['AP' + row].v).toBeCloseTo(amount, 9)
    expect(sheet['AA' + row].v).toBeCloseTo(amount, 9)
    expect(sheet['O' + row].v).toBeCloseTo(amount / 7.2, 9)
    expect(sheet['AP' + row].f).toBe('AO' + row + '*K' + row)
  })
  expect(sheet.L4.v).toBe(300000)
  expect(sheet.K4.v).toBe(87)
  expect(sheet.AM4.v).toBe('2026-10-01 / 2026-10-02')
  expect(sheet.AN4.v).toBe('PO-1 / PO-2')
  expect(sheet.AO4.v).not.toBe(.00056)
  const reimported = parseShipmentWorkbook(workbook).rows.filter(row => row.sheet === 'PRICE-BASIS')
  expect(reimported).toHaveLength(5)
  reimported.forEach((row, i) => expect(shipmentPurchaseAmount(row.item)).toBeCloseTo(expected[i], 9))
  expect(rows).toEqual(before)
}, 60000)
