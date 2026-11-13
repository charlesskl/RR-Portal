import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'
import { expect, it, vi } from 'vitest'
import { shipmentLoadError } from './shipmentLoadError'
import { loadShipmentDetail, loadShipmentMaterials } from './shipmentDetailLoad'
import { shipmentDeclarationSaveError } from './shipmentDeclarationSaveValidation'
import { shipmentPackingAverageQty, shipmentWeightQuantity, shipmentKgWeight } from './shipmentWeight'
import { applyMergedShipmentEdits, mergedFieldEditable } from './shipmentMergedEditor'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { shipmentSheetFields, sheetFillDownEdits } from './shipmentSheet'

const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ShipmentsPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = new Set(['recordSheetUndo', 'resetSheetUndo', 'undoSheetEdit', 'redoSheetEdit', 'restoreSheetHistory', 'setItems', 'save', 'closeEditor', 'openEdit',
  'openCreate', 'patchMatDim', 'kgForItem', 'writeMergedCells', 'effectiveWeighingQty', 'requestCloseEditor'])
const functions: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text || '')) functions.push(node.getText(tree))
  ts.forEachChild(node, collect)
}
collect(tree)
const code = ts.transpileModule(functions.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const deferred = <T = any>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

function fixture() {
  const state: any = {
    Map, Set, structuredClone, dayjs, num: (value: any) => Number(value) || 0,
    shipmentDeclarationSaveError, shipmentPackingAverageQty, shipmentWeightQuantity, shipmentKgWeight, applyMergedShipmentEdits, mergedFieldEditable,
    editorSession: { current: 1 }, editorLoadState: { current: 'ready' }, savePending: { current: null },
    unacknowledgedSave: { current: false }, writtenMaterials: { current: new Map() },
    sheetWritePending: { current: false }, sheetEditing: false, saving: false,
    formRevision: { current: 0 }, customerRevision: { current: 0 },
    rawItems: [{ _rowKey: 1, material_id: 8, outbound_id: 4, qty: 1, kg: 1, cartons: 1, price: 5, currency: 'US$', po_no: 'PR1067-PO' }],
    baseMatMap: new Map([[8, { id: 8, name_zh: 'PR1067 Synthetic material', unit_kg: 'KGM', net_per_pc: 1, length: 10 }]]),
    dirtyMatIds: new Set<number>(), editorDirty: true,
    latestUndoState: { current: null }, undoHistory: { current: [] }, redoHistory: { current: [] }, nextRowKey: { current: 1 },
    creating: false, editing: { id: 11, customer: 'RRI', container_no: 'PR1067-A' },
    customValues: { customer: 'RRI', container_no: 'PR1067-A', status: 'draft' },
    customsOptions: [], outRows: [], message: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
    Modal: { confirm: vi.fn() },
    api: { put: vi.fn(async () => ({})), post: vi.fn(async () => ({ data: { id: 777 } })), get: vi.fn() },
    setEditorLoadError: vi.fn(), setEditorViewKey: vi.fn(), shipmentLoadError, loadShipmentDetail, loadShipmentMaterials,
    load: vi.fn(), closeOutboundLink: vi.fn(), setDrawerFull: vi.fn(), setEditorLoad: vi.fn(),
    setUndoCount: vi.fn(), setRedoCount: vi.fn(), setCartonSelection: vi.fn(), setOutRows: vi.fn(),
    flushSync: (fn: () => void) => fn(), setTimeout: (fn: () => void) => fn(),
  }
  state.form = {
    getFieldValue: (key: string) => state.customValues[key],
    setFieldsValue: (values: any) => Object.assign(state.customValues, values),
    resetFields: () => { state.customValues = {} },
    validateFields: vi.fn(async () => ({ ...state.customValues })),
  }
  state.setRawItems = (value: any) => { state.rawItems = typeof value === 'function' ? value(state.rawItems) : value }
  state.setMatMap = (value: any) => { state.baseMatMap = typeof value === 'function' ? value(state.baseMatMap) : value }
  state.setDirtyMatIds = (value: any) => { state.dirtyMatIds = typeof value === 'function' ? value(state.dirtyMatIds) : value }
  state.setEditorDirty = (value: boolean) => { state.editorDirty = value }
  state.setSaving = (value: boolean) => { state.saving = value }
  state.setSheetEditing = (value: boolean) => { state.sheetEditing = value }
  state.setEditing = (value: any) => { state.editing = typeof value === 'function' ? value(state.editing) : value }
  state.setCreating = (value: boolean) => { state.creating = value }
  let lastRaw: any, lastBase: any
  const publish = () => {
    if (state.rawItems !== lastRaw || state.baseMatMap !== lastBase) {
      state.matMap = new Map(state.baseMatMap)
      for (const item of state.rawItems) if (item.material_snapshot && !state.matMap.has(item.material_id)) state.matMap.set(item.material_id, item.material_snapshot)
      state.items = state.rawItems.map((item: any) => ({ ...item }))
      state.consolidatedItems = consolidateShipmentItems(state.items, state.matMap)
      lastRaw = state.rawItems; lastBase = state.baseMatMap
    }
    state.latestUndoState.current = { rawItems: state.rawItems, baseMatMap: state.baseMatMap, dirtyMatIds: state.dirtyMatIds, editorDirty: state.editorDirty }
    state.sheetRevision = { current: { rawItems: state.rawItems, matMap: state.matMap, session: state.editorSession.current } }
  }
  state.orderedItems = (items: any[]) => items.map(item => ({ ...item }))
  publish()
  const context = createContext(state); runInContext(code, context)
  const run = (expression: string) => runInContext(expression, context)
  const edit = (qty: number) => { state.nextQty = qty; run('setItems(rows => rows.map(row => ({ ...row, qty: nextQty, kg: nextQty }))); setEditorDirty(true)'); publish() }
  return { state, run, publish, edit }
}

it('undo deep snapshots preserve every source, nested import image/metadata, zero/null and pending material fields', () => {
  const f = fixture(), s = f.state
  const imported = { id: 77, name_zh: 'Synthetic imported', image: 'data:image/png;base64,c3ludGhldGlj', shipment_images: ['first', 'second'], import_source: { sheet: 'PR1067', row: 4 } }
  s.rawItems = [{ _rowKey: 1, material_id: -1, material_snapshot: imported, qty: 0, kg: null, po_no: 'PR1067-IMPORTED' },
    { _rowKey: 2, material_id: 8, outbound_id: 4, po_no: 'PR1067-PO-1', qty: 3 },
    { _rowKey: 3, material_id: 8, outbound_id: 5, po_no: 'PR1067-PO-2', qty: 7 }]
  s.baseMatMap.set(-1, imported); s.baseMatMap.get(8).extra = { preserved: 0 }
  f.publish(); const expected = structuredClone(s.latestUndoState.current)
  f.run('recordSheetUndo()')
  imported.import_source.row = 99; imported.shipment_images.push('third'); s.baseMatMap.get(8).extra.preserved = 5; s.rawItems[1].qty = 30; s.dirtyMatIds.add(8)
  f.run('undoSheetEdit()'); f.publish()
  expect(s.rawItems).toEqual(expected.rawItems); expect(s.baseMatMap).toEqual(expected.baseMatMap)
  expect(s.dirtyMatIds).toEqual(expected.dirtyMatIds)
  expect(s.rawItems[0]).toMatchObject({ material_id: -1, qty: 0, kg: null })
  expect(s.rawItems[0].material_snapshot.image).toBe(imported.image)
})

it('keeps exactly the newest 30 independent steps and does not rewind new-row identity allocation', () => {
  const f = fixture(); f.state.editorDirty = false; f.publish()
  for (let n = 2; n <= 36; n++) f.edit(n)
  expect(f.state.undoHistory.current).toHaveLength(30)
  const rowKey = f.state.nextRowKey.current
  for (let n = 0; n < 30; n++) { f.run('undoSheetEdit()'); f.publish() }
  expect(f.state.rawItems[0].qty).toBe(6); expect(f.state.undoHistory.current).toHaveLength(0)
  expect(f.state.nextRowKey.current).toBe(rowKey)
  f.run('undoSheetEdit()'); expect(f.state.rawItems[0].qty).toBe(6)
})

it('undo restores a material change and its original dirty-material set as one operation', () => {
  const f = fixture(), s = f.state; s.dirtyMatIds = new Set([12]); f.publish()
  f.run('patchMatDim(8, "length", 25)'); f.publish()
  expect(s.baseMatMap.get(8).length).toBe(25); expect([...s.dirtyMatIds]).toEqual([12, 8])
  f.run('undoSheetEdit()'); f.publish()
  expect(s.baseMatMap.get(8).length).toBe(10); expect([...s.dirtyMatIds]).toEqual([12])
})

it('redo restores multiple table edits in order, including complete imported snapshots and material changes', () => {
  const f = fixture(), s = f.state
  s.rawItems[0].material_snapshot = { name_zh: 'Imported', shipment_images: ['one', 'two'], import_source: { sheet: 'Main', row: 4 } }
  f.publish(); const original = structuredClone(s.latestUndoState.current)
  f.edit(2)
  f.run('patchMatDim(8, "length", 25)'); f.publish()
  const changed = structuredClone(s.latestUndoState.current)
  f.run('undoSheetEdit()'); f.publish(); f.run('undoSheetEdit()'); f.publish()
  expect(s.rawItems).toEqual(original.rawItems)
  expect(s.redoHistory.current).toHaveLength(2)
  f.run('redoSheetEdit()'); f.publish()
  expect(s.rawItems[0].qty).toBe(2)
  expect(s.baseMatMap.get(8).length).toBe(10)
  f.run('redoSheetEdit()'); f.publish()
  expect(s.latestUndoState.current).toEqual(changed)
  expect(s.redoHistory.current).toHaveLength(0)
  expect(s.setRedoCount).toHaveBeenLastCalledWith(0)
  f.run('redoSheetEdit()'); f.publish()
  expect(s.latestUndoState.current).toEqual(changed)
})

it('new edits discard the redo branch, and resets clear both histories', () => {
  const f = fixture(), s = f.state
  f.edit(2); f.edit(3); f.run('undoSheetEdit()'); f.publish()
  expect(s.redoHistory.current).toHaveLength(1)
  f.edit(4)
  expect(s.redoHistory.current).toHaveLength(0)
  f.run('redoSheetEdit()'); f.publish()
  expect(s.rawItems[0].qty).toBe(4)
  f.run('undoSheetEdit()'); f.publish()
  f.run('resetSheetUndo()')
  expect(s.redoHistory.current).toHaveLength(0)
  expect(s.undoHistory.current).toHaveLength(0)
})

it('redo is blocked during writes/loading, keeps later header edits, and stays dirty after an uncertain save', () => {
  const f = fixture(), s = f.state
  f.edit(2); f.run('undoSheetEdit()'); f.publish()
  for (const state of ['saving', 'pending', 'loading']) {
    s.saving = state === 'saving'; s.sheetWritePending.current = state === 'pending'
    s.editorLoadState.current = state === 'loading' ? 'loading' : 'ready'
    f.run('redoSheetEdit()')
    expect(s.rawItems[0].qty).toBe(1)
    expect(s.redoHistory.current).toHaveLength(1)
  }
  s.editorLoadState.current = 'ready'; s.formRevision.current++; s.customerRevision.current++
  s.customValues.customer = 'RRM'; s.unacknowledgedSave.current = true
  f.run('redoSheetEdit()'); f.publish()
  expect(s.rawItems[0].qty).toBe(2)
  expect(s.customValues.customer).toBe('RRM'); expect(s.editorDirty).toBe(true)
  expect(s.message.info).toHaveBeenCalledWith('本次保存尚未完整确认，恢复后需再次保存。')
})

it('a complete explicit save discards redo targets from the previous saved state', async () => {
  const f = fixture(), s = f.state
  f.edit(2); f.run('undoSheetEdit()'); f.publish()
  expect(s.redoHistory.current).toHaveLength(1)
  expect(await f.run('save()')).toBe(true)
  expect(s.redoHistory.current).toHaveLength(0)
  expect(s.undoHistory.current).toHaveLength(0)
})

it('a save response cannot discard edits and undo steps made after its submitted snapshot', async () => {
  const f = fixture(), s = f.state, response = deferred()
  f.run('recordSheetUndo()'); s.api.put.mockReturnValue(response.promise)
  const pending = f.run('save()'); await settle()
  expect(s.api.put.mock.calls[0][1].items[0].qty).toBe(1)
  f.edit(2); const history = structuredClone(s.undoHistory.current)
  response.resolve({}); expect(await pending).toBe(false)
  expect(s.rawItems[0].qty).toBe(2); expect(s.editorDirty).toBe(true)
  expect(s.undoHistory.current).toEqual(history); expect(s.savePending.current).toBe(null)
})

it('an old shipment save cannot replace a new shipment header, dirty state or undo history', async () => {
  const f = fixture(), s = f.state, response = deferred()
  s.api.put.mockReturnValue(response.promise)
  const pending = f.run('save(true)'); await settle()
  s.api.get.mockResolvedValue({ data: { id: 22, customer: 'RRM', container_no: 'PR1067-B', items: [
    { _rowKey: 2, material_id: -2, qty: 88, kg: 88, material_snapshot: { name_zh: 'Synthetic B', unit_kg: 'KGM' } },
  ] } })
  await f.run('openEdit({ id: 22 })'); f.publish(); f.edit(89)
  const history = structuredClone(s.undoHistory.current)
  response.resolve({}); expect(await pending).toBe(true)
  expect(s.editing.id).toBe(22); expect(s.customValues).toMatchObject({ customer: 'RRM', container_no: 'PR1067-B' })
  expect(s.rawItems[0].qty).toBe(89); expect(s.editorDirty).toBe(true); expect(s.undoHistory.current).toEqual(history)
  expect(s.api.put).toHaveBeenCalledTimes(1)
})

it('delayed validation cannot submit an outdated draft or clear its history', async () => {
  const f = fixture(), s = f.state, validation = deferred()
  s.form.validateFields.mockReturnValue(validation.promise)
  const pending = f.run('save()'); f.edit(2)
  validation.resolve({ customer: 'RRI' }); expect(await pending).toBe(false)
  expect(s.api.put).not.toHaveBeenCalled(); expect(s.undoHistory.current).toHaveLength(1); expect(s.editorDirty).toBe(true)
})

it('a complete save clears history, and the first subsequent undo returns to its clean saved baseline', async () => {
  const f = fixture(), s = f.state; f.edit(2); s.dirtyMatIds = new Set([8]); f.publish()
  expect(await f.run('save()')).toBe(true)
  expect(s.api.put.mock.calls.map((call: any[]) => call[0])).toEqual(['/shipments/11', '/materials/8/dims'])
  expect(s.undoHistory.current).toHaveLength(0); expect(s.editorDirty).toBe(false); expect(s.dirtyMatIds.size).toBe(0)
  f.publish(); f.edit(3); f.run('undoSheetEdit()'); f.publish()
  expect(s.rawItems[0].qty).toBe(2); expect(s.editorDirty).toBe(false)
})

it('a failed material write retains pending changes/history and retries without falsely acknowledging success', async () => {
  const f = fixture(), s = f.state; f.edit(2); s.dirtyMatIds = new Set([8]); f.publish()
  s.api.put.mockImplementation(async (url: string) => { if (url.startsWith('/materials')) throw Error('synthetic dims failure'); return {} })
  expect(await f.run('save()')).toBe(false)
  expect(s.undoHistory.current).toHaveLength(1); expect(s.editorDirty).toBe(true); expect(s.dirtyMatIds.has(8)).toBe(true)
  expect(s.message.success).not.toHaveBeenCalled()
  s.api.put.mockResolvedValue({}); expect(await f.run('save()')).toBe(true)
  expect(s.undoHistory.current).toHaveLength(0); expect(s.editorDirty).toBe(false)
})

it('a new shipment retains its returned ID when material writes fail, and retry updates that same shipment', async () => {
  const f = fixture(), s = f.state; s.creating = true; s.editing = { id: 0 }; s.dirtyMatIds = new Set([8]); f.publish()
  s.api.put.mockRejectedValue(Error('synthetic dims failure'))
  expect(await f.run('save()')).toBe(false); expect(s.editing.id).toBe(777); expect(s.creating).toBe(false)
  s.api.put.mockResolvedValue({}); expect(await f.run('save()')).toBe(true)
  expect(s.api.post).toHaveBeenCalledTimes(1); expect(s.api.put.mock.calls.map((call: any[]) => call[0])).toContain('/shipments/777')
})

it('undo waits for an existing quantity check and its finished edit cannot replay after undo', async () => {
  const f = fixture(), s = f.state, balances = deferred()
  s.api.get.mockReturnValue(balances.promise)
  const pending = f.run('writeMergedCells([{ row: 0, field: "qty", value: "2" }], true)')
  expect(s.sheetWritePending.current).toBe(true); f.run('undoSheetEdit()')
  expect(s.rawItems[0].qty).toBe(1); expect(s.undoHistory.current).toHaveLength(0)
  balances.resolve({ data: [{ outbound_id: 4, allocatable_qty: 20 }] }); expect(await pending).toBe(true); f.publish()
  expect(s.rawItems[0].qty).toBe(2); expect(s.undoHistory.current).toHaveLength(1)
  f.run('undoSheetEdit()'); f.publish(); await settle()
  expect(s.rawItems[0].qty).toBe(1); expect(s.undoHistory.current).toHaveLength(0)
})

it('undo across a committed row snapshot stays dirty and a later explicit save persists the restored row', async () => {
  const f = fixture(), s = f.state, response = deferred(); let databaseQty = 1
  s.editorDirty = false; f.publish(); f.edit(2)
  s.api.put.mockImplementation(async (_url: string, body: any) => { databaseQty = body.items[0].qty; return response.promise })
  const pending = f.run('save()'); await settle(); f.edit(3)
  response.resolve({}); expect(await pending).toBe(false); expect(databaseQty).toBe(2)
  f.run('undoSheetEdit()'); f.publish(); f.run('undoSheetEdit()'); f.publish()
  expect(s.rawItems[0].qty).toBe(1); expect(s.editorDirty).toBe(true); expect(databaseQty).toBe(2)
  expect(s.message.info).toHaveBeenCalledWith('本次保存尚未完整确认，撤回后需再次保存。')
  f.run('requestCloseEditor()'); expect(s.Modal.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '保存后退出？' }))
  expect(await f.run('save()')).toBe(true); expect(databaseQty).toBe(1); expect(s.editorDirty).toBe(false)
  expect(s.unacknowledgedSave.current).toBe(false)
})

