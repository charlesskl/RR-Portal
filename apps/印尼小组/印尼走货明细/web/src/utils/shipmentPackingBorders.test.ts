import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { buildCustomsWorkbook } from './customsExport'

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const parse = (xml: string) => new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml')

it.each(['RRI', 'RRM', 'legacy'])('packing tables have vertical dividers without internal horizontal lines, including blank and expanded rows (%s)', async variant => {
  const items = Array.from({ length: 11 }, (_, index) => ({ material_id: index + 1, qty: 10, kg: 1,
    gross_kg: 2, cartons: 1, price: 2, currency: 'US$', supplier: '合成供应商',
    contract_no: `SYN-C-${index < 2 ? 1 : 2}`, invoice_no: `SYN-I-${index < 2 ? 1 : 2}` }))
  const template = variant === 'legacy' ? 'template-customs.xlsx' : `template-customs-${variant.toLowerCase()}.xlsx`
  const blob = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/' + template, import.meta.url))).buffer,
    items, materials: new Map(items.map(item => [item.material_id, { id: item.material_id,
      product_code: `SYN-${item.material_id}`, name_zh: `合成物料${item.material_id}`, unit_kg: 'KGM' }])),
    productHs: new Map(), images: new Map(), form: { customer: variant === 'legacy' ? 'RRM' : variant, containerNo: 'PACKING-BORDERS' },
  })
  const bytes = await blob.arrayBuffer(), book = XLSX.read(bytes, { type: 'array' }), zip = await JSZip.loadAsync(bytes)
  const workbook = parse(await zip.file('xl/workbook.xml')!.async('string'))
  const relations = parse(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'))
  const sheet = Array.from(workbook.getElementsByTagNameNS(ns, 'sheet')).find(node => node.getAttribute('name') === '装箱单')!
  const relation = Array.from(relations.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship')).find(node => node.getAttribute('Id') === sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'))!
  const target = relation.getAttribute('Target')!.replace(/^\//, '')
  const packing = parse(await zip.file(target.startsWith('xl/') ? target : 'xl/' + target)!.async('string'))
  const styles = parse(await zip.file('xl/styles.xml')!.async('string'))
  const xfs = Array.from(styles.getElementsByTagNameNS(ns, 'cellXfs')[0].getElementsByTagNameNS(ns, 'xf'))
  const borders = Array.from(styles.getElementsByTagNameNS(ns, 'borders')[0].getElementsByTagNameNS(ns, 'border'))
  const cells = new Map(Array.from(packing.getElementsByTagNameNS(ns, 'c')).map(cell => [cell.getAttribute('r'), cell]))
  const edge = (address: string, side: string) => {
    const cell = cells.get(address)!
    expect(cell, address).toBeTruthy()
    const xf = xfs[Number(cell.getAttribute('s') || 0)]
    return borders[Number(xf.getAttribute('borderId') || 0)].getElementsByTagNameNS(ns, side)[0]?.getAttribute('style') || null
  }
  const ranges = Object.entries(book.Sheets['装箱单']).filter(([address, cell]) => /^D\d+$/.test(address) && /^SUM\(D\d+:D\d+\)$/.test(cell.f || ''))
    .map(([, cell]) => cell.f!.match(/^SUM\(D(\d+):D(\d+)\)$/)!.slice(1).map(Number))
  expect(ranges).toHaveLength(2)
  expect(ranges.map(([first, last]) => last - first + 1)).toEqual([7, 9])
  for (const [first, last] of ranges) {
    for (let row = first; row <= last + 1; row++) {
      for (const column of 'ABCDEFGHIJK') {
        const address = `${column}${row}`
        expect(edge(address, 'top'), address).toBe(null)
        expect(edge(address, 'bottom'), address).toBe(null)
        expect(edge(address, 'left'), address).toBe('thin')
        expect(edge(address, 'right'), address).toBe('thin')
      }
    }
    for (const column of 'ABCDEFGHIJK') {
      expect(edge(`${column}${first - 1}`, 'bottom')).toBe('thin')
      expect(edge(`${column}${last + 2}`, 'bottom')).toBe('medium')
    }
  }
}, 60000)
