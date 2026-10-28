import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { buildCustomsWorkbook, freezeMainWorksheet } from './customsExport'

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const parse = (xml: string) => new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml')
const serialize = (node: any) => new XMLSerializer().serializeToString(node)

function expectFrozen(xml: string) {
  const doc = parse(xml)
  const views = Array.from(doc.getElementsByTagNameNS(ns, 'sheetView'))
  expect(views.length).toBeGreaterThan(0)
  for (const view of views) {
    const panes = view.getElementsByTagNameNS(ns, 'pane')
    expect(panes.length).toBe(1)
    for (const [name, value] of Object.entries({ xSplit: '13', ySplit: '3', topLeftCell: 'N4', activePane: 'bottomRight', state: 'frozen' }))
      expect(panes[0].getAttribute(name)).toBe(value)
    expect(view.hasAttribute('topLeftCell')).toBe(false)
    const selections = Array.from(view.getElementsByTagNameNS(ns, 'selection'))
    expect(selections.map(s => s.getAttribute('pane'))).toEqual(['topRight', 'bottomLeft', 'bottomRight'])
    expect(selections[2].getAttribute('activeCell')).toBe('N4')
    expect(selections[2].getAttribute('sqref')).toBe('N4')
  }
}

async function fixture(views: string) {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="柜&amp;号" sheetId="7" r:id="rId7"/><sheet name="发票" sheetId="2" r:id="rId2"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Target="worksheets/sheet7.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet7.xml', `<x:worksheet xmlns:x="${ns}"><x:sheetPr/><x:dimension ref="A1:BD5"/>${views}<x:sheetFormatPr defaultRowHeight="15"/><x:cols><x:col min="14" max="15" hidden="1"/></x:cols><x:sheetData><x:row r="4"><x:c r="K4"><x:v>23</x:v></x:c><x:c r="L4"><x:v>100000</x:v></x:c><x:c r="AP4"><x:f>AO4*K4</x:f><x:v>73</x:v></x:c></x:row></x:sheetData><x:autoFilter ref="A3:BD4"/><x:mergeCells count="1"><x:mergeCell ref="AQ4:AQ5"/></x:mergeCells><x:drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdImg"/></x:worksheet>`)
  zip.file('xl/worksheets/sheet2.xml', `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane xSplit="2" state="frozen" topLeftCell="C1"/></sheetView></sheetViews><sheetData/></worksheet>`)
  return zip
}

it.each([
  '',
  `<x:sheetViews xmlns:x="${ns}"/>`,
  `<x:sheetViews xmlns:x="${ns}"><x:sheetView workbookViewId="0" zoomScale="65" showGridLines="0" topLeftCell="AP20"><x:pane xSplit="5" state="split"/><x:selection activeCell="AP20" sqref="AP20"/></x:sheetView><x:sheetView workbookViewId="1" zoomScale="80"/></x:sheetViews>`,
])('最终XML补齐或替换冻结视图，保持单元格、图片、隐藏列和其他单据不变 %#', async views => {
  const zip = await fixture(views)
  const invoiceBefore = await zip.file('xl/worksheets/sheet2.xml')!.async('string')
  const before = parse(await zip.file('xl/worksheets/sheet7.xml')!.async('string'))
  await freezeMainWorksheet(zip, '柜&号')
  const xml = await zip.file('xl/worksheets/sheet7.xml')!.async('string')
  expectFrozen(xml)
  const after = parse(xml)
  for (const tag of ['dimension', 'sheetFormatPr', 'cols', 'sheetData', 'autoFilter', 'mergeCells', 'drawing'])
    expect(serialize(after.getElementsByTagNameNS(ns, tag)[0])).toBe(serialize(before.getElementsByTagNameNS(ns, tag)[0]))
  const order = Array.from(after.documentElement!.childNodes).filter(n => n.nodeType === 1).map(n => n.localName)
  expect(order.indexOf('sheetViews')).toBeGreaterThan(order.indexOf('dimension'))
  expect(order.indexOf('sheetViews')).toBeLessThan(order.indexOf('sheetFormatPr'))
  if (views.includes('zoomScale="65"')) {
    const view = after.getElementsByTagNameNS(ns, 'sheetView')[0]
    expect(view.getAttribute('zoomScale')).toBe('65')
    expect(view.getAttribute('showGridLines')).toBe('0')
  }
  expect(await zip.file('xl/worksheets/sheet2.xml')!.async('string')).toBe(invoiceBefore)
  await freezeMainWorksheet(zip, '柜&号')
  expect(await zip.file('xl/worksheets/sheet7.xml')!.async('string')).toBe(xml)
})

it('主明细缺失时明确报错，不输出没有冻结的文件', async () => {
  await expect(freezeMainWorksheet(await fixture(''), '不存在')).rejects.toThrow('主明细')
})

it.each([
  ['rri', false], ['rri', true], ['rrm', false], ['rrm', true], ['', false], ['', true],
] as const)('真实模板导出的最终文件冻结前三行和A至M，兼容完整单据和仅主表（%s / %s）', async (template, mainOnly) => {
  const templateBuffer = Uint8Array.from(readFileSync(new URL(`../../public/template-customs${template ? '-' + template : ''}.xlsx`, import.meta.url))).buffer
  const items = [{ material_id: 942, outbound_id: 91, qty: 100000, kg: 23, price: .00073, purchase_unit: '个',
    currency: 'US$', supplier: '供应商', customs_company: '出口公司', po_no: 'IRRIHS0391', cartons: 10 }]
  const materials = new Map([[942, { id: 942, product_code: '47674A', name_zh: 'PB螺丝2.6*5PB', unit_kg: 'KGM', net_per_pc: .00023 }]])
  const before = structuredClone(items)
  const blob = await buildCustomsWorkbook({ templateBuffer, items, materials, productHs: new Map(), images: new Map(),
    form: { containerNo: 'FREEZE-TEST', customer: template === 'rrm' ? 'RRM' : 'RRI', rate: .93 }, mainOnly })
  const buffer = await blob.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)
  const book = parse(await zip.file('xl/workbook.xml')!.async('string'))
  const rels = parse(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'))
  const sheet = Array.from(book.getElementsByTagNameNS(ns, 'sheet')).find(s => s.getAttribute('name') === 'FREEZE-TEST')!
  const id = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  const rel = Array.from(rels.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship')).find(r => r.getAttribute('Id') === id)!
  const path = 'xl/' + rel.getAttribute('Target')!.replace(/^\/?xl\//, '')
  expectFrozen(await zip.file(path)!.async('string'))
  const sheetData = XLSX.read(buffer, { type: 'array' }).Sheets['FREEZE-TEST']
  expect(sheetData.K4.v).toBe(23)
  expect(sheetData.L4.v).toBe(100000)
  expect(sheetData.AP4.v).toBeCloseTo(73, 8)
  expect(items).toEqual(before)
}, 60000)
