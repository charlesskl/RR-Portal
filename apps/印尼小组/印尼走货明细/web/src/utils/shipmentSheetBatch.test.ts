import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { parseSheetClipboard, sheetFillDownEdits, sheetPasteSelectionEdits } from './shipmentSheet'
import { applyMergedShipmentEdits } from './shipmentMergedEditor'

const table = ts.createSourceFile('table.tsx', readFileSync(new URL('../components/ShipmentSheetTable.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let batch = '', click = '', registration = '', fill = ''
function collect(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(table) === 'runBatch') batch = node.initializer!.getText(table)
  if (ts.isVariableDeclaration(node) && node.name.getText(table) === 'registerDraft') registration = (node.initializer as ts.CallExpression).arguments[0].getText(table)
  if (ts.isVariableDeclaration(node) && node.name.getText(table) === 'fillFrom') fill = node.initializer!.getText(table)
  if (ts.isJsxAttribute(node) && node.name.getText(table) === 'onClickCapture') click = ((node.initializer as ts.JsxExpression).expression!).getText(table)
  ts.forEachChild(node, collect)
}
collect(table)
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText

it.each([false, true])('Shift 多选不更换锚点；虚拟锚点离屏时将焦点留在表格根节点（离屏=%s）', offscreen => {
  const root = { contains: () => !offscreen, focus: vi.fn() }, setEnd = vi.fn(), setAnchor = vi.fn()
  const context = createContext({ anchor: { row: 0, col: 0 }, batchPending: { current: false },
    suppressClick: { current: false }, pendingFocus: { current: null },
    point: () => ({ row: 67, col: 0 }), root: { current: root }, document: { activeElement: {} },
    setEnd, setAnchor, setEditingCell: vi.fn(), focus: vi.fn(),
    event: { shiftKey: true, target: { closest: () => null }, preventDefault: vi.fn(), stopPropagation: vi.fn() } })
  runInContext(compile(`(${click})(event)`), context)
  expect(setEnd).toHaveBeenCalledWith({ row: 67, col: 0 })
  expect(setAnchor).not.toHaveBeenCalled()
  expect(context.focus).not.toHaveBeenCalled()
  expect(root.focus).toHaveBeenCalledTimes(offscreen ? 1 : 0)
})

it('小蓝点及拖拽填充同样经由草稿提交后的最新数据，非法目标不填充', () => {
  const edits = vi.fn()
  const context = createContext({ fields: ['contract_no'], count: 3, sheetFillDownEdits,
    runBatch: (build: (values: any) => unknown) => edits(build({ valueAt: () => 'NEW DRAFT' })) })
  runInContext(compile(`const fillFrom = ${fill}; fillFrom(0,2,'contract_no')`), context)
  expect(edits).toHaveBeenCalledExactlyOnceWith([1, 2].map(row => ({ row, field: 'contract_no', value: 'NEW DRAFT' })))
  expect(() => runInContext("fillFrom(2,0,'contract_no')", context)).toThrow('向下')
  expect(edits).toHaveBeenCalledTimes(1)
})

it('实际小蓝点组件的点击和拖拽都使用表格的受保护填充，而非页面旧闭包', () => {
  const pageTree = ts.createSourceFile('page.tsx', readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const component = pageTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'FillableShipmentCell')!
  const batchFill = vi.fn(), legacyFill = vi.fn(), legacyToEnd = vi.fn()
  const context = createContext({ ShipmentSheetFillContext: {}, useContext: () => batchFill,
    React: { createElement: (tag: any, props: any, ...children: any[]) => ({ tag, props, children }) },
    props: { rowIndex: 0, rowCount: 3, field: 'contract_no', onFill: legacyFill, onFillToEnd: legacyToEnd, children: null } })
  runInContext(compile(component.getText(pageTree)), context)
  const cell = runInContext('FillableShipmentCell(props)', context)
  const dot = cell.children.at(-1)
  dot.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() })
  expect(batchFill).toHaveBeenLastCalledWith(0, 2, 'contract_no')
  cell.props.onDrop({ preventDefault: vi.fn(), dataTransfer: { getData: () => JSON.stringify({ field: 'contract_no', rowIndex: 0 }) } })
  expect(batchFill).toHaveBeenLastCalledWith(0, 0, 'contract_no')
  expect(legacyFill).not.toHaveBeenCalled(); expect(legacyToEnd).not.toHaveBeenCalled()
})

