import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { shipmentPackingAverageQty, shipmentWeightQuantity } from './shipmentWeight'

// Execute the actual page save handler against a mock API. No business records
// are created while verifying that the one-row view still saves both batches.
const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('ShipmentsPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const functions: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && ['save', 'effectiveWeighingQty'].includes(node.name.text))
    functions.push(node.getText(tree))
  ts.forEachChild(node, collect)
}
collect(tree)
const executable = ts.transpileModule(functions.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const rows = [
  { _rowKey: 1, material_id: 974, outbound_id: 74, qty: 8150, kg: 738.39, cartons: 82, qty_per_carton: '100', price: 2 },
  { _rowKey: 2, material_id: 974, outbound_id: 75, qty: 82, kg: 7.4292, cartons: 1, qty_per_carton: '100', price: 2 },
]
const materials = new Map([[974, { id: 974, name_zh: '彩盒-FSC', net_per_pc: 0.0906 }]])

it.each([true, false])('汇总视图保存仍逐批保留出库数量（新建=%s）', async creating => {
  const items = structuredClone(rows)
  const consolidatedItems = consolidateShipmentItems(items, materials)
  expect(consolidatedItems).toHaveLength(1)
  const api = { post: vi.fn(async (..._args: any[]) => ({ data: { id: 9 } })), put: vi.fn(async (..._args: any[]) => ({})) }
  const context = createContext({
    items, consolidatedItems, showConsolidated: true, creating, editing: creating ? null : { id: 9 },
    matMap: materials, dirtyMatIds: new Set(), api,
    form: { validateFields: async () => ({ container_no: 'TEST-ONLY', customer: 'RRI' }) },
    setSaving: vi.fn(), setEditing: vi.fn(), setCreating: vi.fn(), setEditorDirty: vi.fn(),
    setDirtyMatIds: vi.fn(), closeEditor: vi.fn(), load: vi.fn(), message: { success: vi.fn() },
    shipmentPackingAverageQty, shipmentWeightQuantity, num: (value: any) => Number(value) || 0,
  })
  runInContext(executable, context)
  expect(await runInContext('save()', context)).toBe(true)
  const calls = creating ? api.post.mock.calls : api.put.mock.calls
  expect(calls).toHaveLength(1)
  const saved = calls[0][1].items
  expect(saved.map((row: any) => [row.outbound_id, row.qty, row.kg, row.cartons]))
    .toEqual([[74, 8150, 738.39, 82], [75, 82, 7.4292, 1]])
  expect(saved.every((row: any) => !row.sources && !row.outbound_ids)).toBe(true)
  expect(items).toEqual(rows)

  // Editing one batch changes only its allocation; display consolidation must
  // never spread a revised total over all outbound records.
  items[1] = { ...items[1], qty: 40, kg: 3.624 }
  expect(await runInContext('save()', context)).toBe(true)
  const revised = calls[1][1].items
  expect(revised.map((row: any) => [row.outbound_id, row.qty])).toEqual([[74, 8150], [75, 40]])
})
