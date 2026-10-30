import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { cartonLayout, sortShipmentItems } from './shipmentOrder'
import { withShipmentInvoicePrices } from './shipmentInvoice'
import { shipmentPurchaseAmount } from './shipmentPurchase'
import { buildCustomsWorkbook } from './customsExport'

const materials = new Map([[974, {
  id: 974, name_zh: '彩盒-FSC', name_en: 'Gift Box-FSC', product_code: 'E73860C',
  spec: '245*115*180MM', unit_kg: 'KGM', supplier: '测试供应商', customs_company: '测试报关公司',
  net_per_pc: 0.0906, weight_per_carton: 10, length: 24.5, width: 11.5, height: 18,
}]])
const batches = [
  { outbound_id: 74, material_id: 974, qty: 8150, kg: 738.39, cartons: 82, carton_no: '1-82', qty_per_carton: '100', price: 2, currency: 'US$', po_no: 'IRRIHS0401' },
  { outbound_id: 75, material_id: 974, qty: 82, kg: 7.4292, cartons: 1, carton_no: '83', qty_per_carton: '100', price: 2, currency: 'US$', po_no: 'IRRIHS0401' },
]

it('同柜分批出库只显示一行，数量、重量和实际箱数累加，原始分配不变', () => {
  const before = structuredClone(batches)
  const result = consolidateShipmentItems(batches, materials)
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ qty: 8232, kg: 745.8192, cartons: 83, carton_no: '1-82 / 83', outbound_ids: [74, 75] })
  expect(result[0].sources).toEqual(before)
  expect(batches).toEqual(before)
  expect(shipmentPurchaseAmount(result[0])).toBeCloseTo(batches.reduce((sum, row) => sum + shipmentPurchaseAmount(row), 0), 10)
  // Separate containers are separate calls; their original allocations are not changed.
  expect(consolidateShipmentItems([batches[0]], materials)[0].qty).toBe(8150)
  expect(consolidateShipmentItems([batches[1]], materials)[0].qty).toBe(82)
})

it.each([
  { material_id: 975 }, { supplier: '另一供应商' }, { customs_company: '另一报关公司' },
  { currency: '¥' }, { purchase_unit: '米' }, { contract_no: '另一合同' },
  { invoice_no: '另一发票' }, { bl_head: '另一抬头' }, { weighing_qty: 5 },
  { qty_per_carton: '200' }, { pallet: '1-2/1卡' },
  { material_snapshot: { id: 974 } }, { outbound_id: undefined }, { material_id: undefined },
])('不合并资料不同或不能确认来源的明细 %j', override => {
  expect(consolidateShipmentItems([batches[0], { ...batches[1], ...override }], materials)).toHaveLength(2)
})

it.each([
  [' A01-A82 ', 'B03', 'A01-A82 / B03'],
  ['1-82', ' 1-82 ', '1-82'],
  ['', '83', '83'],
  ['1-82', '', '1-82'],
])('箱号只是批次标签，保留完整值且不影响实际箱数：%s、%s', (first, last, label) => {
  const rows = [{ ...batches[0], carton_no: first }, { ...batches[1], carton_no: last }]
  const before = structuredClone(rows)
  const result = consolidateShipmentItems(rows, materials)
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ carton_no: label, cartons: 83, qty: 8232, kg: 745.8192 })
  expect(result[0].sources).toEqual(before)
  expect(rows).toEqual(before)
})

it('不同采购单、日期和单价合并，保留全部来源并按各批金额加权', () => {
  const rows = [{ ...batches[0], po_date: '2026-10-01' },
    { ...batches[1], po_no: 'IRRIHS0402', po_date: '2026-10-02', price: 3 }]
  const before = structuredClone(rows)
  const result = consolidateShipmentItems(rows, materials)
  expect(result).toHaveLength(1)
  expect(result[0].po_no).toBe('IRRIHS0401 / IRRIHS0402')
  expect(result[0].outbound_ids).toEqual([74, 75])
  expect(result[0].po_date).toBeUndefined()
  expect(result[0].price).toBeCloseTo((8150 * 2 + 82 * 3) / 8232, 12)
  expect(shipmentPurchaseAmount(result[0])).toBeCloseTo(8150 * 2 + 82 * 3, 9)
  expect(result[0].sources).toEqual(before)
  expect(rows).toEqual(before)
})

