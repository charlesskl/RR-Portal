import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { DOMParser } from '@xmldom/xmldom'
import { isShipmentCountUnit, normalizeShipmentDeclarations } from './shipmentDeclaration'
import { shipmentPackingAverageQty, shipmentWeightQuantity } from './shipmentWeight'
import { withShipmentInvoicePrices } from './shipmentInvoice'
import { shipmentPurchaseAmount } from './shipmentPurchase'
import { applyShipmentSheetEdits } from './shipmentSheet'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { parseShipmentWorkbook } from './shipmentImport'
import { buildCustomsWorkbook } from './customsExport'
import { shipmentDateOnly, shipmentPurchaseDates } from './shipmentDates'

const materials = new Map([[972, { id: 972, name_zh: '壶吸塑', unit_kg: 'PCE', net_per_pc: 51.23 / 5450 }],
  [973, { id: 973, name_zh: '杯吸塑', unit_kg: 'PCE', net_per_pc: 64.31 / 10900 }]])
const rows = [{ material_id: 972, outbound_id: 96, qty: 5450, kg: 51.23, price: .12 },
  { material_id: 973, outbound_id: 97, qty: 10900, kg: 64.31, price: .08 }]

it('旧PCE记录显示实际件数，送货数量、采购单价、实物净重及源记录保持不变', () => {
  const before = structuredClone(rows)
  const normalized = withShipmentInvoicePrices(rows, materials)
  expect(normalized.map(row => row.kg)).toEqual([5450, 10900])
  expect(normalized.map(row => row.qty)).toEqual([5450, 10900])
  normalized.forEach((row, i) => {
    expect(shipmentPurchaseAmount(row)).toBe(shipmentPurchaseAmount(rows[i]))
    const m = materials.get(row.material_id)!
    expect(m.net_per_pc * shipmentWeightQuantity(m.name_zh, row.qty)).toBeCloseTo([51.23, 64.31][i])
  })
  expect(rows).toEqual(before)
})

it('导入旧PCE记录换算每件申报单价但保留采购总额，重复规范化不会重复换算', () => {
  const item = { qty: 5450, kg: 51.23, price: 3.5, material_id: -1, material_snapshot: { unit_kg: 'PCE', name_zh: '壶吸塑' } }
  const normalized = normalizeShipmentDeclarations([item], new Map())[0]
  expect(normalized.kg).toBe(5450)
  expect(normalized.price).toBeCloseTo(3.5 * 51.23 / 5450, 12)
  expect(shipmentPurchaseAmount(normalized)).toBeCloseTo(shipmentPurchaseAmount(item), 10)
  expect(normalizeShipmentDeclarations([normalized], new Map())[0]).toBe(normalized)
  expect(item.kg).toBe(51.23)
})

it('备品仍不收费，规范化只改变申报基数不改变原采购计费量', () => {
  const item = { ...rows[0], purchase_charge_ratio: 5400 / 5450 }
  const result = normalizeShipmentDeclarations([item], materials)[0]
  expect(shipmentPurchaseAmount(result)).toBeCloseTo(5400 * .12)
  expect(result.price).toBe(.12)
})

it.each(['KGM', 'TNE'])('保留%s已录入的实际重量及明确零值，不按件数强行覆盖', unit_kg => {
  const map = new Map([[1, { unit_kg, net_per_pc: .2 }]])
  for (const kg of [0, 17.25]) {
    const item = { material_id: 1, qty: 100, kg }
    expect(normalizeShipmentDeclarations([item], map)[0]).toBe(item)
  }
})

it('缺少物料或件数时不猜单位和数量', () => {
  const item = { material_id: 1, kg: 51.23, price: 1 }
  expect(normalizeShipmentDeclarations([item], new Map())[0]).toBe(item)
  expect(normalizeShipmentDeclarations([item], new Map([[1, { unit_kg: 'PCE' }]]))[0]).toBe(item)
  expect(isShipmentCountUnit('PCE')).toBe(true)
  expect(isShipmentCountUnit('KGM')).toBe(false)
})

it('切换申报单位保留导入采购金额；修改件数按每件价格正常计费', () => {
  const map = new Map([[1, { unit_kg: 'KGM', net_per_pc: .2 }]])
  const item = { material_id: 1, material_snapshot: { unit_kg: 'KGM' }, qty: 100, kg: 20, price: 5 }
  const count = applyShipmentSheetEdits([item], map, [{ row: 0, field: 'material:unit_kg', value: 'PCE' }])
  expect(count.items[0]).toMatchObject({ qty: 100, kg: 100, price: 1 })
  expect(shipmentPurchaseAmount(count.items[0])).toBe(100)
  const doubled = applyShipmentSheetEdits(count.items, count.materials, [{ row: 0, field: 'qty', value: '200' }])
  expect(doubled.items[0]).toMatchObject({ qty: 200, kg: 200, price: 1 })
  const back = applyShipmentSheetEdits(count.items, count.materials, [{ row: 0, field: 'material:unit_kg', value: 'KGM' }])
  expect(back.items[0]).toMatchObject({ qty: 100, kg: 20, price: 5 })
})

it('件数单位禁止把公斤值粘贴到申报数量，整次拒绝且不写入源行', () => {
  expect(() => applyShipmentSheetEdits(rows, materials, [{ row: 0, field: 'kg', value: '51.23' }])).toThrow('自动取送货数量')
  expect(rows[0].kg).toBe(51.23)
  const result = applyShipmentSheetEdits(rows, materials, [
    { row: 0, field: 'kg', value: '6000' }, { row: 0, field: 'qty', value: '6000' },
  ])
  expect(result.items[0]).toMatchObject({ qty: 6000, kg: 6000 })
})

