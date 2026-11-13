import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'
import { expect, it, vi } from 'vitest'
import { shipmentLoadError } from './shipmentLoadError'
import { loadShipmentDetail, loadShipmentMaterials } from './shipmentDetailLoad'

// Run the real page handlers with deferred read requests; never call a server.
const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['openEdit', 'save', 'recordSheetUndo', 'resetSheetUndo', 'undoSheetEdit', 'restoreSheetHistory'].includes(node.name?.text || '')) handlers.push(node.getText(tree))
  ts.forEachChild(node, collect)
}
collect(tree)
const code = ts.transpileModule(handlers.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  const detail = deferred(), metadata = deferred()
  const state = {
    dayjs, editorSession: { current: 0 }, editorLoadState: { current: 'ready' }, savePending: { current: null },
    unacknowledgedSave: { current: false }, writtenMaterials: { current: new Map() },
    undoHistory: { current: ['previous shipment edit'] }, setUndoCount: vi.fn(), redoHistory: { current: [] }, setRedoCount: vi.fn(),
    shipmentLoadError, loadShipmentDetail, loadShipmentMaterials, setEditorLoadError: vi.fn(), setEditorLoad: vi.fn(), setCreating: vi.fn(), setEditing: vi.fn(), setItems: vi.fn(),
    setMatMap: vi.fn(), setDirtyMatIds: vi.fn(), setEditorDirty: vi.fn(),
    form: { resetFields: vi.fn(), setFieldsValue: vi.fn(), validateFields: vi.fn() },
    message: { error: vi.fn(), info: vi.fn() }, sheetEditing: false,
    api: { get: vi.fn((url: string) => url.startsWith('/shipments/') ? detail.promise : metadata.promise), put: vi.fn(), post: vi.fn() },
  }
  const context = createContext(state)
  runInContext(code, context)
  const open = (id = 11) => runInContext(`openEdit({ id: ${id} })`, context) as Promise<void>
  const save = () => runInContext('save()', context) as Promise<boolean>
  return { state, detail, metadata, open, save }
}
const record = { id: 11, customer: 'RRI', rate: .93, ship_date: '2026-11-02', items: [{ material_id: 8, qty: 10, kg: 2 }] }

it('pending detail or material requests cannot validate or save an empty editor', async () => {
  const f = setup(), pending = f.open()
  expect(f.state.editorLoadState.current).toBe('loading')
  expect(f.state.undoHistory.current).toEqual([])
  expect(await f.save()).toBe(false)
  f.detail.resolve({ data: record })
  await vi.waitFor(() => expect(f.state.api.get).toHaveBeenLastCalledWith('/materials/by-ids', { params: { ids: '8' } }))
  expect(await f.save()).toBe(false)
  expect(f.state.form.validateFields).not.toHaveBeenCalled()
  expect(f.state.api.put).not.toHaveBeenCalled()
  expect(f.state.api.post).not.toHaveBeenCalled()
  expect(f.state.setItems).toHaveBeenCalledTimes(1) // reset only
  f.metadata.resolve({ data: [{ id: 8, name_zh: '测试物料' }] }); await pending
  expect(f.state.editorLoadState.current).toBe('ready')
  expect(f.state.setItems).toHaveBeenLastCalledWith(record.items, false)
  expect(f.state.form.setFieldsValue).toHaveBeenCalledWith(expect.objectContaining({ customer: 'RRI', ship_date: '2026-11-02' }))
  expect(f.state.api.get.mock.calls.map(call => call[0])).toEqual(['/shipments/11', '/materials/by-ids'])
})

it.each(['detail', 'metadata'])('failed %s remains blocked and can be retried without saving', async failed => {
  const f = setup(), pending = f.open()
  if (failed === 'detail') f.detail.reject(new Error('offline'))
  else { f.detail.resolve({ data: record }); f.metadata.reject(new Error('offline')) }
  await pending
  expect(f.state.editorLoadState.current).toBe('error')
  expect(await f.save()).toBe(false)
  expect(f.state.api.put).not.toHaveBeenCalled()
  f.state.api.get.mockImplementation(async url => ({ data: url.startsWith('/shipments/') ? record : [{ id: 8 }] }))
  await f.open()
  expect(f.state.editorLoadState.current).toBe('ready')
  expect(f.state.setItems).toHaveBeenLastCalledWith(record.items, false)
})

