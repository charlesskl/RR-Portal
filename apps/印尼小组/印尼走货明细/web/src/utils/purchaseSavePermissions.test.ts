import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'
import { describe, expect, it, vi } from 'vitest'
import { autoLinkPurchaseMaterials } from './purchaseNetWeight'
import { purchaseItemCodes } from './purchaseCustoms'

// Execute the page's actual save path, not a copy of its permission handling.
const page = readFileSync(new URL('../pages/PurchasePage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('PurchasePage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = ['save', 'loadPurchaseMaterials', 'loadPurchaseMaterialCandidates', 'applyQuotePrices']
const functions: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) functions.push(node.getText(tree))
  ts.forEachChild(node, collect)
}
collect(tree)
const executable = ts.transpileModule(functions.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const original = { product_code: 'SYNTHETIC-A', material_name: 'Synthetic material', spec: 'S1',
  qty: 12, purchase_qty: 12, price: 0.12345678, net_per_pc: 0.25, ship_unit: 'KGM', notes: 'retain' }
const material = { id: 42, product_code: original.product_code, name_zh: original.material_name,
  spec: original.spec, supplier: 'Synthetic supplier', net_per_pc: 99 }

async function saveWithLookup(failure?: { status: number; path: string }, materialId?: number) {
  const items = [{ ...original, ...(materialId == null ? {} : { material_id: materialId }) }]
  const api = {
    get: vi.fn(async (path: string) => {
      if (path === failure?.path) throw Object.assign(new Error('Synthetic lookup failure'), {
        response: { status: failure.status },
      })
      if (path === '/materials') return { data: [material] }
      if (path === '/dictionaries') return { data: { suppliers: [] } }
      if (path === '/quotes/blob') return { data: [] }
      throw new Error(`Unexpected synthetic request: ${path}`)
    }),
    post: vi.fn(async () => ({ data: { id: 1 } })),
  }
  const message = { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() }
  const setItems = vi.fn()
  const context = createContext({
    api, message, items, setItems, autoLinkPurchaseMaterials, purchaseItemCodes, dayjs, productCodes: [original.product_code],
    form: { validateFields: async () => ({ po_no: 'SYNTHETIC-PO', supplier: material.supplier,
      order_date: '2026-10-13', delivery_date: '2026-10-28' }) },
    creating: true, editing: { id: 0 }, setCreating: vi.fn(), setEditing: vi.fn(), load: vi.fn(),
    applyDeliveryDateAll: false, setApplyDeliveryDateAll: vi.fn(),
  })
  runInContext(executable + '\nglobalThis.completed = save()', context)
  await context.completed
  return { api, message, setItems, items }
}

describe('purchase save with optional material lookup permissions', () => {
  it('uses full SKU quotes without borrowing another pack or the family-code price', () => {
    const code = '94704/1099803/6077834'
    const sibling = '94704/1099803/6077835'
    const context = createContext({ purchaseItemCodes })
    runInContext(executable, context)
    context.items = [{ product_code: code, material_name: 'Box', spec: 'S1', purchase_qty: 10, price: 0 }]
    context.quotes = ['94704', sibling, code].map((productCode, index) => ({
      productCode, matName: 'Box', spec: 'S1', supplier: 'Supplier', unitPrice: index + 1, minQty: 0,
    }))
    context.codes = [code, sibling, '94704']
    const result = runInContext("applyQuotePrices(items, quotes, 'Supplier', true, codes)", context)
    expect(result.hit).toBe(1)
    expect(result.items[0].price).toBe(3)
    context.quotes = context.quotes.slice(0, 2)
    expect(runInContext("applyQuotePrices(items, quotes, 'Supplier', true, codes)", context).hit).toBe(0)
  })
  it('links a unique material with access while preserving quantities, price and saved values', async () => {
    const result = await saveWithLookup()
    expect(result.api.post).toHaveBeenCalledTimes(1)
    const [path, payload] = result.api.post.mock.calls[0] as unknown as [string, { items: unknown[] }]
    expect(path).toBe('/purchase')
    expect(payload.items).toEqual([{ ...original, material_id: material.id }])
    expect(result.items).toEqual([original])
    expect(result.message.error).not.toHaveBeenCalled()
  })

  it.each(['/materials', '/dictionaries'])('preserves the original items and saves when %s returns 403', async path => {
    const result = await saveWithLookup({ status: 403, path })
    expect(result.api.post).toHaveBeenCalledTimes(1)
    const [endpoint, payload] = result.api.post.mock.calls[0] as unknown as [string, { items: unknown[] }]
    expect(endpoint).toBe('/purchase')
    expect(payload.items).toEqual([original])
    expect(payload.items[0]).toBe(result.items[0])
    expect(result.setItems).not.toHaveBeenCalled()
    expect(result.message.warning).toHaveBeenCalledWith(expect.stringContaining('权限'))
    expect(result.message.error).not.toHaveBeenCalled()
  })

  it('retains an existing material ID when the by-ID lookup returns 403', async () => {
    const result = await saveWithLookup({ status: 403, path: '/materials/by-ids' }, 42)
    expect(result.api.post).toHaveBeenCalledTimes(1)
    const [, payload] = result.api.post.mock.calls[0] as unknown as [string, { items: unknown[] }]
    expect(payload.items).toEqual([{ ...original, material_id: 42 }])
    expect(payload.items[0]).toBe(result.items[0])
    expect(result.setItems).not.toHaveBeenCalled()
    expect(result.message.warning).toHaveBeenCalledWith(expect.stringContaining('权限'))
    expect(result.message.error).not.toHaveBeenCalled()
  })

  it('still blocks saving on a non-permission lookup failure', async () => {
    const result = await saveWithLookup({ status: 500, path: '/materials' })
    expect(result.api.post).not.toHaveBeenCalled()
    expect(result.setItems).not.toHaveBeenCalled()
    expect(result.message.error).toHaveBeenCalledWith(expect.stringContaining('尚未保存'))
    expect(result.message.warning).not.toHaveBeenCalled()
    expect(result.items).toEqual([original])
  })
})
