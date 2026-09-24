import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx-js-style'
import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { apiBase, publicAsset, publicBase } from './deployment'
import { buildCustomsWorkbook, customsFormulaName, customsInvoicePrice, effectiveCustomsCompany } from './utils/customsExport'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const excelSerial = (date: string) => Math.floor((new Date(date).getTime() - Date.UTC(1899, 11, 30)) / 86400000)

async function cellBorderSides(bytes: ArrayBuffer, address: string, sheetPath = 'xl/worksheets/sheet2.xml') {
  const zip = await JSZip.loadAsync(bytes)
  const parser = new DOMParser()
  const sheet = parser.parseFromString(await zip.file(sheetPath)!.async('string'), 'application/xml')
  const styles = parser.parseFromString(await zip.file('xl/styles.xml')!.async('string'), 'application/xml')
  const elements = (parent: any, localName: string) => Array.from(parent.getElementsByTagName('*'))
    .filter(node => (node as any).localName === localName) as any[]
  const children = (parent: any, localName: string) => Array.from(parent?.childNodes || [])
    .filter(node => (node as any).localName === localName) as any[]
  const cell = elements(sheet, 'c').find(node => node.getAttribute('r') === address)
  const styleId = Number(cell?.getAttribute('s') || 0)
  const xf = children(elements(styles, 'cellXfs')[0], 'xf')[styleId]
  const borderId = Number(xf?.getAttribute('borderId') || 0)
  const border = children(elements(styles, 'borders')[0], 'border')[borderId]
  return ['left', 'right', 'top', 'bottom'].map(edge => {
    const side = Array.from(border?.childNodes || []).find(node => (node as any).localName === edge) as any
    return side?.getAttribute('style')
  })
}

async function cellFillId(bytes: ArrayBuffer, address: string, sheetPath = 'xl/worksheets/sheet2.xml') {
  const zip = await JSZip.loadAsync(bytes)
  const parser = new DOMParser()
  const sheet = parser.parseFromString(await zip.file(sheetPath)!.async('string'), 'application/xml')
  const styles = parser.parseFromString(await zip.file('xl/styles.xml')!.async('string'), 'application/xml')
  const elements = (parent: any, localName: string) => Array.from(parent.getElementsByTagName('*'))
    .filter(node => (node as any).localName === localName) as any[]
  const children = (parent: any, localName: string) => Array.from(parent?.childNodes || [])
    .filter(node => (node as any).localName === localName) as any[]
  const cell = elements(sheet, 'c').find(node => node.getAttribute('r') === address)
  const styleId = Number(cell?.getAttribute('s') || 0)
  const xf = children(elements(styles, 'cellXfs')[0], 'xf')[styleId]
  return Number(xf?.getAttribute('fillId') || 0)
}

async function cellFontSize(bytes: ArrayBuffer, address: string, sheetPath = 'xl/worksheets/sheet2.xml') {
  const zip = await JSZip.loadAsync(bytes)
  const parser = new DOMParser()
  const sheet = parser.parseFromString(await zip.file(sheetPath)!.async('string'), 'application/xml')
  const styles = parser.parseFromString(await zip.file('xl/styles.xml')!.async('string'), 'application/xml')
  const elements = (parent: any, localName: string) => Array.from(parent.getElementsByTagName('*'))
    .filter(node => (node as any).localName === localName) as any[]
  const children = (parent: any, localName: string) => Array.from(parent?.childNodes || [])
    .filter(node => (node as any).localName === localName) as any[]
  const cell = elements(sheet, 'c').find(node => node.getAttribute('r') === address)
  const styleId = Number(cell?.getAttribute('s') || 0)
  const xf = children(elements(styles, 'cellXfs')[0], 'xf')[styleId]
  const fontId = Number(xf?.getAttribute('fontId') || 0)
  const font = children(elements(styles, 'fonts')[0], 'font')[fontId]
  return Number(children(font, 'sz')[0]?.getAttribute('val') || 0)
}

