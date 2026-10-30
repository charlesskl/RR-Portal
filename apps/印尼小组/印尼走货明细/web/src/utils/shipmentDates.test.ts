import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { shipmentDateOnly, shipmentPurchaseDates } from './shipmentDates'
import { shipmentSheetFields } from './shipmentSheet'

const page = ts.createSourceFile('page.tsx', readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['mergedCellValue', 'sheetDisplayValue'].includes(node.name?.text || '')) handlers.push(node.getText(page))
  ts.forEachChild(node, collect)
}
collect(page)
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const row = {
  material_id: 1, po_date: '2026-09-28T00:00:00',
  contract_date: '2026-10-06T23:30:00-08:00', invoice_date: '2026-10-07T00:00:00Z',
}
function setup() {
  const source = { ...row }
  const context = createContext({ shipmentDateOnly, shipmentPurchaseDates, shipmentSheetFields,
    consolidatedItems: [{ ...source, sources: [source] }], matMap: new Map(),
  })
  runInContext(compile(handlers.join('\n')), context)
  return { context, source }
}

it.each([
  ['po_date', '2026-09-28'], ['contract_date', '2026-10-06'], ['invoice_date', '2026-10-07'],
])('未激活的 %s 单元格及复制/填充值仅含日期，保留业务日不做时区换日', (field, expected) => {
  const { context, source } = setup()
  context.field = field
  context.col = shipmentSheetFields.indexOf(field as typeof shipmentSheetFields[number])
  expect(runInContext('mergedCellValue(0, field)', context)).toBe(expected)
  expect(runInContext('sheetDisplayValue(0, col)', context)).toBe(expected)
  expect(source).toEqual(row)
  expect(context.consolidatedItems[0]).toMatchObject(row)
})

it('合并采购日期去重，采购、合同和发票的空日期均显示为空', () => {
  const { context } = setup()
  context.consolidatedItems[0].sources.push({ ...row, po_date: '2026-10-06T00:00:00Z' }, { ...row, po_date: '2026-09-28T23:00:00-08:00' })
  expect(runInContext("mergedCellValue(0, 'po_date')", context)).toBe('2026-09-28 / 2026-10-06')
  for (const field of ['po_date', 'contract_date', 'invoice_date'] as const) {
    context.consolidatedItems[0][field] = ''
    context.consolidatedItems[0].sources = []
    context.field = field
    expect(runInContext('mergedCellValue(0, field)', context)).toBe('')
  }
})

it('实际多格复制读取格式化日期，未挂载的单元格也不泄漏时间后缀', () => {
  const { context } = setup()
  const table = ts.createSourceFile('table.tsx', readFileSync(new URL('../components/ShipmentSheetTable.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let copy = ''
  function walk(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(table) === 'onCopyCapture') copy = ((node.initializer as ts.JsxExpression).expression!).getText(table)
    ts.forEachChild(node, walk)
  }
  walk(table)
  const setData = vi.fn()
  Object.assign(context, { anchor: { row: 0, col: 0 }, end: { row: 0, col: 2 },
    fields: ['po_date', 'contract_date', 'invoice_date'], cellAt: () => null,
    quote: (value: string) => value,
    event: { target: { closest: () => null }, preventDefault: vi.fn(), clipboardData: { setData } },
  })
  runInContext(compile(`const valueAt = mergedCellValue; const copy = ${copy}; copy(event)`), context)
  expect(setData).toHaveBeenCalledExactlyOnceWith('text/plain', '2026-09-28\t2026-10-06\t2026-10-07')
})
