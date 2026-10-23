import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx-js-style'
import { describe, expect, it, vi } from 'vitest'
import { numToChinese, PO_ENTITY_META } from './poNumber'
import { formatPurchaseContractFonts, formatPurchaseContractTotals, roundPurchaseContractAmount, setPurchaseContractLineAmounts } from './purchaseContractWorkbook'
import { purchaseLineDeliveryDate, purchaseLineSourceKey } from './purchaseOrderMerge'

// Execute the real page handlers/exporter so UI changes cannot bypass the tested path.
const source = readFileSync(new URL('../pages/PurchasePage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = ['openOrderMerge', 'mergeOrders', 'changeWholeDeliveryDate', 'buildContractSheet', 'shipQuantity', 'shipQuantityDigits', 'contractUnitLabel']
const functions: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) functions.push(node.getText(tree))
  ts.forEachChild(node, collect)
}
collect(tree)
const executable = ts.transpileModule(functions.join('\n').replace("const XLSX = await import('xlsx-js-style')", ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText

function context(overrides: Record<string, unknown> = {}) {
  const sandbox = createContext({
    dayjs, XLSX, PO_ENTITY_META, numToChinese, purchaseLineDeliveryDate, purchaseLineSourceKey,
    formatPurchaseContractFonts, formatPurchaseContractTotals, roundPurchaseContractAmount, setPurchaseContractLineAmounts,
    api: { post: vi.fn(async () => ({ data: { id: 2, po_no: '20269002', item_count: 2 } })), get: vi.fn(async () => ({ data: [] })) },
    selectedOrders: [1, 2].map(id => ({ id, po_no: `2026900${id}`, status: 'draft', supplier: 'Supplier', order_date: `2026-10-${18 + id}` })),
    mergeTarget: 2, mergingOrders: false, load: vi.fn(), loadPurchaseMaterials: async () => new Map(), resolveProductCode: (x: string) => x,
    message: { warning: vi.fn(), success: vi.fn() }, setMergeTarget: vi.fn(), setMergeOrdersOpen: vi.fn(), setPoSelKeys: vi.fn(), setMergingOrders: vi.fn(),
    ...overrides,
  })
  runInContext(executable, sandbox)
  return sandbox
}

describe('purchase merge page flow', () => {
  it('previews the whole-order date and exports it without replacing the original source dates', async () => {
    const lines = [1, 2].map(id => ({ product_code: '35874', material_name: 'FSC', purchase_qty: 10, price: 1,
      ship_unit: 'PCE', source_po_no: `2026900${id}`, source_delivery_date: `2026-10-${22 + id}` }))
    const c = context({ setApplyDeliveryDateAll: vi.fn(), setItems: (apply: (items: typeof lines) => unknown) => { c.items = apply(lines) } })
    runInContext("changeWholeDeliveryDate(dayjs('2026-12-01'))", c)
    expect(c.setApplyDeliveryDateAll).toHaveBeenCalledWith(true)
    expect(c.items.map((it: typeof lines[number]) => it.source_delivery_date)).toEqual(['2026-10-23', '2026-10-24'])
    c.order = { id: 1, po_no: '20269001', supplier: 'Supplier', order_date: '2026-10-19', delivery_date: '2026-12-01', items: c.items }
    const { ws } = await runInContext('buildContractSheet(order)', c)
    expect(ws.H10.v).toBe('数量：10pcs')
    expect(ws.H11.v).toBe('数量：10pcs')
    expect(ws.A15.v).toContain('2026年12月1日')
    expect(ws.G13.v).toBe(20)
  })
  it('allows different order dates, opens confirmation without writing, then sends the selected target and IDs', async () => {
    const c = context()
    runInContext('openOrderMerge()', c)
    expect(c.api.post).not.toHaveBeenCalled()
    expect(c.setMergeOrdersOpen).toHaveBeenCalledWith(true)
    await runInContext('mergeOrders()', c)
    expect(c.api.post).toHaveBeenCalledWith('/purchase/merge', { target_id: 2, ids: [1, 2] })
    expect(c.setPoSelKeys).toHaveBeenCalledWith([])
    expect(c.load).toHaveBeenCalledOnce()
  })
  it('retains the selection and confirmation when the server rejects the merge', async () => {
    const c = context({ api: { post: vi.fn(async () => { throw new Error('occupied') }) } })
    await runInContext('mergeOrders()', c)
    expect(c.setPoSelKeys).not.toHaveBeenCalled()
    expect(c.setMergeOrdersOpen).not.toHaveBeenCalled()
    expect(c.setMergingOrders).toHaveBeenLastCalledWith(false)
  })
  it('does not offer merging sent orders', () => {
    const c = context({ selectedOrders: [{ id: 1, status: 'draft' }, { id: 2, status: 'sent' }] })
    runInContext('openOrderMerge()', c)
    expect(c.setMergeOrdersOpen).not.toHaveBeenCalled()
    expect(c.message.warning).toHaveBeenCalled()
  })
  it('keeps source rows and amounts but exports quantity-only notes and the whole-order date', async () => {
    const line = { product_code: '35874', material_name: 'FSC', spec: 'same', purchase_qty: 20200, ship_unit: 'PCE' }
    const c = context({ order: {
      id: 1, po_no: '20269001', supplier: 'Supplier', order_date: '2026-10-19', delivery_date: '2026-11-01',
      items: [
        { ...line, price: 0.08, source_po_no: '20269001', source_delivery_date: '2026-10-23' },
        { ...line, price: 0.07, source_po_no: '20269002', source_delivery_date: '2026-10-28' },
      ],
    } })
    const { ws } = await runInContext('buildContractSheet(order)', c)
    expect(ws.G10.v).toBe(1616)
    expect(ws.G11.v).toBe(1414)
    expect(ws.G13.v).toBe(3030)
    expect(ws.H10.v).toBe('数量：20200pcs')
    expect(ws.H11.v).toBe('数量：20200pcs')
    expect(ws.A15.v).toContain('2026年11月1日')
    expect(ws['!rows'][9].hpt).toBe(45)
  })
})
