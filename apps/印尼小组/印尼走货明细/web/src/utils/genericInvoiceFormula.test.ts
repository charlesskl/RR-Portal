import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { buildCustomsWorkbook } from './customsExport'

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const parse = (xml: string) => new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml')
async function sheetPath(zip: JSZip, name: string) {
  const wb = parse(await zip.file('xl/workbook.xml')!.async('string'))
  const id = Array.from(wb.getElementsByTagNameNS(ns, 'sheet')).find(s => s.getAttribute('name') === name)!.getAttribute('r:id')
  const rels = parse(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'))
  const target = Array.from(rels.getElementsByTagName('Relationship')).find(r => r.getAttribute('Id') === id)!.getAttribute('Target')!
  return target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^xl\//, '')
}

it.each(['rri', 'rrm', 'legacy'])('发票按商品名查编号、公司筛选去重、重复名称按公司+原序号匹配，合并行C至M绿色（%s）', async variant => {
  const template = variant === 'legacy' ? 'template-customs.xlsx' : `template-customs-${variant}.xlsx`
  const input = readFileSync(new URL('../../public/' + template, import.meta.url))
  const catalogue = XLSX.read(input, { type: 'buffer' }).Sheets['商品汇总表']
  const bagRow = Object.keys(catalogue).find(address => /^B\d+$/.test(address) && catalogue[address].v === 'PE胶袋')!.slice(1)
  const inputZip = await JSZip.loadAsync(input)
  const cataloguePath = await sheetPath(inputZip, '商品汇总表')
  const catalogueDoc = parse(await inputZip.file(cataloguePath)!.async('string'))
  // The reference catalogue's PE bag row is intentionally text with a leading zero.
  const bagCode = Array.from(catalogueDoc.getElementsByTagNameNS(ns, 'c')).find(cell => cell.getAttribute('r') === `A${bagRow}`)!
  bagCode.setAttribute('t', 'str')
  bagCode.getElementsByTagNameNS(ns, 'v')[0].textContent = '0012345678'
  inputZip.file(cataloguePath, new XMLSerializer().serializeToString(catalogueDoc))
  const names = ['PE胶袋', '无目录匹配的商品', 'PB螺丝', '说明书-FSC', 'PWB螺丝', '说明书-FSC', '彩盒']
  const materials = new Map(names.map((name, i) => [i + 1, { id: i + 1, name_zh: name, product_code: 'SYN-' + i,
    hs_cn: name.includes('螺丝') ? '7318159090' : '9999999999', unit_kg: 'KGM', net_per_pc: 1 }]))
  const items = names.map((_, i) => ({ material_id: i + 1, outbound_id: i + 1, qty: i + 1, kg: i + 1,
    price: 2, currency: 'US$', cartons: 1, customs_company: i % 2 ? '乙公司' : '甲公司', supplier: 'Synthetic supplier' }))
  const before = structuredClone(items)
  const blob = await buildCustomsWorkbook({ templateBuffer: await inputZip.generateAsync({ type: 'arraybuffer' }),
    items, materials, productHs: new Map(), images: new Map(),
    form: { customer: variant === 'rri' ? 'RRI' : 'RRM', containerNo: "O'Brien" } })
  const bytes = await blob.arrayBuffer(), zip = await JSZip.loadAsync(bytes)
  const book = XLSX.read(bytes, { type: 'array', cellStyles: true }), invoice = book.Sheets['发票']
  expect([9, 10, 11, 13, 14, 15].map(r => invoice[`B${r}`].v)).toEqual([1, 3, 7, 2, 4, 6])
  expect(invoice.C9.v).toBe('0012345678')
  expect(invoice.C10.v).toBe(7318159090)
  expect(invoice.C13.v || '').toBe('') // no catalogue match, no main-table HS fallback
  expect(invoice.C9.f).toBe('XLOOKUP(D9,\'商品汇总表\'!$B:$B,\'商品汇总表\'!$A:$A,"")')
  expect(invoice.D9.f).toContain("UNIQUE(_xlws.FILTER('O''Brien'!E:E,'O''Brien'!AR:AR=$D$12")
  expect(invoice.D9.F).toBe('D9:D11')
  expect([9, 10, 11].map(r => invoice[`D${r}`].v)).toEqual(['PE胶袋', '螺丝', '彩盒'])
  expect(invoice.D10.f).toBeUndefined(); expect(invoice.D11.f).toBeUndefined()
  for (const r of [13, 14, 15]) {
    expect(invoice[`D${r}`].f).toContain("'O''Brien'!AR:AR=$D$16")
    expect(invoice[`D${r}`].f).toContain(`'O''Brien'!A:A=B${r}`)
    expect(invoice[`D${r}`].f).not.toContain('UNIQUE')
  }
  expect([invoice.D14.v, invoice.D15.v]).toEqual(['说明书-FSC', '说明书-FSC'])
  expect(invoice.F10.v).toBe(8)
  expect(invoice.I10.v).toBe(16)
  expect(invoice.I17.v).toBe(56)
  expect(book.Sheets["O'Brien"].B4.v).toBe('9999999999')
  const xml = parse(await zip.file(await sheetPath(zip, '发票'))!.async('string'))
  const styles = parse(await zip.file('xl/styles.xml')!.async('string'))
  const cells = Array.from(xml.getElementsByTagNameNS(ns, 'c'))
  const xfs = Array.from(styles.getElementsByTagNameNS(ns, 'cellXfs')[0].getElementsByTagNameNS(ns, 'xf'))
  const fills = Array.from(styles.getElementsByTagNameNS(ns, 'fills')[0].getElementsByTagNameNS(ns, 'fill'))
  const color = (address: string) => {
    const cell = cells.find(cell => cell.getAttribute('r') === address)!
    const xf = xfs[Number(cell.getAttribute('s'))]
    return fills[Number(xf.getAttribute('fillId'))].getElementsByTagNameNS(ns, 'fgColor')[0]?.getAttribute('rgb') || ''
  }
  for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
    expect(color(col + '10')).toBe('FFC6E0B4')
    expect(color(col + '9')).not.toBe('FFC6E0B4')
    expect(color(col + '12')).not.toBe('FFC6E0B4')
  }
  expect(color('B10')).not.toBe('FFC6E0B4')
  expect(cells.find(c => c.getAttribute('r') === 'D9')!.getAttribute('cm')).toBe('1')
  for (const address of ['D10', 'D11']) {
    const child = cells.find(c => c.getAttribute('r') === address)!
    expect(child.getAttribute('t')).toBe('str')
    expect(child.getElementsByTagNameNS(ns, 'is').length).toBe(0)
    expect(child.getElementsByTagNameNS(ns, 'v')[0].textContent).toBe(invoice[address].v)
  }
  const rels = parse(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'))
  const metadataTarget = Array.from(rels.getElementsByTagName('Relationship')).find(rel => rel.getAttribute('Type')?.endsWith('/sheetMetadata'))!.getAttribute('Target')!
  const metadataPath = metadataTarget.startsWith('/') ? metadataTarget.slice(1) : 'xl/' + metadataTarget
  const metadata = parse(await zip.file(metadataPath)!.async('string'))
  expect(metadata.getElementsByTagNameNS(ns, 'metadataType')[0].getAttribute('name')).toBe('XLDAPR')
  expect(metadata.getElementsByTagNameNS(ns, 'cellMetadata')[0].getElementsByTagNameNS(ns, 'rc')[0].getAttribute('t')).toBe('1')
  expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('spreadsheetml.sheetMetadata+xml')
  // Sparse invoice serials remain compact in auxiliary sheets and select the correct invoice rows.
  const sales = book.Sheets['销售合同']
  expect([16, 17, 18, 19, 20, 21].map(r => sales[`A${r}`].v)).toEqual([1, 2, 3, 4, 6, 7])
  expect(sales.I18.v).toBe(16)
  expect(sales.I53.v).toBe(56)
  expect(items).toEqual(before)
}, 60000)