describe('deployment base paths', () => {
  it('uses product-type prefixes as formula names outside Huashengyi customs', () => {
    expect(customsFormulaName({ formula_name: '五金配件-钉' }, undefined, '其他报关公司')).toBe('五金配件')
    expect(customsFormulaName({ formula_name: '塑胶件-透明罩' }, undefined, '其他报关公司')).toBe('塑胶件')
    expect(customsFormulaName({ formula_name: '搪胶件-公仔' }, undefined, '其他报关公司')).toBe('搪胶件')
    expect(customsFormulaName({ formula_name: '毛绒裁片-耳朵' }, undefined, '其他报关公司')).toBe('毛绒裁片')
    expect(customsFormulaName({ formula_name: '五金配件-钉' }, undefined, '深圳市华胜益出口贸易有限公司')).toBe('五金配件-钉')
    expect(customsFormulaName({ formula_name: '彩咭-FSC' }, undefined, '其他报关公司')).toBe('彩咭-FSC')
  })

  it('derives invoice prices from purchase prices by customs company', () => {
    expect(customsInvoicePrice(3.5, '其他报关公司')).toBe(3.5)
    expect(customsInvoicePrice(36, '深圳市华胜益出口贸易有限公司', 100, false)).toBeCloseTo(5.25)
    expect(customsInvoicePrice(36, '深圳市华胜益出口贸易有限公司', 100, true)).toBeCloseTo((36 * 1.05 + 1248 / 100) / 7.2)
  })

  it('defaults a blank customs company to Huashengyi instead of the supplier', () => {
    expect(effectiveCustomsCompany({ customs_company: '' }, { customs_company: '' })).toBe('深圳市华胜益出口贸易有限公司')
    expect(effectiveCustomsCompany({ customs_company: '其他报关公司' }, { customs_company: '' })).toBe('其他报关公司')
  })

  it('writes the Huashengyi formula for legacy rows with a blank customs company', async () => {
    const templateBytes = readFileSync(resolve(projectRoot, 'public', 'template-customs-rri.xlsx'))
    const output = await buildCustomsWorkbook({
      templateBuffer: Uint8Array.from(templateBytes).buffer,
      items: [
        { material_id: 1, kg: 13.312, qty: 1, cartons: 1, price: 0.04, currency: 'US$', supplier: 'Same Supplier', customs_company: '' },
        { material_id: 2, kg: 0.174, qty: 1, cartons: 1, price: 0.45, currency: 'US$', supplier: 'Same Supplier', customs_company: '' },
      ],
      materials: new Map([
        [1, { id: 1, product_code: '46720J', name_zh: 'PWB螺丝', customs_company: '' }],
        [2, { id: 2, product_code: '46720J', name_zh: 'PB螺丝', customs_company: '' }],
      ]),
      productHs: new Map(),
      images: new Map(),
      form: { customer: 'RRI', containerNo: 'FORMULA-TEST', rate: 7.2 },
    })
    const workbook = XLSX.read(await output.arrayBuffer(), { type: 'array', cellFormula: true })
    const sheet = workbook.Sheets['FORMULA-TEST']
    expect(sheet.AR4?.v).toBe('深圳市华胜益出口贸易有限公司')
    expect(sheet.Z4).toMatchObject({ f: 'AO4*1.05/7.2', v: (0.04 * 1.05) / 7.2 })
    expect(sheet.Z5).toMatchObject({ f: 'IFERROR((AO5*1.05+1248/K5)/7.2,AO5*1.05/7.2)', v: (0.45 * 1.05 + 1248 / 0.174) / 7.2 })
    expect(sheet.AB4?.f).toBe('SUM(AA4:AA5)')
    expect(sheet.AB5?.f).toBeUndefined()
    expect(sheet.AB5?.v || '').toBe('')
    expect(sheet.AQ4?.f).toBe('SUM(AP4:AP5)')
    expect(sheet.AQ5?.f).toBeUndefined()
    expect(sheet.AQ5?.v || '').toBe('')
    expect(sheet['!merges'] || []).toContainEqual({ s: { r: 3, c: 27 }, e: { r: 4, c: 27 } })
    expect(sheet['!merges'] || []).toContainEqual({ s: { r: 3, c: 42 }, e: { r: 4, c: 42 } })
  })

  it('uses the Vite public base for browser routes', () => {
    expect(publicBase('/indo-shipping/')).toBe('/indo-shipping')
  })

  it('uses the Vite public base for API requests', () => {
    expect(apiBase('/indo-shipping/')).toBe('/indo-shipping/api')
  })

  it('uses the Vite public base for downloadable assets', () => {
    expect(publicAsset('/indo-shipping/', '/template-customs.xlsx')).toBe('/indo-shipping/template-customs.xlsx')
  })

  it('ships only the sanitized customs template', async () => {
    execFileSync(process.execPath, [resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--base=/indo-shipping/'], {
      cwd: projectRoot,
      stdio: 'inherit',
    })

    const templatePath = resolve(projectRoot, 'dist', 'template-customs.xlsx')
    expect(existsSync(templatePath)).toBe(true)

    const archive = await JSZip.loadAsync(readFileSync(templatePath))
    const entries = Object.keys(archive.files)
    expect(entries.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))).toHaveLength(15)
    expect(entries.some((name) => name.startsWith('xl/externalLinks/'))).toBe(false)
    expect(entries.some((name) => name.startsWith('customXml/'))).toBe(false)
    const searchableXml = (await Promise.all(
      entries
        .filter((name) => name.endsWith('.xml') || name.endsWith('.rels'))
        .map((name) => archive.file(name)?.async('string') ?? ''),
    )).join('\n')
    expect(searchableXml).not.toMatch(/xwechat_files|wxid_|Users[\\/]DELL/i)
  }, 20_000)

  it('builds a customs export from the sanitized template', async () => {
    const templateBytes = readFileSync(resolve(projectRoot, 'public', 'template-customs-rrm.xlsx'))
    const templateBuffer = Uint8Array.from(templateBytes).buffer
    const templateWorkbook = XLSX.read(templateBytes, { type: 'buffer', cellFormula: true, cellStyles: true })
    const templateSheet = templateWorkbook.Sheets['WHSU6945931']
    const output = await buildCustomsWorkbook({
      templateBuffer,
      items: [
        { material_id: 7, qty: 12, price: 3.5, currency: 'US$', cartons: 2, qty_per_carton: '6', weighing_qty: 6, pallet: '1-2/1卡', po_no: 'PO-TEST', supplier: 'Shared Supplier', contract_no: 'RWCRRM2600206', contract_date: '2026-09-01', invoice_no: 'RW202600206', invoice_date: '2026-09-02', customs_company: 'A 报关公司' },
        { material_id: 8, qty: 20000, price: 0.1, cartons: 1, qty_per_carton: '20000', weighing_qty: 20, po_no: 'PO-ROPE', supplier: 'Other Supplier', contract_no: 'RWCRRM2600206', invoice_no: 'RW202600206', customs_company: 'B 报关公司' },
        { material_id: 9, qty: 10000, price: 0.2, cartons: 3, qty_per_carton: '1-2/3000 3/4000', weighing_qty: 2500, po_no: 'PO-MIXED', supplier: 'Shared Supplier', contract_no: 'RWCRRM2600206', invoice_no: 'RW202600206', customs_company: 'B 报关公司' },
      ],
      materials: new Map([[7, {
        id: 7,
        product_code: 'ITEM-TEST',
        name_zh: '测试物料',
        material_code: '010020100',
        hs_cn: '0000.00',
        hs_id: '1111.11',
        length: 30,
        width: 20,
        height: 10,
        weight_per_carton: 8,
        gross_per_pc: 0.6,
        net_per_pc: 0.5,
      }], [8, {
        id: 8,
        product_code: 'PAPER-ROPE',
        name_zh: '纸绳',
        weight_per_carton: 7.9,
        net_per_pc: 0.7,
      }], [9, {
        id: 9,
        product_code: 'MIXED-PACKING',
        name_zh: '混合装箱物料',
        weight_per_carton: 9,
        net_per_pc: 0.002,
      }]]),
      productHs: new Map(),
      images: new Map([[7, {
        bytes: Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zf8AAAAAASUVORK5CYII=', 'base64')),
        ext: 'png',
      }]]),
      form: { customer: 'RRM', containerNo: 'TEST-CNTR', blNo: 'TEST-SEAL', rate: 7.8 },
    })

    const outputBytes = await output.arrayBuffer()
    const workbook = XLSX.read(outputBytes, { type: 'array', cellFormula: true, cellStyles: true })
    expect(workbook.SheetNames).toEqual([
      '类别金额', 'TEST-CNTR', '全球合同', '全球发票', '装箱单',
      '商品汇总表', '发票', '销售合同', '装箱单 (2)', '草稿大单-1', '司机资料', '单位对照',
      'WpsReserved_CellImgList',
    ])
    const sheet = workbook.Sheets['TEST-CNTR']
    expect(sheet.M3?.c).toBeUndefined()
    expect(sheet.A4?.v).toBe(1)
    expect(sheet.D4?.v).toBe('ITEM-TEST')
    expect(sheet.N1?.v).toBe(7.8)
    expect(sheet.N4).toMatchObject({ f: 'AO4/$N$1' })
    expect(sheet.Z4).toMatchObject({ f: 'AO4', v: 3.5 })
    expect(sheet.AA4).toMatchObject({ f: 'Z4*K4' })
    expect(sheet.AP4).toMatchObject({ f: 'AO4*K4' })
    expect(sheet.P4).toMatchObject({ f: 'ROUND(BA4*L4,2)' })
    expect(sheet.Q4).toMatchObject({ f: 'ROUND(BB4*L4,2)' })
    expect(sheet.R4).toMatchObject({ f: 'AU4*AV4*AW4/28316.75*0.0283' })
    expect(['AU', 'AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC', 'BD'].map(col => sheet[`${col}3`]?.v)).toEqual([
      '长\nLength', '宽\nWidth', '高\nHeight', '物料编码', '每箱数量',
      '每箱重量', '单个毛重', '单个净重', '卡板', '',
    ])
    expect(sheet.AT4?.v).toBe(2)
    expect(sheet.AU4?.v).toBe(30)
    expect(sheet.AV4?.v).toBe(20)
    expect(sheet.AW4?.v).toBe(10)
    expect(sheet.AX4?.v).toBe('010020100')
    expect(sheet.AY4?.v).toBe(6)
    expect(sheet.AZ4?.v).toBe(8)
    expect(sheet.BA4?.v).toBeCloseTo(8 / 6)
    expect(sheet.BA4?.f).toBe('IFERROR(IF(AZ4>0,AZ4/6,0),0)')
    expect(sheet.BA5?.v).toBeCloseTo(0.395)
    expect(sheet.BA5?.f).toBe('IFERROR(IF(AZ5>0,AZ5/20,0),0)')
    expect(sheet.AT6?.v).toBe(3)
    expect(sheet.AY6?.v).toBe('1-2/3000 3/4000')
    expect(sheet.BA6?.v).toBeCloseTo(9 / 2500)
    expect(sheet.BA6?.f).toBe('IFERROR(IF(AZ6>0,AZ6/2500,0),0)')
    expect(sheet.BB4?.v).toBe(0.5)
    expect(sheet.BC4?.v).toBe('1-2/1卡')
    expect(sheet.A7?.v).toBeUndefined()
    expect(sheet.A8?.v).toBe('合计')
    expect(sheet.L8?.f).toBe('SUM(L4:L6)')
    expect(sheet.P8?.f).toBe('SUM(P4:P6)')
    expect(sheet.Q8?.f).toBe('SUM(Q4:Q6)')
    expect(sheet.S8?.f).toBe('SUM(S4:S6)')
    expect(sheet.AT8?.f).toBe('SUM(AT4:AT6)')
    for (const address of ['A4', 'B4', 'AB4', 'AQ4', 'B5', 'AB5', 'AQ5', 'BD6']) {
      expect(await cellBorderSides(outputBytes, address)).toEqual(['thin', 'thin', 'thin', 'thin'])
    }
    for (const column of ['A', 'B', 'L', 'P', 'Q', 'S', 'AT', 'BD']) {
      expect(await cellBorderSides(outputBytes, `${column}8`)).toEqual(['thin', 'thin', 'thin', 'thin'])
      expect(await cellFillId(outputBytes, `${column}8`)).toBe(0)
    }
    for (const address of ['B22', 'H22', 'B23', 'H23', 'B24', 'H33', 'B34', 'H34']) {
      expect(await cellBorderSides(outputBytes, address, 'xl/worksheets/sheet3.xml')).toEqual(['thin', 'thin', 'thin', 'thin'])
    }
    for (const address of ['B30', 'J30', 'B31', 'J31', 'B32', 'J41', 'B42', 'J42']) {
      expect(await cellBorderSides(outputBytes, address, 'xl/worksheets/sheet4.xml')).toEqual(['thin', 'thin', 'thin', 'thin'])
    }
    for (const address of ['A23', 'K23', 'A24', 'K30', 'A31', 'K31']) {
      expect(await cellBorderSides(outputBytes, address, 'xl/worksheets/sheet5.xml')).toEqual(['thin', 'thin', 'thin', 'thin'])
    }
    for (const column of ['D', 'H', 'I', 'J', 'K']) {
      expect(await cellFillId(outputBytes, `${column}31`, 'xl/worksheets/sheet5.xml')).toBeGreaterThan(0)
    }
    expect(await cellFillId(outputBytes, 'A31', 'xl/worksheets/sheet5.xml')).toBeGreaterThan(0)
    for (const column of ['E', 'H', 'I', 'J', 'K']) {
      expect(await cellFillId(outputBytes, `${column}32`, 'xl/worksheets/sheet5.xml')).toBeGreaterThan(0)
      expect(await cellBorderSides(outputBytes, `${column}32`, 'xl/worksheets/sheet5.xml')).toEqual(['thin', 'thin', null, 'medium'])
    }
    expect(sheet.A7?.s?.border).toBeUndefined()
    expect(sheet.AB4?.f).toBe('SUM(AA4:AA6)')
    expect(sheet.AB5?.f).toBeUndefined()
    expect(sheet.AB5?.v || '').toBe('')
    expect(sheet.AB6?.f).toBeUndefined()
    expect(sheet.AB6?.v || '').toBe('')
    expect(sheet.AQ4?.f).toBe('SUM(AP4,AP6)')
    expect(sheet.AQ5?.f).toBe('SUM(AP5)')
    expect(sheet.AQ6?.f).toBeUndefined()
    expect(sheet.AQ6?.v || '').toBe('')
    expect(sheet.AQ4?.z).toContain('"US$"#,##0.0000')
    expect(sheet.AD4?.z).toBe(templateSheet.AD4?.z)
    expect(sheet.A5?.z).toBeDefined()
    expect(sheet.AT4?.z).toBeDefined()
    expect(sheet.AU4?.z).toBeDefined()
    expect(sheet.BB4?.z).toBeDefined()
    expect(sheet.A3?.s?.fgColor?.rgb).toBe(templateSheet.A3?.s?.fgColor?.rgb)
    expect(sheet.A4?.s?.patternType).toBe(templateSheet.A4?.s?.patternType)
    expect(sheet.A4?.s?.fgColor?.rgb).toBe(templateSheet.A4?.s?.fgColor?.rgb)
    expect(sheet.A4?.s?.fgColor?.rgb).not.toBe(sheet.A5?.s?.fgColor?.rgb)
    expect(sheet.A5?.s?.fgColor?.rgb).toBe(sheet.A6?.s?.fgColor?.rgb)
    expect(await cellFillId(outputBytes, 'BB4')).toBe(await cellFillId(outputBytes, 'A4'))
    expect(await cellFillId(outputBytes, 'BB6')).toBe(await cellFillId(outputBytes, 'A6'))
    expect(sheet.E4?.s?.fgColor?.rgb).toBe(sheet.E3?.s?.fgColor?.rgb)
    expect(sheet.E4?.s?.fgColor?.rgb).not.toBe(sheet.A4?.s?.fgColor?.rgb)
    expect(sheet.P4?.z).toBe(templateSheet.P4?.z)
    expect(sheet['!cols']?.[0]?.width).toBeLessThan(templateSheet['!cols']?.[0]?.width || Infinity)
    expect(sheet['!cols']?.[19]?.width).toBeLessThan(templateSheet['!cols']?.[19]?.width || Infinity)
    for (const column of [13, 14, 28, 29, 30, 31, 32, 33, 34, 35, 36]) {
      expect(sheet['!cols']?.[column]?.hidden).toBe(true)
    }
    const archive = await JSZip.loadAsync(outputBytes)
    const drawing = await archive.file('xl/drawings/drawing999.xml')?.async('string')
    const mainSheetXml = await archive.file('xl/worksheets/sheet2.xml')?.async('string')
    const mainRelsXml = await archive.file('xl/worksheets/_rels/sheet2.xml.rels')?.async('string')
    expect(drawing).toContain('<xdr:col>19</xdr:col>')
    expect(drawing).toContain('<xdr:row>3</xdr:row>')
    expect(mainSheetXml).toContain('<drawing r:id="rIdGenDrawing999"/>')
    expect(mainRelsXml).toContain('Target="../drawings/drawing999.xml"')
    expect(archive.file('xl/media/image100.png')).toBeTruthy()
    expect(await cellFontSize(outputBytes, 'AR4')).toBe(16)
    expect(await cellFontSize(outputBytes, 'AR5')).toBe(16)
    expect(await cellFontSize(outputBytes, 'AS4')).toBe(16)
    expect(await cellFontSize(outputBytes, 'AS5')).toBe(16)
    expect(sheet['!rows']?.[3]?.hpt).toBe(templateSheet['!rows']?.[3]?.hpt)
    expect(sheet['!rows']?.[0]?.hpt).toBe(24)
    expect(sheet['!rows']?.[1]?.hpt).toBe(24)
    // 连续的合计分组纵向合并；非连续分组和报关公司列不跨行合并。
    expect(sheet['!merges'] || []).toContainEqual({ s: { r: 3, c: 27 }, e: { r: 5, c: 27 } })
    expect(sheet['!merges'] || []).not.toContainEqual({ s: { r: 4, c: 42 }, e: { r: 5, c: 42 } })
    expect(sheet['!merges'] || []).not.toContainEqual({ s: { r: 4, c: 43 }, e: { r: 5, c: 43 } })
    expect(sheet.AR5?.v).toBe('B 报关公司')
    expect(sheet.AR6?.v).toBe('B 报关公司')
    expect(workbook.Sheets['类别金额'].C4?.f).toContain("'TEST-CNTR'!AA:AA")
    expect(workbook.Sheets['类别金额']['!cols']?.[1]?.wch).toBeGreaterThanOrEqual(19)
    expect(workbook.Sheets['全球合同'].B24?.f).toBe("'TEST-CNTR'!D4")
    expect(workbook.Sheets['全球合同'].C24?.f).toBe("'TEST-CNTR'!G4&'TEST-CNTR'!F4")
    expect(workbook.Sheets['全球合同'].G24?.f).toBe('F24*D24')
    expect(workbook.Sheets['全球合同'].H5?.v).toBe('RWCRRM2600206')
    expect(workbook.Sheets['全球合同'].H9?.v).toBe(excelSerial('2026-09-01'))
    expect(workbook.Sheets['全球合同'].B27?.v || '').toBe('')
    expect(workbook.Sheets['全球合同'].B27?.f).toBeUndefined()
    expect(workbook.Sheets['全球发票'].B32?.f).toBe("'TEST-CNTR'!D4")
    expect(workbook.Sheets['全球发票'].J32?.f).toBe('I32*G32')
    expect(workbook.Sheets['全球发票'].J9?.v).toBe('RW202600206')
    expect(workbook.Sheets['全球发票'].J11?.v).toBe(excelSerial('2026-09-02'))
    expect(workbook.Sheets['全球发票'].B35?.v || '').toBe('')
    expect(workbook.Sheets['全球发票'].B35?.f).toBeUndefined()
    expect(workbook.Sheets['装箱单'].B24?.f).toBe("'TEST-CNTR'!D4")
    expect(workbook.Sheets['装箱单'].D9?.v).toBe('RW202600206')
    expect(workbook.Sheets['装箱单'].D11?.v).toBe(excelSerial('2026-09-02'))
    expect(workbook.Sheets['装箱单'].D13?.v).toBe('RWCRRM2600206')
    expect(workbook.Sheets['装箱单'].D13?.f).toBeUndefined()
    expect(workbook.Sheets['装箱单'].D17?.v).toBe('TEST-CNTR')
    expect(workbook.Sheets['装箱单'].H17?.v).toBe('TEST-SEAL')
    expect(workbook.Sheets['装箱单'].B27?.v || '').toBe('')
    expect(workbook.Sheets['装箱单'].B27?.f).toBeUndefined()
    for (const name of ['全球合同', '全球发票', '装箱单']) {
      expect(Object.values(workbook.Sheets[name]).some((cell: any) => cell?.f?.includes('LOOKUP('))).toBe(false)
    }
    expect(workbook.Sheets['发票'].D9?.f).toBe("'TEST-CNTR'!F4")
    expect(workbook.Sheets['装箱单 (2)'].B10?.f).toBe("'TEST-CNTR'!F4")
    expect(workbook.Sheets['销售合同'].I53?.f).toBe('SUM(I16:I52)')
  }, 20_000)

  it('uses the industrial contract and invoice templates for RRI', async () => {
    const templateBytes = readFileSync(resolve(projectRoot, 'public', 'template-customs-rri.xlsx'))
    const output = await buildCustomsWorkbook({
      templateBuffer: Uint8Array.from(templateBytes).buffer,
      items: [{ material_id: 1, kg: 2.3, qty: 100, price: 0.04, contract_no: 'RRI-C001', contract_date: '2026-09-11', invoice_no: 'RRI-I001', invoice_date: '2026-09-12' }],
      materials: new Map([[1, { id: 1, product_code: 'RRI-ITEM', name_zh: '测试物料', unit_kg: 'KGM' }]]),
      productHs: new Map(), images: new Map(),
      form: { customer: 'RRI', containerNo: 'RRI-CNTR', rate: 7.2 },
    })
    const workbook = XLSX.read(await output.arrayBuffer(), { type: 'array', cellFormula: true })
    expect(['AU', 'AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BB', 'BC', 'BD'].map(col => workbook.Sheets['RRI-CNTR'][`${col}3`]?.v)).toEqual([
      '长\nLength', '宽\nWidth', '高\nHeight', '物料编码', '每箱数量',
      '每箱重量', '单个毛重', '单个净重', '卡板', '',
    ])
    expect(workbook.Sheets['实业合同'].H5?.v).toBe('RRI-C001')
    expect(workbook.Sheets['实业合同'].B24?.f).toBe("'RRI-CNTR'!D4")
    expect(workbook.Sheets['实业发票'].J9?.v).toBe('RRI-I001')
    expect(workbook.Sheets['实业发票'].B28?.f).toBe("'RRI-CNTR'!D4")
    expect(workbook.Sheets['全球合同']).toBeUndefined()
    expect(workbook.Sheets['全球发票']).toBeUndefined()
  }, 20_000)
})
