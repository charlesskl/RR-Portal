import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { buildCustomsWorkbook, customsFileName } from './customsExport'
import { bindInvoiceLookupSerial } from './documentTemplateFormula'
import auxiliaryDocumentLayout from './auxiliaryDocumentLayout.json'

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

const templateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs.xlsx', import.meta.url))).buffer
const rriTemplateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rri.xlsx', import.meta.url))).buffer
const rrmTemplateBuffer = Uint8Array.from(readFileSync(new URL('../../public/template-customs-rrm.xlsx', import.meta.url))).buffer
const seller = {
  keyword: '测试供应商', full: '测试供应商有限公司', nameEn: 'Test Supplier Limited',
  addressZh: '深圳市测试路1号', addressEn: 'No. 1 Test Road, Shenzhen',
  phone: '0755-12345678', email: 'sales@example.com', contact: '张先生',
}
const huashengyiSeller = {
  keyword: '华胜益', full: '深圳市华胜益出口贸易有限公司', nameEn: 'SHENZHEN HUASHENGYI EXPORT TRADING LIMITED',
  addressZh: '深圳市龙华区测试地址', addressEn: 'Test Address, Longhua, Shenzhen',
  phone: '0755-27745367', email: 'test@huashengyi.example', contact: 'Peng Yuqiang',
}
const secondSeller = {
  id: 202, keyword: '乙方供应商', full: '乙方供应商有限公司', nameEn: 'SECOND SUPPLIER LIMITED',
  addressZh: '东莞市测试路2号', addressEn: 'No. 2 Test Road, Dongguan',
  phone: '0769-22223333', email: 'sales@second.example', contact: '李小姐',
}

function tradeTerms(wb: XLSX.WorkBook, sheetNames: string[]) {
  return sheetNames.flatMap(sheetName => Object.values(wb.Sheets[sheetName] || {})
    .map((cell: any) => cell?.v)
    .filter((value): value is string => typeof value === 'string' && /^(?:FOB|CIF) IDSRG,Semarang$/.test(value)))
}

function countCellValue(wb: XLSX.WorkBook, sheetName: string, value: string) {
  return Object.values(wb.Sheets[sheetName] || {}).filter((cell: any) => cell?.v === value).length
}

function sheetHasValue(wb: XLSX.WorkBook, sheetName: string, value: string) {
  return Object.values(wb.Sheets[sheetName] || {}).some((cell: any) => cell?.v === value)
}

function sheetContainsText(wb: XLSX.WorkBook, sheetName: string, value: string) {
  return Object.values(wb.Sheets[sheetName] || {}).some((cell: any) => typeof cell?.v === 'string' && cell.v.includes(value))
}

function countCellsContaining(wb: XLSX.WorkBook, sheetName: string, value: string) {
  return Object.values(wb.Sheets[sheetName] || {})
    .filter((cell: any) => typeof cell?.v === 'string' && cell.v.includes(value)).length
}

function borderEdges(stylesXml: string, sheetXml: string, address: string) {
  const stylesDoc = new DOMParser().parseFromString(stylesXml, 'application/xml')
  const sheetDoc = new DOMParser().parseFromString(sheetXml, 'application/xml')
  const cells = Array.from(sheetDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'c')) as any[]
  const cell = cells.find(candidate => candidate.getAttribute('r') === address)
  if (!cell) return []
  const xfs = Array.from(stylesDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'cellXfs')[0]
    .getElementsByTagNameNS(SPREADSHEET_NS, 'xf')) as any[]
  const borders = Array.from(stylesDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'borders')[0]
    .getElementsByTagNameNS(SPREADSHEET_NS, 'border')) as any[]
  const xf = xfs[Number(cell.getAttribute('s') || 0)]
  const border = borders[Number(xf?.getAttribute('borderId') || 0)]
  return ['top', 'bottom', 'left', 'right'].filter(edge => {
    const side = border?.getElementsByTagNameNS(SPREADSHEET_NS, edge)[0]
    return Boolean(side?.getAttribute('style'))
  })
}

function borderStyle(stylesXml: string, sheetXml: string, address: string, edge: string, color = false) {
  const stylesDoc = new DOMParser().parseFromString(stylesXml, 'application/xml')
  const sheetDoc = new DOMParser().parseFromString(sheetXml, 'application/xml')
  const cells = Array.from(sheetDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'c')) as any[]
  const cell = cells.find(candidate => candidate.getAttribute('r') === address)
  const xfs = Array.from(stylesDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'cellXfs')[0]
    .getElementsByTagNameNS(SPREADSHEET_NS, 'xf')) as any[]
  const borders = Array.from(stylesDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'borders')[0]
    .getElementsByTagNameNS(SPREADSHEET_NS, 'border')) as any[]
  const xf = xfs[Number(cell?.getAttribute('s') || 0)]
  const border = borders[Number(xf?.getAttribute('borderId') || 0)]
  const side = border?.getElementsByTagNameNS(SPREADSHEET_NS, edge)[0]
  return color ? side?.getElementsByTagNameNS(SPREADSHEET_NS, 'color')[0]?.getAttribute('rgb') || null
    : side?.getAttribute('style') || null
}

function fillColor(stylesXml: string, sheetXml: string, address: string) {
  const stylesDoc = new DOMParser().parseFromString(stylesXml, 'application/xml')
  const sheetDoc = new DOMParser().parseFromString(sheetXml, 'application/xml')
  const cells = Array.from(sheetDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'c')) as any[]
  const cell = cells.find(candidate => candidate.getAttribute('r') === address)
  const xfs = Array.from(stylesDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'cellXfs')[0]
    .getElementsByTagNameNS(SPREADSHEET_NS, 'xf')) as any[]
  const fills = Array.from(stylesDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'fills')[0]
    .getElementsByTagNameNS(SPREADSHEET_NS, 'fill')) as any[]
  const xf = xfs[Number(cell?.getAttribute('s') || 0)]
  const fill = fills[Number(xf?.getAttribute('fillId') || 0)]
  return fill?.getElementsByTagNameNS(SPREADSHEET_NS, 'fgColor')[0]?.getAttribute('rgb') || ''
}

async function worksheetXml(zip: JSZip, sheetName: string) {
  const workbookDoc = new DOMParser().parseFromString(
    await zip.file('xl/workbook.xml')!.async('string'),
    'application/xml',
  )
  const relsDoc = new DOMParser().parseFromString(
    await zip.file('xl/_rels/workbook.xml.rels')!.async('string'),
    'application/xml',
  )
  const sheet = (Array.from(workbookDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'sheet')) as any[])
    .find(candidate => candidate.getAttribute('name') === sheetName)
  const relationId = sheet?.getAttributeNS(
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'id',
  )
  const relation = (Array.from(relsDoc.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/package/2006/relationships',
    'Relationship',
  )) as any[]).find(candidate => candidate.getAttribute('Id') === relationId)
  const target = String(relation?.getAttribute('Target') || '').replace(/^\//, '')
  const path = target.startsWith('xl/') ? target : `xl/${target}`
  return await zip.file(path)!.async('string')
}

