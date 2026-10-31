import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { DOMParser } from '@xmldom/xmldom'
import * as XLSX from 'xlsx'
import { expect, it, vi } from 'vitest'
import { formatShipmentDeclaration, roundedShipmentDeclaration, shipmentDeclarationPrecision } from './shipmentDeclaration'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { shipmentPurchaseAmount } from './shipmentPurchase'
import { shipmentOptionalNumber } from './shipmentDisplay'
import { withShipmentInvoicePrices } from './shipmentInvoice'
import { buildCustomsWorkbook } from './customsExport'

it.each([
  ['KGM', 502.379, 502.38, '502.38', 2],
  ['KG', 1.005, 1.01, '1.01', 2],
  ['千克', 87, 87, '87.00', 2],
  ['TNE', 1.23456, 1.2346, '1.2346', 4],
  ['TON', .00505, .0051, '0.0051', 4],
  ['吨', 2, 2, '2.0000', 4],
  ['PCE', 5450, 5450, '5,450', undefined],
  ['SET', 10, 10, '10', undefined],
  ['MTR', 1.2345, 1.2345, '1.2345', undefined],
] as const)('%s 申报数量按单位精度显示及取值', (unit_kg, kg, expected, display, precision) => {
  const original = { kg, qty: 100, outbound_id: 7, price: 3 }
  const row = roundedShipmentDeclaration(original, { unit_kg })
  expect(row.kg).toBe(expected)
  expect(shipmentDeclarationPrecision(unit_kg)).toBe(precision)
  expect(formatShipmentDeclaration(row.kg, unit_kg)).toBe(display)
  expect(shipmentPurchaseAmount(row)).toBe(300)
  expect(original.kg).toBe(kg)
})

it('先合并原始批次数值再取舍，备品计费及原始来源不变', () => {
  const materials = new Map([[1, { unit_kg: 'KGM' }]])
  const sources = [1, 2].map(outbound_id => ({ material_id: 1, outbound_id, qty: 10, kg: .004, price: 5, purchase_charge_ratio: .8 }))
  const before = structuredClone(sources)
  const [row] = consolidateShipmentItems(sources, materials).map(item => roundedShipmentDeclaration(item, materials.get(1)))
  expect(row.kg).toBe(.01)
  expect(row.sources.map(source => source.kg)).toEqual([.004, .004])
  expect(shipmentPurchaseAmount(row)).toBe(80)
  const [invoice] = withShipmentInvoicePrices([row], materials)
  expect(invoice.invoice_price * invoice.kg).toBeCloseTo(80)
  expect(sources).toEqual(before)
})

it('导入行四舍五入后换算申报单价，采购金额不变，极小数量不默默清零金额', () => {
  const original = { material_snapshot: { unit_kg: 'KGM' }, kg: 502.379, price: 1.6569, qty: 3667 }
  const row = roundedShipmentDeclaration(original, original.material_snapshot)
  expect(row.kg).toBe(502.38)
  expect(shipmentPurchaseAmount(row)).toBeCloseTo(shipmentPurchaseAmount(original), 8)
  const tiny = { ...original, kg: .004 }
  expect(roundedShipmentDeclaration(tiny, tiny.material_snapshot)).toBe(tiny)
  expect(original.kg).toBe(502.379)
})

it('实际页面的文字预览、复制及填充读取固定精度，数字编辑器也按单位限制精度', () => {
  const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let handler = ''
  function walk(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'mergedCellValue') handler = node.getText(tree)
    ts.forEachChild(node, walk)
  }
  walk(tree)
  const context = createContext({ formatShipmentDeclaration, shipmentOptionalNumber, consolidatedItems: [{ kg: 1250.582, material_id: 1 }], matMap: new Map([[1, { unit_kg: 'KGM' }]]) })
  runInContext(ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  expect(runInContext("mergedCellValue(0, 'kg')", context)).toBe('1,250.58')
  context.matMap.set(1, { unit_kg: 'TNE' })
  expect(runInContext("mergedCellValue(0, 'kg')", context)).toBe('1,250.5820')
  expect(source).toContain('precision={shipmentDeclarationPrecision(matMap.get(r.material_id!)?.unit_kg)}')
})

