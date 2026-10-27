import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { applyShipmentSheetEdits, parseSheetClipboard, parseShipmentSheetValue, sheetPasteEdits, shipmentSheetFields } from './shipmentSheet'

const materials = new Map([[1, { id: 1, unit_kg: 'KGM', net_per_pc: 0.2, supplier: 'A' }]])
const rows = [
  { _rowKey: 10, id: 20, outbound_id: 30, material_id: 1, qty: 10, kg: 2, cartons: 2, qty_per_carton: '5' },
  { _rowKey: 11, id: 21, outbound_id: 31, material_id: 1, qty: 20, kg: 4, cartons: 4, qty_per_carton: '5' },
]
describe('Excel clipboard', () => {
  it('parses CRLF, empty columns, quoted newlines and escaped quotes', () => {
    expect(parseSheetClipboard('a\t\t"1-2/3000\r\n3/4000"\r\nb\t"say ""hi"""\t\r\n'))
      .toEqual([['a', '', '1-2/3000\n3/4000'], ['b', 'say "hi"', '']])
  })
  it('retains final empty cell and intentional blank row', () => {
    expect(parseSheetClipboard('1\t\n\n')).toEqual([['1', ''], ['']])
  })
  it('rejects malformed or oversized input', () => {
    expect(() => parseSheetClipboard('"oops')).toThrow('引号')
    expect(() => parseSheetClipboard('x'.repeat(1000001))).toThrow('过大')
  })
  it('preserves physical column positions and blocks protected cells', () => {
    expect(sheetPasteEdits([['4', '10']], { row: 0, col: 13 }, 2)).toEqual([
      { row: 0, field: 'kg', value: '4' }, { row: 0, field: 'qty', value: '10' },
    ])
    expect(() => sheetPasteEdits([['4', '10', 'KGM']], { row: 0, col: 13 }, 2)).toThrow('受保护')
    expect(sheetPasteEdits([['4', '10', '']], { row: 0, col: 13 }, 2)).toHaveLength(2)
    expect(() => sheetPasteEdits([['1'], ['2']], { row: 1, col: 14 }, 2)).toThrow('超出')
  })
})
describe('typed spreadsheet values', () => {
  it.each(['-1', 'NaN', 'Infinity', '1,2', '=1+1', '10kg', '1e20'])('rejects numeric %s', raw => {
    expect(() => parseShipmentSheetValue('qty', raw)).toThrow()
  })
  it('accepts normal numbers, clears and identifiers with leading zeros', () => {
    expect(parseShipmentSheetValue('qty', '1,234.56')).toBe(1234.56)
    expect(parseShipmentSheetValue('price', '.25')).toBe(.25)
    expect(parseShipmentSheetValue('qty', '')).toBe(0)
    expect(parseShipmentSheetValue('invoice_no', '00123')).toBe('00123')
    expect(() => parseShipmentSheetValue('cartons', '1.5')).toThrow('整数')
  })
  it('validates date, unit and currency without executing formulas', () => {
    expect(parseShipmentSheetValue('po_date', '2026/10/2')).toBe('2026-10-02')
    expect(() => parseShipmentSheetValue('po_date', '2026-02-30')).toThrow('不存在')
    expect(() => parseShipmentSheetValue('material:unit_kg', 'banana')).toThrow('可用值')
    expect(() => parseShipmentSheetValue('currency', 'USD')).toThrow('可用值')
    expect(() => parseShipmentSheetValue('formula_name', '=1+1')).toThrow('不执行')
  })
})
describe('batch updates', () => {
  it('recalculates quantities and packing without mutating input or IDs', () => {
    const result = applyShipmentSheetEdits(rows, materials, [{ row: 0, field: 'qty', value: '25' }])
    expect(result.items[0]).toEqual({ ...rows[0], qty: 25, kg: 5, cartons: 5 })
    expect(result.items[1]).toEqual(rows[1])
    expect(rows[0].qty).toBe(10)
  })
  it('applies final packing and explicit weight regardless of paste order', () => {
    const result = applyShipmentSheetEdits(rows, materials, [
      { row: 0, field: 'kg', value: '6.1234' }, { row: 0, field: 'qty', value: '30' },
      { row: 0, field: 'qty_per_carton', value: '10' },
    ])
    expect(result.items[0]).toMatchObject({ qty: 30, kg: 6.1234, cartons: 3 })
  })
  it('updates same material across all batches, preserving shipment unit conversion', () => {
    const result = applyShipmentSheetEdits(rows, materials, [{ row: 0, field: 'material:unit_kg', value: 'TNE' }])
    expect(result.items.map(row => row.kg)).toEqual([.002, .004])
    expect(materials.get(1)?.unit_kg).toBe('KGM')
    expect([...result.dirtyMaterials]).toEqual([1])
  })
  it('rejects the whole paste on invalid values or conflicting shared-material values', () => {
    expect(() => applyShipmentSheetEdits(rows, materials, [
      { row: 0, field: 'qty', value: '30' }, { row: 1, field: 'qty', value: 'bad' },
    ])).toThrow('第 2 行')
    expect(() => applyShipmentSheetEdits(rows, materials, [
      { row: 0, field: 'material:length', value: '30' }, { row: 1, field: 'material:length', value: '40' },
    ])).toThrow('相同物料')
    expect(rows[0].qty).toBe(10)
    expect(materials.get(1)).not.toHaveProperty('length')
  })
  it('protects IDs and rejects material edits without a linked material', () => {
    for (const field of ['outbound_id', 'material_id', 'id', 'invoice_price'])
      expect(() => applyShipmentSheetEdits(rows, materials, [{ row: 0, field, value: '99' }])).toThrow('不允许')
    expect(() => applyShipmentSheetEdits([{}], materials, [{ row: 0, field: 'material:length', value: '1' }])).toThrow('先选择物料')
  })
  it('preserves shared cartons and synchronizes explicit carton count', () => {
    const grouped = rows.map(row => ({ ...row, carton_group: 'G', cartons: 6 }))
    expect(applyShipmentSheetEdits(grouped, materials, [{ row: 0, field: 'qty', value: '15' }]).items.map(r => r.cartons)).toEqual([6, 6])
    expect(applyShipmentSheetEdits(grouped, materials, [{ row: 0, field: 'cartons', value: '7' }]).items.map(r => r.cartons)).toEqual([7, 7])
    expect(() => applyShipmentSheetEdits(grouped, materials, [
      { row: 0, field: 'cartons', value: '7' }, { row: 1, field: 'cartons', value: '8' },
    ])).toThrow('同箱')
  })
  it('unlinks shared cartons if supplier changes, and preserves imported snapshots', () => {
    const input = [{ ...rows[0], carton_group: 'G', material_snapshot: { id: 1, name_zh: 'Imported' } }]
    const result = applyShipmentSheetEdits(input, materials, [{ row: 0, field: 'supplier', value: 'B' }])
    expect(result.items[0]).toMatchObject({ supplier: 'B', material_snapshot: input[0].material_snapshot, outbound_id: 30 })
    expect(result.items[0].carton_group).toBeUndefined()
  })
})

it('spreadsheet fields stay aligned with actual page columns, including protected columns', () => {
  const source = readFileSync(new URL('../pages/ShipmentsPage.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let titles: string[] = []
  function walk(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'ShipmentSheetTable') {
      const prop = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(tree) === 'columns') as ts.JsxAttribute
      const array = (prop.initializer as ts.JsxExpression).expression as ts.ArrayLiteralExpression
      titles = array.elements.map(el => {
        const title = (el as ts.ObjectLiteralExpression).properties.find(p => p.name?.getText(tree) === 'title') as ts.PropertyAssignment
        return (title.initializer as ts.StringLiteral).text
      })
    }
    ts.forEachChild(node, walk)
  }
  walk(tree)
  expect(titles).toHaveLength(shipmentSheetFields.length)
  expect(titles.filter((_, i) => shipmentSheetFields[i])).toEqual([
    '套公式名称栏', '单位', '送货重量', '送货数量', '产品用途', '合同号码', '合同日期', '发票号', '发票日期',
    '供应商', '采购单日期', '采购单号', '采购单价', '币种', '报关出口公司', '提单抬头', '箱数', '每箱数量', '卡板', '箱号',
    '长', '宽', '高', '每箱重量', '称重数量', '单个净重',
  ])
})
