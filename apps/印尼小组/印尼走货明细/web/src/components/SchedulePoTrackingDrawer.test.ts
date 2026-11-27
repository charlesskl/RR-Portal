import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { trackingQuantity } from './SchedulePoTrackingDrawer'

vi.mock('../api/client', () => ({ api: { get: vi.fn() } }))

const text = readFileSync(new URL('./SchedulePoTrackingDrawer.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('SchedulePoTrackingDrawer.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effect: ts.Expression | undefined
function find(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect') effect = node.arguments[0]
  ts.forEachChild(node, find)
}
find(tree)
if (!effect) throw new Error('The actual drawer loading effect must exist')
const code = ts.transpileModule(`return (${effect.getText(tree)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
function delayed() {
  let resolve!: (value: { data: unknown }) => void, reject!: (value: unknown) => void
  const promise = new Promise<{ data: unknown }>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
function fixture() {
  const state = { data: null as unknown, error: '', loading: false, expanded: [] as unknown[] }
  const api = { get: vi.fn() }, request = { current: 0 }
  const start = (orderNo?: string, code = '123/456/789', source = 'RRM', scheduleId = 8) => {
    const bindings = { api, request, orderNo, code, source, scheduleId,
      setData: (value: unknown) => { state.data = value }, setError: (value: string) => { state.error = value },
      setLoading: (value: boolean) => { state.loading = value }, setExpanded: (value: unknown[]) => { state.expanded = value },
    }
    return new Function(...Object.keys(bindings), codeEffect)(...Object.values(bindings))() as (() => void) | undefined
  }
  return { state, api, start }
}
const codeEffect = code

describe('PO material tracking real request lifecycle', () => {
  it('requests the selected schedule, literal PO, full compound SKU and source', async () => {
    const f = fixture(), pending = delayed()
    f.api.get.mockReturnValueOnce(pending.promise)
    f.start('0001')
    expect(f.state.loading).toBe(true)
    expect(f.api.get).toHaveBeenCalledWith('/schedules/8/po-tracking', expect.objectContaining({
      params: { order_no: '0001', code: '123/456/789', source: 'RRM' }, skipErrorToast: true,
    }))
    pending.resolve({ data: { materials: [{ shipped_qty: null, status: 'review' }] } }); await settle()
    expect(f.state.data).toEqual({ materials: [{ shipped_qty: null, status: 'review' }] })
    expect(f.state.loading).toBe(false)
  })
  it.each(['success', 'failure'])('switching POs ignores the previous late %s', async result => {
    const f = fixture(), old = delayed(), next = delayed()
    f.api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const cancel = f.start('PO-A')!
    cancel(); f.start('PO-B')
    if (result === 'success') old.resolve({ data: { order_no: 'PO-A' } })
    else old.reject(new Error('obsolete failure'))
    await settle()
    expect(f.state).toMatchObject({ data: null, error: '', loading: true })
    next.resolve({ data: { order_no: 'PO-B' } }); await settle()
    expect(f.state.data).toEqual({ order_no: 'PO-B' })
    expect(f.state.loading).toBe(false)
  })
  it('closing during a request clears the selection and rejects old results', async () => {
    const f = fixture(), pending = delayed()
    f.api.get.mockReturnValueOnce(pending.promise)
    const close = f.start('PO-A')!
    close(); f.start(undefined)
    pending.resolve({ data: { order_no: 'PO-A' } }); await settle()
    expect(f.state).toMatchObject({ data: null, loading: false, error: '' })
    expect(f.api.get).toHaveBeenCalledTimes(1)
  })
  it('shows failure without fabricated zero totals and allows a clean retry', async () => {
    const f = fixture(), failed = delayed(), retry = delayed()
    f.api.get.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise)
    f.start('PO-A')
    failed.reject({ response: { data: { error: '排期已变动，请刷新' } } }); await settle()
    expect(f.state).toMatchObject({ data: null, error: '排期已变动，请刷新', loading: false })
    f.start('PO-A')
    expect(f.state).toMatchObject({ data: null, error: '', loading: true })
    retry.resolve({ data: { materials: [] } }); await settle()
    expect(f.state.data).toEqual({ materials: [] })
  })
})

it('keeps unknown quantities distinct from true zero and preserves fractional purchase units', () => {
  expect(trackingQuantity(null)).toBe('—')
  expect(trackingQuantity(undefined)).toBe('—')
  expect(trackingQuantity(0)).toBe('0')
  expect(trackingQuantity(1500)).toBe('1,500')
  expect(trackingQuantity(0.1256)).toBe('0.1256')
})

it('the real schedule PO button passes the exact selected PO, SKU and source to tracking', () => {
  const source = readFileSync(new URL('../pages/SchedulesPage.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('SchedulesPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let click: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node)) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute)
      if (attrs.some(attr => attr.name.getText(tree) === 'aria-label' && attr.getText(tree).includes('物料走货进度'))) {
        const init = attrs.find(attr => attr.name.getText(tree) === 'onClick')?.initializer
        if (init && ts.isJsxExpression(init)) click = init.expression
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  expect(click).toBeDefined()
  const setTracking = vi.fn(), value = '000-PO', row = { code: '123/456/789', source: 'RRM' }
  const callback = new Function('setTracking', 'value', 'row', `return (${click!.getText(tree)})`)(setTracking, value, row)
  callback()
  expect(setTracking).toHaveBeenCalledWith({ orderNo: value, code: row.code, source: row.source })
})