it('undo after partial dimensions success keeps the committed master restoration pending for explicit save', async () => {
  const f = fixture(), s = f.state
  s.baseMatMap.set(9, { id: 9, name_zh: 'Synthetic second material', unit_kg: 'KGM', net_per_pc: 1, length: 10 })
  s.rawItems = [...s.rawItems, { _rowKey: 2, material_id: 9, qty: 1, kg: 1 }]; s.editorDirty = false; f.publish()
  f.run('patchMatDim(8, "length", 20)'); f.publish(); f.run('patchMatDim(9, "length", 30)'); f.publish()
  const catalog = new Map([[8, 10], [9, 10]])
  s.api.put.mockImplementation(async (url: string, body: any) => {
    if (url === '/materials/8/dims') catalog.set(8, body.length)
    if (url === '/materials/9/dims') throw Error('synthetic second material failure')
    return {}
  })
  expect(await f.run('save()')).toBe(false); expect([...catalog]).toEqual([[8, 20], [9, 10]])
  f.run('undoSheetEdit()'); f.publish(); f.run('undoSheetEdit()'); f.publish()
  expect(s.baseMatMap.get(8).length).toBe(10); expect(s.baseMatMap.get(9).length).toBe(10)
  expect(s.dirtyMatIds.has(8)).toBe(true); expect(s.editorDirty).toBe(true)
  s.api.put.mockClear()
  s.api.put.mockImplementation(async (url: string, body: any) => {
    if (url.startsWith('/materials/')) catalog.set(Number(url.split('/')[2]), body.length)
    return {}
  })
  expect(await f.run('save()')).toBe(true)
  expect([...catalog]).toEqual([[8, 10], [9, 10]])
  expect(s.api.put.mock.calls.filter((call: any[]) => call[0] === '/materials/8/dims')[0][1].length).toBe(10)
  expect(s.api.put.mock.calls.filter((call: any[]) => call[0] === '/materials/9/dims')[0][1].length).toBe(10)
  expect(s.editorDirty).toBe(false); expect(s.writtenMaterials.current.size).toBe(0)
})

