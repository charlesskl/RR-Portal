import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import * as XLSX from 'xlsx'
import { expect, it, vi } from 'vitest'
import { buildCustomsWorkbook } from './customsExport'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { roundedShipmentDeclaration, shipmentStoredDeclarationPrice } from './shipmentDeclaration'
import { shipmentDeclarationSaveError } from './shipmentDeclarationSaveValidation'
import { shipmentDateOnly } from './shipmentDates'
import { applyMergedShipmentEdits } from './shipmentMergedEditor'
import { shipmentPurchaseAmount } from './shipmentPurchase'
import { sheetFillDownEdits } from './shipmentSheet'
import type { Material } from '../api/client'

const imported = (kg: number, unit = 'KGM', key = 1) => ({
  _rowKey: key, material_id: -key, material_snapshot: { unit_kg: unit, net_per_pc: .0123456 },
  qty: 100, kg, price: 100, currency: 'US$',
})
const materialsFor = (items: ReturnType<typeof imported>[]) => new Map<number, Material>(items.map(item => [item.material_id, item.material_snapshot]))
const visible = <T extends Parameters<typeof consolidateShipmentItems>[0][number]>(items: T[], materials: Map<number, Material>) =>
  consolidateShipmentItems(items, materials).map(item => roundedShipmentDeclaration(item, materials.get(item.material_id!)))

it.each([['KGM', .006, .01], ['TNE', .00006, .0001]] as const)(
  '导入%s单价编辑使用可见申报数量，原始数量及其他行不变', (unit, kg, declaration) => {
    const items = [imported(kg, unit), imported(12.345, 'KGM', 2)]
    const original = structuredClone(items), materials = materialsFor(items)
    const edited = applyMergedShipmentEdits(items, materials, visible(items, materials), [{ row: 0, field: 'price', value: '10' }])
    const row = visible(edited.items, edited.materials)[0]
    expect(row.kg).toBe(declaration)
    expect(row.price).toBeCloseTo(10, 12)
    expect(shipmentPurchaseAmount(row)).toBeCloseTo(declaration * 10, 12)
    expect(edited.items[0].kg).toBe(kg)
    expect(edited.items[0].qty).toBe(100)
    expect(edited.items[1]).toEqual(original[1])
    expect(items).toEqual(original)
  },
)

it('同次粘贴申报数量与单价按最终申报数量计价，与粘贴列顺序无关', () => {
  const items = [imported(.006)], materials = materialsFor(items)
  const edits = [{ row: 0, field: 'kg', value: '.016' }, { row: 0, field: 'price', value: '10' }]
  for (const ordered of [edits, [...edits].reverse()]) {
    const edited = applyMergedShipmentEdits(items, materials, visible(items, materials), ordered)
    const [row] = visible(edited.items, edited.materials)
    expect(edited.items[0].kg).toBe(.016)
    expect(row.kg).toBe(.02)
    expect(row.price).toBeCloseTo(10, 12)
    expect(shipmentPurchaseAmount(row)).toBeCloseTo(.2, 12)
  }
})

it('同次改申报单位与单价按最终单位计价，不套用旧单位换算', () => {
  const items = [imported(.00123456, 'TNE')], materials = materialsFor(items)
  const edits = [{ row: 0, field: 'material:unit_kg', value: 'KGM' }, { row: 0, field: 'price', value: '10' }]
  for (const ordered of [edits, [...edits].reverse()]) {
    const edited = applyMergedShipmentEdits(items, materials, visible(items, materials), ordered)
    const [row] = visible(edited.items, edited.materials)
    expect(edited.items[0].kg).toBe(1.2346)
    expect(row.kg).toBe(1.23)
    expect(row.price).toBeCloseTo(10, 12)
    expect(shipmentPurchaseAmount(row)).toBeCloseTo(12.3, 12)
  }
})

it('批量修改及向下填充复制可见单价，每行按自己的申报数量计价', () => {
  const items = [imported(.006), imported(.016, 'KGM', 2)], materials = materialsFor(items)
  const edited = applyMergedShipmentEdits(items, materials, visible(items, materials), [
    { row: 0, field: 'price', value: '10' }, { row: 1, field: 'price', value: '7.5' },
  ])
  const displayed = visible(edited.items, edited.materials)
  expect(displayed[0].price).toBeCloseTo(10, 12)
  expect(displayed[1].price).toBeCloseTo(7.5, 12)
  expect(shipmentPurchaseAmount(displayed[0])).toBeCloseTo(.1, 12)
  expect(shipmentPurchaseAmount(displayed[1])).toBeCloseTo(.15, 12)
  const fill = sheetFillDownEdits({ row: 1, col: 0 }, { row: 1, col: 0 }, 2, ['price'], (row) => displayed[row].price)
  const filled = applyMergedShipmentEdits(edited.items, edited.materials, displayed, fill)
  const final = visible(filled.items, filled.materials)
  expect(final[1].price).toBeCloseTo(10, 12)
  expect(shipmentPurchaseAmount(final[1])).toBeCloseTo(.2, 12)
})

