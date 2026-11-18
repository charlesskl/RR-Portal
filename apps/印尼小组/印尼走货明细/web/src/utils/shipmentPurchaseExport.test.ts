import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildCustomsWorkbook } from './customsExport'
import { parseShipmentWorkbook } from './shipmentImport'
import { shipmentPurchaseAmount, shipmentPurchaseLineAmount, shipmentPurchaseTotal } from './shipmentPurchase'
import { roundPurchaseContractAmount, setPurchaseContractLineAmounts } from './purchaseContractWorkbook'
import { withShipmentInvoicePrices } from './shipmentInvoice'
import { consolidateShipmentItems } from './shipmentConsolidation'

it.each(['RRI', 'RRM'])('免费备品：数量不减、申报公斤取2位、采购/发票金额及再导入金额不含备品（%s）', async customer => {
  const materials = new Map([
    [979, { id: 979, name_zh: '阿奇密封盒', product_code: '97282/1099235/6077462', unit_kg: 'KGM' }],
    [983, { id: 983, name_zh: '阿奇CDU', product_code: '94704/1101147/6079033', unit_kg: 'KGM' }],
  ])
  const common = { currency: 'US$', supplier: '测试供应商', customs_company: '测试报关公司', purchase_unit: '个' }
  const rows = [
    { ...common, material_id: 979, outbound_id: 99, qty: 3667, kg: 502.379, price: .227, purchase_charge_ratio: 3630 / 3667, po_no: 'IRRIHS0403' },
    { ...common, material_id: 983, outbound_id: 100, qty: 9000, kg: 738, price: .3032, purchase_charge_ratio: 15100 / 15251, po_no: 'IRRIHS0451' },
    { ...common, material_id: 983, outbound_id: 101, qty: 6251, kg: 512.582, price: .3032, purchase_charge_ratio: 15100 / 15251, po_no: 'IRRIHS0451' },
  ]
  const before = structuredClone(rows)
  const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-' + customer.toLowerCase() + '.xlsx', import.meta.url))).buffer
  const blob = await buildCustomsWorkbook({ templateBuffer, items: rows, materials, productHs: new Map(), images: new Map(),
    form: { containerNo: 'FREE-SPARES', customer, rate: 1 } })
  const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellNF: true })
  const sheet = workbook.Sheets['FREE-SPARES']
  const expected = [824.01, 4578.32]
  expected.forEach((amount, i) => {
    const r = i + 4
    expect(sheet['AP' + r].v).toBeCloseTo(amount, 9)
    expect(sheet['AP' + r].f).toBe('ROUND(AO' + r + '*K' + r + ',2)')
    expect(sheet['AA' + r].v).toBeCloseTo(amount, 9)
    expect(sheet['O' + r].v).toBeCloseTo(amount, 9)
    expect(sheet['AO' + r].v * sheet['K' + r].v).toBeCloseTo(amount, 9)
  })
  expect(sheet.L4.v).toBe(3667)
  expect(sheet.K4.v).toBe(502.38)
  expect(sheet.K4.z?.replaceAll('_ ', '')).toBe('0.00')
  expect(sheet.L5.v).toBe(15251)
  expect(sheet.K5.v).toBe(1250.58)
  expect(sheet.K5.z?.replaceAll('_ ', '')).toBe('0.00')
  const imported = parseShipmentWorkbook(workbook).rows.filter(row => row.sheet === 'FREE-SPARES')
  expect(imported).toHaveLength(2)
  imported.forEach((row, i) => expect(shipmentPurchaseAmount(row.item)).toBeCloseTo(expected[i], 9))
  expect(rows).toEqual(before)
}, 60000)

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
    expect(sheet['AP' + row].v).toBe(shipmentPurchaseLineAmount(displayed[i]))
    expect(sheet['AA' + row].v).toBeCloseTo(amount, 9)
    expect(sheet['O' + row].v).toBeCloseTo(amount / 7.2, 9)
    expect(sheet['AP' + row].f).toBe('ROUND(AO' + row + '*K' + row + ',2)')
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

