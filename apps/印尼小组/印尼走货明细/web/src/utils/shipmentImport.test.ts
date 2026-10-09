import { expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import { parseShipmentWorkbook, matchShipmentMaterial, importShipmentFile, planShipmentImport } from './shipmentImport'
import { DOMParser } from '@xmldom/xmldom'

function book(rows: unknown[][]) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '明细')
  return wb
}
it('相同明细唯一匹配更新，新增追加，重复和出库关联需核对', () => {
  const item = { material_snapshot: { name_zh: '螺丝', product_code: 'A', spec: '3MM', supplier: '供应商' }, qty: 2 }
  expect(planShipmentImport([item], [item])).toEqual([0])
  expect(planShipmentImport([item], [])).toEqual([-1])
  expect(planShipmentImport([item], [item, item])).toEqual([-2])
  expect(planShipmentImport([item, item], [item])).toEqual([-2, -2])
  expect(planShipmentImport([item], [{ ...item, outbound_id: 1 }])).toEqual([-3])
  expect(planShipmentImport([{ ...item, po_no: 'PO2' }], [{ ...item, po_no: 'PO1' }])).toEqual([-1])
  expect(planShipmentImport([{ ...item, qty: 0 }], [item])).toEqual([0])
})
it('重量和件数分开，读取格式币种、日期及文本编号', () => {
  const wb = book([
    ['货号', '产品中文名称', '单位', '需求数量', '产品数量', '单位', '采购单价', '采购单日期', '物料编码'],
    ['001', '棉花', 'kg', 19.3875, 11750, 'pcs', 35.34, 46303, '00017'],
  ])
  wb.Sheets['明细'].G2.z = '"US$"0.00'
  const row = parseShipmentWorkbook(wb).rows[0].item
  expect(row).toMatchObject({ qty: 11750, kg: 19.3875, price: 35.34, currency: 'US$', purchase_unit: 'pcs' })
  expect(row.po_date).toMatch(/^2026-\d{2}-\d{2}$/)
  expect(row.material_snapshot).toMatchObject({ product_code: '001', material_code: '00017', unit_kg: 'KGM' })
})
it('不把公斤当件数，不猜币种，错误公式不会带入', () => {
  const wb = book([['货号', '产品中文名称', '单位', '需求数量', '采购单价'], ['x', '棉花', 'kg', 10, 8]])
  const row = parseShipmentWorkbook(wb).rows[0]
  expect(row.item.qty).toBeUndefined()
  expect(row.item.currency).toBeUndefined()
  expect(row.warnings.length).toBeGreaterThan(0)
  wb.Sheets['明细'].D2 = { t: 'e', v: 23, f: '#REF!' }
  expect(parseShipmentWorkbook(wb).rows[0].item.kg).toBeUndefined()
})
it('只继承真实合并单元格，保留箱数组合且不导入汇总行', () => {
  const wb = book([['货号', '产品中文名称', '箱数', '供应商'], ['A', '物料1', 1, '公司'], ['', '物料2'], ['', '总计', 1]])
  wb.Sheets['明细']['!merges'] = [{ s: { r: 1, c: 2 }, e: { r: 2, c: 2 } }, { s: { r: 1, c: 3 }, e: { r: 2, c: 3 } }]
  const rows = parseShipmentWorkbook(wb).rows
  expect(rows).toHaveLength(2)
  expect(rows[1].item.material_snapshot.product_code).toBe('')
  expect(rows[1].item.supplier).toBe('公司')
  expect(rows[0].item.carton_group).toBe(rows[1].item.carton_group)
})
it('同名多匹配不任意绑定，源值覆盖匹配档案且不修改原档案', () => {
  const source = { name_zh: '工具', product_code: 'A', gross_per_pc: 0 }
  const old = { id: 8, name_zh: '工具', product_code: 'A', gross_per_pc: 1, hs_cn: '123' }
  expect(matchShipmentMaterial(source, [old]).material).toMatchObject({ id: 8, gross_per_pc: 0, hs_cn: '123' })
  expect(old.gross_per_pc).toBe(1)
  expect(matchShipmentMaterial(source, [old, { ...old, id: 9 }]).material.id).toBeUndefined()
})
it.skipIf(!process.env.SHIPMENT_IMPORT_SAMPLES)('三份真实样表识别验证（只读）', () => {
  const paths = JSON.parse(process.env.SHIPMENT_IMPORT_SAMPLES!) as string[]
  const results = paths.map(path => parseShipmentWorkbook(XLSX.read(readFileSync(path), { type: 'buffer', cellNF: true })))
  expect([...new Set(results[0].rows.map(r => r.sheet))]).toEqual(['CZ007E1华胜益', 'L67988A华登'])
  const plush = results[0].rows.find(r => r.item.material_snapshot.name_zh === '毛绒裁片-蘑菇头左片')!
  expect(plush.item).toMatchObject({ kg: 19.3875, qty: 11750 })
  expect(results[1].rows).toHaveLength(2)
  expect(results[1].rows[0].item).toMatchObject({ qty: 2, price: 35.34, currency: 'US$', po_no: '' })
  expect(new Set(results[2].rows.map(r => r.sheet))).toEqual(new Set(['TXGU8151892']))
  expect(results[2].rows[0].item).toMatchObject({ qty: 10040, kg: 231, cartons: 26, qty_per_carton: '1-25/400\n26/40' })
  expect(results[2].rows.some(r => r.item.carton_group)).toBe(true)
  console.log('识别明细行数', results.map(r => r.rows.length))
})
it.skipIf(!process.env.SHIPMENT_IMPORT_SAMPLES)('真实样表图片保持行对应，包含 WPS 单元格图及浮动图', async () => {
  vi.stubGlobal('DOMParser', DOMParser)
  try {
    const paths = JSON.parse(process.env.SHIPMENT_IMPORT_SAMPLES!) as string[]
    for (const path of paths) {
      const buffer = readFileSync(path)
      const parsed = await importShipmentFile({ size: buffer.length, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length) } as File)
      expect(parsed.rows.some(r => r.item.material_snapshot.image?.startsWith('data:image/'))).toBe(true)
      if (path.includes('物料上印尼')) expect(parsed.rows.every(r => !!r.item.material_snapshot.image)).toBe(true)
    }
  } finally { vi.unstubAllGlobals() }
})