it('真实采购来源保持原单价及免费备品比例；零数量不除零；无单价编辑保持原金额', () => {
  const material = { unit_kg: 'KGM' }
  const linked = [{ _rowKey: 1, material_id: 1, outbound_id: 5, qty: 100, kg: .006, price: 100, purchase_charge_ratio: .8 }]
  const materials = new Map([[1, material]])
  const edited = applyMergedShipmentEdits(linked, materials, visible(linked, materials), [{ row: 0, field: 'price', value: '10' }])
  expect(edited.items[0].price).toBe(10)
  expect(shipmentPurchaseAmount(visible(edited.items, edited.materials)[0])).toBe(800)
  const zero = [imported(0)], zeroMaterials = materialsFor(zero)
  const zeroEdited = applyMergedShipmentEdits(zero, zeroMaterials, visible(zero, zeroMaterials), [{ row: 0, field: 'price', value: '10' }])
  expect(zeroEdited.items[0].price).toBe(10)
  expect(shipmentPurchaseAmount(zeroEdited.items[0])).toBe(0)
  const untouched = [imported(.006)], untouchedMaterials = materialsFor(untouched)
  const textEdited = applyMergedShipmentEdits(untouched, untouchedMaterials, visible(untouched, untouchedMaterials), [{ row: 0, field: 'pallet', value: '1卡' }])
  expect(textEdited.items[0].price).toBe(untouched[0].price)
  expect(shipmentPurchaseAmount(textEdited.items[0])).toBe(shipmentPurchaseAmount(untouched[0]))
})

const page = ts.createSourceFile('page.tsx', readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const pickerValues = new Map<string, string>()
function walk(node: ts.Node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(page) === 'DatePicker') {
    const value = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(page) === 'value')
    if (value && ts.isJsxAttribute(value) && value.initializer && ts.isJsxExpression(value.initializer) && value.initializer.expression) {
      const expression = value.initializer.expression.getText(page)
      for (const field of ['contract_date', 'invoice_date', 'po_date']) if (expression.includes(`r.${field}`)) pickerValues.set(field, expression)
    }
  }
  ts.forEachChild(node, walk)
}
walk(page)
it.each(['contract_date', 'invoice_date', 'po_date'])('真实DatePicker的%s与日期预览保持同一业务日', field => {
  const source = '2026-10-06T23:30:00-08:00'
  const expression = pickerValues.get(field)
  expect(expression).toBeTruthy()
  const context = createContext({ dayjs, shipmentDateOnly, r: { [field]: source } })
  const active = runInContext(`(${expression}).format('YYYY-MM-DD')`, context)
  expect(active).toBe(shipmentDateOnly(source))
})

it.each(['legacy', 'RRI', 'RRM'])('真实%s模板导出合同、发票及采购业务日不按时区换日', async variant => {
  vi.stubGlobal('DOMParser', DOMParser); vi.stubGlobal('XMLSerializer', XMLSerializer)
  try {
    const source = '2026-10-06T23:30:00-08:00'
    const templateBuffer = Uint8Array.from(readFileSync(new URL(`../../public/template-customs${variant === 'legacy' ? '' : '-' + variant.toLowerCase()}.xlsx`, import.meta.url))).buffer
    const items = [{ material_id: 1, outbound_id: 1, qty: 100, kg: 10, price: 1, contract_date: source, invoice_date: source, po_date: source }]
    const before = structuredClone(items)
    const blob = await buildCustomsWorkbook({ templateBuffer, items, materials: new Map([[1, { unit_kg: 'KGM' }]]), productHs: new Map(), images: new Map(), form: { containerNo: 'DATE-REGRESSION', customer: variant === 'legacy' ? 'RRI' : variant, rate: 1 }, mainOnly: true })
    const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['DATE-REGRESSION']
    for (const address of ['W4', 'Y4', 'AM4']) expect(XLSX.SSF.format('yyyy-mm-dd', Number(sheet[address].v))).toBe('2026-10-06')
    expect(items).toEqual(before)
  } finally { vi.unstubAllGlobals() }
}, 60000)

it('申报显示单价转换仍受服务器8位金额校验保护，不能用换算绕过', () => {
  const item = imported(10000000.004)
  const price = shipmentStoredDeclarationPrice(item, .000000005, item.material_snapshot)
  const changed = { ...item, price }
  expect(shipmentPurchaseAmount(changed)).toBeCloseTo(.05, 12)
  expect(shipmentDeclarationSaveError([changed])).toContain('0.05')
  expect(shipmentDeclarationSaveError([changed])).toContain('0.00')
  expect(item.price).toBe(100)
})