it.each([{}, { ...record, id: 99 }, { ...record, items: null }])('malformed or wrong-shipment response does not become a savable empty record', async data => {
  const f = setup(), pending = f.open(); f.detail.resolve({ data }); await pending
  expect(f.state.editorLoadState.current).toBe('error')
  expect(f.state.form.setFieldsValue).not.toHaveBeenCalled()
  expect(await f.save()).toBe(false)
})

it('missing master material blocks partial records instead of silently dropping columns', async () => {
  const f = setup(), pending = f.open()
  f.detail.resolve({ data: record }); f.metadata.resolve({ data: [] }); await pending
  expect(f.state.editorLoadState.current).toBe('error')
  expect(f.state.setItems).toHaveBeenCalledTimes(1)
  expect(await f.save()).toBe(false)
})

it('import-only records use saved snapshots and make no outbound or material lookup', async () => {
  const f = setup(), pending = f.open()
  const item = { material_id: 8, qty: 10, material_snapshot: JSON.stringify({ name_zh: '导入快照', hs_id: '001234' }) }
  f.detail.resolve({ data: { ...record, items: [item] } }); await pending
  expect(f.state.api.get).toHaveBeenCalledTimes(1)
  expect(f.state.setItems).toHaveBeenLastCalledWith([{ ...item, material_snapshot: { name_zh: '导入快照', hs_id: '001234' } }], false)
  expect(f.state.editorLoadState.current).toBe('ready')
})

it('a legitimately empty saved shipment can finish loading', async () => {
  const f = setup(), pending = f.open()
  f.detail.resolve({ data: { ...record, items: [] } }); await pending
  expect(f.state.editorLoadState.current).toBe('ready')
  expect(f.state.api.get).toHaveBeenCalledTimes(1)
})

it.each(['resolve', 'reject'])('closed editor ignores late detail %s', async result => {
  const f = setup(), pending = f.open(); f.state.editorSession.current++
  if (result === 'resolve') f.detail.resolve({ data: record }); else f.detail.reject(new Error('late'))
  await pending
  expect(f.state.form.setFieldsValue).not.toHaveBeenCalled()
  expect(f.state.setItems).toHaveBeenCalledTimes(1)
  expect(f.state.message.error).not.toHaveBeenCalled()
})

it('switching shipments ignores an old master-data response and keeps the new form', async () => {
  const f = setup(), old = f.open(); f.detail.resolve({ data: record })
  await Promise.resolve(); await Promise.resolve()
  f.state.api.get.mockImplementation(async () => ({ data: { ...record, id: 14, customer: 'RRM', items: [] } }))
  await f.open(14)
  f.metadata.resolve({ data: [{ id: 8 }] }); await old
  expect(f.state.form.setFieldsValue).toHaveBeenCalledTimes(1)
  expect(f.state.form.setFieldsValue).toHaveBeenLastCalledWith(expect.objectContaining({ customer: 'RRM' }))
  expect(f.state.setItems).toHaveBeenLastCalledWith([], false)
  expect(f.state.editorLoadState.current).toBe('ready')
})

