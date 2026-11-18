import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { linkShipmentOutboundBatches } from './shipmentOutboundBatchLink'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { parseShipmentPacking } from './shipmentWeight'
import { cartonLayout } from './shipmentOrder'
import { shipmentCbmPerCarton, shipmentCbmTotal, shipmentGrossPerPc, shipmentNetTotalKg, shipmentWeightQuantity } from './shipmentWeight'
import { shipmentPurchaseAmount, shipmentPurchaseLineAmount, shipmentPurchaseTotal } from './shipmentPurchase'
import type { Material } from '../api/client'

const text = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler = ''
let validateHandler = ''
let totalHandler = ''
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'confirmOutboundLink') handler = node.getText(tree)
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'computeValidation') validateHandler = node.getText(tree)
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'tot' && node.initializer && ts.isCallExpression(node.initializer))
    totalHandler = node.initializer.arguments[0].getText(tree)
  ts.forEachChild(node, collect)
}
collect(tree)
const code = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function setup() {
  const source = { outbound_id: 7, material_id: 66, allocatable_qty: 10, po_no: 'IRRIHS1', purchase_unit: '个' }
  const material = { id: 66, name_zh: '中边模', length: 23 }
  const row = { _rowKey: 1, material_id: 66, qty: 2, kg: .2, cartons: 1 }
  const state = {
    linkRowKey: 1, linkSelected: [7], linkQuantities: { 7: 2 } as Record<number, number>, linkConfirmed: true, linkBusy: false, linkRequest: { current: 1 },
    editing: { id: 11 }, linkRows: [source], linkShipmentOutboundBatches, createCartonGroupId: () => 'batch-test',
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

it('refreshes every selected batch, splits only the original row, and preserves both source purchase amounts', async () => {
  const { state, source, run } = setup()
  Object.assign(source, { price: 3 })
  const second = { ...source, outbound_id: 8, po_no: 'IRRIHS2', price: 5, purchase_charge_ratio: .8 }
  state.linkRows.push(second)
  state.linkSelected = [7, 8]
  state.linkQuantities = { 7: .5, 8: 1.5 }
  state.api.get.mockResolvedValueOnce({ data: [source, second] })
  await run()
  expect(state.setItems).toHaveBeenCalledOnce()
  expect(state.setItems.mock.calls[0][0]).toEqual([
    expect.objectContaining({ outbound_id: 7, qty: .5, kg: .05, price: 3, po_no: 'IRRIHS1' }),
    expect.objectContaining({ outbound_id: 8, qty: 1.5, kg: .15, price: 5, po_no: 'IRRIHS2', purchase_charge_ratio: .8 }),
  ])
  expect(state.api.get.mock.calls.every(call => !call[0].includes('/purchase/'))).toBe(true)
})

it.each(['changed', 'missing', 'exhausted'])('rejects the entire multi-selection when the second source is %s', async failure => {
  const { state, source, run } = setup()
  Object.assign(source, { price: 3 })
  const second = { ...source, outbound_id: 8, po_no: 'IRRIHS2' }
  state.linkRows.push(second); state.linkSelected = [7, 8]; state.linkQuantities = { 7: 1, 8: 1 }
  const updated = failure === 'changed' ? { ...second, price: 4 } : { ...second, allocatable_qty: 0 }
  state.api.get.mockResolvedValueOnce({ data: failure === 'missing' ? [source] : [source, updated] })
  await run()
  expect(state.setItems).not.toHaveBeenCalled()
  expect(state.setMatMap).not.toHaveBeenCalled()
  expect(state.closeOutboundLink).not.toHaveBeenCalled()
  expect(state.message.error).toHaveBeenCalled()
})

it('validates the original physical packing total after splitting source allocations instead of flagging every batch', async () => {
  const material = { id: 66, name_zh: '中边模', unit_kg: 'KGM' }
  const input = { _rowKey: 1, material_id: 66, qty: 3, kg: .0001, cartons: 2, qty_per_carton: '1/1 2/2' }
  const linked: Array<typeof input & { material_snapshot?: typeof material }> = linkShipmentOutboundBatches([input], 1, [
    { source: { outbound_id: 7, material_id: 66, allocatable_qty: 1, price: 2, supplier: 'A', po_no: 'IRRIHS1' }, qty: 1 },
    { source: { outbound_id: 8, material_id: 66, allocatable_qty: 2, price: 3, supplier: 'A', po_no: 'IRRIHS2' }, qty: 2 },
  ], material, new Map([[66, material]]), 'packing')
  const items = linked.map((item, index) => ({ ...item, _rowKey: index + 1, material_id: -(index + 1) }))
  const matMap = new Map(items.map(item => [item.material_id, item.material_snapshot!]))
  const context = createContext({ items, matMap, consolidatedItems: consolidateShipmentItems(items, matMap),
    form: { getFieldsValue: () => ({ container_no: 'TEST', ship_date: '2026-11-02', load_date: '2026-11-02', rate: 1 }) },
    partitionOf: () => 'RRI', parseShipmentPacking, decimals: () => 4, shipmentGrossPerPc: () => 0, effectiveWeighingQty: () => 0,
  })
  runInContext(ts.transpileModule(validateHandler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const result = await runInContext('computeValidation()', context)
  expect(result.hard).toEqual([])
  expect(result.warn.some((message: string) => message.includes('分段合计'))).toBe(false)
})

it('counts CBM once per physical carton even when packing rows or legacy metadata differ', () => {
  const material = { id: 66, name_zh: '中边模', unit_kg: 'KGM', length: 30, width: 20, height: 10 }
  const original = { _rowKey: 1, material_id: 66, material_snapshot: undefined as Material | undefined,
    qty: 10, kg: 2.0001, cartons: 2, qty_per_carton: '1/4 2/6' }
  const sources = [
    { source: { outbound_id: 7, material_id: 66, allocatable_qty: 4, price: 2 }, qty: 4 },
    { source: { outbound_id: 8, material_id: 66, allocatable_qty: 6, price: 3 }, qty: 6 },
  ]
  const linked = linkShipmentOutboundBatches([original], 1, sources, material, new Map([[66, material]]), 'physical')
    .map((item, index) => ({ ...item, _rowKey: index + 1, material_id: -(index + 1) }))
  const totals = (items: typeof linked) => {
    const matMap = new Map(items.map(item => [item.material_id, item.material_snapshot!]))
    const context = createContext({ items, matMap, consolidatedItems: consolidateShipmentItems(items, matMap),
      cartonRows: cartonLayout(items, matMap), shipmentCbmPerCarton, shipmentCbmTotal, shipmentNetTotalKg, shipmentGrossPerPc, shipmentWeightQuantity, shipmentPurchaseAmount, shipmentPurchaseLineAmount, shipmentPurchaseTotal,
      effectiveWeighingQty: () => 0 })
    return runInContext(ts.transpileModule(`(${totalHandler})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  }
  expect(totals(linked)).toMatchObject({ cbm: .01, cartons: 2, qty: 10, amount: 26 })
  expect(totals(linked).kg).toBeCloseTo(2.0001, 8)
  const distinctPacking = linked.map((item, index) => index ? { ...item, qty_per_carton: '1/2 2/4' } : item)
  // Packing contents may differ within the same physical carton group.
  expect(totals(distinctPacking).cbm).toBe(.01)
  const distinctGroup = linked.map((item, index) => index ? { ...item, carton_group: 'other' } : item)
  expect(totals(distinctGroup).cbm).toBe(.02)
  const legacy = linked.map(item => ({ ...item, material_snapshot: { ...item.material_snapshot!, shipment_outbound_link_group: undefined } }))
  expect(totals(legacy).cbm).toBe(.01)
})
