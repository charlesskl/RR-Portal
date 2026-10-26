import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import dayjs from 'dayjs'
import { expect, it, vi } from 'vitest'

const page = readFileSync(new URL('../pages/PurchasePage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('PurchasePage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const names = ['spoilageRate', 'roundPurchaseQuantity', 'applyAutoSpoilage', 'patchPoItem', 'restoreSavedSpoilage', 'shipQuantity', 'save']
const functions: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) functions.push(node.getText(tree))
  ts.forEachChild(node, collect)
}
collect(tree)
const code = ts.transpileModule(functions.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function calculate(expression: string, item: Record<string, unknown>) {
  const context = createContext({ item })
  runInContext(code, context)
  return runInContext(expression, context)
}

it.each([
  "applyAutoSpoilage({ ...item, material_qty: item.ordered_qty * item.usage_qty })",
  "patchPoItem(item, 'ordered_qty', 100)",
  "patchPoItem(item, 'usage_qty', 0.145)",
  "patchPoItem(item, 'spoilage_qty', 0)",
])('半整数乘法尾差在实际计算路径中向上取整：%s', expression => {
  const row = calculate(expression, {
    usage_qty: 0.145, ordered_qty: 100, material_qty: 100 * 0.145, category: '耗材',
  })
  expect(row.purchase_qty).toBe(15)
  expect(row.qty).toBe(15)
})

it.each([
  { quantity: 0, expected: 0 },
  { quantity: 0.499999999999999, expected: 0 },
  { quantity: 0.5, expected: 1 },
  { quantity: 14.49999999999999, expected: 14 },
  { quantity: 100 * 0.145, expected: 15 },
  { quantity: 14.50000000000001, expected: 15 },
  { quantity: 2 ** 50 + 0.25, expected: 2 ** 50 },
  { quantity: 2 ** 51 + 0.25, expected: 2 ** 51 },
  { quantity: 2 ** 51 + 0.5, expected: 2 ** 51 + 1 },
  { quantity: Number.MAX_SAFE_INTEGER, expected: Number.MAX_SAFE_INTEGER },
  { quantity: Infinity, expected: Infinity },
  { quantity: NaN, expected: NaN },
])('整数取整仅修正半整数附近的二进制尾差 %j', ({ quantity, expected }) => {
  expect(calculate('roundPurchaseQuantity(item.quantity)', { quantity })).toBe(expected)
})

it('分数用量的尾差不再产生 2500.01 个采购量', () => {
  const row = calculate("patchPoItem(item, 'spoilage_qty', 0)", {
    usage_qty: 0.166667, ordered_qty: 15000, material_qty: 2500.005, price: 0.63,
  })
  expect(row.purchase_qty).toBe(2500)
  expect(row.qty).toBe(2500)
  expect(row.qty * row.price).toBe(1575)
})

it.each([0, 10.49, 10.5, 2500.005, 2500.01])('自动损耗后的采购量四舍五入为整数 %s', material_qty => {
  const row = calculate('applyAutoSpoilage(item)', { material_qty, category: '其它类' })
  const loss = Math.round(material_qty * 0.01 * 100) / 100
  expect(row.purchase_qty).toBe(Math.round(material_qty + loss))
  expect(row.qty).toBe(row.purchase_qty)
})

it.each(['ordered_qty', 'usage_qty', 'category', 'spoilage_qty'])('修改 %s 后真实采购数量为整数', field => {
  const value = field === 'category' ? "'其它类'" : '0.166667'
  const row = calculate(`patchPoItem(item, '${field}', ${value})`, {
    ordered_qty: 15000, usage_qty: 0.166667, material_qty: 2500.005, spoilage_qty: 0,
  })
  expect(Number.isInteger(row.purchase_qty)).toBe(true)
  expect(row.qty).toBe(row.purchase_qty)
})

it('未入库草稿打开时取整，已有入库及非草稿历史值保留', () => {
  const row = { purchase_qty: 2500.01, qty: 2500.01, material_qty: 2500.005, spoilage_qty: 0, price: 0.63 }
  expect(calculate('restoreSavedSpoilage(item, true)', row).purchase_qty).toBe(2500)
  expect(calculate('restoreSavedSpoilage(item)', row).purchase_qty).toBe(2500.01)
  expect(calculate('restoreSavedSpoilage(item, true)', { ...row, received_qty: 1 }).purchase_qty).toBe(2500.01)
  expect(calculate('restoreSavedSpoilage(item, true)', { ...row, spare_qty: 1 }).purchase_qty).toBe(2500.01)
})

it('打开半整数尾差草稿时取整，已有入库/备品和非草稿仍保留原数量', () => {
  const quantity = 100 * 0.145
  const row = { purchase_qty: quantity, qty: quantity, material_qty: quantity, spoilage_qty: 0 }
  expect(calculate('restoreSavedSpoilage(item, true)', row).purchase_qty).toBe(15)
  expect(calculate('restoreSavedSpoilage(item)', row).purchase_qty).toBe(quantity)
  expect(calculate('restoreSavedSpoilage(item, true)', { ...row, received_qty: 1 }).purchase_qty).toBe(quantity)
  expect(calculate('restoreSavedSpoilage(item, true)', { ...row, spare_qty: 1 }).purchase_qty).toBe(quantity)
})

it('采购量取整不截断千克/吨走货重量', () => {
  const row = { purchase_qty: 2500, net_per_pc: 0.0004, ship_unit: 'TNE' }
  expect(calculate('shipQuantity(item)', row)).toBe(0.001)
  expect(calculate('shipQuantity(item)', { ...row, ship_unit: 'KGM' })).toBe(1)
})

it.each([
  { creating: true, status: 'draft', received: 0, expected: 2500 },
  { creating: false, status: 'draft', received: 0, expected: 2500 },
  { creating: false, status: 'draft', received: 1, expected: 2500.01 },
  { creating: false, status: 'received', received: 1, expected: 2500.01 },
  { creating: false, status: 'sent', received: 0, expected: 2500.01 },
  { creating: true, status: 'draft', received: 0, quantity: 100 * 0.145, expected: 15 },
  { creating: false, status: 'draft', received: 0, quantity: 100 * 0.145, expected: 15 },
  { creating: false, status: 'draft', received: 1, quantity: 100 * 0.145, expected: 100 * 0.145 },
  { creating: false, status: 'sent', received: 0, quantity: 100 * 0.145, expected: 100 * 0.145 },
])('保存真实页面采购量同步到 qty，不覆盖已执行记录 %j', async scenario => {
  const quantity = scenario.quantity ?? 2500.01
  const item = { purchase_qty: quantity, qty: quantity, received_qty: scenario.received, price: 0.63, ship_unit: 'KGM' }
  const api = { post: vi.fn(async (..._args: any[]) => ({ data: { id: 1 } })), put: vi.fn(async (..._args: any[]) => ({})) }
  const context = createContext({
    items: [item], api, dayjs, creating: scenario.creating, editing: { id: 1, status: scenario.status },
    form: { validateFields: async () => ({ po_no: 'TEST', status: scenario.status }) },
    loadPurchaseMaterialCandidates: async () => ({ materials: [], profiles: [] }),
    autoLinkPurchaseMaterials: (items: unknown[]) => ({ items, linked: 0, issues: [] }),
    setItems: vi.fn(), setEditing: vi.fn(), setCreating: vi.fn(), load: vi.fn(),
    message: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
    applyDeliveryDateAll: false, setApplyDeliveryDateAll: vi.fn(),
  })
  runInContext(code, context)
  await runInContext('save()', context)
  const calls = scenario.creating ? api.post.mock.calls : api.put.mock.calls
  expect(calls).toHaveLength(1)
  expect(calls[0][1].items[0]).toMatchObject({ purchase_qty: scenario.expected, qty: scenario.expected, price: 0.63 })
  expect(item.purchase_qty).toBe(quantity)
})
