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
  { outbound_id: 74, material_id: 974, qty: 8150, kg: 738.39, cartons: 82, qty_per_carton: '100', price: 2, currency: 'US$', po_no: 'IRRIHS0401' },
  { outbound_id: 75, material_id: 974, qty: 82, kg: 7.4292, cartons: 1, qty_per_carton: '100', price: 2, currency: 'US$', po_no: 'IRRIHS0401' },
]

it('同柜分批出库只显示一行，数量、重量和实际箱数累加，原始分配不变', () => {
  const before = structuredClone(batches)
  const result = consolidateShipmentItems(batches, materials)
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ qty: 8232, kg: 745.8192, cartons: 83, outbound_ids: [74, 75] })
  expect(result[0].sources).toEqual(before)
  expect(batches).toEqual(before)
  expect(shipmentPurchaseAmount(result[0])).toBeCloseTo(batches.reduce((sum, row) => sum + shipmentPurchaseAmount(row), 0), 10)
  // Separate containers are separate calls; their original allocations are not changed.
  expect(consolidateShipmentItems([batches[0]], materials)[0].qty).toBe(8150)
  expect(consolidateShipmentItems([batches[1]], materials)[0].qty).toBe(82)
})

it.each([
  { material_id: 975 }, { supplier: '另一供应商' }, { customs_company: '另一报关公司' },
  { price: 3 }, { currency: '¥' }, { purchase_unit: '米' }, { contract_no: '另一合同' },
  { invoice_no: '另一发票' }, { bl_head: '另一抬头' }, { weighing_qty: 5 },
  { qty_per_carton: '200' }, { carton_no: '另一个箱号' }, { pallet: '1-2/1卡' },
  { material_snapshot: { id: 974 } }, { outbound_id: undefined }, { material_id: undefined },
])('不合并资料不同或不能确认来源的明细 %j', override => {
  expect(consolidateShipmentItems([batches[0], { ...batches[1], ...override }], materials)).toHaveLength(2)
})

it('不同采购单但其他资料一致时保留全部采购单号及出库来源', () => {
  const result = consolidateShipmentItems([batches[0], { ...batches[1], po_no: 'IRRIHS0402' }], materials)
  expect(result).toHaveLength(1)
  expect(result[0].po_no).toBe('IRRIHS0401 / IRRIHS0402')
  expect(result[0].outbound_ids).toEqual([74, 75])
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
  expect(sheet.K4.v).toBe(745.8192)
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
