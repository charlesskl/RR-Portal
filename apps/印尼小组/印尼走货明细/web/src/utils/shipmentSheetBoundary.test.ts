import { describe, expect, it } from 'vitest'
import { applyShipmentSheetEdits, parseSheetClipboard, sheetPasteEdits, shipmentSheetFields } from './shipmentSheet'
import { sortShipmentItems } from './shipmentOrder'
import { withShipmentInvoicePrices } from './shipmentInvoice'

const materials = new Map<number, any>([[1, { id: 1, name_zh: '螺丝', unit_kg: 'KGM', net_per_pc: .2 }]])
const rows = [
  { _rowKey: 1, id: 11, outbound_id: 21, material_id: 1, qty: 10, kg: 2, cartons: 2, qty_per_carton: '5' },
  { _rowKey: 2, id: 12, outbound_id: 22, material_id: 1, qty: 20, kg: 4, cartons: 4, qty_per_carton: '5' },
]

describe('independent spreadsheet boundaries', () => {
  it('ragged clipboard rows keep omitted cells untouched and explicit weights win', () => {
    const edits = sheetPasteEdits(parseSheetClipboard('.5\t9\n1.25'), { row: 0, col: 13 }, rows.length)
    const result = applyShipmentSheetEdits(rows, materials, edits)
    expect(result.items).toEqual([
      { ...rows[0], qty: 9, kg: .5, cartons: 2 },
      { ...rows[1], kg: 1.25 },
    ])
  })

  it('blank protected positions do not shift later editable columns', () => {
    const matrix = [['25', ...Array(5).fill(''), '玩具配件']]
    const edits = sheetPasteEdits(matrix, { row: 0, col: 14 }, rows.length)
    expect(edits).toEqual([
      { row: 0, field: 'qty', value: '25' },
      { row: 0, field: 'product_use', value: '玩具配件' },
    ])
    expect(applyShipmentSheetEdits(rows, materials, edits).items[0])
      .toEqual({ ...rows[0], qty: 25, kg: 5, cartons: 5, product_use: '玩具配件' })
  })

  it('range overflow or a later protected cell rejects the complete paste', () => {
    const before = structuredClone(rows)
    expect(() => sheetPasteEdits([['20'], ['30']], { row: 1, col: 14 }, rows.length)).toThrow('超出')
    expect(() => sheetPasteEdits([['.5', '20', ''], ['1', '30', '个']], { row: 0, col: 13 }, rows.length)).toThrow('受保护')
    expect(rows).toEqual(before)
  })

  it('a shared-material conflict leaves original rows and material metadata untouched', () => {
    const input = structuredClone(rows)
    const originalMaterial = structuredClone(materials.get(1))
    expect(() => applyShipmentSheetEdits(input, materials, [
      { row: 0, field: 'qty', value: '30' },
      { row: 0, field: 'material:net_per_pc', value: '.3' },
      { row: 1, field: 'material:net_per_pc', value: '.4' },
    ])).toThrow('相同物料')
    expect(input).toEqual(rows)
    expect(materials.get(1)).toEqual(originalMaterial)
  })

  it('shared material changes recalculate every batch and preserve explicit pasted weights', () => {
    const result = applyShipmentSheetEdits(rows, materials, [
      { row: 1, field: 'kg', value: '7' },
      { row: 0, field: 'material:net_per_pc', value: '.5' },
    ])
    expect(result.items.map(row => row.kg)).toEqual([5, 7])
    expect(result.items.map(row => [row.id, row.outbound_id, row.material_id]))
      .toEqual([[11, 21, 1], [12, 22, 1]])
    expect(result.materials.get(1)).not.toBe(materials.get(1))
    expect(materials.get(1)?.net_per_pc).toBe(.2)
  })

  it('identical carton group labels in different customs scopes remain independent', () => {
    const input = [
      { ...rows[0], carton_group: 'G', supplier: 'A', customs_company: '公司一', cartons: 6 },
      { ...rows[1], carton_group: 'G', supplier: 'A', customs_company: '公司一', cartons: 6 },
      { ...rows[1], id: 13, outbound_id: 23, carton_group: 'G', supplier: 'A', customs_company: '公司二', cartons: 9 },
    ]
    const result = applyShipmentSheetEdits(input, materials, [{ row: 0, field: 'cartons', value: '7' }])
    expect(result.items.map(row => row.cartons)).toEqual([7, 7, 9])
    expect(input.map(row => row.cartons)).toEqual([6, 6, 9])
  })

  it('canonical post-edit ordering still recomputes invoice prices without changing batch sources', () => {
    const input = rows.map(row => ({ ...row, customs_company: '', currency: 'US$', price: .04, invoice_price: .04 }))
    const result = applyShipmentSheetEdits(input, materials, [{ row: 1, field: 'price', value: '.45' }])
    const displayAndSaveRows = withShipmentInvoicePrices(sortShipmentItems(result.items, result.materials), result.materials)
    expect(displayAndSaveRows.map(row => [row.outbound_id, row.qty, row.price, row.invoice_price]))
      .toEqual([[21, 10, .04, .2], [22, 20, .45, 2.25]])
    for (const field of ['outbound_id', 'material_id', 'invoice_price', 'gross_per_pc', 'netTotal']) {
      expect(shipmentSheetFields).not.toContain(field)
      expect(() => applyShipmentSheetEdits(input, materials, [{ row: 0, field, value: '999' }])).toThrow('不允许')
    }
  })

  it('an empty edit set does not recalculate manual weights or alter sources', () => {
    const input = [{ ...rows[0], kg: 3.21 }]
    const result = applyShipmentSheetEdits(input, materials, [])
    expect(result.items).toEqual(input)
    expect(result.materials).toEqual(materials)
    expect(result.dirtyMaterials.size).toBe(0)
  })
})