it('不同采购单的备品比例及价格分别计费，合并不重复扣费，纯备品可合并为零金额', () => {
  const rows = [
    { ...batches[0], qty: 110, kg: 11, price: 2, purchase_charge_ratio: 100 / 110 },
    { ...batches[1], qty: 60, kg: 6, price: 3, purchase_charge_ratio: 50 / 60, po_no: 'IRRIHS0402' },
    { ...batches[1], outbound_id: 76, qty: 10, kg: 1, price: 99, purchase_charge_ratio: 0 },
  ]
  const before = structuredClone(rows)
  const result = consolidateShipmentItems(rows, materials)
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ qty: 180, kg: 18 })
  expect(shipmentPurchaseAmount(result[0])).toBeCloseTo(350, 10)
  expect(result[0].price).toBeCloseTo(350 / 150, 12)
  expect(result[0].sources).toEqual(before)
  expect(rows).toEqual(before)
  const freeOnly = consolidateShipmentItems(rows.map(row => ({ ...row, purchase_charge_ratio: 0 })), materials)
  expect(shipmentPurchaseAmount(freeOnly[0])).toBe(0)
  expect(freeOnly[0].qty).toBe(180)
})

it('小数采购数量合并不因浮点尾差产生大于一的收费比例', () => {
  const rows = [.1, .2].map((qty, i) => ({ ...batches[i], qty, kg: qty, price: 2, purchase_unit: '千克' }))
  const result = consolidateShipmentItems(rows, materials)[0]
  expect(result.qty).toBe(.3)
  expect(result.purchase_charge_ratio).toBe(1)
  expect(shipmentPurchaseAmount(result)).toBeCloseTo(.6, 12)
})

it('已合并箱数只计一次，独立批次不重新向上取整箱数', () => {
  const shared = batches.map(row => ({ ...row, carton_group: 'shared', cartons: 83 }))
  const result = consolidateShipmentItems(shared, materials)
  expect(result[0].cartons).toBe(83)
  expect(cartonLayout(result, materials).reduce((sum, row) => sum + row.count, 0)).toBe(83)
  const separate = batches.map(row => ({ ...row, qty: 50, cartons: 1 }))
  expect(consolidateShipmentItems(separate, materials)[0].cartons).toBe(2)
})

it('不同共箱组及分段箱号不错误折叠', () => {
  expect(consolidateShipmentItems(batches.map((row, index) => ({ ...row, carton_group: String(index) })), materials)).toHaveLength(2)
  expect(consolidateShipmentItems(batches.map(row => ({ ...row, qty_per_carton: '1-2/100' })), materials)).toHaveLength(2)
})

