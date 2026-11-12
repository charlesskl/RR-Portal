import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { DOMParser } from '@xmldom/xmldom'
import { buildCustomsWorkbook } from './customsExport'
import { appendShipmentDocumentSheets, renameDocumentSheets, shipmentDocumentBatches } from './shipmentDocumentOverflow'

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relNS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const docRelNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const template = (customer: string) => Uint8Array.from(readFileSync(new URL(`../../public/template-customs-${customer.toLowerCase()}.xlsx`, import.meta.url))).buffer
const seller = { id: 11, keyword: '合成供应商', full: '合成供应商有限公司', nameEn: 'SYNTHETIC SELLER',
  addressZh: '合成地址', addressEn: 'Synthetic address', phone: '000', email: 'synthetic@example.invalid', contact: 'Test' }
const parse = (value: string) => new DOMParser().parseFromString(value, 'application/xml')

it.each([true, false])('按单套容量分批，所有合同发票顺序和明细均保留，RRI=%s', rri => {
  const groups = Array.from({ length: 50 }, (_, i) => ({ indo: i % 5 === 0, indices: [i + 1, i + 100], contract: 'C' + i }))
  const batches = shipmentDocumentBatches(groups, rri)
  expect(batches.flat()).toEqual(groups)
  for (const batch of batches) {
    expect(batch.length).toBeLessThanOrEqual(15)
    expect(batch.filter(g => !g.indo).length).toBeLessThanOrEqual(rri ? 14 : 15)
    expect(batch.filter(g => g.indo).length).toBeLessThanOrEqual(rri ? 1 : 2)
  }
})

it('续页公式只改工作表引用，主明细、字符串与绝对坐标不变', () => {
  const names = new Map([['实业合同', '实业合同·续2'], ['实业发票', '实业发票·续2']])
  expect(renameDocumentSheets(`IF(A1="实业合同!H5",'主明细'!K4+'实业合同'!$G$31+实业发票!J35,0)`, names))
    .toBe(`IF(A1="实业合同!H5",'主明细'!K4+'实业合同·续2'!$G$31+'实业发票·续2'!J35,0)`)
})