describe('supplier document export', () => {
  it.each(['legacy', 'RRI', 'RRM'])('restores approved auxiliary lookup formulas against current grouped invoice (%s)', async variant => {
    const buffer = variant === 'legacy' ? templateBuffer : variant === 'RRI' ? rriTemplateBuffer : rrmTemplateBuffer
    const output = await buildCustomsWorkbook({ templateBuffer: buffer, seller,
      items: [1, 2, 3].map(id => ({ material_id: id, qty: 10 * id, kg: id, price: 2,
        customs_company: id === 2 ? '其他报关公司' : '深圳市华胜益出口贸易有限公司',
        contract_no: 'CURRENT-C', invoice_no: 'CURRENT-I' })),
      materials: new Map([1, 2, 3].map(id => [id, { id, product_code: `CURRENT-${id}`, name_zh: `当前物料${id}`, supplier: seller.keyword }])),
      productHs: new Map(), images: new Map(), form: { customer: variant, containerNo: 'CURRENT-CONTAINER', shipDate: '2026-10-14' },
    })
    const wb = XLSX.read(await output.arrayBuffer(), { type: 'array' })
    const invoice = wb.Sheets['发票']
    const invoiceRows = Object.entries(invoice).filter(([address, cell]) => /^B\d+$/.test(address) && typeof cell.v === 'number')
    expect(invoiceRows).toHaveLength(3)
    for (let serial = 1; serial <= 3; serial++) {
      const invoiceRow = Number(invoiceRows.find(([, c]) => c.v === serial)![0].slice(1))
      const sales = wb.Sheets['销售合同'], packing = wb.Sheets['装箱单 (2)'], declaration = wb.Sheets['草稿大单-1']
      const sr = serial + 15, pr = serial + 9, dr = serial + 20
      expect(sales[`B${sr}`].f).toMatch(/HSTACK\(/)
      expect(sales[`B${sr}`].f).toContain(`XLOOKUP($A${sr},'发票'!$B:$B,'发票'!$C:$C)`)
      expect(sales[`B${sr}`].F).toBe(`B${sr}:F${sr}`)
      expect(packing[`B${pr}`].F).toBe(`B${pr}:H${pr}`)
      for (const [col, source] of Object.entries({ B: 'D', C: 'L', D: 'M', E: 'F', F: 'G', G: 'J', H: 'K' })) {
        expect(packing[`${col}${pr}`].v).toBe(invoice[`${source}${invoiceRow}`].v)
      }
      expect(sales[`I${sr}`].v).toBe(invoice[`I${invoiceRow}`].v)
      expect(declaration[`D${dr}`].f).toContain(`XLOOKUP($A${dr},'发票'!$B:$B,'发票'!$D:$D,"")`)
      expect(declaration[`N${dr}`].v).toBe(invoice[`I${invoiceRow}`].v)
    }
    const total = invoiceRows.reduce((sum, [address]) => sum + Number(invoice[`I${address.slice(1)}`].v), 0)
    expect(wb.Sheets['销售合同'].I53).toMatchObject({ f: 'SUM(I16:I52)', v: total })
    expect(wb.Sheets['草稿大单-1'].N52).toMatchObject({ f: 'SUM(N21:N51)', v: total })
    expect(wb.Sheets['销售合同'].I4).toMatchObject({ f: "'发票'!D5", v: 'CURRENT-C' })
    expect(wb.Sheets['销售合同'].I6.v).toBe(46309)
    expect(wb.Sheets['草稿大单-1'].A16).toMatchObject({ f: 'IF(\'司机资料\'!B2="","",\'司机资料\'!B2)', v: 'CURRENT-CONTAINER' })
    expect(wb.Sheets['司机资料'].B2.v).toBe('CURRENT-CONTAINER')
    for (const name of ['销售合同', '装箱单 (2)', '草稿大单-1']) {
      expect(Object.values(wb.Sheets[name]).some((c: any) => /#REF!/.test(c?.f || ''))).toBe(false)
    }
    for (const [name, start] of [['销售合同', 19], ['装箱单 (2)', 13], ['草稿大单-1', 24]] as const) {
      expect(wb.Sheets[name][`A${start}`]?.v || '').toBe('')
      expect(wb.Sheets[name][`B${start}`]?.f).toBeUndefined()
      expect(wb.Sheets[name][`C${start}`]?.v || '').toBe('')
    }
    for (const row of [1, 3, 4, 5, 6, 7, 8]) expect(wb.Sheets['司机资料'][`B${row}`]?.v || '').toBe('')
  })

  it('keeps missing driver references blank after recalculation and never uses the template sheet name as a container', async () => {
    const output = await buildCustomsWorkbook({ templateBuffer: rrmTemplateBuffer, seller,
      items: [{ material_id: 1, qty: 10, kg: 1, price: 2, contract_no: 'C', invoice_no: 'I' }],
      materials: new Map([[1, { id: 1, name_zh: '当前物料', supplier: seller.keyword }]]),
      productHs: new Map(), images: new Map(), form: { customer: 'RRM' },
    })
    const wb = XLSX.read(await output.arrayBuffer(), { type: 'array' })
    for (let row = 1; row <= 8; row++) expect(wb.Sheets['司机资料'][`B${row}`]?.v || '').toBe('')
    const declaration = wb.Sheets['草稿大单-1']
    for (const [address, source] of [['M6', 'B8'], ['A16', 'B2'], ['D17', 'B5']]) {
      // A direct reference to an empty input evaluates to 0 in Excel/Calc.
      // Keep an editable link with an explicit blank guard instead.
      expect(declaration[address]).toMatchObject({ f: `IF('司机资料'!${source}="","",'司机资料'!${source})`, v: '' })
    }
  })

  it('keeps missing specifications blank while retaining numeric and text zero specifications', async () => {
    const template = XLSX.read(rrmTemplateBuffer, { type: 'array', cellFormula: true, cellStyles: true })
    template.Sheets['商品汇总表'] = XLSX.utils.aoa_to_sheet([
      ['HS', '品名', '', '申报要素'], ['100', '空规格', '', ''],
      ['100', '数字零规格', '', 0], ['100', '文本零规格', '', '0'], ['100', '当前规格', '', 'CURRENT-SPEC'],
    ])
    const names = ['空规格', '数字零规格', '文本零规格', '当前规格']
    const output = await buildCustomsWorkbook({ templateBuffer: XLSX.write(template, { type: 'array', bookType: 'xlsx' }), seller,
      items: names.map((_name, index) => ({ material_id: index + 1, qty: 10, kg: 1, price: 2, contract_no: 'C', invoice_no: 'I', customs_company: '深圳市华胜益出口贸易有限公司' })),
      materials: new Map(names.map((name, index) => [index + 1, { id: index + 1, name_zh: name, hs_cn: '100', supplier: seller.keyword }])),
      productHs: new Map(), images: new Map(), form: { customer: 'RRM', containerNo: 'CURRENT' },
    })
    const wb = XLSX.read(await output.arrayBuffer(), { type: 'array' })
    for (const [index, expected] of ['', '0', '0', 'CURRENT-SPEC'].entries()) {
      expect(wb.Sheets['销售合同'][`D${16 + index}`]?.v || '').toBe(expected)
      expect(wb.Sheets['草稿大单-1'][`E${21 + index}`]?.v || '').toBe(expected)
    }
    expect(wb.Sheets['销售合同'].B16.f).toContain(`COUNTBLANK(INDEX('发票'!$E:$E,MATCH($A16,'发票'!$B:$B,0)))`)
    expect(wb.Sheets['草稿大单-1'].E21.f).toContain(`COUNTBLANK(INDEX('发票'!$E:$E,MATCH($A21,'发票'!$B:$B,0)))`)
    expect(wb.Sheets['商品汇总表'].D3).toMatchObject({ t: 'n', v: 0 })
    expect(wb.Sheets['商品汇总表'].D4).toMatchObject({ t: 's', v: '0' })
  })

  it.each([0, 3, 40, 80])('keeps auxiliary totals and cross-sheet references correct with %s details', async count => {
    const ids = Array.from({ length: count }, (_, i) => i + 1)
    const output = await buildCustomsWorkbook({ templateBuffer: rrmTemplateBuffer, seller,
      items: ids.map(id => ({ material_id: id, qty: id, kg: id, price: 1, contract_no: 'C', invoice_no: 'I' })),
      materials: new Map(ids.map(id => [id, { id, name_zh: `M${id}`, supplier: seller.keyword }])),
      productHs: new Map(), images: new Map(), form: { customer: 'RRM', containerNo: 'CURRENT' },
    })
    const wb = XLSX.read(await output.arrayBuffer(), { type: 'array' })
    const salesTotal = Math.max(53, 16 + count), packingTotal = Math.max(47, 10 + count), declarationTotal = Math.max(52, 21 + count)
    expect(wb.Sheets['销售合同'][`I${salesTotal}`].f).toBe(`SUM(I16:I${salesTotal - 1})`)
    expect(wb.Sheets['装箱单 (2)'][`G${packingTotal}`].f).toBe(`SUM(G10:G${packingTotal - 1})`)
    expect(wb.Sheets['草稿大单-1'].I14.f).toBe(`SUM('装箱单 (2)'!G${packingTotal})`)
    expect(wb.Sheets['草稿大单-1'][`N${declarationTotal}`].f).toBe(`SUM(N21:N${declarationTotal - 1})`)
    const signatureRow = 62 + Math.max(0, count - 37)
    const sales = wb.Sheets['销售合同']
    expect(sales[`A${signatureRow}`].v).toBe(sales.B8.v)
    expect(sales[`E${signatureRow}`].v).toBe(String(sales.B4.v).split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1))
    if (count) expect(sales[`E${signatureRow}`].v).toBe(seller.nameEn)
    expect(sales[`A${signatureRow - 1}`].v).toBe('The Buyer')
    expect(sales[`E${signatureRow - 1}`].v).toBe('The Seller')
    expect(Object.values(sales).some((cell: any) => /精駿|ZHONG SHAN JUN TAI/.test(String(cell?.v || '')))).toBe(false)
    if (count) {
      expect(wb.Sheets['销售合同'][`B${15 + count}`].f).toContain(`$A${15 + count}`)
      if (count >= 40) expect(wb.Sheets['销售合同']['!merges']?.map(XLSX.utils.encode_range)).toContain('I55:J55')
      expect(wb.Sheets['草稿大单-1'][`D${20 + count}`].v).toBe(`M${count}`)
    } else {
      expect(wb.Sheets['销售合同'].I53.v).toBe(0)
      expect(wb.Sheets['草稿大单-1'].N52.v).toBe(0)
      expect(wb.Sheets['销售合同'].B16?.f).toBeUndefined()
    }
  })

  it.each(['RRI', 'RRM'])('restores auxiliary template blank cells and layout (%s)', async variant => {
    const buffer = variant === 'RRI' ? rriTemplateBuffer : rrmTemplateBuffer
    const output = await buildCustomsWorkbook({ templateBuffer: buffer, seller,
      items: [{ material_id: 1, qty: 10, kg: 1, price: 2, contract_no: 'CURRENT-C', invoice_no: 'CURRENT-I' }],
      materials: new Map([[1, { id: 1, product_code: 'CURRENT-P', name_zh: '当前物料', supplier: seller.keyword }]]),
      productHs: new Map(), images: new Map(), form: { customer: variant, containerNo: 'CURRENT' },
    })
    const outputZip = await JSZip.loadAsync(await output.arrayBuffer())
    const parser = new DOMParser()
    for (const [name, layoutXml] of Object.entries(auxiliaryDocumentLayout.sheets)) {
      const source = parser.parseFromString(layoutXml, 'application/xml')
      const actual = parser.parseFromString(await worksheetXml(outputZip, name), 'application/xml')
      const elements = (doc: any, tag: string): any[] => Array.from(doc.getElementsByTagNameNS(SPREADSHEET_NS, tag))
      const attrs = (node: any) => Object.fromEntries(Array.from(node.attributes as any).map((a: any) => [a.name, a.value]))
      const styleOffset = Number(elements(actual, 'c').find(c => c.getAttribute('r') === 'A1').getAttribute('s'))
        - Number(elements(source, 'c').find(c => c.getAttribute('r') === 'A1').getAttribute('s'))
      expect(elements(source, 'v')).toHaveLength(0)
      expect(elements(source, 'f')).toHaveLength(0)
      expect(elements(source, 'is')).toHaveLength(0)
      expect(elements(actual, 'col')).toHaveLength(elements(source, 'col').length)
      expect(elements(actual, 'col').map(attrs)).toEqual(elements(source, 'col').map(col => ({ ...attrs(col),
        ...(col.hasAttribute('style') ? { style: String(Number(col.getAttribute('style')) + styleOffset) } : {}),
      })))
      expect(elements(actual, 'mergeCell').map(attrs)).toEqual(elements(source, 'mergeCell').map(attrs))
      for (const address of name === '销售合同' ? ['I16', 'J16', 'G4', 'H4'] : ['A1', 'B8']) {
        expect(borderEdges(await outputZip.file('xl/styles.xml')!.async('string'), await worksheetXml(outputZip, name), address))
          .toEqual(borderEdges(auxiliaryDocumentLayout.styles, layoutXml, address))
      }
      const actualCells = new Map(elements(actual, 'c').map(cell => [cell.getAttribute('r'), cell]))
      for (const cell of elements(source, 'c')) {
        if (elements(cell, 'v').length || elements(cell, 'f').length || elements(cell, 'is').length) continue
        const exported = actualCells.get(cell.getAttribute('r'))
        expect(exported, `${variant} ${name}!${cell.getAttribute('r')}`).toBeDefined()
        expect(exported?.getAttribute('s')).toBe(String(Number(cell.getAttribute('s') || 0) + styleOffset))
      }
      const actualRows = new Map(elements(actual, 'row').map(row => [row.getAttribute('r'), row]))
      for (const row of elements(source, 'row')) {
        const exported = actualRows.get(row.getAttribute('r'))
        for (const attribute of ['ht', 'customHeight', 'hidden', 's', 'customFormat']) {
          const expected = attribute === 's' && row.hasAttribute('s')
            ? String(Number(row.getAttribute('s')) + styleOffset) : row.getAttribute(attribute) || ''
          expect(exported?.getAttribute(attribute) || '').toBe(expected)
        }
      }
    }
    const wb = XLSX.read(await output.arrayBuffer(), { type: 'array' })
    expect(wb.Sheets['销售合同'].A16.v).toBe(1)
    expect(wb.Sheets['销售合同'].B4.v).toContain(seller.nameEn)
  })

  it.each(['legacy', 'RRI'])('keeps original full-column lookup expressions and array metadata (%s)', async variant => {
    const buffer = variant === 'RRI' ? rriTemplateBuffer : templateBuffer
    const template = XLSX.read(buffer, { type: 'array' })
    const originalMain = template.SheetNames[1]
    const blob = await buildCustomsWorkbook({
      templateBuffer: buffer, seller,
      items: [1, 2].map(id => ({ material_id: id, supplier: seller.keyword, kg: id,
        qty: id * 10, price: id, contract_no: 'C-ORIGINAL', invoice_no: 'I-ORIGINAL' })),
      materials: new Map([1, 2].map(id => [id, { id, product_code: `P${id}`,
        name_zh: `物料${id}`, name_en: `Material ${id}`, supplier: seller.keyword }])),
      productHs: new Map(), images: new Map(),
      form: { customer: variant === 'RRI' ? 'RRI' : 'RRM', containerNo: 'CURRENT-CONTAINER' },
    })
    const exported = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
    for (const [sheet, start] of (variant === 'RRI'
      ? [['实业合同', 24], ['实业发票', 28], ['装箱单', 25]]
      : [['全球合同', 24], ['全球发票', 32], ['装箱单', 24]]) as [string, number][]) {
      for (const row of [start, start + 1]) {
        for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
          const address = `${col}${row}`
          const original = template.Sheets[sheet][address]
          if (!original?.f?.startsWith('LOOKUP(')) continue
          const rebound = original.f.replaceAll(`${originalMain}!`, "'CURRENT-CONTAINER'!")
          expect(exported.Sheets[sheet][address].f, `${sheet}!${address}`)
            .toBe(/发票/.test(sheet) && ['D', 'E', 'F', 'G', 'H', 'I'].includes(col)
              ? bindInvoiceLookupSerial(rebound, 'CURRENT-CONTAINER', row) : rebound)
          expect(exported.Sheets[sheet][address].F).toBe(address)
        }
        const serial = exported.Sheets[sheet][`A${row}`].v
        expect(exported.Sheets['CURRENT-CONTAINER'][`A${Number(serial) + 3}`].v).toBe(serial)
      }
    }
  })

  it.each(['legacy', 'RRI', 'RRM'])('keeps repeated invoice material lines bound to their own serial (%s)', async variant => {
    const buffer = variant === 'legacy' ? templateBuffer : variant === 'RRI' ? rriTemplateBuffer : rrmTemplateBuffer
    const items = [
      { material_id: 1, supplier: seller.keyword, kg: 10, qty: 100, price: 1, contract_no: 'C-FIRST', invoice_no: 'I-FIRST' },
      { material_id: 1, supplier: seller.keyword, kg: 30, qty: 300, price: 3, contract_no: 'C-FIRST', invoice_no: 'I-FIRST' },
      { material_id: 1, supplier: seller.keyword, kg: 20, qty: 200, price: 2, contract_no: 'C-SECOND', invoice_no: 'I-SECOND' },
    ]
    const blob = await buildCustomsWorkbook({ templateBuffer: buffer, seller, items,
      materials: new Map([[1, { id: 1, product_code: 'SAME', name_zh: '同名物料', name_en: 'Same material', spec: 'SAME', supplier: seller.keyword }]]),
      productHs: new Map(), images: new Map(), form: { customer: variant === 'RRI' ? 'RRI' : 'RRM', containerNo: 'UNIQUE-LINES' } })
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
    const invoice = wb.Sheets[variant === 'RRI' ? '实业发票' : '全球发票']
    const main = wb.Sheets['UNIQUE-LINES']
    const invoiceRows = Object.entries(invoice).filter(([address, cell]) => /^A\d+$/.test(address)
      && typeof cell.v === 'number' && invoice[`G${address.slice(1)}`]?.f?.startsWith('LOOKUP('))
    expect(invoiceRows).toHaveLength(3)
    for (const [address, cell] of invoiceRows) {
      const row = Number(address.slice(1))
      const serial = Number(cell.v)
      // Each repeated name must still select just its unique main-table serial,
      // keeping the lookup correct even when the main table is reordered.
      for (const column of ['D', 'E', 'F', 'G', 'H', 'I']) {
        expect(invoice[`${column}${row}`].f).toContain(`'UNIQUE-LINES'!A:A=A${row}`)
        expect(invoice[`${column}${row}`].F).toBe(`${column}${row}`)
      }
      expect(invoice[`G${row}`].f).toContain("'UNIQUE-LINES'!K:K")
      expect(invoice[`I${row}`].f).toContain("'UNIQUE-LINES'!Z:Z")
      expect(invoice[`J${row}`].f).toBe(`I${row}*G${row}`)
      expect(main[`A${serial + 3}`].v).toBe(serial)
      expect([10, 20, 30]).toContain(main[`K${serial + 3}`].v)
      // PO prices are per piece; invoice prices are converted to kilograms.
      expect(main[`Z${serial + 3}`].v).toBe(Number(main[`K${serial + 3}`].v))
    }
  })

  it.each([2, 18])('recovers RRM blank detail formulas with %i lines, including the reported F24 price', async count => {
    const items = Array.from({ length: count + 1 }, (_, index) => ({
      material_id: index + 1, supplier: seller.keyword, kg: index + 1, qty: 20,
      price: 0.00529, contract_no: index < count ? 'C-FIRST' : 'C-SECOND',
      invoice_no: index < count ? 'I-FIRST' : 'I-SECOND',
    }))
    const materials = new Map(items.map(item => [item.material_id, {
      id: item.material_id, product_code: '46720J', name_zh: '同名物料', name_en: 'Same material',
      spec: 'same', supplier: seller.keyword,
    }]))
    const blob = await buildCustomsWorkbook({ templateBuffer: rrmTemplateBuffer, seller, items, materials,
      productHs: new Map(), images: new Map(), form: { customer: 'RRM', containerNo: '123' } })
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
    const contract = wb.Sheets['全球合同']
    const invoice = wb.Sheets['全球发票']
    const packing = wb.Sheets['装箱单']
    expect(contract.F24.f).toBe("LOOKUP(1,0/(('123'!V:V=$H$5)*('123'!A:A=A24)),'123'!Z:Z)")
    for (let index = 0; index < count; index++) {
      for (const [sheet, start, column, source] of [
        [contract, 24, 'D', 'K'], [contract, 24, 'F', 'Z'],
        [invoice, 32, 'G', 'K'], [invoice, 32, 'I', 'Z'],
        [packing, 24, 'H', 'P'], [packing, 24, 'I', 'Q'],
      ] as const) {
        const formula = sheet[`${column}${start + index}`].f!
        expect(formula).toMatch(/^LOOKUP\(/)
        expect(formula).toContain(`'123'!${source}:${source}`)
        expect(sheet[`${column}${start + index}`].F).toBe(`${column}${start + index}`)
      }
      expect(contract[`G${24 + index}`].f).toBe(`F${24 + index}*D${24 + index}`)
      expect(invoice[`J${32 + index}`].f).toBe(`I${32 + index}*G${32 + index}`)
    }
    const delta = Math.max(10, count) - 14
    const packingDelta = Math.max(7, count) - 14
    expect(contract[`F${75 + delta}`].f).toContain(`$H$${56 + delta}`)
    expect(contract[`F${75 + delta}`].f).toContain("'123'!Z:Z")
    expect(contract[`F${75 + delta}`].F).toBe(`F${75 + delta}`)
    expect(invoice[`B${83 + delta}`].f).toContain(`$J$${62 + delta}`)
    expect(invoice[`B${83 + delta}`].f).toContain(`$J$${66 + delta}`)
    expect(packing[`H${64 + packingDelta}`].f).toContain(`$D$${49 + packingDelta}`)
    expect(contract[`G${38 + delta}`].f).toBe(`SUM(G24:G${37 + delta})`)
    expect(invoice[`I${46 + delta}`].f).toBe(`SUM(J32:J${45 + delta})`)
  })

  it.each(['RRI', 'RRM'])('uses that template’s expressions after expanding and shrinking groups (%s)', async customer => {
    const isRri = customer === 'RRI'
    const source = XLSX.read(isRri ? rriTemplateBuffer : rrmTemplateBuffer, { type: 'array', cellStyles: true })
    const contractName = isRri ? '实业合同' : '全球合同'
    const invoiceName = isRri ? '实业发票' : '全球发票'
    const invoiceStart = isRri ? 28 : 32
    const packingStart = isRri ? 25 : 24
    const contractTotal = isRri ? 31 : 38
    const invoiceTotal = isRri ? 35 : 46
    const mainName = source.SheetNames[1]
    source.Sheets[contractName].G24 = { t: 'n', v: 999, f: 'ROUND(F24*D24,2)' }
    source.Sheets[contractName][`G${contractTotal}`].f = `ROUND(SUM(G24:G${contractTotal - 1}),2)`
    source.Sheets[invoiceName][`J${invoiceStart}`] = { t: 'n', v: 999, f: `ROUND(I${invoiceStart}*G${invoiceStart},2)` }
    source.Sheets[invoiceName][`I${invoiceTotal}`].f = `ROUND(SUM(J${invoiceStart}:J${invoiceTotal - 1}),2)`
    source.Sheets['装箱单'][`H${packingStart}`] = { t: 'n', v: 999, f: `ROUND('${mainName}'!P4,3)` }
    const modifiedTemplate = XLSX.write(source, { type: 'array', bookType: 'xlsx' })
    const items = Array.from({ length: 19 }, (_, i) => ({
      material_id: i + 1, supplier: seller.keyword, kg: i + 1, qty: i + 2,
      price: 0.00529, contract_no: i < 18 ? 'C-FIRST' : 'C-SECOND',
      invoice_no: i < 18 ? 'I-FIRST' : 'I-SECOND',
    }))
    // Preserve the template's criteria even when its material names repeat.
    const materials = new Map(items.map(item => [item.material_id, {
      id: item.material_id, product_code: 'SAME', name_zh: '同名物料', name_en: 'Same material',
      spec: 'SAME', supplier: seller.keyword, material_code: `M${item.material_id}`,
    }]))
    const blob = await buildCustomsWorkbook({
      templateBuffer: modifiedTemplate, seller, items, materials, productHs: new Map(), images: new Map(),
      form: { customer, containerNo: 'TEMPLATE-CALC' },
    })
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
    const contract = workbook.Sheets[contractName]
    const invoice = workbook.Sheets[invoiceName]
    expect(contract.G24.f).toBe('ROUND(F24*D24,2)')
    expect(contract.G41.f).toBe('ROUND(F41*D41,2)')
    expect(contract.G42.f).toBe('ROUND(SUM(G24:G41),2)')
    expect(invoice[`J${invoiceStart + 17}`].f).toBe(`ROUND(I${invoiceStart + 17}*G${invoiceStart + 17},2)`)
    expect(invoice[`I${invoiceStart + 18}`].f).toBe(`ROUND(SUM(J${invoiceStart}:J${invoiceStart + 17}),2)`)
    expect(workbook.Sheets['装箱单'][`H${packingStart + 17}`].f).toBe("ROUND('TEMPLATE-CALC'!P21,3)")
    if (isRri) {
      expect(invoice[`G${invoiceStart}`].f).toContain("'TEMPLATE-CALC'!K:K")
      expect(invoice[`G${invoiceStart + 17}`].f).toContain("'TEMPLATE-CALC'!K:K")
      // The second contract’s absolute header moves by the first table’s expansion.
      expect(contract.B79.f).toContain('$H$60')
      expect(contract.B79.f).toContain("'TEMPLATE-CALC'!D:D")
    }
    expect(workbook.Sheets['TEMPLATE-CALC'].AO4.v).toBe(0.00529 * 2 / 1)
    expect(workbook.Sheets['TEMPLATE-CALC'].K21.v).toBe(18)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(await zip.file('xl/workbook.xml')!.async('string')).toContain('fullCalcOnLoad="1"')
    for (const name of [contractName, invoiceName, '装箱单']) {
      expect(Object.values(workbook.Sheets[name]).some((cell: any) => cell?.f?.includes(mainName))).toBe(false)
      expect(Object.values(workbook.Sheets[name]).some((cell: any) => cell?.f?.includes('#REF!'))).toBe(false)
    }
  })

  it.each(['RRI', 'RRM'])('keeps column formats consistent across many customs companies (%s)', async customer => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      material_id: i + 1, supplier: seller.keyword, customs_company: `公司${i}`,
      kg: 1, qty: 2, invoice_date: '2026-09-18', contract_date: '2026-09-18', currency: 'US$',
    }))
    const file = await buildCustomsWorkbook({
      templateBuffer: customer === 'RRI' ? rriTemplateBuffer : rrmTemplateBuffer,
      seller, items, materials: new Map(), productHs: new Map(), images: new Map(),
      form: { customer, containerNo: 'STYLE-TEST' },
    })
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const parser = new DOMParser()
    const styles = parser.parseFromString(await zip.file('xl/styles.xml')!.async('string'), 'application/xml')
    const xfs = styles.getElementsByTagName('cellXfs')[0].getElementsByTagName('xf')
    const sheet = parser.parseFromString(await worksheetXml(zip, 'STYLE-TEST'), 'application/xml')
    const cells = new Map(Array.from(sheet.getElementsByTagNameNS(SPREADSHEET_NS, 'c')).map(c => [c.getAttribute('r'), c]))
    const xf = (address: string) => xfs[Number(cells.get(address)?.getAttribute('s') || 0)]
    for (let row = 4; row < 14; row++) {
      for (const column of ['F', 'K', 'W', 'Y', 'AR', 'AS', 'AO', 'AP']) {
        for (const attribute of ['fontId', 'numFmtId']) {
          expect(xf(`${column}${row}`).getAttribute(attribute), `${column}${row} ${attribute}`)
            .toBe(xf(`${column}4`).getAttribute(attribute))
        }
        expect(xf(`${column}${row}`).getElementsByTagName('alignment')[0]?.toString())
          .toBe(xf(`${column}4`).getElementsByTagName('alignment')[0]?.toString())
      }
      expect(xf(`F${row}`).getAttribute('fillId')).not.toBe('0')
      expect(xf(`Y${row}`).getAttribute('numFmtId')).not.toBe('0')
    }
    expect(xf('F4').getAttribute('fillId')).not.toBe(xf('F5').getAttribute('fillId'))
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    for (let row = 4; row < 14; row++) expect(wb.Sheets['STYLE-TEST'][`Y${row}`].v).toBe(46283)
  })
  it('exports with no loading date using an explicit filename placeholder', () => {
    expect(customsFileName({ customer: 'RRM', containerNo: '1523' })).toContain('未填装柜日期')
    expect(customsFileName({ loadDate: 'invalid' })).toContain('未填装柜日期')
  })
  it.each(['RRI', 'RRM'])('exports incomplete and empty shipment drafts (%s)', async customer => {
    for (const items of [[{ material_id: 999, supplier: '未建档供应商', customs_company: '未建档供应商' }], []]) {
      const file = await buildCustomsWorkbook({
        templateBuffer: customer === 'RRI' ? rriTemplateBuffer : rrmTemplateBuffer,
        items, materials: new Map(), supplierProfiles: [], productHs: new Map(), images: new Map(),
        form: { customer, containerNo: 'DRAFT' },
      })
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      expect(wb.Sheets['DRAFT']).toBeDefined()
      if (items.length) {
        expect(sheetHasValue(wb, customer === 'RRI' ? '实业发票' : '全球发票', '未建档供应商')).toBe(true)
      }
    }
  })
  it('uses each declaration unit without changing source quantities, paid amounts or physical net weight', async () => {
    const codes = ['KGM', 'PCS', 'SET', 'MTR', '个']
    const items = codes.map((_, i) => ({
      material_id: i + 1, supplier: seller.keyword, kg: i + 0.25, qty: 100,
      price: i + 2, purchase_charge_ratio: 0.9,
    }))
    const original = structuredClone(items)
    const file = await buildCustomsWorkbook({
      templateBuffer: rrmTemplateBuffer, seller,
      items,
      materials: new Map(codes.map((unit, i) => [i + 1, {
        id: i + 1, name_zh: `测试${i}`, unit_kg: unit, supplier: seller.keyword, net_per_pc: 0.2,
      }])),
      supplierProfiles: [seller], productHs: new Map(), images: new Map(),
      form: { customer: 'RRM', containerNo: 'UNIT-TEST' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    ;['千克', '个', '套', '米', '个'].forEach((unit, i) => {
      expect(wb.Sheets['发票'][`G${i + 9}`].v).toBe(unit)
      expect(wb.Sheets['发票'][`G${i + 9}`].f).toContain(`'UNIT-TEST'!J${i + 4}`)
      const declarationQuantity = i === 0 ? original[i].kg : original[i].qty
      const paidAmount = original[i].qty * original[i].price * original[i].purchase_charge_ratio
      const main = wb.Sheets['UNIT-TEST']
      const invoice = wb.Sheets['发票']
      expect(invoice[`F${i + 9}`]).toMatchObject({ f: `'UNIT-TEST'!K${i + 4}`, v: declarationQuantity })
      expect(main[`J${i + 4}`].v).toBe(codes[i])
      expect(main[`K${i + 4}`].v).toBe(declarationQuantity)
      expect(main[`L${i + 4}`].v).toBe(original[i].qty)
      expect(main[`Q${i + 4}`].v).toBe(20)
      expect(main[`AP${i + 4}`].v).toBeCloseTo(paidAmount, 8)
      expect(invoice[`I${i + 9}`].v).toBeCloseTo(paidAmount, 8)
      expect(invoice[`F${i + 9}`].v * invoice[`H${i + 9}`].v).toBeCloseTo(paidAmount, 8)
    })
    expect(items).toEqual(original)
  })
  it.each(['legacy', 'RRI', 'RRM'])('uses shipping weight and its unit for generic invoice quantity (%s)', async variant => {
    const file = await buildCustomsWorkbook({
      templateBuffer: variant === 'legacy' ? templateBuffer : variant === 'RRI' ? rriTemplateBuffer : rrmTemplateBuffer,
      seller,
      items: [
        { material_id: 1, supplier: seller.keyword, qty: 600, kg: 0.174, purchase_unit: '个' },
        { material_id: 2, supplier: seller.keyword, qty: 33280, kg: 13.312, purchase_unit: '个' },
      ],
      materials: new Map([1, 2].map(id => [id, { id, name_zh: `螺丝${id}`, unit_kg: 'KGM', supplier: seller.keyword }])),
      supplierProfiles: [seller], productHs: new Map(), images: new Map(),
      form: { customer: variant === 'RRI' ? 'RRI' : 'RRM', containerNo: 'WEIGHT-TEST' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const invoice = wb.Sheets['发票']
    expect(invoice.F9).toMatchObject({ f: "'WEIGHT-TEST'!K4", v: 0.174 })
    expect(invoice.F10).toMatchObject({ f: "'WEIGHT-TEST'!K5", v: 13.312 })
    expect(invoice.G9.v).toBe('千克')
    expect(invoice.G9.f).toContain("'WEIGHT-TEST'!J4")
    expect(invoice.G10.v).toBe('千克')
    expect(invoice.G10.f).toContain("'WEIGHT-TEST'!J5")
    expect(invoice.F11.f).toBe('SUM(F9:F10)')
    expect(invoice.F11.v).toBeCloseTo(13.486, 8)
    expect(invoice.I9.f).toBe('F9*H9')
    expect(invoice.I10.f).toBe('F10*H10')
    // 主表送货数量和采购单位保持不变。
    expect(wb.Sheets['WEIGHT-TEST'].L4.v).toBe(600)
    expect(wb.Sheets['WEIGHT-TEST'].M4.v).toBe('个')
  })
  it.each(['RRI', 'RRM'])('uses catalogue declaration content instead of English names (%s)', async customer => {
    const file = await buildCustomsWorkbook({
      seller,
      templateBuffer: customer === 'RRI' ? rriTemplateBuffer : rrmTemplateBuffer,
      items: [1, 2].map(id => ({ material_id: id, qty: 1, supplier: seller.keyword })),
      materials: new Map([
        [1, { id: 1, name_zh: 'PB螺丝', name_en: 'PB screw', hs_cn: '7318159001' }],
        [2, { id: 2, name_zh: '不存在的商品', name_en: 'Must not use English', hs_cn: '7318159090' }],
      ]), supplierProfiles: [seller], productHs: new Map(), images: new Map(),
      form: { customer, containerNo: 'DECLARATION' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const invoice = wb.Sheets['发票']
    expect(wb.Sheets['DECLARATION'].E4.v).toBe('螺丝')
    expect(wb.Sheets['DECLARATION'].F4.v).toBe('PB螺丝')
    expect(wb.Sheets['DECLARATION'].G4.v).toBe('PB screw')
    expect(invoice.D9).toMatchObject({ f: "'DECLARATION'!E4", v: '螺丝' })
    expect(invoice.E9.v).toBe('0|0|铁制|353MPa|无牌|1008|2.0mm-4.0mm')
    expect(invoice.E9.f).toMatch(/^'商品汇总表'!D\d+$/)
    expect(wb.Sheets['商品汇总表'][invoice.E9.f!.split('!')[1]].v).toBe(invoice.E9.v)
    expect(invoice.E10?.v || '').toBe('')
    expect(invoice.E10?.f).toBeUndefined()
  })
  it('groups only the generic invoice by customs company and totals each group', async () => {
    const items = [
      { material_id: 1, qty: 2, kg: 2, price: 5, cartons: 1, customs_company: '甲报关公司', supplier: seller.keyword, formula_name: '螺丝' },
      { material_id: 2, qty: 3, kg: 3, price: 6, cartons: 2, customs_company: '乙报关公司', supplier: seller.keyword, formula_name: '螺母' },
      { material_id: 3, qty: 4, kg: 4, price: 7, cartons: 3, customs_company: '甲报关公司', supplier: seller.keyword, formula_name: '绑片卡' },
    ]
    const materials = new Map(items.map(item => [item.material_id, { id: item.material_id, name_zh: `物料${item.material_id}`, hs_cn: `CN${item.material_id}`, supplier: seller.keyword }]))
    const file = await buildCustomsWorkbook({ templateBuffer: rrmTemplateBuffer, items, materials,
      supplierProfiles: [seller], productHs: new Map(), images: new Map(), form: { customer: 'RRM', containerNo: 'GROUP-TEST' } })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const invoice = wb.Sheets['发票']
    const groupRows = Object.entries(invoice).filter(([address, cell]) => /^D\d+$/.test(address) && /[甲乙]报关公司/.test(String(cell.v)))
    expect(groupRows).toHaveLength(2)
    let previous = 8
    for (const [address, cell] of groupRows) {
      const totalRow = Number(address.slice(1))
      const detailRows = Array.from({ length: totalRow - previous - 1 }, (_, i) => previous + i + 1)
        .filter(row => invoice[`C${row}`]?.f)
      expect(detailRows).toHaveLength(cell.v === '甲报关公司' ? 2 : 1)
      for (const row of detailRows) {
        const mainRow = Number(invoice[`C${row}`].f!.match(/B(\d+)$/)![1])
        expect(invoice[`D${row}`]).toMatchObject({
          f: `'GROUP-TEST'!E${mainRow}`, v: wb.Sheets['GROUP-TEST'][`E${mainRow}`].v,
        })
        expect(invoice[`D${row}`].v).not.toBe(wb.Sheets['GROUP-TEST'][`F${mainRow}`].v)
        expect(wb.Sheets['GROUP-TEST'][`AR${mainRow}`].v).toBe(cell.v)
        expect(invoice[`I${row}`].f).toBe(`F${row}*H${row}`)
        expect(invoice[`I${row}`].v).toBeCloseTo(Number(invoice[`F${row}`].v) * Number(invoice[`H${row}`].v), 8)
      }
      expect(invoice[`F${totalRow}`].f).toBe(`SUM(F${detailRows[0]}:F${detailRows.at(-1)})`)
      previous = totalRow
    }
    expect(Object.values(invoice).filter((cell: any) => cell?.f?.match(/'GROUP-TEST'!B\d+/))).toHaveLength(3)
    const grandTotals = Object.entries(invoice).filter(([, cell]) => cell.v === '总合计')
    expect(grandTotals).toHaveLength(1)
    const grandRow = Number(grandTotals[0][0].slice(1))
    expect(grandRow).toBe(previous + 1)
    expect(grandRow).toBe(14) // 三条明细、两家公司小计、总合计；无间隔空行。
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const styles = await zip.file('xl/styles.xml')!.async('string')
    const xml = await worksheetXml(zip, '发票')
    // 公司小计整行黄色，空白格也填色。
    for (const [address] of groupRows) {
      for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
        expect(fillColor(styles, xml, `${col}${address.slice(1)}`)).toBe(fillColor(styles, xml, `I${previous}`))
      }
    }
    // 单元格必须按列排序，避免 WPS 忽略后补的总合计文字及填色。
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    for (const row of Array.from(document.getElementsByTagName('row'))) {
      const columns = Array.from(row.getElementsByTagName('c')).map(cell => XLSX.utils.decode_cell(cell.getAttribute('r')!).c)
      expect(columns).toEqual([...columns].sort((a, b) => a - b))
    }
    // 明细、公司小计、总合计的所有格子均闭合。
    for (let row = 9; row <= grandRow; row++) {
      for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
        expect(borderEdges(styles, xml, `${col}${row}`)).toEqual(expect.arrayContaining(['top', 'bottom', 'left', 'right']))
      }
    }
    // 合并表头竖线连续，上下两行之间不出现横线。
    for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
      expect(borderEdges(styles, xml, `${col}7`)).toEqual(expect.arrayContaining(['top', 'left', 'right']))
      expect(borderEdges(styles, xml, `${col}8`)).toEqual(expect.arrayContaining(['bottom', 'left', 'right']))
      expect(borderEdges(styles, xml, `${col}7`)).not.toContain('bottom')
      expect(borderEdges(styles, xml, `${col}8`)).not.toContain('top')
    }
    for (const col of ['I', 'J', 'K', 'L']) {
      expect(invoice[`${col}${grandRow}`].f).toBe(`SUM(${groupRows.map(([address]) => `${col}${address.slice(1)}`).join(',')})`)
      expect(invoice[`${col}${grandRow}`].v).toBeCloseTo(groupRows.reduce((sum, [address]) => sum + Number(invoice[`${col}${address.slice(1)}`].v), 0), 8)
    }
    for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']) {
      expect(fillColor(styles, xml, `${col}${grandRow}`)).toBe(fillColor(styles, xml, `I${previous}`))
      expect(borderEdges(styles, xml, `${col}${grandRow}`)).toEqual(expect.arrayContaining(['top', 'bottom', 'left', 'right']))
    }
    expect(invoice[`F${grandRow}`]?.v || '').toBe('')
    expect(invoice[`I${grandRow}`].v).toBe(56)
    expect(invoice[`L${grandRow}`].v).toBe(6)
    expect(invoice['!ref']).toBe(`B1:M${grandRow}`)
  }, 20000)
  it.each(['legacy', 'RRI', 'RRM'])('merges compatible invoice categories without changing main rows or auxiliary totals (%s)', async variant => {
    const specs = [
      { name: 'PB螺丝', kg: 2, price: 5 }, { name: 'PWB螺丝', kg: 3, price: 7 },
      { name: 'M3螺母', kg: 0, price: 9 }, { name: 'M4螺母', kg: 0, price: 10 },
      { name: 'PB螺丝', kg: 4, price: 11, company: '乙报关公司' },
      { name: 'PB螺丝', kg: 1, price: 2, hs: '002' },
      { name: 'PB螺丝', kg: 1, price: 3, unit: 'PCE' },
      { name: '彩盒', kg: 1, price: 4 },
    ]
    const items = specs.map((spec, index) => ({ material_id: index + 1, qty: spec.kg > 0 ? 10 : 0, kg: spec.kg,
      price: spec.price, cartons: 1, customs_company: spec.company || '甲报关公司', supplier: seller.keyword }))
    const file = await buildCustomsWorkbook({
      templateBuffer: variant === 'legacy' ? templateBuffer : variant === 'RRI' ? rriTemplateBuffer : rrmTemplateBuffer,
      items, materials: new Map(specs.map((spec, index) => [index + 1, { id: index + 1, product_code: `P${index + 1}`,
        name_zh: spec.name, hs_cn: spec.hs || '001', unit_kg: spec.unit || 'KGM',
        net_per_pc: 0.1, weight_per_carton: 2, qty_per_carton: 10 }])),
      seller, supplierProfiles: [seller], productHs: new Map(), images: new Map(),
      form: { customer: variant, containerNo: 'MERGE-TEST' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const main = wb.Sheets['MERGE-TEST'], invoice = wb.Sheets['发票']
    expect(Object.keys(main).filter(address => /^D\d+$/.test(address) && /^P\d+$/.test(String(main[address]?.v)))).toHaveLength(8)
    const detailRows = Object.keys(invoice).filter(address => /^B\d+$/.test(address) && typeof invoice[address].v === 'number')
      .map(address => Number(address.slice(1)))
    expect(detailRows).toHaveLength(6)
    expect(detailRows.map(row => invoice[`B${row}`].v).sort()).toEqual([1, 2, 3, 4, 5, 6])
    const merged = detailRows.find(row => invoice[`D${row}`].v === '螺丝' && invoice[`F${row}`].v === 5)!
    expect(merged).toBeDefined()
    expect(invoice[`I${merged}`].v).toBe(120)
    expect(invoice[`H${merged}`]).toMatchObject({ v: 24, f: `IFERROR(I${merged}/F${merged},0)` })
    for (const [column, source] of Object.entries({ F: 'K', I: 'AA', J: 'P', K: 'Q', L: 'AT' })) {
      expect(invoice[`${column}${merged}`].f).toMatch(/^SUM\(/)
      const addresses = [...invoice[`${column}${merged}`].f!.matchAll(/'MERGE-TEST'!([A-Z]+)(\d+)(?::\1(\d+))?/g)]
        .flatMap(match => Array.from({ length: Number(match[3] || match[2]) - Number(match[2]) + 1 },
          (_, offset) => `${match[1]}${Number(match[2]) + offset}`))
      expect(addresses).toHaveLength(2)
      expect(addresses.every(address => address.startsWith(source))).toBe(true)
    }
    expect(invoice[`K${merged}`].v).toBe(2)
    expect(invoice[`L${merged}`].v).toBe(2)
    const nut = detailRows.find(row => invoice[`D${row}`].v === '螺母')!
    expect(invoice[`H${nut}`]).toMatchObject({ v: 0, f: `IFERROR(I${nut}/F${nut},0)` })
    const total = detailRows.reduce((sum, row) => sum + Number(invoice[`I${row}`].v), 0)
    expect(total).toBe(320)
    const grand = Object.keys(invoice).find(address => invoice[address]?.v === '总合计')!.slice(1)
    expect(invoice[`I${grand}`].v).toBe(320)
    for (const row of detailRows) {
      const serial = Number(invoice[`B${row}`].v)
      expect(wb.Sheets['销售合同'][`I${serial + 15}`].v).toBe(invoice[`I${row}`].v)
      expect(wb.Sheets['装箱单 (2)'][`B${serial + 9}`].v).toBe(invoice[`D${row}`].v)
      expect(wb.Sheets['草稿大单-1'][`N${serial + 20}`].v).toBe(invoice[`I${row}`].v)
    }
    expect(wb.Sheets['销售合同'].I53.v).toBe(320)
    expect(wb.Sheets['销售合同'].A22?.v || '').toBe('')
  }, 30000)
  it('exports 256 merged source rows with valid range formulas and linked auxiliary totals', async () => {
    const items = Array.from({ length: 256 }, (_, index) => ({
      material_id: index + 1, qty: 10, kg: 1, price: 2, cartons: 1, qty_per_carton: '10',
      customs_company: '甲报关公司', supplier: seller.keyword, contract_no: 'LARGE-C', invoice_no: 'LARGE-I',
    }))
    const file = await buildCustomsWorkbook({
      templateBuffer: rrmTemplateBuffer, items, seller,
      materials: new Map(items.map(item => [item.material_id, { id: item.material_id,
        product_code: `LARGE-${item.material_id}`, name_zh: `PB螺丝${item.material_id}`,
        hs_cn: '7318159090', unit_kg: 'KGM', net_per_pc: 0.1, weight_per_carton: 1 }])),
      productHs: new Map(), images: new Map(), form: { customer: 'RRM', containerNo: 'LARGE-MERGE' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const main = wb.Sheets['LARGE-MERGE'], invoice = wb.Sheets['发票']
    expect(Object.values(main).filter((cell: any) => /^LARGE-\d+$/.test(String(cell?.v)))).toHaveLength(256)
    for (const [column, source] of Object.entries({ F: 'K', I: 'AA', J: 'P', K: 'Q', L: 'AT' })) {
      expect(invoice[`${column}9`].f).toBe(`SUM('LARGE-MERGE'!${source}4:${source}259)`)
    }
    expect(invoice.F9.v).toBe(256)
    expect(invoice.H9).toMatchObject({ f: 'IFERROR(I9/F9,0)', v: 20 })
    expect(invoice.I9.v).toBe(5120)
    expect(wb.Sheets['销售合同'].I16.v).toBe(5120)
    expect(wb.Sheets['销售合同'].I53.v).toBe(5120)
    expect(wb.Sheets['装箱单 (2)'].B10.v).toBe('螺丝')
    expect(wb.Sheets['草稿大单-1'].N21.v).toBe(5120)
    expect(Object.entries(wb.Sheets['装箱单'])
      .filter(([address, cell]) => /^A\d+$/.test(address) && typeof cell.v === 'number')).toHaveLength(256)
  }, 30000)
  it.each(['legacy', 'RRI', 'RRM'])('links generic invoice commodity numbers to Chinese HS codes (%s)', async variant => {
    const items = [1, 2, 3].map(id => ({ material_id: id, qty: 1, supplier: seller.keyword }))
    const materials = new Map(items.map(item => [item.material_id, {
      id: item.material_id, supplier: seller.keyword, name_zh: '测试物料',
      product_code: `P${item.material_id}`, hs_cn: item.material_id === 1 ? '0123456789' : '', hs_id: '99999999',
    }]))
    const file = await buildCustomsWorkbook({
      templateBuffer: variant === 'legacy' ? templateBuffer : variant === 'RRI' ? rriTemplateBuffer : rrmTemplateBuffer,
      items, materials, seller, supplierProfiles: [seller],
      productHs: new Map([['P2', { hsCN: '4819200000', hsID: '88888888' }]]),
      images: new Map(), form: { customer: variant === 'RRI' ? 'RRI' : 'RRM', containerNo: 'HS-TEST' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    for (let i = 0; i < 3; i++) expect(wb.Sheets['发票'][`C${9 + i}`].f).toBe(`'HS-TEST'!B${4 + i}`)
    expect(wb.Sheets['HS-TEST'].B4.v).toBe('0123456789')
    expect(wb.Sheets['HS-TEST'].B5.v).toBe('4819200000')
    expect(wb.Sheets['HS-TEST'].B6?.v || '').toBe('')
  })
  it.each(['RRI', 'RRM'])('adds Hengxinchang beneficiary details only to its own invoices (%s)', async customer => {
    const hengxinchang = { ...seller, keyword: '恒新昌', full: '东莞市恒新昌彩印有限公司', nameEn: 'Dongguan Hengxinchang Printing Co.,Ltd.' }
    const items = [hengxinchang, hengxinchang, secondSeller].map((profile, index) => ({
      material_id: index + 1, supplier: profile.keyword, customs_company: profile.full,
      qty: 1, contract_no: `C-${index}`, invoice_no: `I-${index}`,
    }))
    const materials = new Map(items.map(item => [item.material_id, { id: item.material_id, supplier: item.supplier, name_zh: '测试物料' }]))
    const file = await buildCustomsWorkbook({
      templateBuffer: customer === 'RRI' ? rriTemplateBuffer : rrmTemplateBuffer,
      items, materials, supplierProfiles: [hengxinchang, secondSeller],
      productHs: new Map(), images: new Map(), form: { customer, containerNo: 'HXC-TEST' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheetName = customer === 'RRI' ? '实业发票' : '全球发票'
    for (const account of ['8110914014201724067(USD)', '8110901012301719910 (RMB)', '8110913013901724078 (HKD)']) {
      expect(countCellsContaining(wb, sheetName, account)).toBe(2)
    }
    expect(countCellsContaining(wb, sheetName, 'Beneficiary: Dongguan shengcheng Import and Export Co., Ltd.')).toBe(2)
    expect(countCellsContaining(wb, sheetName, 'Room 603, No. 39, HongLi Road Dongcheng')).toBe(2)
    expect(countCellsContaining(wb, sheetName, '15668277360001')).toBe(0)
    expect(countCellsContaining(wb, sheetName, 'Add: Room 602')).toBe(0)
    const sheet = wb.Sheets[sheetName]
    // Every invoice after a banking footer must retain all six letterhead lines.
    const titleRows = Object.entries(sheet).filter(([address, cell]) => /^B\d+$/.test(address) && cell.v === 'COMMERCIAL INVOICE').map(([address]) => Number(address.slice(1)))
    expect(titleRows).toHaveLength(3)
    const normalizeHeader = (value: unknown) => String(value || '').replace(/\s+/g, '').toUpperCase()
    for (const titleRow of titleRows) {
      for (let offset = 0; offset < 6; offset++) {
        expect(normalizeHeader(sheet[`B${titleRow - 5 + offset}`]?.v)).toBe(normalizeHeader(sheet[`B${offset + 1}`]?.v))
      }
    }
    const starts = Object.entries(sheet).filter(([address, cell]) => /^B\d+$/.test(address) && String(cell.v).startsWith('Beneficiary name :Dongguan shengcheng')).map(([address]) => Number(address.slice(1)))
    expect(starts).toHaveLength(2)
    const merges = (sheet['!merges'] || []).map(range => XLSX.utils.encode_range(range))
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const xml = await worksheetXml(zip, sheetName)
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const footerStyles = new DOMParser().parseFromString(await zip.file('xl/styles.xml')!.async('string'), 'application/xml')
    const footerXfs = footerStyles.getElementsByTagName('cellXfs')[0].getElementsByTagName('xf')
    const footerFonts = footerStyles.getElementsByTagName('fonts')[0].getElementsByTagName('font')
    for (const start of starts) {
      expect(String(sheet[`B${start}`].v).split('\n').slice(1)).toEqual(['Account number :', '8110914014201724067(USD)', '8110901012301719910 (RMB)', '8110913013901724078 (HKD)'])
      expect(sheet[`G${start}`].v).toContain('Room 603')
      expect(merges).toContain(`G${start}:J${start}`)
      for (const row of [start]) {
        expect(merges).toContain(`B${row}:F${row}`)
        const node = Array.from(doc.getElementsByTagName('row')).find(node => node.getAttribute('r') === String(row))
        expect(Number(node?.getAttribute('ht'))).toBeGreaterThanOrEqual(110)
        for (const col of ['B', 'G']) {
          const cell = Array.from(doc.getElementsByTagName('c')).find(cell => cell.getAttribute('r') === `${col}${row}`)!
          const xf = footerXfs[Number(cell.getAttribute('s'))]
          const font = footerFonts[Number(xf.getAttribute('fontId'))]
          expect(font.getElementsByTagName('sz')[0].getAttribute('val')).toBe('13')
          expect(font.getElementsByTagName('name')[0].getAttribute('val')).toBe('等线')
          expect(font.getElementsByTagName('b')).toHaveLength(1)
        }
      }
    }
  })
  it.each(['RRI', 'RRM'])('preserves complete letterheads across every invoice slot (%s)', async customer => {
    const capacity = customer === 'RRI' ? 14 : 15
    const items = Array.from({ length: capacity }, (_, index) => ({
      material_id: 1, supplier: seller.keyword, customs_company: seller.full,
      qty: 1, contract_no: `ALL-C-${index}`, invoice_no: `ALL-I-${index}`,
    }))
    const file = await buildCustomsWorkbook({
      templateBuffer: customer === 'RRI' ? rriTemplateBuffer : rrmTemplateBuffer,
      items, materials: new Map([[1, { id: 1, supplier: seller.keyword, name_zh: '测试物料' }]]),
      supplierProfiles: [seller], productHs: new Map(), images: new Map(), form: { customer, containerNo: 'ALL-HEADERS' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = wb.Sheets[customer === 'RRI' ? '实业发票' : '全球发票']
    const titles = Object.entries(sheet).filter(([address, cell]) => /^B\d+$/.test(address) && cell.v === 'COMMERCIAL INVOICE').map(([address]) => Number(address.slice(1)))
    expect(titles).toHaveLength(capacity)
    const packing = wb.Sheets['装箱单']
    const grandAddress = Object.keys(packing).find(address => /^C\d+$/.test(address) && packing[address]?.v === '总合计')!
    expect(grandAddress).toBeTruthy()
    const grandRow = Number(grandAddress.slice(1))
    const subtotals = Object.entries(packing).filter(([address, cell]) => /^D\d+$/.test(address) && /^SUM\(/.test(cell.f || '') && Number(address.slice(1)) < grandRow).map(([address]) => Number(address.slice(1))).sort((a, b) => a - b)
    expect(subtotals).toHaveLength(capacity)
    for (const column of ['D', 'H', 'I', 'J', 'K']) {
      expect(packing[`${column}${grandRow}`].f).toBe(`SUM(${subtotals.map(row => `${column}${row}`).join(',')})`)
    }
    expect(grandRow).toBeGreaterThan(subtotals[subtotals.length - 1])
    expect(packing[`C${grandRow + 1}`].v).toBe('主明细合计')
    for (const [column, source] of Object.entries({ D: 'K', H: 'P', I: 'Q', J: 'AT', K: 'S' })) {
      expect(packing[`${column}${grandRow + 1}`].f).toBe(`'ALL-HEADERS'!${source}${capacity + 5}`)
      expect(wb.Sheets['ALL-HEADERS'][`${source}${capacity + 5}`].f).toBe(`SUM(${source}4:${source}${capacity + 3})`)
    }
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const packingXml = await worksheetXml(zip, '装箱单')
    const packingStyles = await zip.file('xl/styles.xml')!.async('string')
    for (const column of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
      expect(borderEdges(packingStyles, packingXml, `${column}${grandRow}`)).toEqual([])
      expect(fillColor(packingStyles, packingXml, `${column}${grandRow}`)).not.toBe('FFCCCCFF')
      expect(borderEdges(packingStyles, packingXml, `${column}${grandRow + 1}`)).toEqual([])
      expect(fillColor(packingStyles, packingXml, `${column}${grandRow + 1}`)).not.toBe('FFCCCCFF')
    }
    expect(fillColor(packingStyles, packingXml, `D${subtotals[0]}`)).toBe('FFCCCCFF')
    const doc = new DOMParser().parseFromString(await worksheetXml(zip, customer === 'RRI' ? '实业发票' : '全球发票'), 'application/xml')
    const rows = new Map(Array.from(doc.getElementsByTagName('row')).map(row => [Number(row.getAttribute('r')), row]))
    const totals = Object.entries(sheet).filter(([address, cell]) => /^B\d+$/.test(address) && /总值大写/.test(String(cell.v))).map(([address]) => Number(address.slice(1)))
    for (let index = 1; index < titles.length; index++) {
      const headerStart = titles[index] - 5
      const previousTotal = Math.max(...totals.filter(row => row < headerStart))
      let visibleHeight = 0
      for (let row = previousTotal + 1; row < headerStart; row++) {
        const node = rows.get(row)
        if (node?.getAttribute('hidden') !== '1') visibleHeight += Number(node?.getAttribute('ht') || 15)
      }
      expect(visibleHeight).toBeLessThanOrEqual(12)
      expect(rows.get(headerStart)?.getAttribute('hidden')).not.toBe('1')
    }
    const normalize = (value: unknown) => String(value || '').replace(/\s+/g, '').toUpperCase()
    for (const title of titles) {
      for (let offset = 0; offset < 6; offset++) {
        expect(normalize(sheet[`B${title - 5 + offset}`]?.v), `header at row ${title - 5 + offset}`).toBe(normalize(sheet[`B${offset + 1}`]?.v))
      }
    }
  }, 60000)
  it('fills the seller positions without retaining sample banking details', async () => {
    const file = await buildCustomsWorkbook({
      templateBuffer, seller,
      items: [{ material_id: 1, supplier: seller.keyword, qty: 1, contract_no: 'C-1', invoice_no: 'I-1' }],
      materials: new Map([[1, { id: 1, supplier: seller.keyword, name_zh: '测试物料' }]]),
      productHs: new Map(), images: new Map(), form: { containerNo: 'TEST-SELLER' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    expect(wb.Sheets['全球合同'].C11.v).toBe(seller.full)
    expect(wb.Sheets['全球合同'].C13.v).toContain(seller.email)
    expect(wb.Sheets['全球发票'].B23.v).toBe(seller.full)
    expect(wb.Sheets['全球发票'].B44?.v).toBe('')
    expect(wb.Sheets['装箱单'].A9.v).toContain(seller.nameEn)
    expect(Object.values(wb.Sheets['装箱单']).some((cell: any) => cell?.v === seller.nameEn)).toBe(true)
    expect(wb.Sheets['销售合同'].B4.v).toContain(seller.nameEn)
    expect(wb.Sheets['发票'].B1.v).toBe('深圳市华胜益出口贸易有限公司')
    const terms = tradeTerms(wb, ['全球合同', '全球发票', '印尼合同', '印尼发票'])
    expect(terms.length).toBe(3)
    expect(new Set(terms)).toEqual(new Set(['CIF IDSRG,Semarang']))
    expect(countCellValue(wb, '全球合同', '购销合同\nPurchase Contract')).toBe(1)
    expect(countCellValue(wb, '全球发票', 'COMMERCIAL INVOICE')).toBe(1)
    expect(countCellValue(wb, '印尼合同', '购销合同\nPurchase Contract')).toBe(0)
    expect(countCellValue(wb, '印尼发票', 'COMMERCIAL INVOICE')).toBe(0)
    // 主明细的报关公司列按设计回退为华胜益（见 deployment.test.ts 的 effectiveCustomsCompany
    // 用例），通用发票也按该报关公司分组，不属于卖方样例残留。
    const remnants = wb.SheetNames.filter(sheet => sheet !== 'TEST-SELLER' && sheet !== '发票').flatMap(sheet => Object.entries(wb.Sheets[sheet])
      .filter(([cell, value]) => !cell.startsWith('!') && typeof value?.v === 'string'
        && /华胜益|HUASHENGYI|雅洛轩|Yaluo Xuan|骏盈|Junying|林丰|Linfeng/i.test(value.v))
      .map(([cell]) => `${sheet}!${cell}`))
    expect(remnants).toEqual([])

    const [templateZip, outputZip] = await Promise.all([
      JSZip.loadAsync(templateBuffer),
      JSZip.loadAsync(await file.arrayBuffer()),
    ])
    const outputStyles = await outputZip.file('xl/styles.xml')!.async('string')
    const contractXml = await outputZip.file('xl/worksheets/sheet3.xml')!.async('string')
    const invoiceXml = await outputZip.file('xl/worksheets/sheet4.xml')!.async('string')
    const packingXml = await outputZip.file('xl/worksheets/sheet7.xml')!.async('string')
    const templateContractXml = await templateZip.file('xl/worksheets/sheet3.xml')!.async('string')
    const styleCount = Number(outputStyles.match(/<(?:x:)?cellXfs\b[^>]*\bcount="(\d+)"/)?.[1] || 0)
    const maxContractStyle = Math.max(...Array.from(contractXml.matchAll(/<(?:x:)?c\b[^>]*\bs="(\d+)"/g), match => Number(match[1])))
    // 所有合同页引用的原模板样式编号必须仍然存在；旧实现重建样式表后会在此失配并显示黑底。
    expect(styleCount).toBeGreaterThan(maxContractStyle)
    expect(contractXml).toContain('<x:cols>')
    expect(contractXml).toMatch(/<x:mergeCells\b/)
    const outputMergeCount = contractXml.match(/<x:mergeCell\b/g)?.length || 0
    const templateMergeCount = templateContractXml.match(/<x:mergeCell\b/g)?.length || 0
    expect(outputMergeCount).toBeGreaterThan(0)
    expect(outputMergeCount).toBeLessThan(templateMergeCount)
    // 装箱单抬头、发货人/收货人及右侧资料栏必须形成完整外框；合并单元格
    // 的右下角也要有实际单元格样式，Excel/WPS 才不会显示缺边。
    expect(borderEdges(outputStyles, packingXml, 'A1')).toEqual(expect.arrayContaining(['top', 'left']))
    expect(borderEdges(outputStyles, packingXml, 'K5')).toContain('right')
    expect(borderEdges(outputStyles, packingXml, 'K5')).not.toContain('bottom')
    expect(borderEdges(outputStyles, packingXml, 'K7')).toContain('right')
    expect(borderEdges(outputStyles, packingXml, 'A8')).toEqual(expect.arrayContaining(['top', 'left']))
    expect(borderEdges(outputStyles, packingXml, 'C14')).toEqual(expect.arrayContaining(['bottom', 'right']))
    expect(borderEdges(outputStyles, packingXml, 'C23')).toEqual(expect.arrayContaining(['bottom', 'right']))
    expect(borderEdges(outputStyles, packingXml, 'D8')).toEqual(expect.arrayContaining(['top', 'left']))
    expect(borderEdges(outputStyles, packingXml, 'G9')).toEqual(expect.arrayContaining(['bottom', 'right']))
    expect(borderEdges(outputStyles, packingXml, 'K23')).toEqual(expect.arrayContaining(['bottom', 'right']))
    for (const address of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'D8', 'H8']) {
      expect(fillColor(outputStyles, packingXml, address)).toBe('FFCCCCFF')
    }
    for (const address of ['A9', 'D9', 'H9', 'A24', 'K30', 'A31', 'A32']) {
      expect(fillColor(outputStyles, packingXml, address)).toBe('FFFFFFFF')
    }
    for (const address of ['D10', 'K10', 'D12', 'K12', 'A15', 'C15', 'D16', 'K16', 'D21', 'K21', 'A23', 'K23', 'D31', 'K31', 'K32']) {
      expect(fillColor(outputStyles, packingXml, address)).toBe('FFCCCCFF')
    }
    expect(borderEdges(outputStyles, packingXml, 'A32')).toEqual(expect.arrayContaining(['bottom', 'left', 'right']))
    expect(borderEdges(outputStyles, packingXml, 'A32')).not.toContain('top')
    expect(borderEdges(outputStyles, packingXml, 'K32')).toEqual(expect.arrayContaining(['bottom', 'left', 'right']))
    expect(borderEdges(outputStyles, packingXml, 'K32')).not.toContain('top')
    expect(borderStyle(outputStyles, packingXml, 'A24', 'bottom')).toBe('thin')
    expect(borderStyle(outputStyles, packingXml, 'K30', 'bottom')).toBe('thin')
    expect(borderStyle(outputStyles, packingXml, 'D31', 'bottom')).toBe(null)
    expect(borderStyle(outputStyles, packingXml, 'K31', 'bottom')).toBe(null)
    expect(borderStyle(outputStyles, packingXml, 'A24', 'bottom', true)).toBe('FFE0E0E0')
    expect(borderStyle(outputStyles, packingXml, 'K30', 'right', true)).toBe('FF000000')
    expect(borderStyle(outputStyles, packingXml, 'K32', 'bottom')).toBe('medium')
    // 发票的装运口岸/目的地分组行以及总值大写行也必须完整闭合。
    expect(borderEdges(outputStyles, invoiceXml, 'B29')).toEqual(expect.arrayContaining(['top', 'left']))
    expect(borderEdges(outputStyles, invoiceXml, 'J29')).toEqual(expect.arrayContaining(['top', 'right']))
    expect(borderEdges(outputStyles, invoiceXml, 'B43')).toEqual(expect.arrayContaining(['bottom', 'left']))
    expect(borderEdges(outputStyles, invoiceXml, 'J43')).toEqual(expect.arrayContaining(['bottom', 'right']))
  })

  it('uses FOB for Huashengyi contracts and their paired invoices', async () => {
    const file = await buildCustomsWorkbook({
      templateBuffer, seller: huashengyiSeller,
      items: [{ material_id: 1, supplier: huashengyiSeller.keyword, qty: 1, contract_no: 'HSY-C-1', invoice_no: 'HSY-I-1' }],
      materials: new Map([[1, { id: 1, supplier: huashengyiSeller.keyword, name_zh: '测试物料' }]]),
      productHs: new Map(), images: new Map(), form: { containerNo: 'HSY-TEST' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const terms = tradeTerms(wb, ['全球合同', '全球发票', '印尼合同', '印尼发票'])
    expect(terms.length).toBe(3)
    expect(new Set(terms)).toEqual(new Set(['FOB IDSRG,Semarang']))
    expect(wb.Sheets['全球合同'].F23.v).toBe('FOB IDSRG,Semarang')
    expect(wb.Sheets['全球发票'].I31.v).toBe('FOB IDSRG,Semarang')
    expect(sheetContainsText(wb, '全球发票', '15668277360001(USD)')).toBe(true)
    expect(sheetContainsText(wb, '全球发票', '15353466270052 (RMB)')).toBe(true)
    expect(sheetContainsText(wb, '全球发票', '15602776290037 (HKD)')).toBe(true)
    expect(sheetContainsText(wb, '全球发票', 'Ping An Bank Co., Ltd')).toBe(true)
    expect(sheetContainsText(wb, '全球发票', 'SZDBCNBSXXX')).toBe(true)
    expect(sheetContainsText(wb, '全球发票', 'SHENZHEN  HUASHENGYI  EXPORT  TRADING  LIMITED')).toBe(true)
    expect(sheetContainsText(wb, '全球发票', 'Room 602, Longsheng Comprehensive Service Building')).toBe(true)
  })

  it('keeps different sellers in one workbook and lays their documents out in order', async () => {
    const firstSeller = { ...huashengyiSeller, id: 101 }
    const items = [
      {
        material_id: 1, supplier: secondSeller.keyword, customs_company: '其他报关公司',
        qty: 1, contract_no: 'C-SECOND', invoice_no: 'I-SECOND',
      },
      {
        material_id: 2, supplier: secondSeller.keyword, customs_company: '深圳市华胜益出口贸易有限公司',
        qty: 1, contract_no: 'C-HSY', invoice_no: 'I-HSY',
      },
    ]
    const materials = new Map(items.map(item => [item.material_id, {
      id: item.material_id, supplier: item.supplier, customs_company: item.customs_company,
      name_zh: `测试物料${item.material_id}`,
    }]))
    const file = await buildCustomsWorkbook({
      templateBuffer: rriTemplateBuffer, items, materials, supplierProfiles: [firstSeller, secondSeller],
      productHs: new Map(), images: new Map(), form: { customer: 'RRI', containerNo: 'ONE-WORKBOOK' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })

    expect(wb.Sheets['实业合同'].H5.v).toBe('C-HSY')
    expect(wb.Sheets['实业合同'].C11.v).toBe(firstSeller.full)
    expect(wb.Sheets['实业合同'].F23.v).toBe('FOB IDSRG,Semarang')
    expect(wb.Sheets['实业发票'].B21.v).toBe(firstSeller.full)
    expect(countCellsContaining(wb, '实业发票', '15668277360001(USD)')).toBe(1)
    expect(countCellsContaining(wb, '实业发票', 'SHENZHEN  HUASHENGYI  EXPORT  TRADING  LIMITED')).toBe(1)
    expect(countCellsContaining(wb, '实业发票', 'Room 602, Longsheng Comprehensive Service Building')).toBe(1)
    expect(wb.Sheets['装箱单'].A9.v).toContain('ROYAL REGENT PRODUCTS INDUSTRIES LIMITED')
    expect(wb.Sheets['装箱单'].A9.v).not.toContain(firstSeller.nameEn)

    expect(sheetHasValue(wb, '实业合同', 'C-SECOND')).toBe(true)
    expect(sheetHasValue(wb, '实业合同', secondSeller.full)).toBe(true)
    expect(Object.values(wb.Sheets['实业合同']).some((cell: any) => cell?.v === 'CIF IDSRG,Semarang')).toBe(true)
    expect(sheetHasValue(wb, '实业发票', secondSeller.full)).toBe(true)
    expect(sheetContainsText(wb, '装箱单', 'ROYAL REGENT PRODUCTS INDUSTRIES LIMITED')).toBe(true)
    expect(sheetContainsText(wb, '装箱单', secondSeller.nameEn)).toBe(false)
    expect(wb.SheetNames).toContain('ONE-WORKBOOK')
    expect(countCellValue(wb, '实业合同', '购销合同\nPurchase Contract')).toBe(2)
    expect(wb.Sheets['实业合同'].G34.f).toBe('SUM(G24:G33)')
    expect(wb.Sheets['实业合同'].G81.f).toBe('SUM(G71:G80)')
    expect(wb.Sheets['实业发票'].B28.f).toBe("LOOKUP(1,0/(('ONE-WORKBOOK'!V:V=$J$13)*('ONE-WORKBOOK'!X:X=$J$9)*('ONE-WORKBOOK'!A:A=A28)),'ONE-WORKBOOK'!D:D)")
    expect(wb.Sheets['实业发票'].A29?.v).toBeUndefined()
    expect(wb.Sheets['实业发票'].I38.f).toBe('SUM(J28:J37)')
    expect(wb.Sheets['装箱单'].D32.f).toBe('SUM(D25:D31)')

    const outputZip = await JSZip.loadAsync(await file.arrayBuffer())
    const outputStyles = await outputZip.file('xl/styles.xml')!.async('string')
    const contractXml = await outputZip.file('xl/worksheets/sheet3.xml')!.async('string')
    const invoiceXml = await outputZip.file('xl/worksheets/sheet4.xml')!.async('string')
    for (const address of ['H5', 'H9', 'H13']) {
      expect(borderEdges(outputStyles, contractXml, address)).toContain('bottom')
    }
    for (const address of ['J9', 'J11', 'J13', 'J16']) {
      expect(borderEdges(outputStyles, invoiceXml, address)).toContain('bottom')
    }
    for (const row of [25, 26, 39]) {
      for (const column of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
        expect(borderEdges(outputStyles, invoiceXml, `${column}${row}`)).toEqual(['top', 'bottom', 'left', 'right'])
      }
    }
    expect(invoiceXml).not.toMatch(/<x:(?:c|f|v)\b/)
  })

  it('keeps Royal Regent World as the shipper on every RRM packing list', async () => {
    const items = [
      { material_id: 1, supplier: seller.keyword, customs_company: '其他报关公司', qty: 1, contract_no: 'RRM-C-1', invoice_no: 'RRM-I-1' },
      { material_id: 2, supplier: secondSeller.keyword, customs_company: '其他报关公司', qty: 1, contract_no: 'RRM-C-2', invoice_no: 'RRM-I-2' },
    ]
    const materials = new Map(items.map(item => [item.material_id, {
      id: item.material_id, supplier: item.supplier, name_zh: `测试物料${item.material_id}`,
    }]))
    const file = await buildCustomsWorkbook({
      templateBuffer: rrmTemplateBuffer, items, materials, supplierProfiles: [seller, secondSeller],
      productHs: new Map(), images: new Map(), form: { customer: 'RRM', containerNo: 'RRM-PACKING', blNo: ' SEAL-RRM-123 ', shipDate: '2026-09-28' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })

    expect(countCellValue(wb, '全球合同', 'BEFORE September.24,2026')).toBe(2)
    expect(countCellValue(wb, '全球合同', 'BEFORE September.17,2026')).toBe(2)
    expect(wb.Sheets['装箱单'].A1.v).toBe('Royal Regent (World) Co. Limited')
    expect(wb.Sheets['装箱单'].A9.v).toContain('Royal Regent (World) Co. Limited')
    expect(wb.Sheets['装箱单'].A9.v).not.toContain(seller.nameEn)
    expect(wb.Sheets['装箱单'].A13.v).toContain('chloe@royalregenthk.com')
    expect(Object.values(wb.Sheets['装箱单']).filter((cell: any) => cell?.v === 'Royal Regent (World) Co. Limited').length).toBeGreaterThanOrEqual(2)
    expect(sheetContainsText(wb, '装箱单', secondSeller.nameEn)).toBe(false)
    expect(Object.values(wb.Sheets['装箱单']).filter((cell: any) => typeof cell?.v === 'string' && cell.v.includes('chloe@royalregenthk.com')).length).toBeGreaterThanOrEqual(2)
    expect(wb.Sheets['全球合同'].G34.f).toBe('SUM(G24:G33)')
    expect(wb.Sheets['全球合同'].G81.f).toBe('SUM(G71:G80)')
    expect(wb.Sheets['全球发票'].I42.f).toBe('SUM(J32:J41)')
    expect(wb.Sheets['装箱单'].D31.f).toBe('SUM(D24:D30)')
    expect(wb.Sheets['装箱单'].D64.f).toBe('SUM(D57:D63)')
    expect(wb.Sheets['装箱单'].H17.v).toBe('SEAL-RRM-123')
    expect(wb.Sheets['装箱单'].H50.v).toBe('SEAL-RRM-123')
    const outputZip = await JSZip.loadAsync(await file.arrayBuffer())
    const styles = await outputZip.file('xl/styles.xml')!.async('string')
    const invoiceXml = await worksheetXml(outputZip, '全球发票')
    // 第二张发票经第一张缩短后，字段在 58/60/62/65 行，而非套用首张偏移。
    for (const address of ['J9', 'J11', 'J13', 'J16', 'J58', 'J60', 'J62', 'J65']) {
      expect(borderStyle(styles, invoiceXml, address, 'bottom')).toBe('thin')
    }
    expect(borderEdges(styles, invoiceXml, 'J56')).not.toContain('bottom')
    const contractXml = await worksheetXml(outputZip, '全球合同')
    for (const address of ['H5', 'H10', 'H14', 'H52', 'H57', 'H61']) {
      expect(borderStyle(styles, contractXml, address, 'bottom')).toBe('thin')
    }
  })

  it('uses Indonesia documents and the actual supplier when the BL header is neither RRI nor RRM', async () => {
    const item = {
      material_id: 2,
      supplier: secondSeller.keyword,
      customs_company: '深圳市华胜益出口贸易有限公司',
      bl_head: '东莞市雅洛轩进出口贸易有限公司',
      qty: 20,
      kg: 12.5,
      cartons: 2,
      contract_no: 'ID-C-1',
      contract_date: '2026-09-20',
      invoice_no: 'ID-I-1',
      invoice_date: '2026-09-21',
    }
    const file = await buildCustomsWorkbook({
      templateBuffer: rrmTemplateBuffer,
      indonesiaTemplateBuffer: templateBuffer,
      items: [item],
      materials: new Map([[2, { id: 2, supplier: secondSeller.keyword, name_zh: '印尼测试物料' }]]),
      supplierProfiles: [huashengyiSeller, secondSeller],
      productHs: new Map(), images: new Map(),
      form: { customer: 'RRM', containerNo: 'INDONESIA-DOCS' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })

    expect(wb.SheetNames).toContain('印尼合同')
    expect(wb.SheetNames).toContain('印尼发票')
    expect(wb.SheetNames).not.toContain('全球合同')
    expect(wb.SheetNames).not.toContain('全球发票')
    expect(wb.Sheets['印尼合同'].H7.v).toBe('ID-C-1')
    expect(XLSX.utils.decode_range(wb.Sheets['印尼合同']['!ref']!).e.r).toBeLessThan(49)
    expect(wb.Sheets['印尼合同'].C13.v).toBe(secondSeller.full)
    expect(wb.Sheets['印尼合同'].F25.v).toBe('CIF IDSRG,Semarang')
    expect(wb.Sheets['印尼合同'].G36.f).toBe('SUM(G26:G35)')
    expect(wb.Sheets['印尼发票'].J10.v).toBe('ID-I-1')
    expect(XLSX.utils.decode_range(wb.Sheets['印尼发票']['!ref']!).e.r).toBeLessThan(44)
    expect(wb.Sheets['印尼发票'].B10.v).toContain(secondSeller.nameEn)
    expect(wb.Sheets['印尼发票'].I23.v).toBe('CIF IDSRG,Semarang')
    expect(wb.Sheets['印尼发票'].I34.f).toBe('SUM(J24:J33)')
    expect(wb.Sheets['装箱单'].A1.v).toBe('PT. ROYAL REGENT INDONESIA')
    expect(wb.Sheets['装箱单'].A9.v).toContain(secondSeller.nameEn)
    expect(wb.Sheets['装箱单'].A12.v).toContain(secondSeller.email)

    const outputZip = await JSZip.loadAsync(await file.arrayBuffer())
    const outputStyles = await outputZip.file('xl/styles.xml')!.async('string')
    const contractXml = await worksheetXml(outputZip, '印尼合同')
    const invoiceXml = await worksheetXml(outputZip, '印尼发票')
    for (const address of ['H7', 'H11', 'H15']) {
      expect(borderEdges(outputStyles, contractXml, address)).toContain('bottom')
    }
    for (const address of ['J10', 'J12', 'J14', 'J16']) {
      expect(borderEdges(outputStyles, invoiceXml, address)).toContain('bottom')
    }
  })

  it('uses the Indonesia packing-list header with the actual supplier as shipper inside an RRI workbook', async () => {
    const firstSeller = { ...huashengyiSeller, id: 101 }
    const items = [
      {
        material_id: 1, supplier: firstSeller.keyword, customs_company: '深圳市华胜益出口贸易有限公司',
        bl_head: 'RRI', qty: 1, contract_no: 'RRI-C-1', invoice_no: 'RRI-I-1',
      },
      {
        material_id: 2, supplier: secondSeller.keyword, customs_company: '其他报关公司',
        bl_head: '东莞市雅洛轩进出口贸易有限公司', qty: 1,
        contract_no: 'ID-C-1', invoice_no: 'ID-I-1',
      },
    ]
    const file = await buildCustomsWorkbook({
      templateBuffer: rriTemplateBuffer, indonesiaTemplateBuffer: templateBuffer,
      items,
      materials: new Map(items.map(item => [item.material_id, {
        id: item.material_id, supplier: item.supplier, customs_company: item.customs_company,
        name_zh: `测试物料${item.material_id}`,
      }])),
      supplierProfiles: [firstSeller, secondSeller],
      productHs: new Map(), images: new Map(),
      form: { customer: 'RRI', containerNo: 'RRI-INDO-PACKING', blNo: 'SEAL-RRI-456' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })

    expect(wb.SheetNames).toContain('印尼合同')
    expect(wb.SheetNames).toContain('印尼发票')
    expect(wb.SheetNames).not.toContain('出货地址')
    expect(wb.Sheets['印尼合同'].H6.v).toBe('ID-C-1')
    expect(wb.Sheets['印尼发票'].J10.v).toBe('ID-I-1')
    expect(wb.Sheets['印尼发票'].C35).toMatchObject({ f: 'I34', v: 0 })
    expect(Object.values(wb.Sheets['印尼发票']).some((cell: any) => cell?.v === 4558.43)).toBe(false)
    expect(countCellValue(wb, '装箱单', 'PT. ROYAL REGENT INDONESIA')).toBeGreaterThanOrEqual(2)
    expect(sheetContainsText(wb, '装箱单', secondSeller.nameEn)).toBe(true)
    expect(wb.Sheets['装箱单'].H17.v).toBe('SEAL-RRI-456')
    expect(wb.Sheets['装箱单'].H51.v).toBe('SEAL-RRI-456')
    expect(sheetContainsText(wb, '装箱单', secondSeller.email)).toBe(true)
    expect(wb.Sheets['装箱单'].A1.v).toBe('ROYAL REGENT PRODUCTS INDUSTRIES LIMITED')

    const outputZip = await JSZip.loadAsync(await file.arrayBuffer())
    const outputStyles = await outputZip.file('xl/styles.xml')!.async('string')
    const packingXml = await worksheetXml(outputZip, '装箱单')
    // RRI 装箱单严格遵循确认稿：顶部与标签条浅紫，资料/明细白底，
    // 合计仅 D:K 浅紫，合计后的空白行仍保留完整表格线。
    for (const address of ['A1', 'K7', 'A8', 'K8', 'D10', 'K10', 'D12', 'K12', 'A15', 'C15', 'D16', 'K16', 'D22', 'K22', 'A24', 'K24', 'D32', 'K32']) {
      expect(fillColor(outputStyles, packingXml, address)).toBe('FFCCCCFF')
    }
    for (const address of ['A9', 'K9', 'A25', 'K31', 'A32', 'C32', 'A33']) {
      expect(fillColor(outputStyles, packingXml, address)).toBe('FFFFFFFF')
    }
    expect(fillColor(outputStyles, packingXml, 'K33')).toBe('FFCCCCFF')
    expect(borderEdges(outputStyles, packingXml, 'A33')).toEqual(expect.arrayContaining(['bottom', 'left', 'right']))
    expect(borderEdges(outputStyles, packingXml, 'A33')).not.toContain('top')
    expect(borderEdges(outputStyles, packingXml, 'K33')).toEqual(expect.arrayContaining(['bottom', 'left', 'right']))
    expect(borderEdges(outputStyles, packingXml, 'K33')).not.toContain('top')
    expect(borderStyle(outputStyles, packingXml, 'A25', 'bottom')).toBe('thin')
    expect(borderStyle(outputStyles, packingXml, 'K31', 'bottom')).toBe('thin')
    expect(borderStyle(outputStyles, packingXml, 'D32', 'bottom')).toBe(null)
    expect(borderStyle(outputStyles, packingXml, 'K32', 'bottom')).toBe(null)
    expect(borderStyle(outputStyles, packingXml, 'A25', 'bottom', true)).toBe('FFE0E0E0')
    expect(borderStyle(outputStyles, packingXml, 'K31', 'bottom', true)).toBe('FFE0E0E0')
    expect(borderStyle(outputStyles, packingXml, 'A25', 'right', true)).toBe('FF000000')
    expect(borderStyle(outputStyles, packingXml, 'K33', 'bottom')).toBe('medium')
  })

  it('exports a main-only combined summary without seller templates', async () => {
    const file = await buildCustomsWorkbook({
      templateBuffer, mainOnly: true, items: [{ material_id: 1, supplier: 'A', qty: 1 }],
      materials: new Map([[1, { id: 1, name_zh: '测试物料' }]]),
      productHs: new Map(), images: new Map(), form: { containerNo: 'TEST-SUMMARY' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    expect(wb.SheetNames).toEqual(['TEST-SUMMARY'])
    expect(wb.Sheets['TEST-SUMMARY'].AL4.v).toBe('A')
  })

  it('uses the industrial buyer version for RRI shipments', async () => {
    const file = await buildCustomsWorkbook({
      templateBuffer, seller,
      items: [{ material_id: 1, supplier: seller.keyword, qty: 1, contract_no: 'RRI-C-1', invoice_no: 'RRI-I-1' }],
      materials: new Map([[1, { id: 1, supplier: seller.keyword, name_zh: '测试物料' }]]),
      productHs: new Map(), images: new Map(), form: { customer: 'RRI', containerNo: 'RRI-TEST' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    expect(wb.SheetNames).toContain('实业合同')
    expect(wb.SheetNames).toContain('实业发票')
    expect(wb.SheetNames).not.toContain('全球合同')
    expect(wb.Sheets['实业合同'].B1.v).toBe('華登製品實業有限公司')
    expect(wb.Sheets['实业合同'].B2.v.trim()).toBe('Royal Regent Products Industries Limited')
    expect(wb.Sheets['实业发票'].B1.v).toBe('華登製品實業有限公司')
    expect(wb.Sheets['实业合同'].H5.v).toBe('RRI-C-1')
    expect(wb.Sheets['装箱单'].A1.v).toBe(seller.nameEn)
    const packingBuyerTitles = Object.values(wb.Sheets['装箱单'])
      .filter((cell: any) => cell?.v === 'Royal Regent Products Industries Limited')
    expect(packingBuyerTitles.length).toBeGreaterThanOrEqual(2)
    expect(wb.Sheets['实业合同'].B24.f).toBe("LOOKUP(1,0/(('RRI-TEST'!V:V=$H$5)*('RRI-TEST'!A:A=A24)),'RRI-TEST'!D:D)")
    expect(wb.Sheets['实业合同'].B25?.v).toBeUndefined()
    expect(wb.Sheets['实业合同'].B33?.v).toBeUndefined()
    expect(wb.Sheets['实业合同'].G34.f).toBe('SUM(G24:G33)')
    expect(wb.Sheets['实业发票'].I42.f).toBe('SUM(J32:J41)')
    expect(wb.Sheets['装箱单'].D31.f).toBe('SUM(D24:D30)')
  })

  it('expands linked document tables beyond ten rows', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      material_id: index + 1,
      supplier: seller.keyword,
      qty: index + 1,
      contract_no: 'LONG-C-1',
      invoice_no: 'LONG-I-1',
    }))
    const materials = new Map(items.map(item => [item.material_id, {
      id: item.material_id,
      supplier: seller.keyword,
      name_zh: `测试物料${item.material_id}`,
      material_code: `M-${item.material_id}`,
    }]))
    const file = await buildCustomsWorkbook({
      templateBuffer, seller, items, materials,
      productHs: new Map(), images: new Map(), form: { containerNo: 'LONG-TEST' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    expect(wb.Sheets['全球合同'].B35.f).toBe("LOOKUP(1,0/(('LONG-TEST'!V:V=$H$5)*('LONG-TEST'!A:A=A35)),'LONG-TEST'!D:D)")
    expect(wb.Sheets['全球合同'].G36.f).toBe('SUM(G24:G35)')
    expect(wb.Sheets['全球发票'].I44.f).toBe('SUM(J32:J43)')
    expect(wb.Sheets['装箱单'].D36.f).toBe('SUM(D24:D35)')
  })

  it('expands modern RRI contract, invoice and packing tables beyond ten rows', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      material_id: index + 1,
      supplier: seller.keyword,
      qty: index + 1,
      contract_no: 'RRI-LONG-C-1',
      invoice_no: 'RRI-LONG-I-1',
    }))
    const materials = new Map(items.map(item => [item.material_id, {
      id: item.material_id,
      supplier: seller.keyword,
      name_zh: `测试物料${item.material_id}`,
      material_code: `RRI-M-${item.material_id}`,
    }]))
    const file = await buildCustomsWorkbook({
      templateBuffer: rriTemplateBuffer, seller, items, materials,
      productHs: new Map(), images: new Map(), form: { customer: 'RRI', containerNo: 'RRI-LONG-TEST' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    expect(wb.Sheets['实业合同'].B35.f).toBe("LOOKUP(1,0/(('RRI-LONG-TEST'!V:V=$H$5)*('RRI-LONG-TEST'!A:A=A35)),'RRI-LONG-TEST'!D:D)")
    expect(wb.Sheets['实业合同'].G36.f).toBe('SUM(G24:G35)')
    expect(wb.Sheets['实业发票'].I40.f).toBe('SUM(J28:J39)')
    expect(wb.Sheets['装箱单'].D37.f).toBe('SUM(D25:D36)')
  })

  it('shows exactly the distinct contracts and their actual invoices', async () => {
    const items = [
      { material_id: 1, supplier: seller.keyword, qty: 1, contract_no: 'C-ONE', invoice_no: 'I-ONE' },
      { material_id: 2, supplier: seller.keyword, qty: 1, contract_no: 'C-ONE', invoice_no: 'I-TWO' },
      { material_id: 3, supplier: seller.keyword, qty: 1, contract_no: 'C-TWO', invoice_no: 'I-THREE' },
    ]
    const materials = new Map(items.map(item => [item.material_id, {
      id: item.material_id, supplier: seller.keyword, name_zh: `测试物料${item.material_id}`,
    }]))
    const file = await buildCustomsWorkbook({
      templateBuffer, seller, items, materials,
      productHs: new Map(), images: new Map(), form: { customer: 'RRI', containerNo: 'COUNT-TEST' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    expect(countCellValue(wb, '实业合同', '购销合同\nPurchase Contract')).toBe(2)
    expect(countCellValue(wb, '实业发票', 'COMMERCIAL INVOICE')).toBe(3)
    expect(Object.values(wb.Sheets['实业合同']).filter((cell: any) => cell?.v === 'C-ONE').length).toBe(1)
    expect(Object.values(wb.Sheets['实业合同']).filter((cell: any) => cell?.v === 'C-TWO').length).toBe(1)
  })
})
