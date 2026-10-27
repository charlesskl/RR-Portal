import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { applyShipmentSheetEdits } from './shipmentSheet'

// Execute the actual page confirmation handler: no API writes occur on paste.
const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler = ''
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'editSheetCells') handler = node.getText(tree)
  ts.forEachChild(node, collect)
}
collect(tree)
const executable = ts.transpileModule(handler, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText
function setup() {
  const items = [{ _rowKey: 1, outbound_id: 7, material_id: 2, qty: 10 }]
  const matMap = new Map([[2, { net_per_pc: .2, unit_kg: 'KGM' }]])
  const state = {
    items, matMap, applyShipmentSheetEdits, customsOptions: [{ value: '已配置公司' }],
    sheetRevision: { current: { rawItems: items, matMap } }, sheetConfirmOpen: { current: false },
    Modal: { confirm: vi.fn() }, React: { createElement: () => null }, Space: {}, Typography: { Text: {} },
    setItems: vi.fn(), setMatMap: vi.fn(), setDirtyMatIds: vi.fn(), setEditorDirty: vi.fn(),
    message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  }
  const context = createContext(state)
  runInContext(executable, context)
  const edit = (field = 'qty', value = '20') => {
    context.edits = [{ row: 0, field, value }]
    runInContext('editSheetCells(edits)', context)
  }
  return { state, edit }
}
it('validates, confirms once, and only changes editor state after confirmation', () => {
  const { state, edit } = setup()
  edit(); edit()
  expect(state.Modal.confirm).toHaveBeenCalledTimes(1)
  expect(state.setItems).not.toHaveBeenCalled()
  const modal = state.Modal.confirm.mock.calls[0][0]
  modal.onOk()
  expect(state.setItems.mock.calls[0][0][0]).toMatchObject({ outbound_id: 7, material_id: 2, qty: 20, kg: 4 })
  expect(state.setEditorDirty).toHaveBeenCalledWith(true)
  expect(state.setMatMap).not.toHaveBeenCalled()
  modal.afterClose()
  expect(state.sheetConfirmOpen.current).toBe(false)
})
it('rejects stale confirmation after rows change rather than overwriting newer edits', () => {
  const { state, edit } = setup()
  edit()
  state.sheetRevision.current.rawItems = [...state.items]
  state.Modal.confirm.mock.calls[0][0].onOk()
  expect(state.setItems).not.toHaveBeenCalled()
  expect(state.message.warning).toHaveBeenCalled()
})
it('rejects invalid values and unknown customs companies without opening confirmation', () => {
  const { state, edit } = setup()
  edit('qty', '-1'); edit('customs_company', '未知公司')
  expect(state.Modal.confirm).not.toHaveBeenCalled()
  expect(state.setItems).not.toHaveBeenCalled()
  expect(state.message.error).toHaveBeenCalledTimes(2)
})
it('closing confirmation without accepting leaves editor unchanged', () => {
  const { state, edit } = setup()
  edit('material:net_per_pc', '.5')
  state.Modal.confirm.mock.calls[0][0].afterClose()
  expect(state.setItems).not.toHaveBeenCalled()
  expect(state.setMatMap).not.toHaveBeenCalled()
  expect(state.matMap.get(2)?.net_per_pc).toBe(.2)
})
