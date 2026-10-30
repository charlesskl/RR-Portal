import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { sheetClearSelectionEdits } from './shipmentSheet'
import { applyMergedShipmentEdits, mergedReadOnlyFields } from './shipmentMergedEditor'
import { consolidateShipmentItems } from './shipmentConsolidation'

it('正向及反向矩形选择均清空全部可编辑格，包括未挂载的虚拟行', () => {
  const fields = ['cartons', 'pallet', 'contract_date']
  const forward = sheetClearSelectionEdits({ row: 0, col: 0 }, { row: 67, col: 2 }, 68, fields)
  expect(forward).toHaveLength(204)
  expect(forward[0]).toEqual({ row: 0, field: 'cartons', value: '' })
  expect(forward.at(-1)).toEqual({ row: 67, field: 'contract_date', value: '' })
  expect(sheetClearSelectionEdits({ row: 67, col: 2 }, { row: 0, col: 0 }, 68, fields)).toEqual(forward)
})

it('只跳过只读、必填单位/币种及动态受保护格，不移动相邻列、不删除明细行', () => {
  const fields = ['', 'material:unit_kg', 'currency', 'cartons', 'qty']
  expect(sheetClearSelectionEdits({ row: 0, col: 0 }, { row: 1, col: 4 }, 2, fields,
    (row, field) => !(row === 0 && field === 'qty'))).toEqual([
    { row: 0, field: 'cartons', value: '' },
    { row: 1, field: 'cartons', value: '' }, { row: 1, field: 'qty', value: '' },
  ])
})

it('单格也可清空；无选区、过期坐标、全保护格和过大范围明确拒绝', () => {
  expect(sheetClearSelectionEdits({ row: 0, col: 0 }, { row: 0, col: 0 }, 1, ['pallet']))
    .toEqual([{ row: 0, field: 'pallet', value: '' }])
  expect(() => sheetClearSelectionEdits(null, null, 1, ['pallet'])).toThrow('请先选择')
  expect(() => sheetClearSelectionEdits({ row: 0, col: 0 }, { row: 1, col: 0 }, 1, ['pallet'])).toThrow('重新选择')
  expect(() => sheetClearSelectionEdits({ row: 0, col: 0 }, { row: 0, col: 1 }, 1, ['', 'currency'])).toThrow('没有可清空')
  expect(() => sheetClearSelectionEdits({ row: 0, col: 0 }, { row: 10000, col: 0 }, 10001, ['pallet'])).toThrow('10000')
})

it('选中箱数、文字及日期经实际合并编辑链清空，源行数量、金额和关联保留', () => {
  const materials = new Map([[1, { unit_kg: 'KGM' }], [2, { unit_kg: 'KGM' }]])
  const items = [1, 2, 3].map((_rowKey, i) => ({ _rowKey, material_id: i < 2 ? 1 : 2,
    outbound_id: 70 + i, qty: 100, kg: 2, price: 3, cartons: i + 1, pallet: '1卡',
    contract_date: '2026-10-30', po_no: 'PO-' + i, po_date: '2026-10-01',
  }))
  const original = structuredClone(items)
  const rows = consolidateShipmentItems(items, materials)
  const fields = ['qty', 'kg', 'po_no', 'po_date', 'cartons', 'pallet', 'contract_date']
  const edits = sheetClearSelectionEdits({ row: 0, col: 0 }, { row: 0, col: 6 }, rows.length, fields,
    (row, field) => !(rows[row].sources.length > 1 && mergedReadOnlyFields.has(field)))
  const result = applyMergedShipmentEdits(items, materials, rows, edits)
  expect(result.items).toHaveLength(3)
  expect(result.items.slice(0, 2)).toEqual(original.slice(0, 2).map(row => ({ ...row, cartons: 0, pallet: '', contract_date: '' })))
  expect(result.items[2]).toEqual(original[2])
  expect(items).toEqual(original)
})

const table = ts.createSourceFile('table.tsx', readFileSync(new URL('../components/ShipmentSheetTable.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let clear = '', batch = ''
function walk(node: ts.Node) {
  if (ts.isVariableDeclaration(node)) {
    if (node.name.getText(table) === 'clearSelection') clear = node.initializer!.getText(table)
    if (node.name.getText(table) === 'runBatch') batch = node.initializer!.getText(table)
  }
  ts.forEachChild(node, walk)
}
walk(table)
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

it('实际清空按钮接入草稿提交和批量校验，使用最新保护规则，跳过合并隐藏格', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let pending!: Promise<void>
  const onEdits = vi.fn()
  const context = createContext({
    anchor: { row: 0, col: 0 }, end: { row: 2, col: 1 }, count: 3, fields: ['cartons', 'qty'],
    sheetClearSelectionEdits, hasCell: ({ row, col }: { row: number; col: number }) => !(row === 1 && col === 0),
    batchPending: { current: false }, drafts: { current: new Set<() => Promise<boolean>>() },
    latest: { current: { rowOrder: '1,2,3', onEdits, editableAt: (_row: number, _field: string) => { void _row; void _field; return true } } },
    message: { error: vi.fn(), info: vi.fn() },
  })
  context.drafts.current.add(async () => {
    await gate
    context.latest.current.editableAt = (_row: number, field: string) => field !== 'qty'
    return true
  })
  runInContext(compile(`const actualBatch = ${batch}; const clearSelection = ${clear}`), context)
  context.runBatch = (build: unknown) => { context.build = build; pending = runInContext('actualBatch(build)', context); return pending }
  runInContext('clearSelection()', context)
  expect(onEdits).not.toHaveBeenCalled()
  release(); await pending
  expect(onEdits).toHaveBeenCalledExactlyOnceWith([
    { row: 0, field: 'cartons', value: '' }, { row: 2, field: 'cartons', value: '' },
  ])
  expect(context.message.error).not.toHaveBeenCalled()
  expect(table.text).toContain('onClick={clearSelection}')
  expect(table.text).toContain('清空选区</Button>')
})