it('多物料共箱中只汇总相同物料批次，保持物理箱数及各合同发票金额', () => {
  const mats = new Map([
    ...materials,
    [975, { ...materials.get(974)!, id: 975, name_zh: '另一物料' }] as const,
  ])
  const rows = [
    { ...batches[0], qty: 50, kg: 4.53, cartons: 2, carton_group: 'G', carton_no: 'A01', contract_no: 'A', invoice_no: 'A' },
    { ...batches[1], material_id: 975, outbound_id: 76, qty: 10, kg: 1, cartons: 2, carton_group: 'G', carton_no: 'B01', contract_no: 'B', invoice_no: 'B' },
    { ...batches[1], qty: 50, kg: 4.53, cartons: 2, carton_group: 'G', carton_no: 'A02', contract_no: 'A', invoice_no: 'A' },
  ].map(row => Object.freeze({ ...row, customs_company: '深圳市华胜益出口贸易有限公司' }))
  const original = structuredClone(rows)
  const before = withShipmentInvoicePrices(sortShipmentItems(Object.freeze(rows), mats), mats)
  const result = consolidateShipmentItems(rows, mats)
  const after = withShipmentInvoicePrices(sortShipmentItems(result, mats), mats)
  expect(result).toHaveLength(2)
  expect(result.find(row => row.material_id === 974)).toMatchObject({
    qty: 100, kg: 9.06, cartons: 2, carton_no: 'A01 / A02', outbound_ids: [74, 75],
    sources: [original[0], original[2]],
  })
  expect(result.find(row => row.material_id === 975)).toMatchObject({ qty: 10, kg: 1, carton_no: 'B01' })
  expect(cartonLayout(result, mats).reduce((sum, row) => sum + row.count, 0)).toBe(2)
  for (const contract of ['A', 'B']) {
    const amount = (items: typeof before) => items.filter(row => row.contract_no === contract)
      .reduce((sum, row) => sum + row.kg * row.invoice_price, 0)
    expect(amount(after)).toBeCloseTo(amount(before), 9)
  }
  expect(rows).toEqual(original)
})

it('同名共箱组跨供应商仍各自计箱，批次标签汇总不扩大共箱范围', () => {
  const rows = [
    { ...batches[0], supplier: 'A供应商', qty: 50, kg: 4.53, cartons: 2, carton_group: 'G', carton_no: 'A01' },
    { ...batches[0], supplier: 'B供应商', outbound_id: 76, qty: 40, kg: 3.624, cartons: 3, carton_group: 'G', carton_no: 'B01' },
    { ...batches[1], supplier: 'A供应商', qty: 50, kg: 4.53, cartons: 2, carton_group: 'G', carton_no: 'A02' },
    { ...batches[1], supplier: 'B供应商', outbound_id: 77, qty: 40, kg: 3.624, cartons: 3, carton_group: 'G', carton_no: 'B02' },
  ]
  const original = structuredClone(rows)
  const result = consolidateShipmentItems(rows, materials)
  expect(result).toHaveLength(2)
  expect(result.map(row => [row.supplier, row.qty, row.cartons, row.carton_no]))
    .toEqual([['A供应商', 100, 2, 'A01 / A02'], ['B供应商', 80, 3, 'B01 / B02']])
  expect(cartonLayout(result, materials).reduce((sum, row) => sum + row.count, 0)).toBe(5)
  expect(rows).toEqual(original)
})

it.each(['RRI', 'RRM'])('真实模板保留两个半箱的实际箱数，数量重量与源批次一致（%s）', async customer => {
  const rows = batches.map((row, index) => ({
    ...row, qty: 50, kg: 4.53, cartons: 1, carton_no: index ? 'HALF-B' : 'HALF-A',
    contract_no: 'C-HALF', invoice_no: 'I-HALF',
  }))
  const original = structuredClone(rows)
  const templateBuffer = Uint8Array.from(readFileSync(new URL(`../../public/template-customs-${customer.toLowerCase()}.xlsx`, import.meta.url))).buffer
  const blob = await buildCustomsWorkbook({ templateBuffer, items: rows, materials,
    productHs: new Map(), images: new Map(), form: { containerNo: 'HALF-CARTONS', customer, rate: 7.2 } })
  const book = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
  const sheet = book.Sheets['HALF-CARTONS']
  expect(sheet.L4.v).toBe(100)
  expect(sheet.K4.v).toBe(9.06)
  expect(sheet.AT4.v).toBe(2)
  expect(sheet.S4.f).toBe('R4*AT4')
  expect(sheet.P4.f).toBe('ROUND(BA4*L4,2)')
  expect(sheet.Q4.f).toBe('ROUND(BB4*L4,2)')
  expect(sheet.AP4.f).toBe('AO4*K4')
  expect(sheet.F5?.v).not.toBe('彩盒-FSC')
  expect(book.Sheets['装箱单'][customer === 'RRI' ? 'A25' : 'A24']?.v).toBe(1)
  expect(rows).toEqual(original)
}, 60000)

