import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { applyMergedShipmentEdits } from './shipmentMergedEditor'

// Execute the actual page batch handler: no confirmation or API writes on paste.
const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['editSheetCells', 'writeMergedCells'].includes(node.name?.text || '')) handlers.push(node.getText(tree))
  ts.forEachChild(node, collect)
}
collect(tree)
const executable = ts.transpileModule(handlers.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText
function setup() {
  const items = [{ _rowKey: 1, outbound_id: 7, material_id: 2, qty: 10 }]
  const matMap = new Map([[2, { net_per_pc: .2, unit_kg: 'KGM' }]])
  const state = {
    items, matMap, applyMergedShipmentEdits, customsOptions: [{ value: '已配置公司' }],
    consolidatedItems: [{ ...items[0], sources: items, outbound_ids: [7] }],
    outRows: [], editing: { id: 9 }, setOutRows: vi.fn(),
    api: { get: vi.fn(async () => ({ data: [{ outbound_id: 7, allocatable_qty: 100 }] })), put: vi.fn(), post: vi.fn() },
    sheetRevision: { current: { rawItems: items, matMap, session: 1 } }, sheetWritePending: { current: false },
    Modal: { confirm: vi.fn() }, React: { createElement: () => null }, Space: {}, Typography: { Text: {} },
    setItems: vi.fn(), setMatMap: vi.fn(), setDirtyMatIds: vi.fn(), setEditorDirty: vi.fn(), setSheetEditing: vi.fn(),
    message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  }
  const context = createContext(state)
  runInContext(executable, context)
  const edit = (field = 'qty', value = '20', confirm = true) => {
    context.edits = [{ row: 0, field, value }]
    return runInContext(confirm ? 'editSheetCells(edits)' : 'writeMergedCells(edits, false)', context) as Promise<boolean>
  }
  return { state, edit }
}
it('validates once and applies immediately without a confirmation or duplicate write', async () => {
  const { state, edit } = setup()
  await Promise.all([edit(), edit()])
  expect(state.Modal.confirm).not.toHaveBeenCalled()
  expect(state.api.get).toHaveBeenCalledOnce()
  expect(state.setItems).toHaveBeenCalledOnce()
  expect(state.setItems.mock.calls[0][0][0]).toMatchObject({ outbound_id: 7, material_id: 2, qty: 20, kg: 4 })
  expect(state.setEditorDirty).toHaveBeenCalledWith(true)
  expect(state.setMatMap).not.toHaveBeenCalled()
  expect(state.api.put).not.toHaveBeenCalled()
  expect(state.api.post).not.toHaveBeenCalled()
  expect(state.sheetWritePending.current).toBe(false)
})
it('rejects stale quantity validation after rows change rather than overwriting newer edits', async () => {
  const { state, edit } = setup()
  const pending = edit()
  state.sheetRevision.current.rawItems = [...state.items]
  expect(await pending).toBe(false)
  expect(state.setItems).not.toHaveBeenCalled()
  expect(state.message.error).toHaveBeenCalled()
})
it('rejects stale quantity validation after material metadata changes, without overwriting either state', async () => {
  const { state, edit } = setup()
  const pending = edit()
  state.sheetRevision.current.matMap = new Map([[2, { net_per_pc: .8, unit_kg: 'KGM' }]])
  expect(await pending).toBe(false)
  expect(state.setItems).not.toHaveBeenCalled()
  expect(state.setMatMap).not.toHaveBeenCalled()
  expect(state.setDirtyMatIds).not.toHaveBeenCalled()
  expect(state.message.error).toHaveBeenCalled()
})
it('rejects invalid values and unknown customs companies without opening confirmation', async () => {
  const { state, edit } = setup()
  await edit('qty', '-1'); await edit('customs_company', '未知公司')
  expect(state.Modal.confirm).not.toHaveBeenCalled()
  expect(state.setItems).not.toHaveBeenCalled()
  expect(state.message.error).toHaveBeenCalledTimes(2)
})
it('material paste updates the draft without a dialog or persistence', async () => {
  const { state, edit } = setup()
  await edit('material:net_per_pc', '.5')
  expect(state.Modal.confirm).not.toHaveBeenCalled()
  expect(state.setItems).toHaveBeenCalledOnce()
  expect(state.setMatMap.mock.calls[0][0].get(2).net_per_pc).toBe(.5)
  expect(state.setDirtyMatIds).toHaveBeenCalledOnce()
  expect(state.api.put).not.toHaveBeenCalled()
  expect(state.api.post).not.toHaveBeenCalled()
  expect(state.matMap.get(2)?.net_per_pc).toBe(.2)
})

it('checks fresh outbound capacity before applying, rejects excess and unlocks subsequent edits', async () => {
  const { state, edit } = setup()
  state.api.get.mockResolvedValue({ data: [{ outbound_id: 7, allocatable_qty: 15 }] })
  expect(await edit()).toBe(false)
  expect(state.api.get).toHaveBeenCalledOnce()
  expect(state.setItems).not.toHaveBeenCalled()
  expect(state.message.error).toHaveBeenCalledWith(expect.stringContaining('OUT-7'))
  expect(state.sheetWritePending.current).toBe(false)
  expect(await edit('contract_no', 'NEXT')).toBe(true)
})

it('does not apply a response to an editor that has been closed or reopened', async () => {
  const { state, edit } = setup()
  const pending = edit()
  state.sheetRevision.current.session++
  expect(await pending).toBe(false)
  expect(state.setItems).not.toHaveBeenCalled()
})

it('direct typing preserves intermediate spaces and newlines in controlled text cells', async () => {
  const { state, edit } = setup()
  state.setItems.mockImplementation(next => {
    state.items = next
    state.consolidatedItems = [{ ...next[0], sources: next, outbound_ids: [7] }]
    state.sheetRevision.current.rawItems = next
  })
  for (const char of 'Royal Regent')
    await edit('contract_no', String((state.items[0] as any).contract_no || '') + char, false)
  for (const char of '1-2\n3-4')
    await edit('pallet', String((state.items[0] as any).pallet || '') + char, false)
  expect(state.items[0]).toMatchObject({ contract_no: 'Royal Regent', pallet: '1-2\n3-4' })
  const before = structuredClone(state.items)
  expect(await edit('contract_no', ' =1+2', false)).toBe(false)
  expect(state.items).toEqual(before)
})

it('文字离格同步写入，紧接着保存/复制时无需等待异步微任务', async () => {
  const { state, edit } = setup()
  const pending = edit('pallet', '1-2/1卡', false)
  expect(state.setItems).toHaveBeenCalledOnce()
  expect(state.setItems.mock.calls[0][0][0]).toMatchObject({ pallet: '1-2/1卡' })
  expect(state.api.get).not.toHaveBeenCalled()
  expect(await pending).toBe(true)
})

it('immediate paste still normalizes text and cannot submit formulas', async () => {
  const { state, edit } = setup()
  await edit('contract_no', ' Royal Regent ')
  expect(state.setItems.mock.calls[0][0][0]).toMatchObject({ contract_no: 'Royal Regent' })
  const writes = state.setItems.mock.calls.length
  expect(await edit('contract_no', ' =1+2')).toBe(false)
  expect(state.setItems).toHaveBeenCalledTimes(writes)
})
