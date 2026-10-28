import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { planOutboundPull } from './shipmentOutboundRemaining'

// Execute the actual UI pull handler against mock APIs, never production data.
const sourceText = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['pullFromOutbound', 'closeOutboundPicker', 'loadOutbound'].includes(node.name?.text || ''))
    handlers.push(node.getText(tree))
  ts.forEachChild(node, collect)
}
collect(tree)
const executable = ts.transpileModule(handlers.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function setup() {
  const items = [{ _rowKey: 1, material_id: 66, outbound_id: 7, qty: 600 }]
  const sources = [{ outbound_id: 7, material_id: 66, allocatable_qty: 1000, po_no: 'IRRIHS1', price: .12, currency: 'US$', purchase_unit: '个' }]
  const materials = [{ id: 66, name_zh: '彩盒' }]
  const state = {
    items, sources, materials, selectedOutIds: ['7'], outLoading: false,
    outRequest: { current: 0 }, outPullPending: { current: null },
    sheetRevision: { current: { rawItems: items, matMap: new Map(), session: 1 } }, editing: { id: 14 },
    planOutboundPull,
    api: { get: vi.fn(async (url: string) => ({ data: url === '/outbound/allocatable' ? sources : materials })) },
    buildMatToPo: vi.fn(async () => new Map()),
    makeItem: vi.fn((m, qty, opts) => ({ material_id: m.id, outbound_id: opts.outboundId, qty, price: opts.poInfo?.it.price })),
    appendItems: vi.fn(), applyPartition: vi.fn(), setOutRows: vi.fn(), setOutOpen: vi.fn(),
    setOutSel: vi.fn(), setOutPulling: vi.fn(), setOutLoading: vi.fn(),
    message: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
  }
  const context = createContext(state)
  runInContext(executable, context)
  return { state, pull: () => runInContext('pullFromOutbound()', context) as Promise<void>,
    cancel: () => runInContext('closeOutboundPicker()', context),
    load: (id: number) => runInContext(`loadOutbound(${id})`, context) as Promise<void> }
}
it('确认时刷新额度，只拉入扣除本柜 600 后剩余的 400；不回退最近采购单价格', async () => {
  const { state, pull } = setup()
  await pull()
  expect(state.api.get).toHaveBeenNthCalledWith(1, '/outbound/allocatable', { params: { shipment_id: 14 } })
  expect(state.appendItems).toHaveBeenCalledWith([{ material_id: 66, outbound_id: 7, qty: 400, price: .12 }])
  expect(state.buildMatToPo).not.toHaveBeenCalled()
  expect(state.items[0].qty).toBe(600)
  expect(state.outPullPending.current).toBeNull()
})
it('按钮连点也只追加一次，重新读取发现额度归零则不追加', async () => {
  const first = setup()
  await Promise.all([first.pull(), first.pull()])
  expect(first.state.appendItems).toHaveBeenCalledTimes(1)
  const { state, pull } = setup()
  state.sources[0].allocatable_qty = 600
  await pull()
  expect(state.appendItems).not.toHaveBeenCalled()
  expect(state.message.error.mock.calls[0][0]).toContain('OUT-7')
})
it('任意一笔物料缺失则整次不追加，不出现半次成功', async () => {
  const { state, pull } = setup()
  state.sources.push({ ...state.sources[0], outbound_id: 8, material_id: 999 })
  state.selectedOutIds.push('8')
  await pull()
  expect(state.appendItems).not.toHaveBeenCalled()
  expect(state.message.error.mock.calls[0][0]).toContain('OUT-8')
})
it('取消选择窗口后不应用晚到的拉入响应', async () => {
  const { state, pull, cancel } = setup()
  let resolve!: (value: any) => void
  state.api.get.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const pending = pull()
  cancel()
  expect(state.outPullPending.current).toBeNull()
  await pull()
  expect(state.appendItems).toHaveBeenCalledTimes(1)
  resolve({ data: state.sources })
  await pending
  expect(state.appendItems).toHaveBeenCalledTimes(1)
  expect(state.setOutOpen).toHaveBeenCalledWith(false)
})
it('异步查询期间换柜或修改原明细，不追加到新的编辑状态', async () => {
  for (const change of ['session', 'items', 'materials']) {
    const { state, pull } = setup()
    let resolve!: (value: any) => void
    state.api.get.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const pending = pull()
    if (change === 'session') state.sheetRevision.current.session++
    if (change === 'items') state.sheetRevision.current.rawItems = [...state.items]
    if (change === 'materials') state.sheetRevision.current.matMap = new Map()
    resolve({ data: state.sources })
    await pending
    expect(state.appendItems).not.toHaveBeenCalled()
  }
})
it('加载的旧货柜响应不能覆盖新货柜候选', async () => {
  const { state, load } = setup()
  let resolveOld!: (value: any) => void, resolveNew!: (value: any) => void
  state.api.get.mockImplementationOnce(() => new Promise(r => { resolveOld = r }))
    .mockImplementationOnce(() => new Promise(r => { resolveNew = r }))
  const oldRequest = load(1), newRequest = load(2)
  resolveNew({ data: state.sources })
  await newRequest
  resolveOld({ data: [] })
  await oldRequest
  expect(state.setOutRows.mock.calls.at(-1)?.[0]).toBe(state.sources)
})