it('blocks an undo with no original material target instead of guessing a previously committed value', () => {
  const f = fixture(), s = f.state
  s.rawItems = []; s.baseMatMap = new Map(); s.editorDirty = false; f.publish(); f.run('recordSheetUndo()')
  s.rawItems = [{ _rowKey: 2, material_id: 9, qty: 1, kg: 1 }]
  s.baseMatMap = new Map([[9, { id: 9, length: 20 }]]); s.writtenMaterials.current.set(9, { id: 9, length: 20 })
  s.unacknowledgedSave.current = true; s.editorDirty = true; f.publish()
  const before = structuredClone(s.rawItems)
  f.run('undoSheetEdit()'); f.publish()
  expect(s.rawItems).toEqual(before); expect(s.baseMatMap.get(9).length).toBe(20)
  expect(s.undoHistory.current).toHaveLength(1); expect(s.editorDirty).toBe(true)
  expect(s.message.info).toHaveBeenCalledWith(expect.stringContaining('缺少原始物料资料，无法完整撤回'))
})

it('late material persistence from a closed shipment cannot contaminate the new shipment commit boundary', async () => {
  const f = fixture(), s = f.state, dimensionReply = deferred()
  s.dirtyMatIds = new Set([8]); f.publish()
  s.api.put.mockImplementation(async (url: string) => url.startsWith('/materials') ? dimensionReply.promise : {})
  const pending = f.run('save()'); await settle()
  expect(s.unacknowledgedSave.current).toBe(true)
  expect(s.api.put.mock.calls.map((call: any[]) => call[0])).toEqual(['/shipments/11', '/materials/8/dims'])
  s.api.get.mockResolvedValue({ data: { id: 22, customer: 'RRM', container_no: 'PR1067-B', items: [
    { _rowKey: 2, material_id: -2, qty: 88, kg: 88, material_snapshot: { unit_kg: 'KGM', name_zh: 'Synthetic B' } },
  ] } })
  await f.run('openEdit({ id: 22 })'); f.publish(); f.edit(89)
  dimensionReply.resolve({}); expect(await pending).toBe(true)
  expect(s.editing.id).toBe(22); expect(s.rawItems[0].qty).toBe(89); expect(s.editorDirty).toBe(true)
  expect(s.undoHistory.current).toHaveLength(1)
  expect(s.unacknowledgedSave.current).toBe(false); expect(s.writtenMaterials.current.size).toBe(0)
})