it('续页重用样式并保留图片关系、工作表链接、打印名称，不覆盖原页或源文件', async () => {
  const make = (source: boolean) => {
    const zip = new JSZip()
    zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${docRelNS}"><sheets><sheet name="主明细" sheetId="1" r:id="rId1"/><sheet name="实业合同" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="1">'实业合同'!$1:$3</definedName></definedNames><calcPr/></workbook>`)
    zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${relNS}"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="${docRelNS}/worksheet"/><Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="${docRelNS}/worksheet"/></Relationships>`)
    const xf = '<xf fontId="0" fillId="0" borderId="0" numFmtId="0"/>'
    zip.file('xl/styles.xml', `<styleSheet xmlns="${ns}"><fonts count="${source ? 2 : 1}"><font><name val="Calibri"/></font>${source ? '<font><name val="Arial"/><b/></font>' : ''}</fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1">${xf}</cellStyleXfs><cellXfs count="2">${xf}${source ? '<xf fontId="1" fillId="0" borderId="0" numFmtId="0"/>' : xf}</cellXfs></styleSheet>`)
    zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${source ? '<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
    zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${ns}"><dimension ref="A1"/><sheetData/></worksheet>`)
    zip.file('xl/worksheets/sheet2.xml', `<worksheet xmlns="${ns}" xmlns:r="${docRelNS}"><dimension ref="A1:H30"/><sheetData><row r="24"><c r="B24" s="${source ? 1 : 0}"><f>'主明细'!D4</f></c></row></sheetData><drawing r:id="pic"/></worksheet>`)
    zip.file('xl/worksheets/_rels/sheet2.xml.rels', `<Relationships xmlns="${relNS}"><Relationship Id="pic" Target="../drawings/drawing1.xml" Type="${docRelNS}/drawing"/></Relationships>`)
    zip.file('xl/drawings/drawing1.xml', '<drawing/>')
    zip.file('xl/drawings/_rels/drawing1.xml.rels', `<Relationships xmlns="${relNS}"><Relationship Id="image" Target="../media/image1.png" Type="${docRelNS}/image"/></Relationships>`)
    zip.file('xl/media/image1.png', new Uint8Array([1, 2, 3]))
    return zip
  }
  const target = make(false), source = make(true), original = await target.file('xl/worksheets/sheet2.xml')!.async('string')
  await appendShipmentDocumentSheets(target, source, 2)
  const count = parse(await target.file('xl/styles.xml')!.async('string')).getElementsByTagNameNS(ns, 'cellXfs')[0].getAttribute('count')
  expect(count).toBe('3') // target has duplicate xfs: append after actual length, not unique count
  await appendShipmentDocumentSheets(target, source, 3)
  expect(parse(await target.file('xl/styles.xml')!.async('string')).getElementsByTagNameNS(ns, 'cellXfs')[0].getAttribute('count')).toBe(count)
  const copied = parse(await target.file('xl/shipmentOverflow2/worksheets/sheet2.xml')!.async('string'))
  expect(copied.getElementsByTagNameNS(ns, 'c')[0].getAttribute('s')).toBe('2')
  expect(await target.file('xl/shipmentOverflow2/media/image1.png')!.async('uint8array')).toEqual(new Uint8Array([1, 2, 3]))
  expect(await target.file('xl/worksheets/sheet2.xml')!.async('string')).toBe(original)
  expect(await source.file('xl/worksheets/sheet2.xml')!.async('string')).toContain('s="1"')
  const book = parse(await target.file('xl/workbook.xml')!.async('string'))
  expect(Array.from(book.getElementsByTagNameNS(ns, 'sheet')).map(n => n.getAttribute('name'))).toEqual(['主明细', '实业合同', '实业合同·续2', '实业合同·续3'])
  expect(Array.from(book.getElementsByTagNameNS(ns, 'definedName')).some(n => n.textContent === "'实业合同·续2'!$1:$3")).toBe(true)
})

async function sheets(zip: JSZip) {
  const workbook = parse(await zip.file('xl/workbook.xml')!.async('string'))
  const relations = parse(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'))
  const byId = new Map(Array.from(relations.getElementsByTagNameNS(relNS, 'Relationship')).map(n => [n.getAttribute('Id'), n.getAttribute('Target')!]))
  const result = new Map<string, ReturnType<typeof parse>>()
  for (const sheet of Array.from(workbook.getElementsByTagNameNS(ns, 'sheet'))) {
    const target = byId.get(sheet.getAttributeNS(docRelNS, 'id'))!
    const path = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : 'xl/' + target
    result.set(sheet.getAttribute('name')!, parse(await zip.file(path)!.async('string')))
  }
  return { workbook, result }
}

it.each(['RRI', 'RRM'].flatMap(customer => [true, false].map(mixed => ({ customer, mixed }))))('超过15份及印尼原容量仍导出全部合同、发票、装箱单（$customer，mixed=$mixed）', async ({ customer, mixed }) => {
  const items = Array.from({ length: 20 }, (_, index) => ({ material_id: index + 1, supplier: seller.keyword,
    qty: 10 + index, kg: 10 + index, cartons: 1, price: 2, currency: 'US$',
    contract_no: `SYN-C-${index}`, invoice_no: `SYN-I-${index}`, bl_head: mixed && index % 5 === 0 ? 'PT SYNTHETIC' : 'RRI' }))
  // The final continuation's one invoice also exceeds its original detail-row
  // capacity, exercising continuation creation together with table expansion.
  items.push(...Array.from({ length: 11 }, (_, index) => ({ ...items[19], material_id: 21 + index, qty: 1, kg: 1 })))
  const original = structuredClone(items)
  const materials = new Map(items.map(item => [item.material_id, { id: item.material_id, name_zh: `合成物料${item.material_id}`,
    product_code: `SYN-${item.material_id}`, unit_kg: 'PCE', net_per_pc: 1, supplier: seller.keyword }]))
  const blob = await buildCustomsWorkbook({ templateBuffer: template(customer),
    indonesiaTemplateBuffer: Uint8Array.from(readFileSync(new URL('../../public/template-customs.xlsx', import.meta.url))).buffer,
    items, materials, seller, productHs: new Map(), images: new Map(), form: { customer, containerNo: 'OVERFLOW-SYNTHETIC' } })
  const bytes = await blob.arrayBuffer(), zip = await JSZip.loadAsync(bytes)
  const { workbook, result } = await sheets(zip)
  expect([...result.keys()].filter(name => name.includes('·续')).length).toBeGreaterThan(0)
  const records = (pattern: RegExp) => [...result].filter(([name]) => pattern.test(name)).flatMap(([, doc]) =>
    Array.from(doc.getElementsByTagNameNS(ns, 'row')).flatMap(row => {
      const r = row.getAttribute('r')!, cells = Array.from(row.getElementsByTagNameNS(ns, 'c'))
      const serial = cells.find(c => c.getAttribute('r') === `A${r}`)?.getElementsByTagNameNS(ns, 'v')[0]?.textContent
      const lookup = cells.find(c => c.getAttribute('r') === `B${r}`)?.getElementsByTagNameNS(ns, 'f')[0]?.textContent
      return serial && lookup?.includes('OVERFLOW-SYNTHETIC') ? [Number(serial)] : []
    }))
  for (const pattern of [/^(实业|全球|印尼)合同(?:·续\d+)?$/, /^(实业|全球|印尼)发票(?:·续\d+)?$/, /^装箱单(?:·续\d+)?$/])
    expect(records(pattern).sort((a, b) => a - b)).toEqual(Array.from({ length: items.length }, (_, i) => i + 1))
  const data = XLSX.read(bytes, { type: 'array' }), main = data.Sheets['OVERFLOW-SYNTHETIC']
  expect(items).toEqual(original)
  expect(items.reduce((sum, _, index) => sum + Number(main[`AP${index + 4}`].v), 0)).toBe(items.reduce((sum, item) => sum + item.qty * item.price, 0))
  const styles = parse(await zip.file('xl/styles.xml')!.async('string'))
  const xfs = Array.from(styles.getElementsByTagNameNS(ns, 'cellXfs')[0].getElementsByTagNameNS(ns, 'xf'))
  const fonts = Array.from(styles.getElementsByTagNameNS(ns, 'fonts')[0].getElementsByTagNameNS(ns, 'font'))
  const fills = Array.from(styles.getElementsByTagNameNS(ns, 'fills')[0].getElementsByTagNameNS(ns, 'fill'))
  const borders = Array.from(styles.getElementsByTagNameNS(ns, 'borders')[0].getElementsByTagNameNS(ns, 'border'))
  const styleAt = (doc: ReturnType<typeof parse>, address: string) => {
    const cell = Array.from(doc.getElementsByTagNameNS(ns, 'c')).find(c => c.getAttribute('r') === address)
    const xf = xfs[Number(cell?.getAttribute('s') || 0)]
    const font = fonts[Number(xf.getAttribute('fontId') || 0)]
    const border = borders[Number(xf.getAttribute('borderId') || 0)]
    return { name: font.getElementsByTagNameNS(ns, 'name')[0]?.getAttribute('val'),
      size: font.getElementsByTagNameNS(ns, 'sz')[0]?.getAttribute('val'),
      bold: font.getElementsByTagNameNS(ns, 'b').length,
      edges: ['left', 'right', 'top', 'bottom'].map(edge => border.getElementsByTagNameNS(ns, edge)[0]?.getAttribute('style')) }
  }
  for (const [name, doc] of result) if (name.includes('·续')) {
    for (const cell of Array.from(doc.getElementsByTagNameNS(ns, 'c'))) {
      const xf = xfs[Number(cell.getAttribute('s') || 0)]
      expect(xf).toBeDefined()
      expect(Number(xf.getAttribute('fontId') || 0)).toBeLessThan(fonts.length)
      expect(Number(xf.getAttribute('fillId') || 0)).toBeLessThan(fills.length)
      expect(Number(xf.getAttribute('borderId') || 0)).toBeLessThan(borders.length)
    }
    const index = data.SheetNames.indexOf(name)
    const area = Array.from(workbook.getElementsByTagNameNS(ns, 'definedName')).find(n => n.getAttribute('name') === '_xlnm.Print_Area' && n.getAttribute('localSheetId') === String(index))
    expect(area?.textContent).toContain(`'${name}'!$A$1:`)
    expect(doc.getElementsByTagNameNS(ns, 'mergeCell').length).toBeGreaterThan(0)
    const base = result.get(name.split('·续')[0])
    if (base) expect(styleAt(doc, 'B24')).toEqual(styleAt(base, 'B24'))
  }
}, 120000)