it('一个值填充反向选中的多行多列，保留前导零与多行内容', () => {
  const value = '00123\n第二行'
  const edits = sheetPasteSelectionEdits(parseSheetClipboard('"' + value + '"'), { row: 2, col: 1 }, { row: 0, col: 0 }, 3, ['contract_no', 'invoice_no'])
  expect(edits).toHaveLength(6)
  expect(edits.every(edit => edit.value === value)).toBe(true)
  expect(edits[0]).toEqual({ row: 0, field: 'contract_no', value })
  expect(edits.at(-1)).toEqual({ row: 2, field: 'invoice_no', value })
})
it('多格矩阵从反向选区左上角开始，受保护列、越界和超大选区整批拒绝', () => {
  expect(sheetPasteSelectionEdits([['A', 'B'], ['C', 'D']], { row: 1, col: 1 }, { row: 0, col: 0 }, 3, ['contract_no', 'invoice_no']))
    .toEqual([
      { row: 0, field: 'contract_no', value: 'A' }, { row: 0, field: 'invoice_no', value: 'B' },
      { row: 1, field: 'contract_no', value: 'C' }, { row: 1, field: 'invoice_no', value: 'D' },
    ])
  expect(() => sheetPasteSelectionEdits([['A']], { row: 0, col: 0 }, { row: 1, col: 1 }, 3, ['', 'invoice_no'])).toThrow('受保护')
  expect(() => sheetPasteSelectionEdits([['A']], { row: 0, col: 0 }, { row: 3, col: 0 }, 3, ['contract_no'])).toThrow('超出')
  expect(() => sheetPasteSelectionEdits([['A']], { row: 0, col: 0 }, { row: 10000, col: 0 }, 10001, ['contract_no'])).toThrow('10000')
})

it('2行2列复制到4行4列时按原布局重复，所有值及空白均不串列', () => {
  const fields = ['contract_no', 'invoice_no', 'product_use', 'formula_name']
  const edits = sheetPasteSelectionEdits([['A', ''], ['00123', '第二行']], { row: 3, col: 3 }, { row: 0, col: 0 }, 4, fields)
  const values = Array.from({ length: 4 }, (_, row) => fields.map(field => edits.find(edit => edit.row === row && edit.field === field)?.value))
  expect(values).toEqual([
    ['A', '', 'A', ''], ['00123', '第二行', '00123', '第二行'],
    ['A', '', 'A', ''], ['00123', '第二行', '00123', '第二行'],
  ])
})
it.each([
  [[['A'], ['B']], 4, 1, ['A', 'B', 'A', 'B']],
  [[['A', 'B']], 1, 4, ['A', 'B', 'A', 'B']],
])('支持多行单列或单行多列区域重复：%j', (matrix, rows, cols, expected) => {
  const fields = ['contract_no', 'invoice_no', 'product_use', 'formula_name']
  const edits = sheetPasteSelectionEdits(matrix as string[][], { row: 0, col: 0 }, { row: Number(rows) - 1, col: Number(cols) - 1 }, Number(rows), fields)
  expect(edits.map(edit => edit.value)).toEqual(expected)
})
it('只点一个目标格时按复制区域完整展开，不要求目标预先选中同样大小', () => {
  expect(sheetPasteSelectionEdits([['A', 'B'], ['C', 'D']], { row: 1, col: 0 }, { row: 1, col: 0 }, 3, ['contract_no', 'invoice_no']))
    .toEqual([
      { row: 1, field: 'contract_no', value: 'A' }, { row: 1, field: 'invoice_no', value: 'B' },
      { row: 2, field: 'contract_no', value: 'C' }, { row: 2, field: 'invoice_no', value: 'D' },
    ])
})
it('目标选区过小、不整倍数或源区域不规整时整批拒绝，保护列仍不能覆盖', () => {
  const fields = ['contract_no', 'invoice_no', 'product_use', 'formula_name']
  for (const end of [{ row: 2, col: 1 }, { row: 1, col: 2 }, { row: 0, col: 1 }])
    expect(() => sheetPasteSelectionEdits([['A', 'B'], ['C', 'D']], { row: 0, col: 0 }, end, 4, fields)).toThrow('整倍数')
  expect(() => sheetPasteSelectionEdits([['A', 'B'], ['C']], { row: 0, col: 0 }, { row: 3, col: 3 }, 4, fields)).toThrow('矩形')
  expect(() => sheetPasteSelectionEdits([['A', 'B']], { row: 0, col: 0 }, { row: 1, col: 3 }, 4, ['contract_no', 'invoice_no', '', 'formula_name'])).toThrow('受保护')
})