it.each([['rri', true], ['rrm', true], ['rri', false], ['rrm', false]] as const)('真实%s模板导出底层数值与固定小数位均匹配，金额不变（仅主表=%s）', async (customer, mainOnly) => {
  vi.stubGlobal('DOMParser', DOMParser)
  try {
    const materials = new Map([
      [1, { name_zh: '公斤测试', unit_kg: 'KGM', net_per_pc: .2 }],
      [2, { name_zh: '吨测试', unit_kg: 'TNE', net_per_pc: .2 }],
      [3, { name_zh: '件数测试', unit_kg: 'PCE', net_per_pc: .2 }],
    ])
    const items = [
      { material_id: 1, outbound_id: 1, kg: 502.379, qty: 100, price: 3, currency: 'US$' },
      { material_id: 2, outbound_id: 2, kg: 1.23456, qty: 200, price: 3, currency: 'US$' },
      { material_id: 3, outbound_id: 3, kg: 10, qty: 50, price: 3, currency: 'US$' },
    ]
    const before = structuredClone(items)
    const templateBuffer = Uint8Array.from(readFileSync(new URL(`../../public/template-customs-${customer}.xlsx`, import.meta.url))).buffer
    const blob = await buildCustomsWorkbook({ templateBuffer, items, materials, productHs: new Map(), images: new Map(), form: { customer: customer.toUpperCase(), containerNo: 'PRECISION', rate: .93 }, mainOnly })
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellNF: true })
    const sheet = wb.Sheets.PRECISION
    expect(sheet.K4.v).toBe(502.38)
    expect(sheet.K4.z?.replaceAll('_ ', '')).toBe('0.00')
    expect(sheet.K5.v).toBe(1.2346)
    expect(sheet.K5.z?.replaceAll('_ ', '')).toBe('0.0000')
    expect(sheet.K6.v).toBe(50)
    expect([sheet.AP4.v, sheet.AP5.v, sheet.AP6.v]).toEqual([300, 600, 150])
    expect(sheet.AO4.v * sheet.K4.v).toBeCloseTo(300, 8)
    expect(sheet.AO5.v * sheet.K5.v).toBeCloseTo(600, 8)
    expect(items).toEqual(before)
  } finally { vi.unstubAllGlobals() }
}, 60000)

it('真实模板先汇总再取舍，导入行金额保留，过小数量明确拒绝导出', async () => {
  vi.stubGlobal('DOMParser', DOMParser)
  try {
    const materials = new Map([[1, { name_zh: '合并测试', unit_kg: 'KGM' }], [-1, { name_zh: '导入测试', unit_kg: 'KGM' }]])
    const imported = { material_id: -1, material_snapshot: materials.get(-1), kg: 502.379, qty: 3667, price: 1.6569, currency: 'US$' }
    const items = [1, 2].map(outbound_id => ({ material_id: 1, outbound_id, qty: 10, kg: .004, price: 5, currency: 'US$' }))
    const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rri.xlsx', import.meta.url))).buffer
    const input = { templateBuffer, materials, productHs: new Map(), images: new Map(), form: { customer: 'RRI', containerNo: 'ROUND', rate: .93 }, mainOnly: true }
    const blob = await buildCustomsWorkbook({ ...input, items: [...items, imported] })
    const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets.ROUND
    expect(sheet.K4.v).toBe(.01)
    expect(sheet.AP4.v).toBe(100)
    expect(sheet.K5.v).toBe(502.38)
    expect(sheet.AP5.v).toBeCloseTo(shipmentPurchaseAmount(imported), 8)
    await expect(buildCustomsWorkbook({ ...input, items: [{ ...imported, kg: .004 }] })).rejects.toThrow('取舍后为零')
  } finally { vi.unstubAllGlobals() }
}, 60000)
