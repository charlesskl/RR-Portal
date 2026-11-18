import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { buildCustomsWorkbook, type CustomsItem } from './customsExport'
import { parseShipmentWorkbook } from './shipmentImport'

const template = (variant: string) => Uint8Array.from(readFileSync(new URL(`../../public/template-customs${variant === 'legacy' ? '' : '-' + variant}.xlsx`, import.meta.url))).buffer
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const parse = (xml: string) => new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml')

it.each(['rri', 'rrm', 'legacy'].flatMap(variant => [true, false].map(mainOnly => ({ variant, mainOnly }))))('主明细送货数量显示备品批注，模板提示不恢复，图片及金额保持（$variant，mainOnly=$mainOnly）', async ({ variant, mainOnly }) => {
  const items = [
    { material_id: 1, outbound_id: 1, qty: 38328, kg: 4178, price: .2, purchase_charge_ratio: 37968 / 38328 },
    { material_id: 2, outbound_id: 2, qty: 10, kg: 2, price: .3, purchase_charge_ratio: 1 },
    { material_id: 3, outbound_id: 3, qty: 5, kg: 1, price: .4, purchase_charge_ratio: 0 },
  ].map(item => ({ ...item, purchase_unit: 'PCS', supplier: '合成供应商', customs_company: '合成报关公司', currency: 'US$', contract_no: 'C', invoice_no: 'I' }))
  const before = structuredClone(items)
  const materials = new Map(items.map(item => [item.material_id, { id: item.material_id, name_zh: '物料' + item.material_id, unit_kg: 'KGM' }]))
  const images = new Map([[1, { ext: 'png', bytes: Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=', 'base64')) }]])
  const output = await buildCustomsWorkbook({ templateBuffer: template(variant), mainOnly, items, materials, images,
    productHs: new Map(), form: { customer: variant === 'rri' ? 'RRI' : 'RRM', containerNo: 'SPARE-NOTES', rate: 1 } })
  const bytes = await output.arrayBuffer(), book = XLSX.read(bytes, { type: 'array' }), sheet = book.Sheets['SPARE-NOTES']
  expect(sheet.L4.c?.map((c: { t?: string }) => c.t)).toEqual(['360pcs备品'])
  expect(sheet.L5.c).toBeUndefined()
  expect(sheet.L6.c?.map((c: { t?: string }) => c.t)).toEqual(['5pcs备品'])
  expect(sheet.M3.c).toBeUndefined()
  expect(sheet.K4.v).toBe(4178); expect(sheet.L4.v).toBe(38328)
  expect(sheet.AP4.v).toBeCloseTo(37968 * .2, 8); expect(sheet.AP4.f).toBe('ROUND(AO4*K4,2)')
  expect(sheet.AP6.v).toBe(0); expect(items).toEqual(before)
  const zip = await JSZip.loadAsync(bytes)
  const sheetNumber = mainOnly ? 1 : 2
  const rels = await zip.file(`xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`)!.async('string')
  expect(rels).toContain('/comments'); expect(rels).toContain('/vmlDrawing'); expect(rels).toContain('/drawing')
  const xml = parse(await zip.file(`xl/worksheets/sheet${sheetNumber}.xml`)!.async('string'))
  expect(xml.getElementsByTagNameNS(ns, 'drawing')).toHaveLength(1)
  expect(xml.getElementsByTagNameNS(ns, 'legacyDrawing')).toHaveLength(1)
  const order = Array.from(xml.documentElement!.childNodes).map(node => node.nodeName.replace(/^.*:/, ''))
  expect(order.indexOf('drawing')).toBeLessThan(order.indexOf('legacyDrawing'))
  if (order.includes('extLst')) expect(order.indexOf('legacyDrawing')).toBeLessThan(order.indexOf('extLst'))
  const vml = await zip.file('xl/drawings/shipment-quantity-comments.vml')!.async('string')
  expect(vml).toContain('visibility:hidden'); expect(vml).toContain('<x:Column>11</x:Column>')
  expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml')
}, 60000)

it('不同采购批次合并后仅在实际导出行注释合计备品', async () => {
  const items = [{ outbound_id: 1, qty: 110, kg: 11, purchase_charge_ratio: 100 / 110 },
    { outbound_id: 2, qty: 60, kg: 6, purchase_charge_ratio: 50 / 60 }].map(item => ({ ...item, material_id: 1, price: 2, purchase_unit: 'PCS' }))
  const blob = await buildCustomsWorkbook({ templateBuffer: template('rri'), mainOnly: true, items,
    materials: new Map([[1, { id: 1, name_zh: '合并物料', unit_kg: 'KGM' }]]), images: new Map(), productHs: new Map(), form: { customer: 'RRI', containerNo: 'MERGED-NOTES' } })
  const sheet = XLSX.read(await blob.arrayBuffer(), { type: 'array' }).Sheets['MERGED-NOTES']
  expect(sheet.L4.v).toBe(170); expect(sheet.L4.c?.map((c: { t?: string }) => c.t)).toEqual(['20pcs备品'])
  expect(sheet.L5?.c).toBeUndefined(); expect(sheet.AP4.v).toBeCloseTo(300, 8)
}, 60000)

it('导入源文件送货数量批注随行保留并重新导出，不改变计费依据', async () => {
  const wb = XLSX.utils.book_new(), input = XLSX.utils.aoa_to_sheet([['产品中文名称', '货号', '送货数量', '申报数量', '申报单位', '采购单价', '数量单位'],
    ['彩盒', 'SYN-1', 38328, 4178, 'KGM', 2, 'PCS']])
  input.C2.c = [{ a: 'Administrator', t: '360pcs备品' }]
  XLSX.utils.book_append_sheet(wb, input, '原始明细')
  const original = structuredClone(wb), item = parseShipmentWorkbook(wb).rows[0].item
  expect(item.material_snapshot.import_source?.cells.find(c => c.address === 'C2')?.comments)
    .toEqual([{ author: 'Administrator', text: '360pcs备品' }])
  const blob = await buildCustomsWorkbook({ templateBuffer: template('rri'), mainOnly: true, items: [{ ...item, material_id: -1 }],
    materials: new Map([[-1, item.material_snapshot]]), images: new Map(), productHs: new Map(), form: { customer: 'RRI', containerNo: 'IMPORTED-NOTES' } })
  const book = XLSX.read(await blob.arrayBuffer(), { type: 'array' }), exported = book.Sheets['IMPORTED-NOTES']
  expect(exported.L4.c?.map((c: { t?: string }) => c.t)).toEqual(['360pcs备品'])
  expect(exported.AP4.v).toBeCloseTo(Number(item.price) * Number(item.kg), 8)
  expect(parseShipmentWorkbook(book).rows.find(row => row.sheet === 'IMPORTED-NOTES')?.item.material_snapshot.import_source?.cells.find(c => c.address === 'L4')?.comments)
    .toEqual([{ author: 'Administrator', text: '360pcs备品' }])
  expect(wb).toEqual(original)
}, 60000)

it('人工核对备注与自动备品合为一个批注，关联行重读再导出不重复追加', async () => {
  const material = { id: 1, name_zh: '彩盒', unit_kg: 'KGM' }
  const item = { material_id: 1, outbound_id: 1, qty: 38328, kg: 4178, price: .2, purchase_unit: 'PCS', purchase_charge_ratio: 37968 / 38328,
    material_snapshot: { ...material, import_source: { sheet: '原始明细', row: 2, context: [], cells: [{ address: 'L2', label: '送货数量',
      value: 38328, display: '38328', comments: [{ author: 'Reviewer', text: '已核对\n360pcs备品' }] }] } } }
  const build = (row: CustomsItem) => buildCustomsWorkbook({ templateBuffer: template('rri'), mainOnly: true, items: [row],
    materials: new Map([[1, material]]), images: new Map(), productHs: new Map(), form: { customer: 'RRI', containerNo: 'NOTE-ROUNDTRIP' } })
  const first = XLSX.read(await (await build(item)).arrayBuffer(), { type: 'array' })
  expect(first.Sheets['NOTE-ROUNDTRIP'].L4.c).toHaveLength(1)
  expect(first.Sheets['NOTE-ROUNDTRIP'].L4.c?.[0].t).toBe('已核对\n360pcs备品')
  const imported = parseShipmentWorkbook(first).rows.find(row => row.sheet === 'NOTE-ROUNDTRIP')!.item
  const next = { ...item, material_snapshot: { ...material, import_source: imported.material_snapshot.import_source! } }
  const second = XLSX.read(await (await build(next)).arrayBuffer(), { type: 'array' })
  expect(second.Sheets['NOTE-ROUNDTRIP'].L4.c?.map((comment: { t?: string }) => comment.t)).toEqual(['已核对\n360pcs备品'])
}, 60000)
