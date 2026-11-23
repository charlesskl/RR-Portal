import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { DOMParser } from '@xmldom/xmldom'
import { shipmentPurchaseTotal } from './shipmentPurchase'
import { buildCustomsWorkbook } from './customsExport'

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const seller = { id: 11, keyword: '合成供应商', full: '合成供应商有限公司', nameEn: 'SYNTHETIC SELLER', addressZh: '合成地址', addressEn: 'Synthetic address', phone: '000', email: 'test@example.invalid', contact: 'Test' }
const template = (variant: string) => Uint8Array.from(readFileSync(new URL(`../../public/template-customs${variant === 'legacy' ? '' : '-' + variant}.xlsx`, import.meta.url))).buffer
const parse = (xml: string) => new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml')

it.each(['rri', 'rrm', 'legacy'])('金额完整显示、合同和发票保留有效单价、中文单位重算后不变（%s）', async variant => {
  const units = ['PCE', 'PCE', 'TNE', 'ROLL']
  const prices = [.0652, .000529, 31830, 11.42]
  const items = units.map((_, index) => ({ material_id: index + 1, supplier: seller.keyword,
    qty: index === 2 ? 1 : 100, kg: index === 2 ? .024 : 100, price: prices[index], purchase_unit: '个', currency: 'US$',
    contract_no: 'C-52', invoice_no: 'I-52', customs_company: '合成报关公司', cartons: 1 }))
  const materials = new Map(units.map((unit, index) => [index + 1, { id: index + 1, name_zh: '物料' + index,
    name_en: 'Material ' + index, product_code: 'SYN-' + index, unit_kg: unit, net_per_pc: 1 }]))
  const blob = await buildCustomsWorkbook({ templateBuffer: template(variant), items, materials, seller,
    productHs: new Map(), images: new Map(), form: { customer: variant === 'rri' ? 'RRI' : 'RRM', containerNo: 'DISPLAY', rate: 1 } })
  const bytes = await blob.arrayBuffer(), zip = await JSZip.loadAsync(bytes)
  const book = XLSX.read(bytes, { type: 'array', cellNF: true, cellStyles: true }), main = book.Sheets.DISPLAY
  expect(main.AQ4.f).toBe('SUM(AP4:AP7)')
  expect(main.AQ4.v).toBeCloseTo(shipmentPurchaseTotal(items), 8)
  for (const col of ['Z', 'AA', 'AB', 'AO', 'AP', 'AQ']) expect(main['!cols']?.[XLSX.utils.decode_col(col)]?.wch).toBeGreaterThanOrEqual(21)
  for (const [address, price] of [['Z4', .0652], ['AO4', .0652], ['Z5', .000529]] as const) {
    expect(main[address].v).toBeCloseTo(price, 10)
    expect(XLSX.utils.format_cell(main[address])).toContain(String(price))
  }
  let checkedDocuments = 0
  for (const [name, sheet] of Object.entries(book.Sheets)) {
    const contract = /^(实业|全球|印尼)合同$/.test(name), invoice = /^(实业|全球|印尼)发票$/.test(name), generic = name === '发票'
    if (!contract && !invoice && !generic) continue
    const serial = generic ? 'B' : 'A', column = contract ? 'F' : generic ? 'H' : 'I'
    const rows = Object.keys(sheet).filter(address => new RegExp(`^${serial}\\d+$`).test(address) && [1, 2].includes(Number(sheet[address].v)))
    if (!rows.length) continue // unused approved template blocks remain blank
    checkedDocuments++
    expect(rows).toHaveLength(2)
    for (const address of rows) {
      const cell = sheet[column + address.slice(1)], price = prices[Number(sheet[address].v) - 1]
      expect(generic ? sheet['F' + address.slice(1)].f : cell.f).toBeTruthy()
      // Template formula caches may be absent; the number format must keep the complete source price on recalculation.
      // SSF cannot render mixed mandatory/optional fractional digits; verify the
      // full precision equivalent, keeping the original OOXML format optional.
      expect(XLSX.SSF.format(cell.z!.replace(/(0\.0+)#+/g, (_: string, fixed: string) => fixed.padEnd(14, '0')), price)).toContain(String(price))
      expect(cell.z).toContain('0.0000########')
    }
  }
  expect(checkedDocuments).toBeGreaterThanOrEqual(3)
  const generic = book.Sheets['发票']
  for (const [serial, label] of [[3, '吨'], [4, '卷']] as const) {
    const row = Object.keys(generic).find(address => /^B\d+$/.test(address) && generic[address].v === serial)!.slice(1)
    expect(generic['G' + row].v).toBe(label)
    expect(generic['F' + row].f).toContain("'单位对照'!$A:$A,'单位对照'!$B:$B")
    expect(generic['F' + row].f).not.toContain(`"${label}"`)
    expect(generic['F' + row].f).toContain('UPPER(TRIM(')
  }
  expect(main.J6.v).toBe('TNE'); expect(main.J7.v).toBe('ROLL')
  const styles = parse(await zip.file('xl/styles.xml')!.async('string'))
  const xfs = Array.from(styles.getElementsByTagNameNS(ns, 'cellXfs')[0].getElementsByTagNameNS(ns, 'xf'))
  const workbook = parse(await zip.file('xl/workbook.xml')!.async('string'))
  const sheets = Array.from(workbook.getElementsByTagNameNS(ns, 'sheet'))
  const relations = parse(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'))
  const mainId = sheets.find(s => s.getAttribute('name') === 'DISPLAY')!.getAttribute('r:id')
  const target = Array.from(relations.getElementsByTagName('Relationship')).find(r => r.getAttribute('Id') === mainId)!.getAttribute('Target')!
  const path = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : 'xl/' + target
  const doc = parse(await zip.file(path)!.async('string'))
  const cell = Array.from(doc.getElementsByTagNameNS(ns, 'c')).find(c => c.getAttribute('r') === 'AQ4')!
  const alignment = xfs[Number(cell.getAttribute('s'))].getElementsByTagNameNS(ns, 'alignment')[0]
  expect(alignment.getAttribute('shrinkToFit')).toBe('1'); expect(alignment.getAttribute('wrapText')).toBe('0')
}, 120000)
