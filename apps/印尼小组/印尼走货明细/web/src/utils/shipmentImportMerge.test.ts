import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { DOMParser } from '@xmldom/xmldom'
import * as shipmentImport from './shipmentImport'
import { toolImportDefaults } from './toolImportDefaults'
import { buildCustomsWorkbook } from './customsExport'

const headers = ['货号', '产品中文名称', '规格', '供应商', '中国HSCODE', '印尼HS CODE', '单位', '送货数量', '送货KG重量', '箱数', '每箱数量', '采购单价', '币种']
const material = { id: 137, product_code: 'SYNTHETIC-TOOL', name_zh: '合成扫描仪', spec: 'TEST', supplier: '合成供应商',
  customs_company: '合成报关公司', hs_cn: '9999999999', hs_id: '99999999', tool_kind: '工具' as const }
const dictionaries = { hs: [{ keyword: '扫描仪', hsCN: '8888888888', hsID: '88888888' }], suppliers: [], translations: [] }
const page = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let importHandler = ''
function collect(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'onImport' && node.initializer
    && ts.isJsxExpression(node.initializer) && node.initializer.expression)
    importHandler = node.initializer.expression.getText(tree)
  ts.forEachChild(node, collect)
}
collect(tree)
const handler = ts.transpileModule(`const runImport = ${importHandler}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function parsed(cn: string, id: string) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers,
    ['SYNTHETIC-TOOL', '合成扫描仪', 'TEST', '合成供应商', cn, id, 'PCE', 3, 3, 1, '3', 10, 'USD']]), '合成')
  return shipmentImport.parseShipmentWorkbook(wb).rows[0].item
}
function enriched(item: ReturnType<typeof parsed>, withMaster = true) {
  const matched = shipmentImport.matchShipmentMaterial(item.material_snapshot, withMaster ? [material] : [])
  return { ...item, material_snapshot: toolImportDefaults(matched.material, dictionaries).material }
}
function update(current: any[], incoming: ReturnType<typeof parsed>[]) {
  const state: any = { items: current, matMap: new Map(current.map(row => [row.material_id, row.material_snapshot])),
    ...shipmentImport, setEditorDirty: vi.fn() }
  state.setItems = (fn: any) => { state.items = fn(state.items) }
  state.setMatMap = (fn: any) => { state.matMap = fn(state.matMap) }
  const context = createContext(state)
  runInContext(handler, context)
  state.incoming = incoming
  state.targets = shipmentImport.planShipmentImport(incoming, current)
  expect(state.targets).toEqual(current.length ? [0] : [-1])
  runInContext('runImport(incoming, targets)', context)
  return state.items
}
it.each([
  ['', '', '', '', '', ''],
  ['0012345678', '00123456', '', '', '0012345678', '00123456'],
  ['', '', '0023456789', '00234567', '0023456789', '00234567'],
  ['', '00123456', '0023456789', '', '0023456789', '00123456'],
])('actual import update uses source HS values and preserves existing blanks/codes (%j)', (oldCN, oldID, sourceCN, sourceID, expectedCN, expectedID) => {
  const incoming = enriched(parsed(sourceCN, sourceID))
  const current = [{ ...parsed(oldCN, oldID), material_id: -1, _rowKey: 1 }]
  const updated = update(current, [incoming])
  expect(updated[0].material_snapshot).toMatchObject({ hs_cn: expectedCN, hs_id: expectedID })
  expect(current[0].material_snapshot).toMatchObject({ hs_cn: oldCN, hs_id: oldID })
  expect(updated[0]).toMatchObject({ qty: 3, kg: 3, price: 10, cartons: 1 })
  expect(updated[0].material_snapshot.import_source).toEqual(incoming.material_snapshot.import_source)
})
it.each([true, false])('new rows retain existing master/dictionary HS defaults (%s)', withMaster => {
  const incoming = enriched(parsed('', ''), withMaster)
  const updated = update([], [incoming])
  expect(updated[0].material_snapshot.hs_cn).toBe(withMaster ? '9999999999' : '8888888888')
  expect(updated[0].material_snapshot.hs_id).toBe(withMaster ? '99999999' : '88888888')
})
it.each(['rri', 'rrm'])('cleared HS survives export, parse, master/default enrichment and actual reimport update (%s)', async customer => {
  vi.stubGlobal('DOMParser', DOMParser)
  try {
    const matched = enriched(parsed('', ''))
    let item: any = { ...matched, customs_company: material.customs_company, material_id: -1, _rowKey: 1,
      material_snapshot: { ...matched.material_snapshot, hs_cn: '', hs_id: '' } }
    const before = structuredClone(item)
    for (let round = 0; round < 2; round++) {
      const blob = await buildCustomsWorkbook({
        templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/template-customs-' + customer + '.xlsx', import.meta.url))).buffer,
        items: [item], materials: new Map([[-1, item.material_snapshot]]), productHs: new Map(), images: new Map(),
        form: { customer: customer.toUpperCase(), containerNo: 'HS-REIMPORT', rate: .93 }, mainOnly: true,
      })
      const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellNF: true })
      expect(workbook.Sheets['HS-REIMPORT'].B4?.v || '').toBe('')
      expect(workbook.Sheets['HS-REIMPORT'].C4?.v || '').toBe('')
      const incoming = enriched(shipmentImport.parseShipmentWorkbook(workbook).rows[0].item)
      // The master is still populated; only the existing shipment's blank must win.
      expect(incoming.material_snapshot.hs_cn).toBe('9999999999')
      item = update([item], [incoming])[0]
      expect(item.material_snapshot.hs_cn).toBe('')
      expect(item.material_snapshot.hs_id).toBe('')
      expect(item).toMatchObject({ qty: before.qty, kg: before.kg, price: before.price })
    }
  } finally { vi.unstubAllGlobals() }
}, 60000)
it.each(['missing', 'error'])('missing/error source HS is not replaced by enriched defaults (%s)', mode => {
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([headers, ['SYNTHETIC-TOOL', '合成扫描仪', 'TEST', '合成供应商', '', '', 'PCE', 3, 3]])
  if (mode === 'missing') { delete sheet.E1; delete sheet.F1 }
  else { sheet.E2 = { t: 'e', v: 23, f: 'INVALID()' }; sheet.F2 = { t: 'n', f: 'INVALID()' } }
  XLSX.utils.book_append_sheet(wb, sheet, '合成')
  const incoming = enriched(shipmentImport.parseShipmentWorkbook(wb).rows[0].item)
  const current = [{ ...parsed('0012345678', '00123456'), material_id: -1, _rowKey: 1 }]
  expect(update(current, [incoming])[0].material_snapshot).toMatchObject({ hs_cn: '0012345678', hs_id: '00123456' })
})
it.each(['prefix-before-exact', 'duplicate-exact'])('HS source selection follows parser exact/first-column precedence (%s)', mode => {
  const row = ['SYNTHETIC-TOOL', '合成扫描仪', 'TEST', '合成供应商', '', '', 'PCE', 3, 3]
  const sourceHeaders = mode === 'prefix-before-exact' ? ['中国HSCODE备注', ...headers] : [...headers, '中国HSCODE']
  const sourceRow = mode === 'prefix-before-exact' ? ['0066666666', ...row] : [...row, ...Array(headers.length - row.length).fill(''), '0066666666']
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sourceHeaders, sourceRow]), '合成')
  const source = shipmentImport.parseShipmentWorkbook(wb).rows[0].item
  expect(source.material_snapshot.hs_cn).toBe('')
  const incoming = enriched(source)
  expect(incoming.material_snapshot.hs_cn).toBe('9999999999')
  const current = [{ ...parsed('0012345678', '00123456'), material_id: -1, _rowKey: 1 }]
  expect(update(current, [incoming])[0].material_snapshot).toMatchObject({ hs_cn: '0012345678', hs_id: '00123456' })
})