it('a lost material response keeps the possibly committed restoration pending for explicit retry', async () => {
  const f = fixture(), s = f.state
  s.baseMatMap.set(9, { id: 9, name_zh: 'Synthetic uncertain write', unit_kg: 'KGM', net_per_pc: 1, length: 10 })
  s.rawItems = [...s.rawItems, { _rowKey: 2, material_id: 9, qty: 1, kg: 1 }]; s.editorDirty = false; f.publish()
  f.run('patchMatDim(8, "length", 20)'); f.publish(); f.run('patchMatDim(9, "length", 30)'); f.publish()
  const catalog = new Map([[8, 10], [9, 10]])
  s.api.put.mockImplementation(async (url: string, body: any) => {
    if (url.startsWith('/materials/')) catalog.set(Number(url.split('/')[2]), body.length)
    if (url === '/materials/9/dims') throw Error('synthetic response lost after persistence')
    return {}
  })
  expect(await f.run('save()')).toBe(false); expect([...catalog]).toEqual([[8, 20], [9, 30]])
  f.run('undoSheetEdit()'); f.publish(); f.run('undoSheetEdit()'); f.publish()
  expect(s.dirtyMatIds).toEqual(new Set([8, 9])); expect(s.editorDirty).toBe(true)
  s.api.put.mockImplementation(async (url: string, body: any) => {
    if (url.startsWith('/materials/')) catalog.set(Number(url.split('/')[2]), body.length)
    return {}
  })
  expect(await f.run('save()')).toBe(true)
  expect([...catalog]).toEqual([[8, 10], [9, 10]]); expect(s.editorDirty).toBe(false)
})

