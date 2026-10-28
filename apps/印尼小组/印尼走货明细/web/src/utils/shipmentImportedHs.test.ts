import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { applyShipmentSheetEdits, parseShipmentSheetValue, sheetFillDownEdits, sheetPasteEdits, shipmentSheetFields } from './shipmentSheet'
import { applyMergedShipmentEdits } from './shipmentMergedEditor'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { shipmentPackingAverageQty, shipmentWeightQuantity } from './shipmentWeight'
import { buildCustomsWorkbook } from './customsExport'
import { parseShipmentWorkbook } from './shipmentImport'

const master = { id: 137, name_zh: '条码扫描仪', product_code: 'TOOL-01', hs_cn: '8471605000', hs_id: '84716050',
  name_en: 'Barcode Scanner', category: '工具', unit_kg: 'PCE', net_per_pc: 1, length: 23, image: 'preserved-image' }
const rows = [
  { _rowKey: 11, material_id: -11, material_snapshot: { ...master }, qty: 3, kg: 3, price: 10,
    cartons: 1, carton_no: 'A1', supplier: '测试供应商', customs_company: '测试公司', currency: 'US$', purchase_unit: '个' },
  { _rowKey: 12, material_id: -12, material_snapshot: { ...master }, qty: 2, kg: 2, price: 10,
    cartons: 1, carton_no: 'A2', supplier: '测试供应商', customs_company: '测试公司', currency: 'US$', purchase_unit: '个' },
]
const materials = new Map<number, any>([[137, master], ...rows.map(row => [row.material_id, row.material_snapshot] as const)])

it('海关编码是文本，保留前导零、允许清空，不接受公式、科学计数或超长编码', () => {
  expect(parseShipmentSheetValue('snapshot:hs_cn', ' 0012345678 ')).toBe('0012345678')
  expect(parseShipmentSheetValue('snapshot:hs_id', '00123456')).toBe('00123456')
  expect(parseShipmentSheetValue('snapshot:hs_id', '')).toBe('')
  for (const value of ['=1+1', '1e8', '84 71', '84716050.0', '123456789'])
    expect(() => parseShipmentSheetValue('snapshot:hs_id', value)).toThrow('海关编码')
  expect(() => parseShipmentSheetValue('snapshot:hs_cn', '12345678901')).toThrow('海关编码')
})
it('只修改目标导入行快照，保留数量重量、图片和匹配物料身份，货号库及另一行不变', () => {
  const before = structuredClone(rows)
  const result = applyShipmentSheetEdits(rows, materials, [
    { row: 0, field: 'snapshot:hs_cn', value: '0012345678' },
    { row: 0, field: 'snapshot:hs_id', value: '00123456' },
  ])
  expect(result.items[0]).toMatchObject({ qty: 3, kg: 3, material_id: -11, material_snapshot: {
    ...master, hs_cn: '0012345678', hs_id: '00123456',
  } })
  expect(result.materials.get(-11)).toEqual(result.items[0].material_snapshot)
  expect(result.materials.get(137)).toBe(master)
  expect(result.items[1]).toEqual(rows[1])
  expect(result.dirtyMaterials.size).toBe(0)
  expect(rows).toEqual(before)
  // An existing local dimension edit must survive HS editing too.
  const dims = new Map(materials).set(-11, { ...rows[0].material_snapshot, length: 99 })
  expect(applyShipmentSheetEdits(rows, dims, [{ row: 0, field: 'snapshot:hs_id', value: '' }]).items[0].material_snapshot)
    .toMatchObject({ length: 99, hs_id: '' })
})
it('海关编码两列粘贴、向下填充及合并编辑路径均写入对应快照', () => {
  expect(shipmentSheetFields.slice(6, 8)).toEqual(['snapshot:hs_cn', 'snapshot:hs_id'])
  const edits = sheetPasteEdits([['0012345678', '00123456'], ['0098765432', '00987654']], { row: 0, col: 6 }, 2)
  const changed = applyMergedShipmentEdits(rows, materials, consolidateShipmentItems(rows, materials), edits)
  expect(changed.items.map(row => [row.material_snapshot.hs_cn, row.material_snapshot.hs_id]))
    .toEqual([['0012345678', '00123456'], ['0098765432', '00987654']])
  const fill = sheetFillDownEdits({ row: 1, col: 7 }, { row: 1, col: 7 }, 2, shipmentSheetFields,
    (row, field) => changed.materials.get(changed.items[row].material_id)[field.slice(9)])
  const filled = applyShipmentSheetEdits(changed.items, changed.materials, fill)
  expect(filled.items.map(row => row.material_snapshot.hs_id)).toEqual(['00123456', '00123456'])
  expect(filled.dirtyMaterials.size).toBe(0)
})
it('混入普通物料、无效编码或伪造主数据字段时整次拒绝，不产生部分写入', () => {
  const input = [...rows, { material_id: 137, qty: 9, kg: 9 }]
  const before = structuredClone(input)
  for (const edits of [
    [{ row: 0, field: 'snapshot:hs_id', value: '00123456' }, { row: 2, field: 'snapshot:hs_id', value: '00123456' }],
    [{ row: 0, field: 'snapshot:hs_id', value: '00123456' }, { row: 1, field: 'snapshot:hs_id', value: 'BAD' }],
    [{ row: 0, field: 'material:hs_id', value: '00123456' }],
    [{ row: 0, field: 'snapshot:name_zh', value: 'BAD' }],
  ]) expect(() => applyShipmentSheetEdits(input, materials, edits)).toThrow()
  expect(input).toEqual(before)
  expect(master.hs_id).toBe('84716050')
})