it.each(['rri', 'rrm', 'legacy'])('主明细：同供应商重复出现时相邻总额仍合并，毛净重显示两位小数（%s）', async variant => {
  const items = ['A', 'A', 'B', 'A', 'A', 'C'].map((supplier, index) => ({
    material_id: -index - 1, qty: 1, kg: .3, price: index + 1, currency: 'US$', supplier, purchase_unit: '个',
    customs_company: '合成报关公司', weighing_qty: 1, contract_no: 'SYN-C', invoice_no: 'SYN-I',
    material_snapshot: { product_code: `SYN-${index}`, name_zh: `合成物料${index}`, unit_kg: 'KGM',
      import_source: { sheet: '源明细', row: index + 2, cells: [], context: [] }, weight_per_carton: index === 0 ? 3 : .4, net_per_pc: .3 },
  }))
  const before = structuredClone(items)
  const template = variant === 'legacy' ? 'template-customs.xlsx' : `template-customs-${variant}.xlsx`
  const blob = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/' + template, import.meta.url))).buffer,
    items, materials: new Map(items.map(item => [item.material_id, item.material_snapshot])), productHs: new Map(), images: new Map(),
    form: { customer: variant === 'rri' ? 'RRI' : 'RRM', containerNo: 'SUPPLIER-RUNS', rate: 1 },
  })
  const book = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellNF: true }), sheet = book.Sheets['SUPPLIER-RUNS']
  expect(items).toEqual(before)
  expect(items.map((_, index) => sheet[`D${index + 4}`].v)).toEqual(items.map(item => item.material_snapshot.product_code))
  const merges = (sheet['!merges'] || []).filter(range => range.s.c === 42)
  expect(merges).toEqual([
    { s: { r: 3, c: 42 }, e: { r: 4, c: 42 } },
    { s: { r: 6, c: 42 }, e: { r: 7, c: 42 } },
  ])
  expect(sheet.AQ4.f).toBe('SUM(AP4:AP5,AP7:AP8)')
  for (const row of [5, 7, 8]) {
    expect(sheet[`AQ${row}`]?.f).toBeUndefined()
    expect(sheet[`AQ${row}`]?.v || '').toBe('')
  }
  items.forEach((item, index) => expect(Number(sheet[`AP${index + 4}`].v)).toBeCloseTo(shipmentPurchaseAmount(item), 9))
  expect(sheet.AQ6.f).toBe('SUM(AP6)')
  expect(sheet.AQ9.f).toBe('SUM(AP9)')
  expect(sheet.P4.v).toBe(3)
  expect(sheet.P5.v).toBe(.4)
  expect(sheet.P4.f).toBe('ROUND(BA4*L4,2)')
  for (const row of [4, 5, 6, 7, 8, 9, 11]) {
    for (const column of ['P', 'Q']) expect(sheet[`${column}${row}`].z?.replaceAll('_ ', '')).toBe('0.00')
  }
  expect(XLSX.utils.format_cell(sheet.P4)).toBe('3.00')
  expect(XLSX.utils.format_cell(sheet.P5)).toBe('0.40')
}, 60000)

