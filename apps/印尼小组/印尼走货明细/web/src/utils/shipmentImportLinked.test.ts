import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { applyShipmentImport } from './shipmentImportApply'
import { planShipmentImport, type ShipmentImportItem } from './shipmentImport'
import { consolidateShipmentItems } from './shipmentConsolidation'
import { shipmentPurchaseAmount } from './shipmentPurchase'
import { shipmentDeclarationSaveError } from './shipmentDeclarationSaveValidation'
import { shipmentPackingAverageQty, shipmentWeightQuantity } from './shipmentWeight'

const material = { id: 137, name_zh: '贴纸', name_en: 'Sticker', product_code: '35874', spec: 'A4', supplier: '原供应商',
  customs_company: '原报关公司', unit_kg: 'TNE', hs_cn: '0012345678', hs_id: '00123456', net_per_pc: .9, length: 10 }
const old = { _rowKey: 1, id: 9, material_id: 137, outbound_id: 70, qty: 20200, kg: .0182,
  price: .04, currency: 'US$', purchase_unit: '个', purchase_charge_ratio: .9, po_no: 'PO-70', po_date: '2026-09-28',
  supplier: '原供应商', customs_company: '原报关公司', cartons: 1, pallet: '旧卡板' }
const incoming: ShipmentImportItem = { material_snapshot: { ...material, id: 999, unit_kg: 'KGM', net_per_pc: 99,
  length: 25, hs_cn: '0099999999', hs_id: '00999999' }, qty: 999999, kg: 999999, price: 88800, currency: '¥',
  purchase_unit: '千克', po_no: old.po_no, po_date: '2030-01-01', supplier: old.supplier,
  customs_company: '新报关公司', cartons: 2, carton_no: '8-9', pallet: '1-3/4卡 8-9/9卡', qty_per_carton: '10100',
  contract_no: 'NEW-C', invoice_no: 'NEW-I' }
const materials = new Map([[137, material]])

it('已关联行唯一匹配可更新，重复、重复导入及采购来源不同仍不会乱覆盖', () => {
  const existing = [{ ...old, material_snapshot: material }]
  expect(planShipmentImport([incoming], existing)).toEqual([0])
  expect(planShipmentImport([incoming], [...existing, ...existing])).toEqual([-2])
  expect(planShipmentImport([incoming, incoming], existing)).toEqual([-2, -2])
  expect(planShipmentImport([{ ...incoming, po_no: 'OTHER' }], existing)).toEqual([-1])
})

it.each([false, true])('只覆盖装箱/报关字段，出库、采购、数量重量与金额不变（原本是本单快照=%s）', snapshot => {
  const row = snapshot ? { ...old, material_id: -1, material_snapshot: material } : { ...old }
  const map = new Map([[row.material_id, material]])
  const before = structuredClone(row), masterBefore = structuredClone(material)
  const [next] = applyShipmentImport([row], map, [incoming], [0])
  expect(next).toMatchObject({ cartons: 2, carton_no: '8-9', pallet: incoming.pallet, customs_company: '新报关公司', contract_no: 'NEW-C', invoice_no: 'NEW-I' })
  for (const field of ['outbound_id', 'qty', 'kg', 'price', 'currency', 'purchase_unit', 'purchase_charge_ratio', 'po_no', 'po_date', 'supplier', '_rowKey', 'id'] as const)
    expect(next[field]).toEqual(before[field])
  expect(next.material_snapshot).toMatchObject({ id: 137, unit_kg: 'TNE', net_per_pc: .9, length: 25, hs_cn: '0099999999' })
  expect(shipmentPurchaseAmount(next)).toBe(shipmentPurchaseAmount(row))
  expect(row).toEqual(before); expect(material).toEqual(masterBefore)
})

it('无匹配追加，未关联的更新方式保持不变，过期或重复目标整次拒绝', () => {
  expect(applyShipmentImport([], materials, [incoming], [-1])).toHaveLength(1)
  const row = { ...old, outbound_id: undefined, material_snapshot: material }
  const source = { ...incoming, customs_company: old.customs_company }
  expect(applyShipmentImport([row], materials, [source], [0])[0].qty).toBe(incoming.qty)
  expect(() => applyShipmentImport([old], materials, [incoming], [-1])).toThrow('匹配结果已变化')
  expect(() => applyShipmentImport([old], materials, [incoming, incoming], [0, 0])).toThrow('重复匹配')
})

it('共箱更新不能只改一行箱数；全部共箱统一更新可保留原分组', () => {
  const rows = [1, 2].map(_rowKey => ({ ...old, _rowKey, outbound_id: 69 + _rowKey, po_no: 'PO-' + _rowKey, carton_group: 'SHARED', cartons: 1 }))
  const sources = rows.map(row => ({ ...incoming, po_no: row.po_no, customs_company: old.customs_company }))
  expect(() => applyShipmentImport(rows, materials, [sources[0]], [0])).toThrow('共箱箱数不一致')
  const next = applyShipmentImport(rows, materials, sources, [0, 1])
  expect(next.map(row => [row.carton_group, row.cartons])).toEqual([['SHARED', 2], ['SHARED', 2]])
  expect(() => applyShipmentImport(rows, materials, [{ ...sources[0], cartons: 1, customs_company: '新公司' }], [0])).toThrow('拆开已有共箱')
})