it('华胜益附加费在合并后重新分摊，整柜发票总额不变', () => {
  const rows = batches.map(row => ({ ...row, customs_company: '深圳市华胜益出口贸易有限公司' }))
  const original = withShipmentInvoicePrices(sortShipmentItems(rows, materials), materials)
  const merged = withShipmentInvoicePrices(sortShipmentItems(consolidateShipmentItems(rows, materials), materials), materials)
  const amount = (values: typeof original) => values.reduce((sum, row) => sum + row.kg * row.invoice_price, 0)
  expect(amount(merged)).toBeCloseTo(amount(original), 8)
})

it('非连续批次合并后，华胜益附加费仍归属于原来的合同', () => {
  const rows = [
    { ...batches[0], contract_no: 'A' },
    { ...batches[1], contract_no: 'B', outbound_id: 76 },
    { ...batches[1], contract_no: 'A' },
  ].map(row => ({ ...row, customs_company: '深圳市华胜益出口贸易有限公司' }))
  const before = withShipmentInvoicePrices(sortShipmentItems(rows, materials), materials)
  const after = withShipmentInvoicePrices(sortShipmentItems(consolidateShipmentItems(rows, materials), materials), materials)
  for (const contract of ['A', 'B']) {
    const amount = (values: typeof before) => values.filter(row => row.contract_no === contract)
      .reduce((sum, row) => sum + row.kg * row.invoice_price, 0)
    expect(amount(after)).toBeCloseTo(amount(before), 8)
  }
})

it.each(['RRI', 'RRM'])('真实模板导出合并明细，公式引用合并后的数量和重量（%s）', async customer => {
  const templateBuffer = Uint8Array.from(readFileSync(new URL(`../../public/template-customs-${customer.toLowerCase()}.xlsx`, import.meta.url))).buffer
  const blob = await buildCustomsWorkbook({
    templateBuffer, items: batches.map(row => ({ ...row, contract_no: 'C-MERGED', invoice_no: 'I-MERGED' })),
    materials, productHs: new Map(), images: new Map(),
    form: { containerNo: 'MERGED-BATCHES', customer, rate: 7.2 },
  })
  const book = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
  const sheet = book.Sheets['MERGED-BATCHES']
  expect(sheet.L4.v).toBe(8232)
  expect(sheet.K4.v).toBe(745.82)
  expect(sheet.AT4.v).toBe(83)
  expect(sheet.AP4.f).toBe('AO4*K4')
  expect(sheet.P4.f).toBe('ROUND(BA4*L4,2)')
  expect(sheet.F4.v).toBe('彩盒-FSC')
  expect(sheet.F5?.v).not.toBe('彩盒-FSC')
  const documents: [string, number][] = customer === 'RRI'
    ? [['实业合同', 24], ['实业发票', 28], ['装箱单', 25]]
    : [['全球合同', 24], ['全球发票', 32], ['装箱单', 24]]
  for (const [name, row] of documents) {
    expect(book.Sheets[name][`A${row}`]?.v).toBe(1)
    expect(book.Sheets[name][`A${row + 1}`]?.v).toBeUndefined()
  }
  expect(book.Sheets[customer === 'RRI' ? '实业合同' : '全球合同'].D24.f).toContain("'MERGED-BATCHES'!K:K")
}, 60000)