it.each(['rri', 'rrm', 'legacy'].flatMap(variant => [true, false].map(mainOnly => ({ variant, mainOnly }))))('采购金额与采购单逐行一致，519.248 应为 519.24（$variant，mainOnly=$mainOnly）', async ({ variant, mainOnly }) => {
  const quantities = [13000, 2800, 2800, 11000, 5500]
  const prices = [.00146, .00118, .05413, .02588, .01104]
  const weights = [5.20, .70, 19.15, 136.73, 22]
  const amounts = [18.98, 3.30, 151.56, 284.68, 60.72]
  const materials = new Map(quantities.map((_, i) => [i + 1, {
    id: i + 1, product_code: 'SYN-' + i, name_zh: '合成物料' + i, unit_kg: 'KGM',
  }]))
  const items = quantities.map((qty, i) => ({ material_id: i + 1, outbound_id: i + 1, qty, kg: weights[i], price: prices[i],
    currency: 'US$', supplier: '合成供应商', customs_company: '合成报关公司', po_no: 'SYN-PO', purchase_unit: '个' }))
  const before = structuredClone(items)
  const template = variant === 'legacy' ? 'template-customs.xlsx' : `template-customs-${variant}.xlsx`
  const output = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/' + template, import.meta.url))).buffer,
    mainOnly, items, materials, productHs: new Map(), images: new Map(),
    form: { customer: variant === 'rri' ? 'RRI' : 'RRM', containerNo: 'PURCHASE-CENTS', rate: 1 },
  })
  const book = XLSX.read(await output.arrayBuffer(), { type: 'array', cellNF: true })
  const sheet = book.Sheets['PURCHASE-CENTS']
  const poSheet: XLSX.WorkSheet = {}
  for (const [i, amount] of amounts.entries()) {
    const r = i + 4
    setPurchaseContractLineAmounts(poSheet, r, weights[i], quantities[i] * prices[i], 2, 'KGM')
    expect(sheet[`AP${r}`].v).toBe(poSheet[`G${r}`].v)
    expect(sheet[`AP${r}`].v).toBe(amount)
    expect(sheet[`AP${r}`].f).toBe(`ROUND(AO${r}*K${r},2)`)
    expect(roundPurchaseContractAmount(sheet[`AO${r}`].v * sheet[`K${r}`].v)).toBe(amount)
    expect(XLSX.utils.format_cell(sheet[`AP${r}`])).toBe('US$' + amount.toFixed(2))
    expect(sheet[`AO${r}`].v).toBeCloseTo(quantities[i] * prices[i] / weights[i], 12)
  }
  expect(sheet.AQ4.v).toBe(519.24)
  expect(sheet.AQ4.f).toBe('SUM(AP4:AP8)')
  expect(XLSX.utils.format_cell(sheet.AQ4)).toBe('US$519.24')
  const imported = parseShipmentWorkbook(book).rows.filter(row => row.sheet === 'PURCHASE-CENTS').map(row => row.item)
  expect(imported).toHaveLength(5)
  expect(shipmentPurchaseTotal(imported)).toBe(519.24)
  expect(items).toEqual(before)
}, 60000)

it.each(['rri', 'rrm', 'legacy'])('币种符号保留，采购金额与合计两位小数，微小单价保留有效精度（%s）', async variant => {
  const currencies = ['US$', '¥', 'HK$', 'IDR', '€', '£', '¥(JPY)']
  const items = currencies.map((currency, i) => ({ material_id: i + 1, qty: 10000, kg: 10000, price: .000529,
    currency, supplier: '合成供应商-' + i, customs_company: '合成报关公司', purchase_unit: '个' }))
  const materials = new Map(items.map(item => [item.material_id, { id: item.material_id, product_code: 'SYN-' + item.material_id,
    name_zh: '合成物料' + item.material_id, unit_kg: 'PCE' }]))
  const template = variant === 'legacy' ? 'template-customs.xlsx' : `template-customs-${variant}.xlsx`
  const output = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/' + template, import.meta.url))).buffer,
    items, materials, productHs: new Map(), images: new Map(),
    form: { customer: variant === 'rri' ? 'RRI' : 'RRM', containerNo: 'CURRENCY-CENTS', rate: 1 },
  })
  const sheet = XLSX.read(await output.arrayBuffer(), { type: 'array', cellNF: true }).Sheets['CURRENCY-CENTS']
  for (const [i, currency] of currencies.entries()) {
    const r = i + 4, label = currency === '¥(JPY)' ? '¥' : currency
    expect(sheet[`AO${r}`].v).toBe(.000529)
    expect(sheet[`AO${r}`].z).toContain('0.0000########')
    for (const col of ['AP', 'AQ']) {
      expect(sheet[`${col}${r}`].v).toBe(5.29)
      expect(XLSX.utils.format_cell(sheet[`${col}${r}`])).toBe(label + '5.29')
    }
  }
}, 60000)
