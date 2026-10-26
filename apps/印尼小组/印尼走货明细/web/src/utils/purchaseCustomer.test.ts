import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'
import { describe, expect, it, vi } from 'vitest'
import { assertPurchaseCustomer, purchaseLineCustomers, purchaseScheduleCustomer } from './purchaseCustomer'
import { purchaseMaterialBucket, purchaseMaterialLine, purchaseSelectionSource, purchaseSelectionSupplier } from './purchaseMaterialSelection'
import { purchaseItemCodes } from './purchaseCustoms'
import { purchaseOrderNumbers } from './purchaseOrderMerge'
import { poDetermineEntity, poGenContractNo, poLineCurrency } from './poNumber'
import { linkPurchaseLine } from './purchaseScheduleLink'

const fullCode = '94704/1099803/6077834'
const spin = { code: fullCode, customer: 'Spin Master', source: 'Spin Master', orderNo: 'SPIN-1', qty: 100 }
const tomy = { code: '47712A', customer: 'TOMY', source: 'KIK', orderNo: 'TOMY-1', qty: 200 }
const products = [spin, tomy].map(row => ({ code: row.code, customer: row.customer }))

// Exercise the real batch/append handlers with a mocked API: never submit a
// synthetic order to the user's database, and do not duplicate page logic.
const page = readFileSync(new URL('../pages/PurchasePage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('PurchasePage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = ['generateBySupplier', 'confirmMaterials', 'materialChoiceCustomer', 'applyQuotePrices', 'applyAutoSpoilage', 'spoilageRate', 'roundPurchaseQuantity']
const functions: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) functions.push(node.getText(tree))
  ts.forEachChild(node, collect)
}
collect(tree)
const executable = ts.transpileModule(functions.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function harness(schedules = [spin, tomy], mode = 'generate') {
  const api = { get: vi.fn(async () => ({ data: [] })), post: vi.fn(async () => ({ data: {} })) }
  const message = { warning: vi.fn(), success: vi.fn() }
  const setItems = vi.fn()
  const context = createContext({
    api, message, dayjs, purchaseMaterialBucket, purchaseMaterialLine, purchaseSelectionSource, purchaseSelectionSupplier,
    assertPurchaseCustomer, purchaseLineCustomers, purchaseScheduleCustomer, purchaseItemCodes,
    purchaseOrderNumbers, poDetermineEntity, poGenContractNo, poLineCurrency,
    rows: [], items: [], schedRows: schedules, purchaseProducts: products, productCodes: products.map(p => p.code),
    materialSelection: { mode, schedules },
    resolveProductCode: (code: string) => code,
    confirmBatchOrder: vi.fn(async () => 'HS'),
    form: { getFieldValue: (key: string) => key === 'supplier' ? 'Same Supplier' : 'IRRIHS0405' },
    setItems, setMergeUndo: vi.fn(), setSchedPickerOpen: vi.fn(), setPickerSelKeys: vi.fn(),
    setEditing: vi.fn(), setCreating: vi.fn(), setDrawerFull: vi.fn(), load: vi.fn(),
  })
  runInContext(executable, context)
  context.choices = schedules.map((row, index) => ({
    key: String(index), groupKey: String(index), productCode: row.code, quantity: row.qty,
    material: { id: index + 1, supplier: 'Same Supplier', name_zh: 'Box', spec: 'S1', usage_qty: 2, category: '彩盒' },
  }))
  return { context, api, message, setItems }
}

describe('purchase customer isolation', () => {
  it('normalizes Spin aliases while preserving legacy TOMY sources', () => {
    expect(purchaseScheduleCustomer({ customer: ' SPIN MASTER ' })).toBe('Spin Master')
    expect(purchaseScheduleCustomer({ source: 'spin' })).toBe('Spin Master')
    for (const source of [undefined, 'RRI', 'KIK', 'RRM']) expect(purchaseScheduleCustomer({ source })).toBe('TOMY')
    expect(purchaseMaterialBucket('Spin Master', 'S')).not.toBe(purchaseMaterialBucket('KIK', 'S'))
    expect(purchaseMaterialBucket('RRI', 'S', undefined, 'SPIN')).not.toBe(purchaseMaterialBucket('RRI', 'S', undefined, 'TOMY'))
    expect(purchaseMaterialBucket('Spin Master', 'S')).toBe(purchaseMaterialBucket('spin', 'S', undefined, 'spin master'))
  })
  it('uses linked order customer, or catalogue customer when the old order is absent from latest schedules', () => {
    expect(purchaseLineCustomers([{ product_code: fullCode, tomy_po: 'SPIN-1' }], [spin], products)).toEqual(['Spin Master'])
    expect(purchaseLineCustomers([{ product_code: fullCode, tomy_po: 'OLD' }], [], products)).toEqual(['Spin Master'])
    expect(purchaseLineCustomers([{ product_code: 'LEGACY' }], [], [{ code: 'LEGACY' }])).toEqual(['TOMY'])
    expect(purchaseLineCustomers([{ product_code: fullCode + ' / 47712A' }], [], products)).toEqual(['Spin Master', 'TOMY'])
    expect(purchaseLineCustomers([{ product_code: 'unknown' }], [], products)).toEqual([undefined])
  })
  it('refuses mixed or unidentified customers without guessing from the PO prefix', () => {
    expect(assertPurchaseCustomer(['SPIN', 'Spin Master'], ['spin master'])).toBe('Spin Master')
    expect(() => assertPurchaseCustomer(['Spin Master', 'TOMY'])).toThrow('不同客户')
    expect(() => assertPurchaseCustomer(['Spin Master'], ['TOMY'])).toThrow('客户不一致')
    expect(() => assertPurchaseCustomer(['TOMY'], [undefined])).toThrow('未能确认')
    expect(() => assertPurchaseCustomer(['TOMY'], ['Spin Master', 'TOMY'])).toThrow('包含不同客户')
  })
  it('generates two supplier orders for mixed customers and keeps same-customer rows together', async () => {
    const { context, api } = harness([spin, tomy, { ...spin, orderNo: 'SPIN-2', qty: 50 }])
    expect(await runInContext('generateBySupplier(choices)', context)).toBe(true)
    expect(api.post).toHaveBeenCalledTimes(2)
    const payloads = api.post.mock.calls.map(call => (call as unknown as [string, any])[1])
    expect(payloads.map(p => p.po_no)).toEqual(['IRRIHS0405', 'IRRIHS0406'])
    expect(payloads[0].items).toHaveLength(1)
    expect(payloads[0].items[0]).toMatchObject({ product_code: fullCode, ordered_qty: 150, material_qty: 300,
      purchase_qty: 303, tomy_po: 'SPIN-1; SPIN-2' })
    expect(payloads[1].items[0]).toMatchObject({ product_code: '47712A', ordered_qty: 200, material_qty: 400, purchase_qty: 404 })
  })
  it('rounds half-integer usage products up when generating a supplier order', async () => {
    const { context, api } = harness([spin])
    context.choices[0].material = { ...context.choices[0].material, usage_qty: 0.145, category: '耗材' }
    expect(await runInContext('generateBySupplier(choices)', context)).toBe(true)
    const payload = (api.post.mock.calls[0] as unknown as [string, any])[1]
    expect(payload.items[0]).toMatchObject({ ordered_qty: 100, material_qty: 100 * 0.145, qty: 15, purchase_qty: 15 })
  })
  it('blocks cross-customer append before changing items or sending an API request', async () => {
    const { context, api, setItems, message } = harness([spin], 'append')
    context.items = [{ product_code: tomy.code, tomy_po: 'OLD-TOMY' }]
    expect(await runInContext('confirmMaterials(choices)', context)).toBe(false)
    expect(setItems).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
    expect(message.warning).toHaveBeenCalledWith(expect.stringContaining('客户不一致'))
  })
  it('allows same-customer append even when its old schedule is no longer latest', async () => {
    const { context, setItems } = harness([spin], 'append')
    context.items = [{ product_code: spin.code, tomy_po: 'OLD-SPIN' }]
    expect(await runInContext('confirmMaterials(choices)', context)).toBe(true)
    expect(setItems).toHaveBeenCalledTimes(1)
  })
  it('also separates material-library batches using catalogue customers', async () => {
    const { context, api } = harness()
    context.materialSelection = { mode: 'generate' }
    context.choices = context.choices.map((choice: any) => ({ ...choice, groupKey: undefined }))
    expect(await runInContext('generateBySupplier(choices)', context)).toBe(true)
    expect(api.post).toHaveBeenCalledTimes(2)
  })
  it('refuses append when the existing customer cannot be recovered', async () => {
    const { context, setItems, message } = harness([spin], 'append')
    context.items = [{ product_code: 'unknown', tomy_po: 'OLD' }]
    expect(await runInContext('confirmMaterials(choices)', context)).toBe(false)
    expect(setItems).not.toHaveBeenCalled()
    expect(message.warning).toHaveBeenCalledWith(expect.stringContaining('未能确认'))
  })
  it('prevents relinking one row into another customer order', () => {
    const target = { product_code: spin.code }
    const existing = { product_code: tomy.code, tomy_po: tomy.orderNo }
    expect(() => linkPurchaseLine(target, spin, [spin, tomy], [target, existing], 'IRRIHS0405', products)).toThrow('客户不一致')
  })
})