it('旧Excel中PCE搭配公斤值时修正申报量，保留原表证据和采购金额', () => {
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['货号', '产品中文名称', '单位', '送货重量', '送货数量', '单位', '采购单价', '净重总重'],
    ['A', '壶吸塑', 'PCE', 51.23, 5450, '个', 3.5, 51.23],
  ])
  sheet.G2.z = '"US$"0.0000'
  XLSX.utils.book_append_sheet(wb, sheet, '原始')
  const row = parseShipmentWorkbook(wb).rows[0]
  expect(row.item).toMatchObject({ qty: 5450, kg: 5450, purchase_unit: '个' })
  expect(shipmentPurchaseAmount(row.item)).toBeCloseTo(3.5 * 51.23)
  expect(row.item.material_snapshot.import_source?.cells.find(c => c.address === 'D2')?.value).toBe(51.23)
  expect(row.warnings.join('；')).toContain('PCE 申报数量')
})

it('采购日期仅显示日历日期，去掉时间后去重，原始批次日期不被修改', () => {
  const sources = [{ po_date: '2026-09-28T00:00:00' }, { po_date: '2026-10-06T00:00:00Z' }, { po_date: '2026-09-28T23:00:00-08:00' }]
  expect(shipmentPurchaseDates(sources).join(' / ')).toBe('2026-09-28 / 2026-10-06')
  expect(sources[0].po_date).toBe('2026-09-28T00:00:00')
  expect(shipmentDateOnly('2026-10-06')).toBe('2026-10-06')
  expect(shipmentDateOnly('2026-02-30T00:00:00')).toBe('')
})

it('实际页面保存使用按单位校正的申报量，采购日期展示去掉时间但逐批保存原始值', async () => {
  const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('ShipmentsPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const handlers: string[] = []
  function walk(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && ['save', 'effectiveWeighingQty', 'mergedCellValue'].includes(node.name?.text || '')) handlers.push(node.getText(tree))
    ts.forEachChild(node, walk)
  }
  walk(tree)
  const raw = [
    { ...rows[0], _rowKey: 1, po_date: '2026-09-28T00:00:00' },
    { ...rows[0], _rowKey: 2, outbound_id: 98, po_date: '2026-10-06T00:00:00' },
  ]
  const items = withShipmentInvoicePrices(raw, materials)
  const api = { put: vi.fn(async (..._args: any[]) => ({})) }
  const context = createContext({
    items, consolidatedItems: consolidateShipmentItems(items, materials), matMap: materials, api, creating: false, editing: { id: 9001 },
    sheetEditing: false, dirtyMatIds: new Set(), form: { validateFields: async () => ({ customer: 'RRI' }) },
    setSaving: vi.fn(), setEditing: vi.fn(), setEditorDirty: vi.fn(), closeEditor: vi.fn(), load: vi.fn(),
    shipmentPurchaseDates, shipmentPackingAverageQty, shipmentWeightQuantity, message: { success: vi.fn() },
  })
  runInContext(ts.transpileModule(handlers.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  expect(runInContext("mergedCellValue(0, 'po_date')", context)).toBe('2026-09-28 / 2026-10-06')
  expect(await runInContext('save()', context)).toBe(true)
  const saved = JSON.parse(JSON.stringify(api.put.mock.calls[0][1].items))
  expect(saved.map((row: any) => row.kg)).toEqual([5450, 5450])
  expect(saved.map((row: any) => row.qty)).toEqual([5450, 5450])
  expect(saved.map((row: any) => row.po_date)).toEqual(raw.map(row => row.po_date))
  expect(raw.map(row => row.kg)).toEqual([51.23, 51.23])
})

it.each(['rri', 'rrm'])('真实模板导出件数申报量、公斤净重、金额及简化日期，并能重新导入（%s）', async customer => {
  vi.stubGlobal('DOMParser', DOMParser)
  try {
    const m = materials.get(972)!
    const batches = [
      { ...rows[0], po_date: '2026-09-28T00:00:00', purchase_unit: '个', supplier: '供应商', customs_company: '出口公司', currency: 'US$' },
      { ...rows[0], outbound_id: 98, po_date: '2026-10-06T00:00:00', purchase_unit: '个', supplier: '供应商', customs_company: '出口公司', currency: 'US$' },
    ]
    const before = structuredClone(batches)
    const normalized = normalizeShipmentDeclarations(batches, materials)
    expect(consolidateShipmentItems(normalized, materials)[0].qty).toBe(10900)
    const templateBuffer = Uint8Array.from(readFileSync(new URL(`../../public/template-customs-${customer}.xlsx`, import.meta.url))).buffer
    const output = await buildCustomsWorkbook({ templateBuffer, items: batches, materials,
      productHs: new Map(), images: new Map(), form: { customer: customer.toUpperCase(), containerNo: 'UNIT-TEST', rate: .93 }, mainOnly: true })
    const wb = XLSX.read(await output.arrayBuffer(), { type: 'array' })
    const sheet = wb.Sheets['UNIT-TEST']
    expect(sheet.J3.v).toContain('申报单位')
    expect(sheet.K3.v).toContain('申报数量')
    expect(sheet.J4.v).toBe('PCE')
    expect(sheet.K4.v).toBe(10900)
    expect(sheet.L4.v).toBe(10900)
    expect(sheet.Q4.v).toBeCloseTo(2 * m.net_per_pc * 5450)
    expect(sheet.AP4.v).toBeCloseTo(10900 * .12)
    expect(sheet.AM4.v).toBe('2026-09-28 / 2026-10-06')
    const imported = parseShipmentWorkbook(wb).rows[0].item
    expect(imported.kg).toBe(10900)
    expect(imported.purchase_unit).toBe('个')
    expect(batches).toEqual(before)
  } finally { vi.unstubAllGlobals() }
}, 60000)