it('a lost shipment update response cannot make an undo falsely clean against the committed row', async () => {
  const f = fixture(), s = f.state; let databaseQty = 1
  s.editorDirty = false; f.publish(); f.edit(2)
  s.api.put.mockImplementation(async (_url: string, body: any) => { databaseQty = body.items[0].qty; throw Error('synthetic response lost after persistence') })
  expect(await f.run('save()')).toBe(false); expect(databaseQty).toBe(2)
  f.run('undoSheetEdit()'); f.publish()
  expect(s.rawItems[0].qty).toBe(1); expect(s.editorDirty).toBe(true)
  f.run('requestCloseEditor()'); expect(s.Modal.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '保存后退出？' }))
  s.api.put.mockImplementation(async (_url: string, body: any) => { databaseQty = body.items[0].qty; return {} })
  expect(await f.run('save()')).toBe(true); expect(databaseQty).toBe(1); expect(s.editorDirty).toBe(false)
})


it('an unknown new-shipment result preserves the draft and asks for a list check without automatic retry', async () => {
  const f = fixture(), s = f.state; let createdCount = 0
  s.creating = true; s.editing = { id: 0 }; s.editorDirty = false; f.publish(); f.edit(2)
  s.api.post.mockImplementation(async () => { createdCount++; throw Error('synthetic create response lost') })
  expect(await f.run('save()')).toBe(false)
  expect(createdCount).toBe(1); expect(s.api.post).toHaveBeenCalledTimes(1)
  expect(s.creating).toBe(true); expect(s.rawItems[0].qty).toBe(2)
  expect(s.undoHistory.current).toHaveLength(1); expect(s.editorDirty).toBe(true)
  expect(s.message.info).toHaveBeenCalledWith(expect.stringContaining('请先在列表核对后再保存'))
  expect(s.message.success).not.toHaveBeenCalled()
})


