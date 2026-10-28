import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { linkShipmentOutbound } from './shipmentOutboundLink'

const text = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler = ''
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'confirmOutboundLink') handler = node.getText(tree)
  ts.forEachChild(node, collect)
}
collect(tree)
const code = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function setup() {
  const source = { outbound_id: 7, material_id: 66, allocatable_qty: 10, po_no: 'IRRIHS1', purchase_unit: '个' }
  const material = { id: 66, name_zh: '中边模', length: 23 }
  const row = { _rowKey: 1, material_id: 66, qty: 2, kg: .2, cartons: 1 }
  const state = {
    linkRowKey: 1, linkSelected: 7, linkConfirmed: true, linkBusy: false, linkRequest: { current: 1 },
    editing: { id: 11 }, linkRows: [source], linkShipmentOutbound,
    sheetRevision: { current: { rawItems: [row], matMap: new Map([[66, material]]) } },
    api: { get: vi.fn(async (url: string) => ({ data: url === '/outbound/allocatable' ? [source] : [material] })) },
    setLinkBusy: vi.fn(), setLinkRows: vi.fn(), setLinkConfirmed: vi.fn(), setMatMap: vi.fn(), setItems: vi.fn(),
    setEditorDirty: vi.fn(), applyPartition: vi.fn(), closeOutboundLink: vi.fn(), message: { success: vi.fn(), error: vi.fn() },
  }
  const ctx = createContext(state); runInContext(code, ctx)
  return { state, source, run: () => runInContext('confirmOutboundLink()', ctx) }
}
it('refreshes balance and binds the existing row in editor only, without API writes', async () => {
  const { state, run } = setup(); await run()
  expect(state.api.get).toHaveBeenNthCalledWith(1, '/outbound/allocatable', { params: { shipment_id: 11 } })
  expect(state.setItems.mock.calls[0][0]).toEqual([expect.objectContaining({ _rowKey: 1, material_id: 66, outbound_id: 7, qty: 2, kg: .2, cartons: 1 })])
  expect(state.setEditorDirty).toHaveBeenCalledWith(true)
  expect(state.closeOutboundLink).toHaveBeenCalledOnce()
})
it('关联后使用出库收费比例，但不减少原有走货数量和重量', async () => {
  const { state, source, run } = setup()
  Object.assign(source, { purchase_charge_ratio: .9, price: 2 })
  await run()
  expect(state.setItems.mock.calls[0][0][0]).toMatchObject({ qty: 2, kg: .2, price: 2, purchase_charge_ratio: .9 })
})
it('requires explicit material confirmation before any request', async () => {
  const { state, run } = setup(); state.linkConfirmed = false; await run()
  expect(state.api.get).not.toHaveBeenCalled()
  expect(state.setItems).not.toHaveBeenCalled()
})
it('rejects newly exhausted balance without changing the row', async () => {
  const { state, source, run } = setup()
  state.api.get.mockResolvedValueOnce({ data: [{ ...source, allocatable_qty: 1 }] })
  await run()
  expect(state.setItems).not.toHaveBeenCalled()
  expect(state.message.error).toHaveBeenCalledWith(expect.stringContaining('超过'))
})
it('rejects changed source metadata and asks for renewed confirmation', async () => {
  const { state, source, run } = setup()
  state.api.get.mockResolvedValueOnce({ data: [{ ...source, po_no: 'IRRIHS2' }] })
  await run()
  expect(state.setItems).not.toHaveBeenCalled()
  expect(state.setLinkConfirmed).toHaveBeenCalledWith(false)
})
it.each(['cancel', 'edit'])('does not apply stale async response after %s', async action => {
  const { state, source, run } = setup()
  state.api.get.mockImplementationOnce(async () => {
    if (action === 'cancel') state.linkRequest.current++
    else state.sheetRevision.current.rawItems = [...state.sheetRevision.current.rawItems]
    return { data: [source] }
  })
  await run()
  expect(state.setItems).not.toHaveBeenCalled()
  expect(state.setMatMap).not.toHaveBeenCalled()
})