// These expressions are evaluated from the actual JSX, not a copied UI policy.
const stateTree = tree
const headerButtons = new Map<string, {disabled: string; loading?: string}>()
let editorInert = ''
function collectHeader(node: ts.Node) {
  if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
    const attrs = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attribute => [attribute.name.getText(stateTree),
      attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression?.getText(stateTree) : undefined]))
    if (node.tagName.getText(stateTree) === 'Button' && ['runValidation', 'exportShipmentExcel', '() => save()', 'requestDiscardChanges'].includes(attrs.get('onClick') || ''))
      headerButtons.set(attrs.get('onClick')!, { disabled: attrs.get('disabled') || 'false', loading: attrs.get('loading') })
    if (node.tagName.getText(stateTree) === 'div' && attrs.has('hidden') && attrs.has('inert')) editorInert = attrs.get('inert')!
  }
  ts.forEachChild(node, collectHeader)
}
collectHeader(stateTree)
it.each(['ready', 'loading', 'error'].flatMap(editorLoad => [false, true].map(sheetEditing => ({editorLoad, sheetEditing}))))('header actions follow actual loading and quantity-validation state: %j', state => {
  const context = createContext({ ...state, editorDirty: true, saving: false, exporting: false })
  const evaluate = (value: string) => runInContext(ts.transpileModule(`(${value})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  expect(headerButtons.size).toBe(4)
  expect(evaluate(headerButtons.get('runValidation')!.disabled)).toBe(state.editorLoad !== 'ready' || state.sheetEditing)
  expect(evaluate(headerButtons.get('exportShipmentExcel')!.disabled)).toBe(state.editorLoad !== 'ready' || state.sheetEditing)
  expect(evaluate(headerButtons.get('requestDiscardChanges')!.disabled)).toBe(state.sheetEditing)
  expect(evaluate(headerButtons.get('() => save()')!.disabled)).toBe(state.editorLoad !== 'ready')
  expect(evaluate(headerButtons.get('() => save()')!.loading!)).toBe(state.sheetEditing)
  expect(evaluate(editorInert)).toBe(state.sheetEditing)
})

it('pending quantity validation blocks save before form validation or persistence', async () => {
  const f = setup()
  f.state.sheetEditing = true
  expect(await f.save()).toBe(false)
  expect(f.state.form.validateFields).not.toHaveBeenCalled()
  expect(f.state.api.put).not.toHaveBeenCalled(); expect(f.state.api.post).not.toHaveBeenCalled()
})
it('loading and failure states offer status and retry controls', () => {
  expect(source).toContain('role="status"')
  expect(source).toContain('重新加载')
})

it('undo restores a complete previous table edit and keeps later header edits', () => {
  const rawItems = [{ material_id: -1, qty: 10, outbound_id: 4 }, { material_id: 8, qty: 3, outbound_id: 5 }]
  const baseMatMap = new Map([[-1, { hs_cn: '012345' }]])
  const dirtyMatIds = new Set<number>()
  const state = {
    Map, Set, structuredClone, latestUndoState: { current: { rawItems, baseMatMap, dirtyMatIds, editorDirty: false } },
    unacknowledgedSave: { current: false }, writtenMaterials: { current: new Map() },
    undoHistory: { current: [] }, redoHistory: { current: [] }, setRedoCount: vi.fn(),
    formRevision: { current: 0 },
    customerRevision: { current: 0 },
    form: { getFieldValue: vi.fn(() => 'RRI'), setFieldsValue: vi.fn() },
    editorLoadState: { current: 'ready' },
    sheetWritePending: { current: false },
    saving: false,
    setUndoCount: vi.fn(), setRawItems: vi.fn(), setMatMap: vi.fn(), setDirtyMatIds: vi.fn(),
    setEditorDirty: vi.fn(), setCartonSelection: vi.fn(),
  }
  const context = createContext(state)
  runInContext(code, context)
  runInContext('recordSheetUndo()', context)
  const loadedMaterial = { hs_cn: '987654' }
  state.latestUndoState.current.baseMatMap = new Map([...baseMatMap, [8, loadedMaterial]])
  state.formRevision.current++
  state.customerRevision.current++
  state.form.getFieldValue.mockReturnValue('RRM')
  state.sheetWritePending.current = true
  runInContext('undoSheetEdit()', context)
  expect(state.setRawItems).not.toHaveBeenCalled()
  state.sheetWritePending.current = false
  runInContext('undoSheetEdit()', context)
  expect(state.setRawItems).toHaveBeenCalledWith(rawItems)
  expect(state.setMatMap).toHaveBeenCalledWith(new Map([...baseMatMap, [8, loadedMaterial]]))
  expect(state.setDirtyMatIds).toHaveBeenCalledWith(dirtyMatIds)
  expect(state.setUndoCount).toHaveBeenLastCalledWith(0)
  expect(state.setEditorDirty).toHaveBeenCalledWith(true)
  expect(state.form.setFieldsValue).not.toHaveBeenCalled()
})

it.each(['detail', 'metadata'] as const)('Network Error保留具体%s阶段，重新加载时清除旧原因', async stage => {
  const f = setup(), pending = f.open(23)
  if (stage === 'detail') f.detail.reject(new Error('Network Error'))
  else { f.detail.resolve({ data: { ...record, id: 23 } }); f.metadata.reject(new Error('Network Error')) }
  await pending
  expect(f.state.setEditorLoadError).toHaveBeenLastCalledWith(expect.stringContaining(stage === 'detail' ? '走货详情' : '物料资料'))
  expect(f.state.setEditorLoadError).toHaveBeenLastCalledWith(expect.stringContaining('Network Error'))
  expect(f.state.editorLoadState.current).toBe('error')
  f.state.api.get.mockImplementation(async url => ({ data: url.startsWith('/shipments/') ? { ...record, id: 23 } : [{ id: 8 }] }))
  await f.open(23)
  expect(f.state.setEditorLoadError).toHaveBeenLastCalledWith('')
  expect(f.state.editorLoadState.current).toBe('ready')
})
