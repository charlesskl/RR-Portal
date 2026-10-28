import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { receiptChargeRatio, shipmentPurchaseAmount } from './shipmentPurchase'
import { isPaperRope, shipmentKgWeight, shipmentWeightQuantity } from './shipmentWeight'

// Exercise the actual page builder for both source-outbound and PO-library paths.
const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler = ''
function collect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'makeItem') handler = node.getText(tree)
  ts.forEachChild(node, collect)
}
collect(tree)
const code = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
it.each([
  { purchase_charge_ratio: 3630 / 3667 },
  { received_qty: 3630, spare_qty: 37 },
])('走货新增路径带入免费备品计费依据，不更改单价或实物数量 %j', basis => {
  const state = { receiptChargeRatio, isPaperRope, shipmentKgWeight, shipmentWeightQuantity,
    material: { id: 979, name_zh: '阿奇密封盒', unit_kg: 'KGM', net_per_pc: .137 },
    opts: { poInfo: { po: { po_no: 'IRRIHS0403' }, it: { price: .227, ...basis } } } }
  const context = createContext(state)
  runInContext(code, context)
  const row = runInContext('makeItem(material, 3667, opts)', context)
  expect(row).toMatchObject({ qty: 3667, kg: 502.379, price: .227 })
  expect(shipmentPurchaseAmount(row)).toBeCloseTo(824.01, 9)
})