const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const handlers: string[] = []
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ['writeMergedCells', 'mergedCellValue', 'save', 'effectiveWeighingQty'].includes(node.name?.text || ''))
    handlers.push(node.getText(tree))
  ts.forEachChild(node, collect)
}
collect(tree)
const code = ts.transpileModule(handlers.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
it('实际页面输入后刷新快照缓存，保存仅调用走货 API，重读保持新编码', async () => {
  const state = {
    items: structuredClone(rows), matMap: new Map(materials), consolidatedItems: consolidateShipmentItems(rows, materials),
    applyMergedShipmentEdits, outRows: [], editing: { id: 9 }, creating: false, sheetEditing: false,
    sheetConfirmOpen: { current: false }, sheetRevision: { current: { rawItems: rows, matMap: materials, session: 1 } },
    customsOptions: [], dirtyMatIds: new Set(), setDirtyMatIds: vi.fn(),
    api: { put: vi.fn(async (..._args: any[]) => ({})), get: vi.fn() },
    form: { validateFields: async () => ({ container_no: 'HS-LOCAL', customer: 'RRI' }) },
    setItems: vi.fn(), setMatMap: vi.fn(), setEditorDirty: vi.fn(), setSheetEditing: vi.fn(),
    setSaving: vi.fn(), setEditing: vi.fn(), closeEditor: vi.fn(), load: vi.fn(),
    message: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    shipmentPackingAverageQty, shipmentWeightQuantity,
    num: (v: unknown) => Number(v) || 0,
    edits: [{ row: 0, field: 'snapshot:hs_id', value: '00123456' }],
  }
  state.setItems.mockImplementation(next => { state.items = next })
  state.setMatMap.mockImplementation(next => { state.matMap = next })
  const context = createContext(state)
  runInContext(code, context)
  expect(await runInContext('writeMergedCells(edits, false)', context)).toBe(true)
  expect(state.setMatMap).toHaveBeenCalledOnce()
  expect(state.setDirtyMatIds).not.toHaveBeenCalled()
  expect(state.matMap.get(-11)?.hs_id).toBe('00123456')
  expect(await runInContext('save()', context)).toBe(true)
  expect(state.api.put).toHaveBeenCalledTimes(1)
  expect(state.api.put.mock.calls[0][0]).toBe('/shipments/9')
  const saved = JSON.parse(JSON.stringify(state.api.put.mock.calls[0][1].items))
  expect(saved[0]).toMatchObject({ material_id: 137, qty: 3, kg: 3, material_snapshot: { id: 137, hs_id: '00123456', image: 'preserved-image' } })
  expect(saved[1].material_snapshot.hs_id).toBe('84716050')
  expect(state.api.get).not.toHaveBeenCalled()
  expect(master.hs_id).toBe('84716050')
})
it.each(['RRI', 'RRM'])('真实导出使用编辑后的文本编码及空值，不回退货号库编码（%s）', async customer => {
  const result = applyShipmentSheetEdits(rows, materials, [
    { row: 0, field: 'snapshot:hs_cn', value: '0012345678' },
    { row: 0, field: 'snapshot:hs_id', value: '00123456' },
    { row: 1, field: 'snapshot:hs_id', value: '' },
  ])
  const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-' + customer.toLowerCase() + '.xlsx', import.meta.url))).buffer
  const blob = await buildCustomsWorkbook({ templateBuffer, items: result.items, materials: result.materials,
    productHs: new Map([['TOOL-01', { hsCN: '9999999999', hsID: '99999999' }]]), images: new Map(),
    form: { customer, containerNo: 'EDIT-HS', rate: 1 } })
  const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
  const sheet = wb.Sheets['EDIT-HS']
  expect(sheet.B4).toMatchObject({ t: 's', v: '0012345678' })
  expect(sheet.C4).toMatchObject({ t: 's', v: '00123456' })
  expect(sheet.C5?.v || '').toBe('')
  expect(sheet.L4.v).toBe(3)
  expect(sheet.K4.v).toBe(3)
  const imported = parseShipmentWorkbook(wb).rows.filter(row => row.sheet === 'EDIT-HS')
  expect(imported[0].item.material_snapshot).toMatchObject({ hs_cn: '0012345678', hs_id: '00123456' })
}, 60000)
