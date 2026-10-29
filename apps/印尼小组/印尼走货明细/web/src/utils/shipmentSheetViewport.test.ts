import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import React, { cloneElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { sheetFillDownEdits } from './shipmentSheet'

const source = readFileSync(new URL('../components/ShipmentSheetTable.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('table.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let columns = '', hasCell = '', copy = '', paste = '', layout = ''
function collect(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'mapped') columns = node.initializer!.getText(tree)
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'hasCell') hasCell = node.initializer!.getText(tree)
  if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'onCopyCapture') copy = ((node.initializer as ts.JsxExpression).expression!).getText(tree)
  if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'onPasteCapture') paste = ((node.initializer as ts.JsxExpression).expression!).getText(tree)
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useLayoutEffect') layout = node.arguments[0].getText(tree)
  ts.forEachChild(node, collect)
}
collect(tree)
const transpile = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText

it('68 x 47 cells mount no inactive inputs, and exactly one active editor', () => {
  const mounted = vi.fn()
  function Editor() { mounted(); return React.createElement('input', { defaultValue: 'test' }) }
  function Fillable(props: any) { return React.createElement('div', null, props.children, React.createElement('span', null, '↓')) }
  const fields = Array.from({ length: 47 }, (_, i) => `field${i}`)
  const state = {
    React, cloneElement, isValidElement, editingCell: null as { row: number; col: number } | null,
    canEdit: () => true, displayAt: (row: number, col: number) => `R${row}C${col}`, widths: {},
    columns: fields.map((_, col) => ({ width: 120, title: col, render: () => React.createElement(Fillable, { onFill: () => {} }, React.createElement(Editor)) })),
    inSelection: () => false, editableAt: () => true, fields,
  }
  const context = createContext(state)
  const render = () => {
    runInContext(transpile(`const mapped = ${columns}`), context)
    const mapped = runInContext('mapped', context)
    const cells = Array.from({ length: 68 }, (_, row) => mapped.map((col: any, index: number) => React.createElement('div', { key: `${row}-${index}` }, col.render(undefined, {}, row)))).flat()
    return renderToStaticMarkup(React.createElement('div', null, cells))
  }
  expect(render()).not.toContain('<input')
  expect(mounted).not.toHaveBeenCalled()
  // Re-evaluate in a fresh context (const mapped is deliberately not reassigned).
  state.editingCell = { row: 67, col: 46 }
  const active = createContext({ ...state })
  runInContext(transpile(`const mapped = ${columns}`), active)
  const mapped = runInContext('mapped', active)
  for (let row = 0; row < 68; row++) for (let col = 0; col < 47; col++)
    renderToStaticMarkup(React.createElement('div', null, mapped[col].render(undefined, {}, row)))
  expect(mounted).toHaveBeenCalledTimes(1)
})

it('logical navigation includes unmounted rows and skips merged-away cells', () => {
  const context = createContext({ props: { dataSource: Array.from({ length: 68 }, () => ({})) },
    columns: [{ onCell: (_row: object, index: number) => ({ rowSpan: index === 40 ? 0 : 1 }) }] })
  runInContext(transpile(`const hasCell = ${hasCell}`), context)
  expect(runInContext('hasCell({ row: 67, col: 0 })', context)).toBe(true)
  expect(runInContext('hasCell({ row: 40, col: 0 })', context)).toBe(false)
  expect(runInContext('hasCell({ row: 68, col: 0 })', context)).toBe(false)
})

it('copy includes protected and editable data from all offscreen selected rows', () => {
  const setData = vi.fn()
  const context = createContext({
    anchor: { row: 0, col: 0 }, end: { row: 67, col: 1 }, fields: ['', 'contract_no'],
    valueAt: (row: number) => `CONTRACT-${row + 1}`, displayAt: (row: number) => `物料${row + 1}`,
    cellAt: () => null, cellText: () => '', quote: (value: string) => value,
    event: { target: { closest: () => null }, preventDefault: vi.fn(), clipboardData: { setData } },
  })
  runInContext(transpile(`const copy = ${copy}; copy(event)`), context)
  const text = setData.mock.calls[0][1] as string
  expect(text.split('\n')).toHaveLength(68)
  expect(text.split('\n')[0]).toBe('物料1\tCONTRACT-1')
  expect(text.split('\n').at(-1)).toBe('物料68\tCONTRACT-68')
  expect(sheetFillDownEdits({ row: 0, col: 0 }, { row: 67, col: 0 }, 68, ['contract_no'], () => 'TOP')).toHaveLength(67)
})

it('single-cell paste on an inactive cell uses validated sheet edits instead of disappearing', () => {
  const onEdits = vi.fn(), parseSheetClipboard = vi.fn(() => [['VALUE']]), sheetPasteEdits = vi.fn(() => [{ row: 67, field: 'contract_no', value: 'VALUE' }])
  const context = createContext({ point: () => ({ row: 67, col: 0 }), anchor: null, fields: ['contract_no'], count: 68,
    onEdits, parseSheetClipboard, sheetPasteEdits, message: { error: vi.fn() },
    event: { target: { closest: () => null }, preventDefault: vi.fn(), stopPropagation: vi.fn(), clipboardData: { getData: () => 'VALUE' } } })
  runInContext(transpile(`const paste = ${paste}; paste(event)`), context)
  expect(onEdits).toHaveBeenCalledWith([{ row: 67, field: 'contract_no', value: 'VALUE' }])
})

it('the real table enables native row virtualization with numeric viewport dimensions', () => {
  expect(source).toMatch(/ref=\{table\} virtual/)
  expect(source).toContain('y: viewportHeight')
  expect(source).toContain('table.current?.scrollTo({ index: p.row })')
  expect(source).toContain('onWheelCapture')
  expect(source).not.toContain('cell.scrollIntoView(')
})

it('focus clears native filler scroll and synchronizes virtual offset with the header', () => {
  const root: any = {}, filler: any = { scrollLeft: 900 }, holder: any = { scrollLeft: 300, clientWidth: 1000 }
  filler.parentElement = holder; holder.parentElement = root
  holder.contains = (node: any) => node === filler || node === holder
  holder.getBoundingClientRect = () => ({ top: 100, bottom: 400 })
  const header = { scrollLeft: 0 }, cell = { parentElement: filler, focus: vi.fn(), getBoundingClientRect: () => ({ top: 120, bottom: 150 }) }
  root.querySelector = (selector: string) => selector === '.ant-table-header' ? header : holder
  const pendingFocus = { current: { point: { row: 67, col: 21 }, edit: false } }
  const scrollTo = vi.fn()
  const context = createContext({ root: { current: root }, pendingFocus, cellAt: () => cell, editorAt: () => null,
    columns: Array.from({ length: 47 }, (_, col) => ({ width: 100, fixed: [0, 4, 5].includes(col) ? 'left' : col === 46 ? 'right' : undefined })),
    widths: {}, props: { rowSelection: {} }, table: { current: { scrollTo } }, cancelAnimationFrame: vi.fn() })
  runInContext(transpile(`const layout = ${layout}; layout()`), context)
  expect(filler.scrollLeft).toBe(0)
  expect(holder.scrollLeft).toBe(0)
  expect(header.scrollLeft).toBe(1340)
  expect(scrollTo).toHaveBeenCalledWith({ left: 1340 })
  expect(cell.focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(pendingFocus.current).toBeNull()
})
