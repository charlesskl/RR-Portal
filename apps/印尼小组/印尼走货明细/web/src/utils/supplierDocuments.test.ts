import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import JSZip from 'jszip'
import { buildCustomsWorkbook } from './customsExport'

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

describe('supplier document export', () => {
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
    expect(wb.Sheets['发票'].B1.v).toBe(seller.full)
    const terms = tradeTerms(wb, ['全球合同', '全球发票', '印尼合同', '印尼发票'])
    expect(terms.length).toBe(3)
    expect(new Set(terms)).toEqual(new Set(['CIF IDSRG,Semarang']))
    expect(countCellValue(wb, '全球合同', '购销合同\nPurchase Contract')).toBe(1)
    expect(countCellValue(wb, '全球发票', 'COMMERCIAL INVOICE')).toBe(1)
    expect(countCellValue(wb, '印尼合同', '购销合同\nPurchase Contract')).toBe(0)
    expect(countCellValue(wb, '印尼发票', 'COMMERCIAL INVOICE')).toBe(0)
    // 主明细的报关公司列按设计回退为华胜益（见 deployment.test.ts 的 effectiveCustomsCompany
    // 用例），不属于卖方样例残留；其余单据页不得带出模板里的样例公司。
    const remnants = wb.SheetNames.filter(sheet => sheet !== 'TEST-SELLER').flatMap(sheet => Object.entries(wb.Sheets[sheet])
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
    expect(wb.Sheets['装箱单'].A9.v).toContain('ROYAL REGENT PRODUCTS INDUSTRIES LIMITED')
    expect(wb.Sheets['装箱单'].A9.v).not.toContain(firstSeller.nameEn)

    expect(wb.Sheets['实业合同'].H50.v).toBe('C-SECOND')
    expect(wb.Sheets['实业合同'].C56.v).toBe(secondSeller.full)
    expect(Object.values(wb.Sheets['实业合同']).some((cell: any) => cell?.v === 'CIF IDSRG,Semarang')).toBe(true)
    expect(wb.Sheets['实业发票'].B65.v).toBe(secondSeller.full)
    expect(wb.Sheets['装箱单'].A45.v).toContain('ROYAL REGENT PRODUCTS INDUSTRIES LIMITED')
    expect(wb.Sheets['装箱单'].A45.v).not.toContain(secondSeller.nameEn)
    expect(wb.SheetNames).toContain('ONE-WORKBOOK')
    expect(countCellValue(wb, '实业合同', '购销合同\nPurchase Contract')).toBe(2)
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
      productHs: new Map(), images: new Map(), form: { customer: 'RRM', containerNo: 'RRM-PACKING' },
    })
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })

    expect(wb.Sheets['装箱单'].A1.v).toBe('Royal Regent (World) Co. Limited')
    expect(wb.Sheets['装箱单'].A9.v).toContain('Royal Regent (World) Co. Limited')
    expect(wb.Sheets['装箱单'].A9.v).not.toContain(seller.nameEn)
    expect(wb.Sheets['装箱单'].A13.v).toContain('chloe@royalregenthk.com')
    expect(wb.Sheets['装箱单'].A41.v).toBe('Royal Regent (World) Co. Limited')
    expect(wb.Sheets['装箱单'].A49.v).toContain('Royal Regent (World) Co. Limited')
    expect(wb.Sheets['装箱单'].A49.v).not.toContain(secondSeller.nameEn)
    expect(wb.Sheets['装箱单'].A53.v).toContain('chloe@royalregenthk.com')
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
    expect(XLSX.utils.decode_range(wb.Sheets['印尼合同']['!ref']!).e.r).toBeLessThan(46)
    expect(wb.Sheets['印尼合同'].C13.v).toBe(secondSeller.full)
    expect(wb.Sheets['印尼合同'].F25.v).toBe('CIF IDSRG,Semarang')
    expect(wb.Sheets['印尼发票'].J10.v).toBe('ID-I-1')
    expect(XLSX.utils.decode_range(wb.Sheets['印尼发票']['!ref']!).e.r).toBeLessThan(39)
    expect(wb.Sheets['印尼发票'].B10.v).toContain(secondSeller.nameEn)
    expect(wb.Sheets['印尼发票'].I23.v).toBe('CIF IDSRG,Semarang')
    expect(wb.Sheets['装箱单'].A1.v).toBe(secondSeller.nameEn)
    expect(wb.Sheets['装箱单'].A9.v).toContain(secondSeller.nameEn)
    expect(wb.Sheets['装箱单'].A13.v).toContain(secondSeller.email)
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
    expect(wb.Sheets['实业合同'].B24.f).toBe("'RRI-TEST'!D4")
    expect(wb.Sheets['实业合同'].B25?.v).toBeUndefined()
    expect(wb.Sheets['实业合同'].B33?.v).toBeUndefined()
    expect(wb.Sheets['实业合同'].G34.f).toBe('SUM(G24:G33)')
    expect(wb.Sheets['实业发票'].I42.f).toBe('SUM(J32:J41)')
    expect(wb.Sheets['装箱单'].D34.f).toBe('SUM(D24:D33)')
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
    expect(wb.Sheets['全球合同'].B35.f).toBe("'LONG-TEST'!D15")
    expect(wb.Sheets['全球合同'].G36.f).toBe('SUM(G24:G35)')
    expect(wb.Sheets['全球发票'].I44.f).toBe('SUM(J32:J43)')
    expect(wb.Sheets['装箱单'].D36.f).toBe('SUM(D24:D35)')
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