it('actual Table fill-down over用途/合同 restores both original cells through Page undo', async () => {
  const f = fixture(), s = f.state
  s.rawItems = [
    { _rowKey: 671001, material_id: 8, qty: 1, kg: 1, product_use: 'UI1067-原始用途-671001', contract_no: 'UI1067-合同-671001' },
    { _rowKey: 671002, material_id: -671002, material_snapshot: { id: 67102, name_zh: 'UI1067-A本单独立快照', unit_kg: 'KGM', net_per_pc: 0.2, import_source: { row: 7 } }, qty: 1, kg: 1, product_use: 'UI1067-原始用途-671002', contract_no: 'UI1067-合同-671002' },
    { _rowKey: 671003, material_id: 10, qty: 1, kg: 1, product_use: 'UI1067-原始用途-671003', contract_no: 'UI1067-合同-671003' },
  ]
  s.editorDirty = false; f.publish()
  const before = structuredClone(s.rawItems)
  const tableTree = ts.createSourceFile('ShipmentSheetTable.tsx', readFileSync(new URL('../components/ShipmentSheetTable.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const batchDeclarations: string[] = []
  function findBatch(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ['runBatch', 'fillDown'].includes(node.name.getText(tableTree))) batchDeclarations.push(`const ${node.getText(tableTree)};`)
    ts.forEachChild(node, findBatch)
  }
  findBatch(tableTree)
  const onEdits = async (edits: any[]) => {
    s.edits = edits
    const result = await f.run('writeMergedCells(edits, true)')
    f.publish()
    return result
  }
  const tableState = { batchPending: { current: false }, drafts: { current: new Set() }, message: s.message,
    latest: { current: { rowOrder: '671001,671002,671003', onEdits, valueAt: (row: number, field: string) => s.consolidatedItems[row][field] } },
    sheetFillDownEdits, anchor: { row: 0, col: 20 }, end: { row: 1, col: 21 }, count: 3, fields: shipmentSheetFields }
  const tableContext = createContext(tableState)
  runInContext(ts.transpileModule(batchDeclarations.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, tableContext)
  runInContext('fillDown()', tableContext); await settle()
  expect(s.rawItems[1]).toMatchObject({ product_use: before[0].product_use, contract_no: before[0].contract_no })
  expect(s.undoHistory.current).toHaveLength(1)
  expect(s.undoHistory.current[0].rawItems).toEqual(before)
  f.run('undoSheetEdit()'); f.publish()
  expect(s.rawItems).toEqual(before)
  expect(s.consolidatedItems[1]).toMatchObject({ product_use: before[1].product_use, contract_no: before[1].contract_no })
  expect(s.editorDirty).toBe(false); expect(s.undoHistory.current).toHaveLength(0)
})