function setup() {
  const state = {
    batchPending: { current: false }, drafts: { current: new Set<() => boolean | Promise<boolean>>() },
    latest: { current: { rowOrder: '1,2', valueAt: () => 'OLD', onEdits: vi.fn() } },
    message: { error: vi.fn(), info: vi.fn() }, sheetFillDownEdits,
  }
  const context = createContext(state)
  runInContext(compile(`const runBatch = ${batch}`), context)
  const run = () => runInContext("runBatch(values => sheetFillDownEdits({row:0,col:0},{row:1,col:0},2,['contract_no'],values.valueAt))", context) as Promise<void>
  return { state, context, run }
}
it('等待未提交草稿，防重复触发，并使用提交后最新的 valueAt/onEdits', async () => {
  const { state, run } = setup()
  let resolve!: () => void
  const gate = new Promise<void>(done => { resolve = done })
  const onEdits = vi.fn()
  state.drafts.current.add(async () => {
    await gate
    state.latest.current = { rowOrder: '1,2', valueAt: () => 'NEW', onEdits }
    return true
  })
  const original = state.latest.current.onEdits
  const first = run(); await run()
  expect(state.batchPending.current).toBe(true)
  expect(original).not.toHaveBeenCalled(); expect(onEdits).not.toHaveBeenCalled()
  resolve(); await first
  expect(onEdits).toHaveBeenCalledExactlyOnceWith([{ row: 1, field: 'contract_no', value: 'NEW' }])
  expect(state.batchPending.current).toBe(false)
})
it('数字行滚动卸载后仍保留正在校验的提交，完成后解除注册', async () => {
  const { state, context, run } = setup()
  runInContext(compile(`const registerDraft = ${registration}`), context)
  let finish!: () => void
  const pending = new Promise<boolean>(resolve => { finish = () => resolve(true) })
  context.commit = () => pending; context.pending = () => pending
  const unregister = runInContext('registerDraft(commit, pending)', context)
  unregister()
  expect(state.drafts.current.size).toBe(1)
  const batch = run()
  expect(state.latest.current.onEdits).not.toHaveBeenCalled()
  finish(); await batch
  expect(state.drafts.current.size).toBe(0)
  expect(state.latest.current.onEdits).toHaveBeenCalledOnce()
})
it.each(['invalid', 'reorder', 'error'])('草稿拒绝、顺序变化或异常时不执行批量操作，输入不被写入错误行：%s', async kind => {
  const { state, run } = setup()
  state.drafts.current.add(() => {
    if (kind === 'error') throw Error('invalid draft')
    if (kind === 'reorder') state.latest.current.rowOrder = '2,1'
    return kind !== 'invalid'
  })
  await run()
  expect(state.latest.current.onEdits).not.toHaveBeenCalled()
  expect(state.batchPending.current).toBe(false)
  if (kind === 'reorder') expect(state.message.info).toHaveBeenCalledWith(expect.stringContaining('当前输入已保留'))
  if (kind === 'error') expect(state.message.error).toHaveBeenCalledWith('invalid draft')
})

it('批量数量校验完成前保持防重复锁，异步失败也解除锁并提示', async () => {
  const { state, run } = setup()
  let reject!: (error: Error) => void
  state.latest.current.onEdits.mockImplementation(() => new Promise((_, fail) => { reject = fail }))
  const pending = run()
  await run()
  expect(state.latest.current.onEdits).toHaveBeenCalledOnce()
  expect(state.batchPending.current).toBe(true)
  reject(new Error('容量校验失败'))
  await pending
  expect(state.message.error).toHaveBeenCalledWith('容量校验失败')
  expect(state.batchPending.current).toBe(false)
})

// Integrate the actual page write with the table batch handler. All
// state and API objects are synthetic; nothing is saved to a business database.
it('先保留源格草稿，再直接填充；无需弹窗且不回退源格', async () => {
  const { state, context, run } = setup()
  const pageTree = ts.createSourceFile('page.tsx', readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const functions: string[] = []
  const read = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && ['writeMergedCells', 'editSheetCells'].includes(node.name?.text || '')) functions.push(node.getText(pageTree))
    ts.forEachChild(node, read)
  }
  read(pageTree)
  const items = [
    { _rowKey: 1, material_id: 1, qty: 10, contract_no: 'OLD' },
    { _rowKey: 2, material_id: 2, qty: 20, contract_no: 'OTHER' },
  ]
  const materials = new Map([[1, { unit_kg: 'KGM', net_per_pc: 1 }], [2, { unit_kg: 'KGM', net_per_pc: 1 }]])
  Object.assign(context, {
    items, matMap: materials, consolidatedItems: items.map(item => ({ ...item, sources: [item] })),
    applyMergedShipmentEdits, customsOptions: [], outRows: [], editing: { id: 1 },
    sheetRevision: { current: { rawItems: items, matMap: materials, session: 1 } }, sheetWritePending: { current: false },
    flushSync: vi.fn((update: () => void) => update()),
    setItems: (next: typeof items) => {
      context.items = next; context.consolidatedItems = next.map(item => ({ ...item, sources: [item] }))
      context.sheetRevision.current.rawItems = next
      state.latest.current = { ...state.latest.current, valueAt: () => next[0].contract_no }
    },
    setMatMap: vi.fn(), setDirtyMatIds: vi.fn(), setEditorDirty: vi.fn(), setSheetEditing: vi.fn(),
    Modal: { confirm: vi.fn() },
    message: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
  })
  runInContext(compile(functions.join('\n')), context)
  state.latest.current.onEdits.mockImplementation(edits => {
    context.edits = edits
    return runInContext('editSheetCells(edits)', context)
  })
  state.drafts.current.add(() => runInContext("writeMergedCells([{row:0,field:'contract_no',value:'NEW DRAFT'}],false,true)", context))
  await run()
  expect(context.flushSync).toHaveBeenCalledOnce()
  expect(context.Modal.confirm).not.toHaveBeenCalled()
  expect(context.items.map((item: any) => item.contract_no)).toEqual(['NEW DRAFT', 'NEW DRAFT'])
})
