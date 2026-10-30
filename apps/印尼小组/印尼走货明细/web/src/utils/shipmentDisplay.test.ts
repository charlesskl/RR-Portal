import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { formatShipmentPallet, shipmentOptionalNumber } from './shipmentDisplay'
import { parseSheetClipboard, shipmentSheetFields } from './shipmentSheet'

it.each([undefined, null, '', 0, '0', NaN])('可选尺寸/称重数量 %s 显示空白', value => {
  expect(shipmentOptionalNumber(value)).toBeUndefined()
})
it.each([.0001, 4.12, 13, '36'])('可选尺寸/称重数量的非零值 %s 不隐藏', value => {
  expect(shipmentOptionalNumber(value)).toBe(Number(value))
})

const tree = ts.createSourceFile('page.tsx', readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers: string[] = []
function walk(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['mergedCellValue', 'sheetDisplayValue'].includes(node.name?.text || '')) handlers.push(node.getText(tree))
  ts.forEachChild(node, walk)
}
walk(tree)
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function setup() {
  const item = { material_id: 1, weighing_qty: 0, pallet: '1-3/4卡 8-9/9卡', sources: [] }
  const material = { length: 0, width: 0, height: 0, weight_per_carton: 0 }
  const context = createContext({ consolidatedItems: [item], matMap: new Map([[1, material]]),
    shipmentSheetFields, formatShipmentPallet, shipmentOptionalNumber,
    effectiveWeighingQty: (row: typeof item) => row.weighing_qty,
  })
  runInContext(compile(handlers.join('\n')), context)
  return { context, item, material }
}

it.each(['material:length', 'material:width', 'material:height', 'material:weight_per_carton', 'weighing_qty'])(
  '实际页面 %s 未激活的预览及复制值留空，不改动原值', field => {
    const { context, item, material } = setup()
    context.field = field; context.col = shipmentSheetFields.indexOf(field as typeof shipmentSheetFields[number])
    expect(runInContext('mergedCellValue(0, field)', context)).toBeUndefined()
    expect(runInContext('sheetDisplayValue(0, col)', context)).toBeUndefined()
    expect(item.weighing_qty).toBe(0)
    expect(material).toEqual({ length: 0, width: 0, height: 0, weight_per_carton: 0 })
    if (field === 'weighing_qty') item.weighing_qty = 25
    else Object.assign(material, { [field.slice(9)]: 25 })
    expect(runInContext('sheetDisplayValue(0, col)', context)).toBe(25)
  })

it('实际页面卡板空格分组显示换行，编辑中的原输入不被修改', () => {
  const { context, item } = setup()
  context.col = shipmentSheetFields.indexOf('pallet')
  expect(runInContext("mergedCellValue(0, 'pallet')", context)).toBe('1-3/4卡\n8-9/9卡')
  expect(runInContext('sheetDisplayValue(0, col)', context)).toBe('1-3/4卡\n8-9/9卡')
  expect(item.pallet).toBe('1-3/4卡 8-9/9卡')
})

it('实际多格复制包括已挂载的卡板输入框，也按分行复制而非泄漏原始空格', () => {
  const { context, item } = setup()
  const table = ts.createSourceFile('table.tsx', readFileSync(new URL('../components/ShipmentSheetTable.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let copy = '', quote = ''
  function collect(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(table) === 'onCopyCapture') copy = ((node.initializer as ts.JsxExpression).expression!).getText(table)
    if (ts.isVariableDeclaration(node) && node.name.getText(table) === 'quote') quote = node.initializer!.getText(table)
    ts.forEachChild(node, collect)
  }
  collect(table)
  const setData = vi.fn()
  Object.assign(context, { anchor: { row: 0, col: 0 }, end: { row: 0, col: 1 }, fields: ['pallet', 'material:length'],
    cellAt: ({ col }: { col: number }) => col === 0 ? { querySelectorAll: () => [{ value: item.pallet, closest: () => null }] } : null,
    event: { target: { closest: () => null }, preventDefault: vi.fn(), clipboardData: { setData } },
  })
  runInContext(compile(`const valueAt = mergedCellValue; const quote = ${quote}; const copy = ${copy}; copy(event)`), context)
  expect(parseSheetClipboard(setData.mock.calls[0][1])).toEqual([['1-3/4卡\n8-9/9卡', '']])
  expect(item.pallet).toBe('1-3/4卡 8-9/9卡')
})
