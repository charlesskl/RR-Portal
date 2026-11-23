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
    hs_cn: name.includes('螺丝') ? '7318159090' : '9999999999', unit_kg: i === 1 ? 'GRM' : i === 3 ? 'ROLL' : 'KGM', net_per_pc: 1 }]))
  const items = names.map((_, i) => ({ material_id: i + 1, outbound_id: i + 1, qty: i + 1, kg: i + 1,
    price: 2, currency: 'US$', cartons: 1, customs_company: i % 2 ? '华康塑胶制品(东源)有限公司' : '东莞华登塑胶制品有限公司', supplier: 'Synthetic supplier' }))
  const before = structuredClone(items)
  const blob = await buildCustomsWorkbook({ templateBuffer: await inputZip.generateAsync({ type: 'arraybuffer' }),
    items, materials, productHs: new Map(), images: new Map(),
    form: { customer: variant === 'rri' ? 'RRI' : 'RRM', containerNo: "O'Brien" } })
  const bytes = await blob.arrayBuffer(), zip = await JSZip.loadAsync(bytes)
  const book = XLSX.read(bytes, { type: 'array', cellStyles: true }), invoice = book.Sheets['发票']
  expect([9, 10, 11, 13, 14, 15].map(r => invoice[`B${r}`].v)).toEqual([1, 3, 7, 2, 4, 6])
  expect(invoice.C9.v).toBe('0012345678')
  expect(invoice.C10.v).toBe(7318159090)
  expect(invoice.E10.f).toContain("XLOOKUP(D10,'商品汇总表'!$B:$B,'商品汇总表'!$D:$D,\"\")")
  expect(invoice.E10.v).toBe('0|0|铁制|353MPa|无牌|1008|2.0mm-4.0mm')
  expect(invoice.E13.v || '').toBe('')
  expect(invoice.C13.v || '').toBe('') // no catalogue match, no main-table HS fallback
  expect(invoice.C9.f).toBe('XLOOKUP(D9,\'商品汇总表\'!$B:$B,\'商品汇总表\'!$A:$A,"")')
  expect(invoice.D9.f).toContain("UNIQUE(_xlws.FILTER('O''Brien'!E:E,'O''Brien'!AR:AR=$D$12")
  expect(invoice.D9.F).toBe('D9:D11')
  expect([9, 10, 11].map(r => invoice[`D${r}`].v)).toEqual(['PE胶袋', '螺丝', '彩盒'])
  expect(invoice.D10.f).toBeUndefined(); expect(invoice.D11.f).toBeUndefined()
  expect(invoice.D13.f).toContain('INDEX(UNIQUE(HSTACK(')
  expect(invoice.D13.F).toBe('D13:D15')
  expect(invoice.D14.f).toBeUndefined(); expect(invoice.D15.f).toBeUndefined()
  expect([invoice.D14.v, invoice.D15.v]).toEqual(['说明书-FSC', '说明书-FSC'])
  for (const [column, source] of Object.entries({ F: 'K', I: 'AA', J: 'P', K: 'Q', L: 'AT' })) {
    expect(invoice[`${column}10`].f).toBe(`SUMIFS('O''Brien'!$${source}:$${source},'O''Brien'!$E:$E,$D10,'O''Brien'!$AR:$AR,$D$12)`)
  }
  expect(invoice.H10.f).toBe('IFERROR(I10/F10,0)')
  expect(invoice.G9.f).toContain("'O''Brien'!$E:$E=$D9")
  expect(invoice.G9.f).toContain("'O''Brien'!$AR:$AR=$D$12")
  expect(invoice.G9.f).toContain("'单位对照'!$A:$A,'单位对照'!$B:$B")
  expect(invoice.F13.f).toBe(`SUMIFS('O''Brien'!$K:$K,'O''Brien'!$E:$E,$D13,'O''Brien'!$AR:$AR,$D$16)`)
  expect(invoice.G13.v).toBe('克')
  expect(invoice.G14.v).toBe('卷')
  expect(invoice.G15.v).toBe('千克')
  for (const row of [13, 14, 15]) for (const col of ['F', 'I', 'J', 'K', 'L']) expect(invoice[`${col}${row}`].f).toMatch(/^SUMIFS\(/)
  const units = book.Sheets['单位对照']
  const roll = Object.keys(units).find(address => /^A\d+$/.test(address) && units[address].v === 'ROLL')!
  expect(units['B' + roll.slice(1)]).toMatchObject({ v: '卷', f: 'IF($B$13="","",$B$13)' })
  expect(invoice.G14.f).not.toContain('IF(OR(')
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

it('整家公司同名同单位全部合并、不同单位分开，单位公式使用可编辑对照表', async () => {
  const input = await JSZip.loadAsync(readFileSync(new URL('../../public/template-customs-rrm.xlsx', import.meta.url)))
  const path = await sheetPath(input, '单位对照'), doc = parse(await input.file(path)!.async('string'))
  const cell = Array.from(doc.getElementsByTagNameNS(ns, 'c')).find(cell => cell.getAttribute('r') === 'B13')!
  while (cell.firstChild) cell.removeChild(cell.firstChild)
  cell.setAttribute('t', 'inlineStr')
  const inline = doc.createElementNS(ns, 'is'), value = doc.createElementNS(ns, 't')
  value.textContent = '测试卷单位'; inline.appendChild(value); cell.appendChild(inline)
  input.file(path, new XMLSerializer().serializeToString(doc))
  const specs = [
    ['搪胶件-A', 'KGM', 2, 1, '001', '东莞华登塑胶制品有限公司'], ['搪胶件-B', 'KGM', 3, 2, '002', '东莞华登塑胶制品有限公司'],
    ['成份商标', 'KGM', 4, 3, '003', '东莞华登塑胶制品有限公司'], ['成份商标', 'KGM', 5, 4, '004', '东莞华登塑胶制品有限公司'],
    ['白色弹力棉带', 'ROLL', 6, 5, '005', '东莞华登塑胶制品有限公司'], ['白色弹力棉带', 'ROLL', 7, 6, '006', '东莞华登塑胶制品有限公司'],
    ['独立商品', 'KGM', 8, 7, '007', '东莞华登塑胶制品有限公司'], ['成份商标', 'KGM', 9, 8, '008', '华康塑胶制品(东源)有限公司'],
    ['成份商标', 'PCE', 10, 9, '009', '东莞华登塑胶制品有限公司'],
  ] as const
  const items = specs.map(([, , qty, price, , company], i) => ({ material_id: i + 1, outbound_id: i + 1,
    qty, kg: qty, price, currency: 'US$', cartons: 1, customs_company: company }))
  const output = await buildCustomsWorkbook({ templateBuffer: await input.generateAsync({ type: 'arraybuffer' }), items,
    materials: new Map(specs.map(([name, unit, , , hs], i) => [i + 1, { id: i + 1, name_zh: name, unit_kg: unit, hs_cn: hs, net_per_pc: 1 }])),
    images: new Map(), productHs: new Map(), form: { customer: 'RRM', containerNo: 'COMPANY-GROUPS' } })
  const book = XLSX.read(await output.arrayBuffer(), { type: 'array' }), invoice = book.Sheets['发票']
  expect([9, 10, 11, 12, 13].map(r => invoice[`D${r}`].v)).toEqual(['搪胶件', '成份商标', '白色弹力棉带', '独立商品', '成份商标'])
  expect([9, 10, 11, 12, 13].map(r => invoice[`F${r}`].v)).toEqual([5, 9, 13, 8, 10])
  expect([9, 10, 11, 12, 13].map(r => invoice[`I${r}`].v)).toEqual([8, 32, 72, 56, 90])
  expect(invoice.D9.F).toBe('D9:D13')
  for (const r of [9, 10, 11, 12, 13]) {
    for (const c of ['F', 'I', 'J', 'K', 'L']) expect(invoice[`${c}${r}`].f).toMatch(/^SUMIFS\(/)
    expect(invoice[`H${r}`].f).toBe(`IFERROR(I${r}/F${r},0)`)
    expect(invoice[`G${r}`].f).toContain("'单位对照'!$A:$A,'单位对照'!$B:$B")
    expect(invoice[`G${r}`].f).not.toContain('IF(OR(')
  }
  expect(invoice.I14.v).toBe(258); expect(invoice.I15.v).toBe(72); expect(invoice.I17.v).toBe(330)
  expect(invoice.G11.v).toBe('测试卷单位')
  const units = book.Sheets['单位对照']
  const alias = Object.keys(units).find(address => /^A\d+$/.test(address) && units[address].v === 'ROLL')!
  expect(units['B' + alias.slice(1)].f).toBe('IF($B$13="","",$B$13)')
  expect(book.Sheets['COMPANY-GROUPS'].B4.v).toBe('001'); expect(book.Sheets['COMPANY-GROUPS'].B5.v).toBe('002')
}, 60000)


it('同名不同单位汇总对单位空格规范化，重算不遗漏金额和数量', async () => {
  const units = ['KGM', ' KGM ', 'PCE']
  const output = await buildCustomsWorkbook({
    templateBuffer: new Uint8Array(readFileSync(new URL('../../public/template-customs-rrm.xlsx', import.meta.url))).buffer,
    items: units.map((_, i) => ({ material_id: i + 1, outbound_id: i + 1, qty: i + 2, kg: i + 2,
      price: 10, currency: 'US$', cartons: 1, customs_company: '东莞华登塑胶制品有限公司' })),
    materials: new Map(units.map((unit, i) => [i + 1, { id: i + 1, name_zh: '合成同名商品', unit_kg: unit, net_per_pc: 1 }])),
    images: new Map(), productHs: new Map(), form: { customer: 'RRM', containerNo: 'UNIT-SPACE' },
  })
  const book = XLSX.read(await output.arrayBuffer(), { type: 'array' }), invoice = book.Sheets['发票']
  expect([invoice.F9.v, invoice.F10.v, invoice.I9.v, invoice.I10.v]).toEqual([5, 4, 50, 40])
  expect(book.Sheets['UNIT-SPACE'].J5.v).toBe(' KGM ')
  for (const row of [9, 10]) for (const [column, source] of Object.entries({ F: 'K', I: 'AA', J: 'P', K: 'Q', L: 'AT' })) {
    expect(invoice[`${column}${row}`].f).toBe(`SUMPRODUCT(--('UNIT-SPACE'!$E$4:$E$6=$D${row}),--('UNIT-SPACE'!$AR$4:$AR$6=$D$11),--(UPPER(TRIM('UNIT-SPACE'!$J$4:$J$6))=UPPER(TRIM('UNIT-SPACE'!$J$${row === 9 ? 4 : 6}))),'UNIT-SPACE'!$${source}$4:$${source}$6)`)
  }
}, 60000)

it.each(['rri', 'rrm', 'legacy'])('仅六家公司合并，科驰立及其他公司逐条保留金额和单位（%s）', async variant => {
  const allowed = ['东莞华登塑胶制品有限公司', '华康塑胶制品(东源)有限公司', '东莞兴信塑胶制品有限公司',
    '河源市港正五金制造有限公司', '华兴玩具制品（河源）有限公司', '华登（河源）玩具制品有限公司']
  const companies = [...allowed, '东莞市科驰立实业有限公司', '其他公司', '东莞华登塑胶制品有限公司（分公司）']
  const items = companies.flatMap((company, i) => [1, 2].map((qty, j) => ({ material_id: i * 2 + j + 1,
    outbound_id: i * 2 + j + 1, qty, kg: qty, price: qty * 10, currency: 'US$', cartons: 1,
    customs_company: company, supplier: 'SYNTHETIC', contract_no: 'ALLOWLIST-C', invoice_no: 'ALLOWLIST-I' })))
  const original = structuredClone(items)
  const file = await buildCustomsWorkbook({
    templateBuffer: Uint8Array.from(readFileSync(new URL('../../public/' + (variant === 'legacy' ? 'template-customs.xlsx' : `template-customs-${variant}.xlsx`), import.meta.url))).buffer,
    items, materials: new Map(items.map(item => [item.material_id, { id: item.material_id, name_zh: '成份商标', unit_kg: 'KGM', net_per_pc: 1 }])),
    images: new Map(), productHs: new Map(), form: { customer: variant === 'rrm' ? 'RRM' : 'RRI', containerNo: 'MERGE-ALLOWLIST' },
  })
  const bytes = await file.arrayBuffer(), book = XLSX.read(bytes, { type: 'array' }), invoice = book.Sheets['发票']
  const zip = await JSZip.loadAsync(bytes), sheet = parse(await zip.file(await sheetPath(zip, '发票'))!.async('string'))
  const styles = parse(await zip.file('xl/styles.xml')!.async('string'))
  const cells = new Map(Array.from(sheet.getElementsByTagNameNS(ns, 'c')).map(cell => [cell.getAttribute('r'), cell]))
  const xfs = Array.from(styles.getElementsByTagNameNS(ns, 'cellXfs')[0].getElementsByTagNameNS(ns, 'xf'))
  const fills = Array.from(styles.getElementsByTagNameNS(ns, 'fills')[0].getElementsByTagNameNS(ns, 'fill'))
  const color = (address: string) => {
    const xf = xfs[Number(cells.get(address)!.getAttribute('s'))]
    return fills[Number(xf.getAttribute('fillId'))].getElementsByTagNameNS(ns, 'fgColor')[0]?.getAttribute('rgb') || ''
  }
  let first = 9
  for (const company of companies) {
    const footer = Number(Object.keys(invoice).find(address => /^D\d+$/.test(address) && invoice[address].v === company)!.slice(1))
    const merge = allowed.includes(company), rows = Array.from({ length: footer - first }, (_, i) => first + i)
    expect(rows).toHaveLength(merge ? 1 : 2)
    expect(rows.map(r => invoice[`F${r}`].v)).toEqual(merge ? [3] : [1, 2])
    expect(rows.map(r => invoice[`I${r}`].v)).toEqual(merge ? [50] : [10, 40])
    expect(invoice[`I${footer}`].v).toBe(50)
    for (const r of rows) {
      expect(invoice[`G${r}`].v).toBe('千克')
      if (merge) {
        expect(invoice[`D${r}`].f).toContain('UNIQUE(')
        for (const c of ['F', 'I', 'J', 'K', 'L']) expect(invoice[`${c}${r}`].f).toMatch(/^SUMIFS\(/)
      } else {
        expect(invoice[`D${r}`].f).toContain('LOOKUP(')
        expect(invoice[`D${r}`].f).toContain(`A:A=B${r}`)
        expect(invoice[`F${r}`].F).toBe(`F${r}:L${r}`)
        expect(invoice[`F${r}`].f).toContain(`$A:$A=$B${r}`)
        expect(invoice[`I${r}`].f).toBeUndefined()
      }
      for (const c of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
        if (merge) expect(color(c + r)).toBe('FFC6E0B4')
        else expect(color(c + r)).not.toBe('FFC6E0B4')
      }
    }
    first = footer + 1
  }
  expect(invoice[`I${first}`].v).toBe(450)
  expect(book.Sheets['销售合同'].I53.v).toBe(450)
  expect(Object.entries(book.Sheets['MERGE-ALLOWLIST']).filter(([a, c]) => /^A\d+$/.test(a) && typeof c.v === 'number')).toHaveLength(18)
  expect(items).toEqual(original)
}, 60000)
