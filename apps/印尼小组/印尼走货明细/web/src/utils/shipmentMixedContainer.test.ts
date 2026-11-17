import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { buildCustomsWorkbook } from './customsExport'

const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const functions = new Map<string, string>()
let templateChoice = ''
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(tree))
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'templateName') templateChoice = node.initializer!.getText(tree)
  ts.forEachChild(node, visit)
}
visit(tree)
const compile = (code: string) => ts.transpile(code, { target: ts.ScriptTarget.ES2022 })

it.each(['RRI', 'RRM'])('pulling and linking mixed PO prefixes never overwrites selected %s entity', customer => {
  const setFieldsValue = vi.fn(), warning = vi.fn()
  const context = createContext({ form: { getFieldsValue: () => ({ customer }), setFieldsValue }, message: { warning } })
  runInContext(compile(functions.get('partitionOf')! + '\n' + functions.get('applyPartition')!), context)
  for (const values of [[{ po_no: 'IRRIHS01' }], [{ po_no: 'IRRMHS02' }], [{ po_no: 'IRRIHS01' }, { po_no: 'IRRMHS02' }]]) {
    context.rows = values
    runInContext('applyPartition(rows)', context)
  }
  expect(setFieldsValue).not.toHaveBeenCalled()
  expect(warning).not.toHaveBeenCalled()
})

it('an empty mixed-container entity waits for explicit selection instead of choosing an arbitrary PO prefix', () => {
  const setFieldsValue = vi.fn(), warning = vi.fn()
  const context = createContext({ form: { getFieldsValue: () => ({ customer: '' }), setFieldsValue }, message: { warning } })
  runInContext(compile(functions.get('partitionOf')! + '\n' + functions.get('applyPartition')!), context)
  runInContext(`applyPartition([{po_no:'IRRIHS01'},{po_no:'IRRMHS02'}])`, context)
  expect(setFieldsValue).not.toHaveBeenCalled()
  expect(warning).not.toHaveBeenCalled()
  runInContext(`applyPartition([{po_no:'IRRIHS01'}])`, context)
  expect(setFieldsValue).toHaveBeenCalledWith({ customer: 'RRI' })
})

it('export with no selected entity stops before fetching templates or validating line data', async () => {
  const warning = vi.fn(), computeValidation = vi.fn()
  const context = createContext({ editing: { id: 1 }, form: { getFieldsValue: () => ({ customer: ' ' }) }, message: { warning }, computeValidation })
  runInContext(compile(functions.get('exportShipmentExcel')!.replaceAll('import.meta.env.BASE_URL', JSON.stringify('/'))), context)
  await runInContext('exportShipmentExcel()', context)
  expect(warning).toHaveBeenCalledOnce()
  expect(computeValidation).not.toHaveBeenCalled()
})

it.each(['RRI', 'RRM'])('mixed PO exports use the selected %s template/entity and retain both purchase sources', async customer => {
  const templateName = runInContext(`(${templateChoice})`, createContext({ v: { customer } }))
  const items = [1, 2].map(id => ({ material_id: id, qty: 10, kg: 1, price: 2, currency: 'US$',
    po_no: id === 1 ? 'IRRIHS01' : 'IRRMHS02', contract_no: 'SYN-C', invoice_no: 'SYN-I' }))
  const blob = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/' + templateName, import.meta.url))).buffer,
    items, materials: new Map(items.map(item => [item.material_id, { id: item.material_id,
      product_code: `SYN-${item.material_id}`, name_zh: `合成物料${item.material_id}`, unit_kg: 'KGM' }])),
    productHs: new Map(), images: new Map(), form: { customer, containerNo: 'SYN-MIXED', rate: 1 },
  })
  const book = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
  const contract = customer === 'RRI' ? '实业合同' : '全球合同'
  expect(book.SheetNames).toContain(contract)
  expect(book.SheetNames).toContain(customer === 'RRI' ? '实业发票' : '全球发票')
  const text = Object.values(book.Sheets[contract]).map(cell => String(cell?.v || '')).join('\n')
  expect(text).toMatch(customer === 'RRI' ? /ROYAL REGENT PRODUCTS INDUSTRIES LIMITED/i : /Royal Regent \(World\) Co\.? Limited/i)
  expect([book.Sheets['SYN-MIXED'].AN4.v, book.Sheets['SYN-MIXED'].AN5.v]).toEqual(['IRRIHS01', 'IRRMHS02'])
  expect(Number(book.Sheets['SYN-MIXED'].AP4.v) + Number(book.Sheets['SYN-MIXED'].AP5.v)).toBe(40)
}, 60000)
