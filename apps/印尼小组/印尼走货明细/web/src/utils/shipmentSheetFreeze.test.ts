import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import React, { cloneElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { shipmentFrozenColumns, shipmentFrozenRowSpan } from './shipmentSheetFreeze'

it('custom frozen columns replace default fixed columns without mutating the definitions', () => {
  const columns = [{ fixed: 'left', width: 50 }, { width: 100 }, { fixed: 'left', width: 160 }, { fixed: 'right', width: 40 }]
  expect(shipmentFrozenColumns(columns, null)).toEqual(columns)
  expect(shipmentFrozenColumns(columns, 1).map(column => column.fixed)).toEqual(['left', 'left', undefined, 'right'])
  expect(shipmentFrozenColumns(columns, -1).map(column => column.fixed)).toEqual([undefined, undefined, undefined, undefined])
  expect(columns[2].fixed).toBe('left')
})

it('shared cartons crossing the frozen boundary split into valid adjacent spans on both sides', () => {
  const spanAt = (row: number) => [1, 4, 0, 0, 0, 1][row]
  expect(Array.from({ length: 6 }, (_, row) => shipmentFrozenRowSpan(row, 3, spanAt))).toEqual([1, 2, 0, 2, 0, 1])
  expect(Array.from({ length: 6 }, (_, row) => shipmentFrozenRowSpan(row, 0, spanAt))).toEqual([1, 4, 0, 0, 0, 1])
})

// Exercise the actual table's render/index/selection handlers with synthetic
// records; freezing remains a view change and never calls the business API.
const source = readFileSync(new URL('../components/ShipmentSheetTable.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ShipmentSheetTable.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const variables = new Map<string, string>()
let summary = '', dataSource = '', keyboard = ''
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.initializer) variables.set(node.name.getText(tree), node.initializer.getText(tree))
  if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
    const value = node.initializer.expression.getText(tree)
    if (node.name.getText(tree) === 'summary') summary = value
    if (node.name.getText(tree) === 'dataSource') dataSource = value
    if (node.name.getText(tree) === 'onKeyDownCapture') keyboard = value
  }
  ts.forEachChild(node, visit)
}
visit(tree)
function fixture() {
  const records = Array.from({ length: 6 }, (_, index) => ({ key: `row-${index}`, name: `Item ${index}`, qty: index + 10 }))
  const Row = ({ children }: any) => React.createElement('tr', null, children)
  const Cell = ({ children, rowSpan }: any) => React.createElement('td', { rowSpan }, children)
  const Summary = ({ children }: any) => React.createElement('tbody', null, children)
  Summary.Row = Row; Summary.Cell = Cell
  const Checkbox = (props: any) => React.createElement('input', { type: 'checkbox', checked: props.checked, readOnly: true, 'aria-label': props['aria-label'] })
  const state: any = {
    React, cloneElement, isValidElement, shipmentFrozenColumns, shipmentFrozenRowSpan, Table: { Summary }, Checkbox,
    props: { dataSource: records, rowKey: 'key', rowSelection: { selectedRowKeys: ['row-0'], onChange: vi.fn() } },
    frozen: { rows: 2, col: 0 }, count: records.length, frozenRows: 2,
    fields: ['', 'name', 'qty'], widths: {}, editingCell: null, anchor: null,
    columns: [
      { width: 50, title: '序号', render: (_value: unknown, _record: object, row: number) => row + 1 },
      { width: 160, title: '名称', dataIndex: 'name', render: (value: unknown) => String(value) },
      { width: 100, title: '数量', dataIndex: 'qty', render: (value: unknown) => String(value) },
    ],
    canEdit: () => false, displayAt: () => '', inSelection: () => false,
    editableAt: () => true, message: { info: vi.fn() },
  }
  state.setFrozen = (value: any) => { state.frozen = typeof value === 'function' ? value(state.frozen) : value }
  const context = createContext(state)
  const run = (code: string) => runInContext(ts.transpileModule(code, {
    fileName: 'test.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, context)
  for (const name of ['rowSpanAt', 'mapped', 'freezeAtSelection', 'recordKey', 'selectedKeys', 'updateSelection', 'rowSelection'])
    run(`var ${name} = ${variables.get(name)}`)
  return { state, run, records }
}

it('frozen summary rows retain logical cell indexes, body rows are not duplicated, and row selection includes all records', () => {
  const f = fixture(), before = structuredClone(f.records)
  const html = renderToStaticMarkup(React.createElement('table', null, f.run(`(${summary})()`)))
  expect(html).toContain('data-sheet-row="0"')
  expect(html).toContain('data-sheet-row="1"')
  expect(html).toContain('Item 0'); expect(html).toContain('Item 1'); expect(html).not.toContain('Item 2')
  expect(f.run(dataSource)).toEqual(f.records.slice(2))
  expect(f.run('mapped[1].onCell(props.dataSource[2], 0)')['data-sheet-row']).toBe(2)
  expect(f.run('mapped[0].render(undefined, props.dataSource[2], 0)')).toBe(3)
  f.run('rowSelection.columnTitle.props.onChange({target:{checked:true}})')
  expect(f.state.props.rowSelection.onChange).toHaveBeenCalledWith(f.records.map(row => row.key), f.records, { type: 'all' })
  f.run('updateSelection(["row-0", "row-3"], "single")')
  expect(f.state.props.rowSelection.onChange).toHaveBeenLastCalledWith(['row-0', 'row-3'], [f.records[0], f.records[3]], { type: 'single' })
  expect(f.records).toEqual(before)
})

it('freeze from selection uses only the rows above and columns left, and navigation back into pinned rows stays in bounds', () => {
  const f = fixture()
  f.state.anchor = { row: 3, col: 2 }
  f.run('freezeAtSelection("both")')
  expect(f.state.frozen).toEqual({ rows: 3, col: 1 })
  f.state.anchor = { row: 0, col: 0 }
  f.run('freezeAtSelection("both")')
  expect(f.state.frozen).toEqual({ rows: 0, col: -1 })
  f.state.anchor = { row: 2, col: 2 }; f.state.editingCell = null
  const focus = vi.fn()
  Object.assign(f.state, {
    point: () => null, cellAt: () => null, batchPending: { current: false },
    sheetArrowKeys: new Set(['ArrowUp']), sheetArrowPoint: (p: any) => ({ row: p.row - 1, col: p.col }),
    sheetArrowUsesEditor: () => false, focus, hasCell: () => true,
    event: { key: 'ArrowUp', target: { closest: () => null, getAttribute: () => null }, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() },
  })
  f.run(`(${keyboard})(event)`)
  expect(focus).toHaveBeenCalledWith({ row: 1, col: 2 }, false)
})
