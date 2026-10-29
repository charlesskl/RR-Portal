import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'
import { expect, it, vi } from 'vitest'

// Run the real page handlers with deferred read requests; never call a server.
const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['openEdit', 'save'].includes(node.name?.text || '')) handlers.push(node.getText(tree))
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
    dayjs, editorSession: { current: 0 }, editorLoadState: { current: 'ready' },
    setEditorLoad: vi.fn(), setCreating: vi.fn(), setEditing: vi.fn(), setItems: vi.fn(),
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
  expect(await f.save()).toBe(false)
  f.detail.resolve({ data: record }); await Promise.resolve(); await Promise.resolve()
  expect(f.state.api.get).toHaveBeenLastCalledWith('/materials/by-ids', { params: { ids: '8' } })
  expect(await f.save()).toBe(false)
  expect(f.state.form.validateFields).not.toHaveBeenCalled()
  expect(f.state.api.put).not.toHaveBeenCalled()
  expect(f.state.api.post).not.toHaveBeenCalled()
  expect(f.state.setItems).toHaveBeenCalledTimes(1) // reset only
  f.metadata.resolve({ data: [{ id: 8, name_zh: '测试物料' }] }); await pending
  expect(f.state.editorLoadState.current).toBe('ready')
  expect(f.state.setItems).toHaveBeenLastCalledWith(record.items)
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
  expect(f.state.setItems).toHaveBeenLastCalledWith(record.items)
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
  expect(f.state.setItems).toHaveBeenLastCalledWith([{ ...item, material_snapshot: { name_zh: '导入快照', hs_id: '001234' } }])
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
  expect(f.state.setItems).toHaveBeenLastCalledWith([])
  expect(f.state.editorLoadState.current).toBe('ready')
})

it('loading/error explicitly disable save/export and offer status and retry controls', () => {
  expect(source).toMatch(/onClick=\{\(\) => save\(\)\}[^\n]*disabled=\{editorLoad !== 'ready'\}/)
  expect(source).toMatch(/onClick=\{exportShipmentExcel\}[^\n]*disabled=\{editorLoad !== 'ready'\}/)
  expect(source).toContain('role="status"')
  expect(source).toContain('重新加载')
})
