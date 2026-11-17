import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import * as XLSX from 'xlsx'
import { expect, it } from 'vitest'
import { shipmentCbmPerCarton, shipmentCbmTotal, shipmentGrossPerPc, shipmentNetTotalKg, shipmentWeightQuantity } from './shipmentWeight'
import { applyShipmentSheetEdits } from './shipmentSheet'
import { shipmentPurchaseAmount } from './shipmentPurchase'
import { buildCustomsWorkbook } from './customsExport'
import { parseShipmentWorkbook } from './shipmentImport'

it.each([
  ['TNE', .028, 28], ['吨', .028, 28], ['TON', .028, 28],
  ['KGM', 28, .028], ['KG', 28, .028], ['KGM', 0, .028],
  ['PCE', 20, .028], ['SET', 20, .028],
] as const)('申报%s=%s，实物净重为%s千克', (unit_kg, kg, expected) => {
  expect(shipmentNetTotalKg({ qty: 20000, kg }, { unit_kg, name_zh: '纸绳1.5MM', net_per_pc: .0014 })).toBeCloseTo(expected)
})

it.each(['KGM', 'KG', 'KGS', '千克', '公斤'])('%s申报数量冲突或为零仍保留原物理净重', unit_kg => {
  const material = { unit_kg, net_per_pc: .2 }
  for (const kg of [.25, 0]) {
    expect(shipmentNetTotalKg({ qty: 100, kg }, material)).toBe(20)
  }
})

it.each(['TNE', 'TON', '吨'])('%s净重换算不改已保存申报量、单重或采购金额', unit_kg => {
  const item = { outbound_id: 7, qty: 20000, kg: .028, price: .01, purchase_unit: '个' }
  const material = { unit_kg, name_zh: '纸绳1.5MM', net_per_pc: .0014 }
  const original = structuredClone({ item, material })
  const paidAmount = shipmentPurchaseAmount(item)
  expect(shipmentNetTotalKg(item, material)).toBe(28)
  expect({ item, material }).toEqual(original)
  expect(shipmentPurchaseAmount(item)).toBe(paidAmount)
  expect(paidAmount).toBe(200)
})

it('逐批申报四舍五入不抹掉更精确的实物净重', () => {
  expect(shipmentNetTotalKg({ qty: 1500, kg: 149.3 }, { unit_kg: 'KGM', net_per_pc: .09953 })).toBeCloseTo(149.295)
  expect(shipmentNetTotalKg({ qty: 1, kg: .028 }, { unit_kg: 'TNE', net_per_pc: 28.001 })).toBe(28.001)
})

it('KGM改成TNE后申报数量换吨，净重仍为千克，源采购金额保持', () => {
  const row = { material_id: 1, outbound_id: 2, qty: 20000, kg: 28, price: .01 }
  const material = { unit_kg: 'KGM', name_zh: '纸绳1.5MM', net_per_pc: 1.4 }
  const result = applyShipmentSheetEdits([row], new Map([[1, material]]), [{ row: 0, field: 'material:unit_kg', value: 'TNE' }])
  expect(result.items[0].kg).toBe(.028)
  expect(result.materials.get(1).unit_kg).toBe('TNE')
  expect(shipmentNetTotalKg(result.items[0], result.materials.get(1))).toBe(28)
  expect(shipmentPurchaseAmount(result.items[0])).toBe(shipmentPurchaseAmount(row))
  expect(row.kg).toBe(28)
  expect(material.unit_kg).toBe('KGM')
})

it('真实页面计算及合并来源汇总不会将吨值当千克', () => {
  const page = ts.createSourceFile('page.tsx', readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let source = '', totals = ''
  function walk(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'calc') source = node.getText(page)
    if (ts.isVariableDeclaration(node) && node.name.getText(page) === 'tot' && node.initializer && ts.isCallExpression(node.initializer))
      totals = node.initializer.arguments[0].getText(page)
    ts.forEachChild(node, walk)
  }
  walk(page)
  expect(source).toBeTruthy()
  const context = createContext({ matMap: new Map([[1, { unit_kg: 'TNE', name_zh: '纸绳', net_per_pc: .0014 }]]),
    num: (value: unknown) => Number(value) || 0, shipmentNetTotalKg, shipmentWeightQuantity, shipmentGrossPerPc,
    shipmentCbmPerCarton, shipmentCbmTotal, shipmentPurchaseAmount, effectiveWeighingQty: () => 0, consolidatedItems: [], cartonRows: [],
    items: [{ material_id: 1, qty: 20000, kg: .028 }] })
  const js = ts.transpile(source + `; calc({ material_id: 1, qty: 20000, kg: .028, sources: [
    { material_id: 1, qty: 10000, kg: .01 }, { material_id: 1, qty: 10000, kg: .018 }
  ] }).netTotal`, { target: ts.ScriptTarget.ES2022 })
  expect(runInContext(js, context)).toBe(28)
  expect(totals).toBeTruthy()
  const totalNet = runInContext(ts.transpile(`(${totals})().net`, { target: ts.ScriptTarget.ES2022 }), context)
  expect(totalNet).toBe(28)
})

it.each(['rri', 'rrm'])('真实%s模板：申报0.0280吨、净重28.00kg，Excel重算及再导入保持正确', async variant => {
  const material = { id: 1, unit_kg: 'TNE', name_zh: '纸绳1.5MM', product_code: '47674A', net_per_pc: .0014 }
  const item = { material_id: 1, outbound_id: 1, qty: 20000, kg: .028, price: .01, currency: 'US$' }
  const templateBuffer = Uint8Array.from(readFileSync(new URL(`../../public/template-customs-${variant}.xlsx`, import.meta.url))).buffer
  const blob = await buildCustomsWorkbook({ templateBuffer, items: [item], materials: new Map([[1, material]]), productHs: new Map(), images: new Map(),
    form: { customer: variant.toUpperCase(), containerNo: 'NET-KG', rate: 1 }, mainOnly: true })
  const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellNF: true })
  const sheet = workbook.Sheets['NET-KG']
  expect(sheet.J4.v).toBe('TNE')
  expect(sheet.K4.v).toBe(.028)
  expect(sheet.K4.z?.replaceAll('_ ', '')).toBe('0.0000')
  expect(sheet.Q4.v).toBe(28)
  expect(sheet.Q4.f).toBe('ROUND(BB4*L4/1000,2)')
  expect(Number(sheet.BB4.v) * Number(sheet.L4.v) / 1000).toBe(28)
  expect(sheet.AP4.v).toBe(200)
  const imported = parseShipmentWorkbook(workbook).rows[0].item
  expect(imported.material_snapshot.unit_kg).toBe('TNE')
  expect(shipmentNetTotalKg(imported, imported.material_snapshot)).toBe(28)
  expect(imported.material_snapshot.net_per_pc).toBe(1.4)
}, 60000)