it.each(['RRI', 'RRM'])('零重量有采购金额的末批不得被合并隐藏或静默导出为零（%s）', async customer => {
  const rows = [
    { ...batches[0], qty: 10, kg: 10, contract_no: 'A', invoice_no: 'A' },
    { ...batches[1], qty: 10, kg: 0, contract_no: 'A', invoice_no: 'A' },
  ].map(row => ({ ...row, customs_company: '深圳市华胜益出口贸易有限公司' }))
  const before = withShipmentInvoicePrices(sortShipmentItems(rows, materials), materials)
  const consolidated = consolidateShipmentItems(rows, materials)
  const after = withShipmentInvoicePrices(sortShipmentItems(consolidated, materials), materials)
  const amount = (values: typeof before) => values.reduce((sum, row) => sum + row.kg * row.invoice_price, 0)
  expect(consolidated).toHaveLength(2)
  expect(amount(after)).toBeCloseTo(amount(before), 9)
  const templateBuffer = Uint8Array.from(readFileSync(new URL(`../../public/template-customs-${customer.toLowerCase()}.xlsx`, import.meta.url))).buffer
  await expect(buildCustomsWorkbook({ templateBuffer, items: rows, materials, productHs: new Map(), images: new Map(),
    form: { containerNo: 'ZERO-LAST-BATCH', customer, rate: 7.2 } })).rejects.toThrow('第 2 行（彩盒-FSC）有采购金额')
}, 60000)

it.each(['RRI', 'RRM'])('共箱先按共享顺序排序，页面与导出保留原合同附加费归属（%s）', async customer => {
  const rows = [
    { ...batches[0], qty: 10, kg: 10, cartons: 2, carton_group: 'G', contract_no: 'A', invoice_no: 'A' },
    { ...batches[1], qty: 10, kg: 10, cartons: 1, carton_group: 'H', contract_no: 'B', invoice_no: 'B', outbound_id: 76 },
    { ...batches[1], qty: 10, kg: 10, cartons: 2, carton_group: 'G', contract_no: 'A', invoice_no: 'A' },
  ].map(row => ({ ...row, customs_company: '深圳市华胜益出口贸易有限公司' }))
  const original = structuredClone(rows)
  const before = withShipmentInvoicePrices(sortShipmentItems(rows, materials), materials)
  const after = withShipmentInvoicePrices(sortShipmentItems(consolidateShipmentItems(rows, materials), materials), materials)
  const editor = withShipmentInvoicePrices(sortShipmentItems(consolidateShipmentItems(sortShipmentItems(rows, materials), materials), materials), materials)
  const amount = (values: typeof before, contract: string) => values.filter(row => row.contract_no === contract)
    .reduce((sum, row) => sum + row.kg * row.invoice_price, 0)
  expect(after.map(row => row.contract_no)).toEqual(['A', 'B'])
  for (const contract of ['A', 'B']) {
    expect(amount(after, contract)).toBeCloseTo(amount(before, contract), 9)
    expect(amount(editor, contract)).toBeCloseTo(amount(before, contract), 9)
  }
  expect(rows).toEqual(original)
  expect(cartonLayout(after, materials).reduce((sum, row) => sum + row.count, 0)).toBe(3)
  const templateBuffer = Uint8Array.from(readFileSync(new URL(`../../public/template-customs-${customer.toLowerCase()}.xlsx`, import.meta.url))).buffer
  const blob = await buildCustomsWorkbook({ templateBuffer, items: rows, materials, productHs: new Map(), images: new Map(),
    form: { containerNo: 'SHARED-GROUP-ORDER', customer, rate: 7.2 } })
  const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['SHARED-GROUP-ORDER']
  expect([sheet.V4.v, sheet.V5.v]).toEqual(['A', 'B'])
  expect([sheet.K4.v, sheet.K5.v]).toEqual([20, 10])
  expect([sheet.AT4.v, sheet.AT5.v]).toEqual([2, 1])
  expect(sheet.Z4.f).not.toContain('1248')
  expect(sheet.Z5.f).toContain('1248')
  expect(Number(sheet.K4.v) * Number(sheet.Z4.v)).toBeCloseTo(amount(before, 'A'), 9)
  expect(Number(sheet.K5.v) * Number(sheet.Z5.v)).toBeCloseTo(amount(before, 'B'), 9)
}, 60000)
