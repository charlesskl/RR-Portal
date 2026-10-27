import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { shipmentPackingAverageQty, shipmentWeightQuantity } from './shipmentWeight'
import { applyShipmentSheetEdits } from './shipmentSheet'
import { linkShipmentOutbound } from './shipmentOutboundLink'

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
  { _rowKey: 1, material_id: 974, outbound_id: 74, qty: 8150, kg: 738.39, cartons: 82, carton_no: '1-82', qty_per_carton: '100', price: 2 },
  { _rowKey: 2, material_id: 974, outbound_id: 75, qty: 82, kg: 7.4292, cartons: 1, carton_no: '83', qty_per_carton: '100', price: 2 },
]
const materials = new Map([[974, { id: 974, name_zh: '彩盒-FSC', net_per_pc: 0.0906 }]])

it.each([true, false])('汇总视图保存仍逐批保留出库数量（新建=%s）', async creating => {
  const items = structuredClone(rows)
  const consolidatedItems = consolidateShipmentItems(items, materials)
  expect(consolidatedItems).toHaveLength(1)
  expect(consolidatedItems[0].carton_no).toBe('1-82 / 83')
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
  expect(saved.map((row: any) => row.carton_no)).toEqual(['1-82', '83'])
  expect(items).toEqual(rows)

  // Editing one batch changes only its allocation; display consolidation must
  // never spread a revised total over all outbound records.
  items[1] = { ...items[1], qty: 40, kg: 3.624 }
  expect(await runInContext('save()', context)).toBe(true)
  const revised = calls[1][1].items
  expect(revised.map((row: any) => [row.outbound_id, row.qty])).toEqual([[74, 8150], [75, 40]])
})

it('表格批量编辑后保存仍保留每批关联，并将导入物料修改仅写入快照', async () => {
  const snapshot = { name_zh: '导入裁片', net_per_pc: .001, unit_kg: 'KGM' }
  const input = [...structuredClone(rows), { _rowKey: 3, material_id: -3, material_snapshot: snapshot, qty: 100, kg: .1, cartons: 1, qty_per_carton: '100' }]
  const mats = new Map<number, any>([...materials, [-3, snapshot]])
  const result = applyShipmentSheetEdits(input, mats, [
    { row: 1, field: 'qty', value: '40' }, { row: 2, field: 'material:net_per_pc', value: '.002' },
  ])
  const api = { put: vi.fn(async (..._args: any[]) => ({})) }
  const context = createContext({
    items: result.items, creating: false, editing: { id: 9 },
    matMap: result.materials, dirtyMatIds: result.dirtyMaterials, api,
    form: { validateFields: async () => ({ container_no: 'TEST-ONLY', customer: 'RRI' }) },
    setSaving: vi.fn(), setEditing: vi.fn(), setCreating: vi.fn(), setEditorDirty: vi.fn(),
    setDirtyMatIds: vi.fn(), closeEditor: vi.fn(), load: vi.fn(), message: { success: vi.fn() },
    shipmentPackingAverageQty, shipmentWeightQuantity, num: (value: any) => Number(value) || 0,
  })
  runInContext(executable, context)
  expect(await runInContext('save()', context)).toBe(true)
  expect(api.put.mock.calls).toHaveLength(1)
  const saved = api.put.mock.calls[0][1].items
  expect(saved.slice(0, 2).map((row: any) => [row.outbound_id, row.material_id, row.qty])).toEqual([[74, 974, 8150], [75, 974, 40]])
  expect(saved[2]).toMatchObject({ material_id: null, material_snapshot: { net_per_pc: .002 }, kg: .2 })
  expect(saved[2]._rowKey).toBeUndefined()
  expect(snapshot.net_per_pc).toBe(.001)
})

it('导入行确认关联后保存真实物料 ID、出库来源和装箱快照，不写回物料库', async () => {
  const snapshot = { name_zh: '导入彩盒', length: 23, net_per_pc: .2, unit_kg: 'KGM' }
  const imported = { _rowKey: 3, material_id: -3, material_snapshot: snapshot, qty: 2, kg: .4, cartons: 1, carton_no: '10', pallet: 'A' }
  const linked = linkShipmentOutbound([imported], 3, { outbound_id: 74, material_id: 974, allocatable_qty: 10 },
    materials.get(974)!, new Map([[-3, snapshot]]))
  const api = { put: vi.fn(async (..._args: any[]) => ({})) }
  const context = createContext({
    items: linked, creating: false, editing: { id: 9 }, matMap: new Map([[-3, linked[0].material_snapshot]]), dirtyMatIds: new Set(), api,
    form: { validateFields: async () => ({ container_no: 'TEST-ONLY' }) },
    setSaving: vi.fn(), setEditing: vi.fn(), setEditorDirty: vi.fn(), load: vi.fn(), message: { success: vi.fn() },
    shipmentPackingAverageQty, shipmentWeightQuantity, num: (value: any) => Number(value) || 0,
  })
  runInContext(executable, context)
  expect(await runInContext('save()', context)).toBe(true)
  expect(api.put).toHaveBeenCalledTimes(1)
  expect(api.put.mock.calls[0][1].items).toEqual([expect.objectContaining({
    material_id: 974, outbound_id: 74, qty: 2, kg: .4, cartons: 1, carton_no: '10', pallet: 'A',
    material_snapshot: expect.objectContaining({ id: 974, length: 23 }),
  })])
})
