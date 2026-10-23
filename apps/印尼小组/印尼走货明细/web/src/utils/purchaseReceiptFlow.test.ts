import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'
import { describe, expect, it, vi } from 'vitest'
import { createReceiptSession } from './purchaseReceipt'

// Run the real page handlers with delayed, fictional API responses. A new context
// models a React render so an in-flight handler keeps its original item closure.
const page = readFileSync(new URL('../pages/PurchasePage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('PurchasePage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = new Set(['load', 'loadReceipts', 'closeReceipt', 'openReceipt', 'saveReceipt', 'editReceipt', 'saveReceiptEdit', 'deleteReceipt'])
const handlers: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) handlers.push(node.getText(tree))
  ts.forEachChild(node, collect)
}
collect(tree)
const executable = ts.transpileModule(handlers.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const A = { id: 1, po_id: 11, purchase_qty: 100, received_qty: 80, spare_qty: 2, shortage_qty: 20 }
const B = { id: 2, po_id: 22, purchase_qty: 200, received_qty: 10, spare_qty: 0, shortage_qty: 190 }
const batchA = { id: 101, po_item_id: 1, qty: 60, spare_qty: 2, batch_no: 'A' }
const batchB = { id: 202, po_item_id: 2, qty: 10, spare_qty: 0, batch_no: 'B' }

function fixture() {
  const state: Record<string, any> = {
    receiptItem: null, receiptRows: [], editingReceipt: null, receiptLoading: false,
    receiptEditSaving: false, rows: [], itemRows: [], latest: [A, B],
  }
  const receiptSession = createReceiptSession()
  const receiptEditOperation = { current: null }
  const receiptForm = { resetFields: vi.fn(), setFieldsValue: vi.fn(), validateFields: vi.fn(async () => ({ qty: 10, spare_qty: 1 })) }
  const receiptEditForm = { setFieldsValue: vi.fn(), validateFields: vi.fn(async () => ({ qty: 50, spare_qty: 3 })) }
  const message = { success: vi.fn(), warning: vi.fn() }
  const api = {
    get: vi.fn(async (url: string): Promise<{ data: any[] }> => ({ data: url.endsWith('/receipts') ? (url.includes('/1/') ? [batchA] : [batchB]) : state.latest })),
    put: vi.fn(async (_url: string, _body: unknown) => ({ data: { ok: true } })),
    post: vi.fn(async (_url: string, _body: unknown) => ({ data: { ok: true } })),
    delete: vi.fn(async (_url: string) => ({ data: { ok: true } })),
  }
  function render() {
    const context = createContext({
      ...state, api, message, dayjs, receiptForm, receiptEditForm, receiptSession, receiptEditOperation,
      ...Object.fromEntries(['receiptItem', 'receiptRows', 'editingReceipt', 'receiptLoading', 'receiptEditSaving', 'rows', 'itemRows', 'loading']
        .map(key => [`set${key[0].toUpperCase()}${key.slice(1)}`, (value: unknown) => { state[key] = value }])),
    })
    runInContext(executable, context)
    return context
  }
  async function open(item = A) { await render().openReceipt(item) }
  return { state, receiptSession, receiptEditOperation, receiptForm, receiptEditForm, message, api, render, open }
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe('purchase receipt dialog isolation', () => {
  it('invalidates old requests even when the same item is closed and reopened', () => {
    const session = createReceiptSession()
    const first = session.open(1)
    expect(session.current(2)).toBeNull()
    expect(session.isCurrent(first)).toBe(true)
    session.close()
    expect(session.isCurrent(first)).toBe(false)
    const next = session.open(1)
    expect(next.revision).toBeGreaterThan(first.revision)
    expect(session.isCurrent(first)).toBe(false)
    expect(session.isCurrent(next)).toBe(true)
  })

  it('does not show A batches under B or clear B loading when A resolves last', async () => {
    const f = fixture()
    const a = deferred<{ data: any[] }>(), b = deferred<{ data: any[] }>()
    f.api.get.mockImplementation(url => url.includes('/1/') ? a.promise : b.promise)
    f.state.receiptRows = [batchB]
    const pa = f.render().openReceipt(A)
    expect(f.state.receiptRows).toEqual([])
    f.render().closeReceipt()
    const pb = f.render().openReceipt(B)
    a.resolve({ data: [batchA] }); await pa
    expect(f.state.receiptItem.id).toBe(2)
    expect(f.state.receiptRows).toEqual([])
    expect(f.state.receiptLoading).toBe(true)
    b.resolve({ data: [batchB] }); await pb
    expect(f.state.receiptRows).toEqual([batchB])
    expect(f.state.receiptLoading).toBe(false)
  })

  it('ignores an earlier response from a previous opening of the same item', async () => {
    const f = fixture(), old = deferred<{ data: any[] }>()
    f.api.get.mockImplementationOnce(() => old.promise)
    const first = f.render().openReceipt(A)
    f.render().closeReceipt()
    await f.open(A)
    old.resolve({ data: [{ ...batchA, qty: 999 }] }); await first
    expect(f.state.receiptRows).toEqual([batchA])
  })

  it('rejects both opening and submitting a batch belonging to another item', async () => {
    const f = fixture(); await f.open(B)
    f.render().editReceipt(batchA)
    expect(f.state.editingReceipt).toBeNull()
    f.state.editingReceipt = batchA
    await f.render().saveReceiptEdit()
    expect(f.api.put).not.toHaveBeenCalled()
    expect(f.message.warning).toHaveBeenCalledTimes(2)
  })

  it('keeps the exact batch ID and old quantities and refreshes server totals/status', async () => {
    const f = fixture(); await f.open()
    f.render().editReceipt(batchA)
    f.receiptEditForm.validateFields.mockResolvedValue({ qty: 80, spare_qty: 3 })
    const latest = { ...A, received_qty: 100, spare_qty: 3, shortage_qty: 0, status: 'received' }
    f.state.latest = [latest, B]
    await f.render().saveReceiptEdit()
    expect(f.api.put).toHaveBeenCalledWith('/purchase/receipts/101', {
      qty: 80, spare_qty: 3, expected_qty: 60, expected_spare_qty: 2,
    })
    expect(f.state.receiptItem).toEqual(latest)
    expect(f.state.itemRows).toEqual([latest, B])
    expect(f.state.rows).toEqual([latest, B])
    expect(f.receiptForm.setFieldsValue).toHaveBeenLastCalledWith({ qty: 0, spare_qty: 0 })
    expect(f.state.editingReceipt).toBeNull()
    expect(f.state.receiptEditSaving).toBe(false)
  })

  it('retains the editor and original quantities on a rejected stale update', async () => {
    const f = fixture(); await f.open(); f.render().editReceipt(batchA)
    f.api.put.mockRejectedValue(new Error('synthetic409'))
    await expect(f.render().saveReceiptEdit()).rejects.toThrow('synthetic409')
    expect(f.state.editingReceipt).toEqual(batchA)
    expect(f.state.receiptEditSaving).toBe(false)
    expect(f.receiptEditOperation.current).toBeNull()
    expect(f.message.success).not.toHaveBeenCalled()
  })

  it('releases saving state after invalid form data and prevents duplicate submissions', async () => {
    const f = fixture(); await f.open(); f.render().editReceipt(batchA)
    const values = deferred<{ qty: number; spare_qty: number }>()
    f.receiptEditForm.validateFields.mockImplementation(() => values.promise)
    const originalRender = f.render()
    const first = originalRender.saveReceiptEdit()
    await originalRender.saveReceiptEdit()
    expect(f.receiptEditForm.validateFields).toHaveBeenCalledOnce()
    values.reject(new Error('synthetic validation error'))
    await expect(first).rejects.toThrow('synthetic validation error')
    expect(f.api.put).not.toHaveBeenCalled()
    expect(f.state.receiptEditSaving).toBe(false)
  })

  it('does not submit after the parent dialog closes while validating', async () => {
    const f = fixture(); await f.open(); f.render().editReceipt(batchA)
    const values = deferred<{ qty: number; spare_qty: number }>()
    f.receiptEditForm.validateFields.mockImplementation(() => values.promise)
    const pending = f.render().saveReceiptEdit()
    f.render().closeReceipt()
    values.resolve({ qty: 50, spare_qty: 3 }); await pending
    expect(f.api.put).not.toHaveBeenCalled()
    expect(f.state.receiptItem).toBeNull()
  })

  it('an old edit completion cannot close the new item editor or change its quantities', async () => {
    const f = fixture(); await f.open(); f.render().editReceipt(batchA)
    const save = deferred<{ data: { ok: boolean } }>()
    f.api.put.mockImplementationOnce(() => save.promise)
    const pending = f.render().saveReceiptEdit(); await tick()
    f.render().closeReceipt(); await f.open(B); f.render().editReceipt(batchB)
    save.resolve({ data: { ok: true } }); await pending
    expect(f.state.receiptItem).toEqual(B)
    expect(f.state.receiptRows).toEqual([batchB])
    expect(f.state.editingReceipt).toEqual(batchB)
    expect(f.state.receiptEditSaving).toBe(false)
  })

  it('an old edit refresh cannot reopen A after closing A and opening B', async () => {
    const f = fixture(); await f.open(); f.render().editReceipt(batchA)
    const refresh = deferred<{ data: any[] }>()
    f.api.get.mockImplementation(url => url === '/purchase/items' ? refresh.promise : Promise.resolve({ data: url.endsWith('/receipts') ? [batchA] : [] }))
    const pending = f.render().saveReceiptEdit(); await tick()
    expect(f.state.editingReceipt).toBeNull()
    f.render().closeReceipt()
    f.api.get.mockImplementation(async url => ({ data: url.endsWith('/receipts') ? [batchB] : [] }))
    await f.open(B)
    refresh.resolve({ data: [{ ...A, received_qty: 70, shortage_qty: 30 }, B] }); await pending
    expect(f.state.receiptItem).toEqual(B)
    expect(f.state.receiptRows).toEqual([batchB])
    expect(f.receiptForm.setFieldsValue).toHaveBeenLastCalledWith(expect.objectContaining({ qty: 190 }))
  })

  it.each(['saveReceipt', 'deleteReceipt'])('an old %s completion cannot overwrite B', async action => {
    const f = fixture(); await f.open()
    const save = deferred<{ data: { ok: boolean } }>()
    if (action === 'saveReceipt') f.api.post.mockImplementationOnce(() => save.promise)
    else f.api.delete.mockImplementationOnce(() => save.promise)
    const pending = f.render()[action](batchA.id); await tick()
    f.render().closeReceipt(); await f.open(B)
    save.resolve({ data: { ok: true } }); await pending
    expect(f.state.receiptItem).toEqual(B)
    expect(f.state.receiptRows).toEqual([batchB])
    expect(f.receiptForm.setFieldsValue).toHaveBeenLastCalledWith(expect.objectContaining({ qty: 190 }))
  })
})