it('无效箱数、尺寸及重量整次拒绝，不部分覆盖其他行', () => {
  const before = structuredClone(old)
  expect(() => applyShipmentImport([old], materials, [{ ...incoming, cartons: -1 }], [0])).toThrow('非负整数')
  expect(() => applyShipmentImport([old], materials, [{ ...incoming, cartons: 1.5 }], [0])).toThrow('非负整数')
  expect(() => applyShipmentImport([old], materials, [{ ...incoming, material_snapshot: { ...incoming.material_snapshot, length: -1 } }], [0])).toThrow('尺寸或重量无效')
  expect(old).toEqual(before)
})

it('同物料分批更新后仍按确认的真实物料合并；报关资料不同或未关联的快照不合并', () => {
  const rows = [1, 2].map(_rowKey => ({ ...old, _rowKey, outbound_id: 69 + _rowKey, po_no: 'PO-' + _rowKey }))
  const sources = rows.map(row => ({ ...incoming, po_no: row.po_no }))
  const updated = applyShipmentImport(rows, materials, sources, [0, 1])
  const local = updated.map((row, i) => ({ ...row, material_id: -(i + 1) }))
  const map = new Map(local.map(row => [row.material_id, row.material_snapshot!]))
  const merged = consolidateShipmentItems(local, map)
  expect(merged).toHaveLength(1)
  expect(merged[0].qty).toBe(old.qty * 2)
  expect(merged[0].sources.map(row => row.outbound_id)).toEqual([70, 71])
  map.set(-2, { ...map.get(-2), hs_cn: '1111111111' })
  expect(consolidateShipmentItems(local, map)).toHaveLength(2)
  expect(consolidateShipmentItems(local.map(row => ({ ...row, outbound_id: undefined })), map)).toHaveLength(2)
})

it('实际确认按钮允许已关联行的缺省币种，不接受重复匹配；页面拒绝时保留预览', () => {
  const text = readFileSync(new URL('../components/ShipmentImport.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('import.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let code = ''
  function walk(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'confirm') code = node.getText(tree)
    ts.forEachChild(node, walk)
  }
  walk(tree)
  const context = createContext({ selected: [{ item: { ...incoming, currency: undefined } }], targets: [0], linkedTarget: () => old,
    onImport: vi.fn(() => false), setRows: vi.fn(), message: { warning: vi.fn(), success: vi.fn() } })
  runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  runInContext('confirm()', context)
  expect(context.onImport).toHaveBeenCalledOnce(); expect(context.setRows).not.toHaveBeenCalled()
  expect(context.message.warning).not.toHaveBeenCalled()
  context.targets = [-2]; context.onImport.mockClear()
  runInContext('confirm()', context)
  expect(context.onImport).not.toHaveBeenCalled()
  expect(context.message.warning).toHaveBeenCalledWith(expect.stringContaining('重复匹配'))
  expect(text).toContain('（保留出库）')
})

it('实际页面导入、保存及重读保留真实出库 ID 与采购金额，装箱快照不写回物料库', async () => {
  const text = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const functions: string[] = []; let onImport = ''
  function walk(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'onImport') onImport = ((node.initializer as ts.JsxExpression).expression!).getText(tree)
    if (ts.isFunctionDeclaration(node) && ['save', 'effectiveWeighingQty'].includes(node.name?.text || '')) functions.push(node.getText(tree))
    ts.forEachChild(node, walk)
  }
  walk(tree)
  const context = createContext({ items: [{ ...old }], matMap: new Map(materials), imported: [incoming], targets: [0],
    applyShipmentImport, shipmentDeclarationSaveError, shipmentPackingAverageQty, shipmentWeightQuantity,
    sheetWritePending: { current: false }, editorLoadState: { current: 'ready' }, sheetEditing: false,
    form: { validateFields: async () => ({ customer: 'RRM' }) }, creating: false, editing: { id: 9 }, dirtyMatIds: new Set(),
    setEditorDirty: vi.fn(), setEditing: vi.fn(), setSaving: vi.fn(), load: vi.fn(),
    message: { info: vi.fn(), error: vi.fn(), success: vi.fn() }, api: { put: vi.fn(async () => ({})) },
  })
  const refresh = () => {
    for (const row of context.items as any[]) if (row.material_snapshot) context.matMap.set(row.material_id, row.material_snapshot)
  }
  context.setItems = (rows: any[]) => {
    context.items = rows.map(row => ({ ...row, material_id: row.material_snapshot ? -row._rowKey : row.material_id }))
    refresh()
  }
  context.setMatMap = (update: (map: Map<number, typeof material>) => Map<number, typeof material>) => { context.matMap = update(context.matMap); refresh() }
  runInContext(ts.transpileModule(`${functions.join('\n')}\nconst runImport = ${onImport}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  expect(runInContext('runImport(imported, targets)', context)).toBe(true)
  expect(context.api.put).not.toHaveBeenCalled()
  expect(await runInContext('save()', context)).toBe(true)
  expect(context.api.put).toHaveBeenCalledOnce()
  expect(context.api.put.mock.calls[0][0]).toBe('/shipments/9')
  const saved = JSON.parse(JSON.stringify(context.api.put.mock.calls[0][1].items[0]))
  expect(saved).toMatchObject({ outbound_id: 70, material_id: 137, qty: 20200, kg: .0182, price: .04, po_no: 'PO-70', cartons: 2 })
  expect(saved.material_snapshot).toMatchObject({ id: 137, length: 25, unit_kg: 'TNE' })
  expect(shipmentPurchaseAmount(saved)).toBe(shipmentPurchaseAmount(old))
  expect(material.length).toBe(10)
})
