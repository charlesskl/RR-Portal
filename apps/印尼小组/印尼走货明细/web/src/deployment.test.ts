import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx-js-style'
import { describe, expect, it } from 'vitest'
import { apiBase, publicAsset, publicBase } from './deployment'
import { buildCustomsWorkbook } from './utils/customsExport'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

describe('deployment base paths', () => {
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
    const templateBytes = readFileSync(resolve(projectRoot, 'public', 'template-customs.xlsx'))
    const templateBuffer = Uint8Array.from(templateBytes).buffer
    const templateWorkbook = XLSX.read(templateBytes, { type: 'buffer', cellFormula: true, cellStyles: true })
    const templateSheet = templateWorkbook.Sheets['WHSU6439229']
    const output = await buildCustomsWorkbook({
      templateBuffer,
      items: [
        { material_id: 7, qty: 12, price: 3.5, cartons: 2, qty_per_carton: '6', weighing_qty: 6, pallet: '1-2/1卡', po_no: 'PO-TEST', customs_company: 'A 报关公司' },
        { material_id: 8, qty: 20000, price: 0.1, cartons: 1, qty_per_carton: '20000', weighing_qty: 20, po_no: 'PO-ROPE', customs_company: 'B 报关公司' },
        { material_id: 9, qty: 10000, price: 0.2, cartons: 3, qty_per_carton: '1-2/3000 3/4000', weighing_qty: 2500, po_no: 'PO-MIXED', customs_company: 'B 报关公司' },
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
      images: new Map(),
      form: { containerNo: 'TEST-CNTR', rate: 7.8 },
    })

    const workbook = XLSX.read(await output.arrayBuffer(), { type: 'array', cellFormula: true, cellStyles: true })
    expect(workbook.SheetNames).toEqual([
      '类别金额', 'TEST-CNTR', '全球合同', '全球发票', '印尼合同', '印尼发票', '装箱单',
      '商品汇总表', '发票', '销售合同', '装箱单 (2)', '草稿大单-1', '司机资料', '单位对照',
      'WpsReserved_CellImgList',
    ])
    const sheet = workbook.Sheets['TEST-CNTR']
    expect(sheet.A4?.v).toBe(1)
    expect(sheet.D4?.v).toBe('ITEM-TEST')
    expect(sheet.N1?.v).toBe(7.8)
    expect(sheet.N4).toMatchObject({ f: 'AO4/$N$1' })
    expect(sheet.P4).toMatchObject({ f: 'ROUND(BB4*L4,2)' })
    expect(sheet.Q4).toMatchObject({ f: 'ROUND(BC4*L4,2)' })
    expect(sheet.R4).toMatchObject({ f: 'AU4*AV4*AW4/1000000' })
    expect(sheet.AT4?.v).toBe(2)
    expect(sheet.AU4?.v).toBe(30)
    expect(sheet.AV4?.v).toBe(20)
    expect(sheet.AW4?.v).toBe(10)
    expect(sheet.AX4?.v).toBe('010020100')
    expect(sheet.AZ4?.v).toBe(6)
    expect(sheet.BA4?.v).toBe(8)
    expect(sheet.BB4?.v).toBeCloseTo(8 / 6)
    expect(sheet.BB4?.f).toBe('IFERROR(IF(BA4>0,BA4/6,0),0)')
    expect(sheet.BB5?.v).toBeCloseTo(0.395)
    expect(sheet.BB5?.f).toBe('IFERROR(IF(BA5>0,BA5/20,0),0)')
    expect(sheet.AT6?.v).toBe(3)
    expect(sheet.AZ6?.v).toBe('1-2/3000 3/4000')
    expect(sheet.BB6?.v).toBeCloseTo(9 / 2500)
    expect(sheet.BB6?.f).toBe('IFERROR(IF(BA6>0,BA6/2500,0),0)')
    expect(sheet.BC4?.v).toBe(0.5)
    expect(sheet.BD4?.v).toBe('1-2/1卡')
    expect(sheet.AB4?.f).toBe('SUM(AA4:AA4)')
    expect(sheet.AQ5?.f).toBe('SUM(AP5:AP6)')
    expect(sheet.AD4?.z).toBe('yyyy/m/d')
    expect(sheet.AT4?.z).toBe('0')
    expect(sheet.AU4?.z).toBe('0.0000')
    expect(sheet.BB4?.z).toBe('0.0000')
    expect(sheet.A3?.s?.fgColor?.rgb).toBe(templateSheet.A3?.s?.fgColor?.rgb)
    expect(sheet.A4?.s?.patternType).toBe(templateSheet.A4?.s?.patternType)
    expect(sheet.A4?.s?.fgColor?.rgb).toBe('C6E0B4')
    expect(sheet.A4?.s?.fgColor?.rgb).not.toBe(sheet.A5?.s?.fgColor?.rgb)
    expect(sheet.A5?.s?.fgColor?.rgb).toBe(sheet.A6?.s?.fgColor?.rgb)
    expect(sheet.P4?.z).toBe('0.00')
    expect(sheet['!cols']?.[0]?.width).toBe(templateSheet['!cols']?.[0]?.width)
    expect(sheet['!rows']?.[3]?.hpt).toBe(templateSheet['!rows']?.[3]?.hpt)
    expect(sheet['!merges']).toContainEqual({ s: { r: 4, c: 27 }, e: { r: 5, c: 27 } })
    expect(sheet['!merges']).toContainEqual({ s: { r: 4, c: 42 }, e: { r: 5, c: 42 } })
    expect(sheet['!merges']).toContainEqual({ s: { r: 4, c: 43 }, e: { r: 5, c: 43 } })
    expect(workbook.Sheets['类别金额'].C4?.f).toContain("'TEST-CNTR'!$AA$4:$AA$1000")
    expect(workbook.Sheets['全球合同'].B24?.f).toContain("'TEST-CNTR'!V:V")
    expect(workbook.Sheets['全球发票'].B32?.f).toContain("'TEST-CNTR'!V:V")
    expect(workbook.Sheets['装箱单'].B24?.f).toContain("'TEST-CNTR'!X:X")
    expect(workbook.Sheets['发票'].D9?.f).toBe("'TEST-CNTR'!F4")
    expect(workbook.Sheets['装箱单 (2)'].B10?.f).toBe("'TEST-CNTR'!F4")
    expect(workbook.Sheets['销售合同'].I53?.f).toBe('SUM(I16:I52)')
  }, 20_000)
})
