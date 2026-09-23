// 出口报关明细 Excel 导出（基于模板 template_报关明细.xlsx）
// 移植自旧 HTML 印尼走货明细生成系统.html 的 buildExcel(6408) / setCell(6395) /
//   excelDate(6402) / dataUrlToBytes(6588) / injectOoxmlImages(6598)
// 与清溪出货样表保持 1:1：56 列布局，表格样式从模板继承，
//   产品图片用 JSZip 注入到第 20 列(T)。
import * as XLSX from 'xlsx-js-style'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import type { Material, SupplierDict } from '../api/client'
import { documentSellerForLine, supplierForLine } from './supplierProfiles'
import { isPaperRope, shipmentGrossPerPc, shipmentPackingAverageQty, shipmentWeightQuantity } from './shipmentWeight'

export const CUSTOMS_FIXED = '深圳市华胜益出口贸易有限公司'

export function effectiveCustomsCompany(
  item: Pick<CustomsItem, 'customs_company'>,
  material?: Pick<Material, 'customs_company'>,
  fallback = CUSTOMS_FIXED,
) {
  return (item.customs_company || material?.customs_company || fallback || CUSTOMS_FIXED).trim()
}

const CUSTOMS_COMPANY_COLORS = [
  'C6E0B4', // 浅绿（参考表第 1 组）
  'F8CBAD', // 浅橙（参考表第 2 组）
  'B4C6E7', // 浅蓝（参考表第 3 组）
  'FFF2CC', // 浅黄
  'E4DFEC', // 浅紫
  'DAEEF3', // 浅青
  'F4CCCC', // 浅红
]

const FORMULA_NAME_PREFIXES = ['五金配件', '塑胶件', '搪胶件', '毛绒裁片']

const PURCHASE_CURRENCY_FORMATS: Record<string, string> = {
  '¥': '¥#,##0.0000',
  'HK$': '"HK$"#,##0.0000',
  'US$': '"US$"#,##0.0000',
  '€': '"€"#,##0.0000',
  '£': '"£"#,##0.0000',
  '¥(JPY)': '"¥"#,##0',
}

function purchaseCurrencyFormat(currency?: string) {
  return PURCHASE_CURRENCY_FORMATS[currency || '¥'] || '#,##0.0000'
}

export function customsFormulaName(item: CustomsItem, material?: Material, customsCompany = '') {
  const name = item.formula_name || material?.name_zh || material?.item_no || ''
  if (customsCompany.includes('华胜益')) return name
  return FORMULA_NAME_PREFIXES.find(prefix => name.startsWith(prefix)) || name
}

export function customsInvoicePrice(
  purchasePrice?: number,
  customsCompany = '',
  deliveryKg?: number,
  isLastCompanyItem = false,
) {
  const price = Number(purchasePrice) || 0
  if (!customsCompany.includes('华胜益')) return price
  const surchargePerKg = isLastCompanyItem && Number(deliveryKg) > 0 ? 1248 / Number(deliveryKg) : 0
  return (price * 1.05 + surchargePerKg) / 7.2
}

// 走货明细行（与 ShipmentsPage 的 ShipmentItem 字段一致，只列导出用到的）
export interface CustomsItem {
  material_id?: number
  kg?: number
  qty?: number
  cartons?: number
  qty_per_carton?: string
  weighing_qty?: number
  purchase_unit?: string
  pallet?: string
  price?: number
  currency?: string
  po_no?: string
  po_date?: string
  supplier?: string
  customs_company?: string
  bl_head?: string
  contract_no?: string
  contract_date?: string
  invoice_no?: string
  invoice_date?: string
  invoice_price?: number
  product_use?: string
  formula_name?: string
}

export interface CustomsExportForm {
  customer?: string
  containerNo?: string
  containerCount?: number | string
  shipDate?: string
  blNo?: string
  rate?: number
  // 旧版隐藏字段，新版暂无 → 默认空/0
  eta?: string
  vessel?: string
  exportCompany?: string
  blHead?: string
  freightCN?: number
  freightID?: number
}

export interface CustomsExportInput {
  templateBuffer: ArrayBuffer
  indonesiaTemplateBuffer?: ArrayBuffer
  items: CustomsItem[]                              // 已按显示顺序
  materials: Map<number, Material>                  // material_id → 物料主数据
  productHs: Map<string, { hsCN?: string; hsID?: string }> // product_code → 产品级 HS（兜底）
  images: Map<number, { bytes: Uint8Array; ext: string }>  // material_id → 图片
  form: CustomsExportForm
  seller?: SupplierDict
  supplierProfiles?: SupplierDict[]
  mainOnly?: boolean
}

export function isIndonesiaBlHead(value?: string) {
  const head = (value || '').trim()
  return Boolean(head && !/(?:实业|實業|全球|\bRRI\b|\bRRM\b)/i.test(head))
}

const HUASHENGYI_BANK_INFO = [
  'Beneficiary name :Shenzhen Huashengyi Export Trading Limited',
  'Account number :',
  '15668277360001(USD)',
  '15353466270052 (RMB)',
  '15602776290037 (HKD)',
  'Beneficiary Bank: Ping An Bank Co., Ltd',
  'Swift code : SZDBCNBSXXX',
].join('\n')
const HUASHENGYI_BENEFICIARY = 'Beneficiary：SHENZHEN  HUASHENGYI  EXPORT  TRADING  LIMITED'
const HUASHENGYI_BENEFICIARY_ADDRESS = 'Add: Room 602, Longsheng Comprehensive Service Building, Longsheng Community, Dalang Street, Longhua District, Shenzhen City'

function isHuashengyiSeller(seller?: SupplierDict) {
  return Boolean(seller && [seller.keyword, seller.full, seller.nameEn]
    .some(name => /华胜益|HUASHENGYI/i.test(name || '')))
}

function fillSeller(wb: XLSX.WorkBook, seller: SupplierDict) {
  const name = seller.full!.trim(), english = seller.nameEn!.trim()
  const combined = `${name}\n${english}`
  const address = `${seller.addressZh!.trim()}\n${seller.addressEn!.trim()}\nTEL: ${seller.phone!.trim()}    Email: ${seller.email!.trim()}    ATTN: ${seller.contact!.trim()}`
  const put = (sheet: string, addresses: string[], value: string) =>
    addresses.forEach(cell => setPreservingStyle(wb.Sheets[sheet], cell, value))
  put('全球合同', ['C11', 'C65', 'C107'], name)
  put('全球合同', ['C12', 'C66', 'C108'], english)
  put('全球合同', ['C13', 'C67', 'C109'], address)
  put('全球合同', ['E51', 'E93', 'E138'], combined)
  put('全球发票', ['B23', 'B78', 'B117'], name)
  put('全球发票', ['B24', 'B79', 'B118'], english)
  put('全球发票', ['B25', 'B80', 'B119'], address)
  // 华胜益发票保留其固定收款资料；其他卖方不得继承模板中的样例账户。
  put('全球发票', ['B50'], isHuashengyiSeller(seller) ? HUASHENGYI_BANK_INFO : '')
  put('全球发票', ['G50'], isHuashengyiSeller(seller) ? HUASHENGYI_BENEFICIARY : '')
  put('全球发票', ['G52'], isHuashengyiSeller(seller) ? HUASHENGYI_BENEFICIARY_ADDRESS : '')
  put('印尼合同', ['C13', 'C58'], name)
  put('印尼合同', ['C14', 'C59'], english)
  put('印尼合同', ['C15', 'C60'], address)
  put('印尼合同', ['E43', 'E98'], combined)
  put('印尼发票', ['B10', 'B42'], combined)
  put('印尼发票', ['B11', 'B43'], address)
  put('装箱单', ['A1'], english)
  put('装箱单', ['A2'], seller.addressEn!.trim())
  put('装箱单', ['A9', 'A51', 'A84'], `${english}\n${seller.addressEn!.trim()}`)
  put('装箱单', ['A12', 'A54', 'A87'], `TEL: ${seller.phone!.trim()}`)
  put('装箱单', ['A13', 'A55', 'A88'], `EMAIL: ${seller.email!.trim()}`)
  put('装箱单', ['A14', 'A56', 'A89'], `Attention: ${seller.contact!.trim()}`)
  put('装箱单', ['A117', 'A149'], english)
  put('装箱单', ['A118', 'A150'], seller.addressEn!.trim())
  put('装箱单', ['A119', 'A151'], '')
  put('装箱单', ['A120', 'A152'], `Email: ${seller.email!.trim()}`)
  put('装箱单', ['A121', 'A153'], `Tel.: ${seller.phone!.trim()}`)
  put('装箱单', ['A122', 'A154'], `ATTN: ${seller.contact!.trim()}`)
  put('发票', ['B1', 'D24', 'D43', 'D45', 'D47'], name)
  put('发票', ['B2'], `TEL: ${seller.phone!.trim()}    EMAIL: ${seller.email!.trim()}`)
  put('销售合同', ['B4'], combined)
  put('销售合同', ['B6'], address)
  put('装箱单 (2)', ['A3'], `Seller: ${english}    ${seller.phone!.trim()}    ${seller.email!.trim()}`)
  put('草稿大单-1', ['A6', 'A8'], name)
}

function applySellerTradeTerms(wb: XLSX.WorkBook, seller: SupplierDict) {
  const sellerNames = [seller.keyword, seller.full, seller.nameEn]
  const tradeTerm = sellerNames.some(name => /华胜益|HUASHENGYI/i.test(name || '')) ? 'FOB' : 'CIF'
  const value = `${tradeTerm} IDSRG,Semarang`
  const put = (sheet: string, addresses: string[]) =>
    addresses.forEach(address => setPreservingStyle(wb.Sheets[sheet], address, value))

  // 每份卖方文件内的合同和配套发票必须使用同一贸易术语，
  // 不能继承模板中首组 FOB、其他组 CIF 的样例值。
  put('全球合同', ['F23', 'C44', 'F77', 'C86', 'F119', 'C131'])
  put('全球发票', ['I31', 'I84', 'I123'])
  put('印尼合同', ['F25', 'C36', 'F70', 'C91'])
  put('印尼发票', ['I23', 'I55'])
}

function sellerTradeTerm(seller: SupplierDict) {
  const names = [seller.keyword, seller.full, seller.nameEn]
  return names.some(name => /华胜益|HUASHENGYI/i.test(name || '')) ? 'FOB' : 'CIF'
}

function fillGenericSeller(wb: XLSX.WorkBook, seller: SupplierDict) {
  const name = seller.full!.trim()
  const english = seller.nameEn!.trim()
  const combined = `${name}\n${english}`
  const address = `${seller.addressZh!.trim()}\n${seller.addressEn!.trim()}\nTEL: ${seller.phone!.trim()}    Email: ${seller.email!.trim()}    ATTN: ${seller.contact!.trim()}`
  const put = (sheet: string, addresses: string[], value: string) =>
    addresses.forEach(cell => setPreservingStyle(wb.Sheets[sheet], cell, value))
  put('发票', ['B1', 'D24', 'D43', 'D45', 'D47'], name)
  put('发票', ['B2'], `TEL: ${seller.phone!.trim()}    EMAIL: ${seller.email!.trim()}`)
  put('销售合同', ['B4'], combined)
  put('销售合同', ['B6'], address)
  put('装箱单 (2)', ['A3'], `Seller: ${english}    ${seller.phone!.trim()}    ${seller.email!.trim()}`)
  put('草稿大单-1', ['A6', 'A8'], name)
}

// 输出文件名：月日+客户+柜数+柜号(报关).xlsx
export function customsFileName(form: CustomsExportForm): string {
  const customer = form.customer || '客户'
  const count = form.containerCount != null && form.containerCount !== '' ? String(form.containerCount) : '1'
  const no = (form.containerNo || '').trim()
  const d = form.shipDate ? new Date(form.shipDate) : new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日${customer}${count}柜${no}(报关).xlsx`
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  const m = String(dataUrl || '').match(/^data:image\/([a-z]+);base64,(.+)$/i)
  if (!m) return null
  const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase()
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, ext }
}

type CellType = 's' | 'n'
function setCell(ws: XLSX.WorkSheet, r: number, c: number, value: any, type: CellType = 's') {
  const addr = XLSX.utils.encode_cell({ r, c })
  if (value === '' || value == null) { delete (ws as any)[addr]; return }
  const cell: any = { v: value, t: type }
  if (typeof value === 'string' && value.startsWith('=')) { cell.f = value.substring(1); cell.t = 'n'; cell.v = 0 }
  ;(ws as any)[addr] = cell
}

function cloneTemplateValue<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function writableTemplateStyle(style: any) {
  if (!style) return undefined
  // xlsx-js-style 读取时会把填充属性直接放在 s 下，写入时需要还原为 fill。
  if (style.patternType || style.fgColor || style.bgColor) return { fill: cloneTemplateValue(style) }
  return cloneTemplateValue(style)
}

function normalizeWorkbookStyles(wb: XLSX.WorkBook) {
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    for (const [address, cell] of Object.entries(sheet) as [string, any][]) {
      if (address.startsWith('!') || !cell?.s) continue
      cell.s = writableTemplateStyle(cell.s)
    }
  }
}

function fitCategoryColumn(wb: XLSX.WorkBook) {
  const sheet = wb.Sheets['类别金额']
  if (!sheet) return
  const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : { s: { r: 0 }, e: { r: 40 } }
  let maxWidth = 8
  for (let row = range.s.r; row <= range.e.r; row++) {
    const value = (sheet as any)[XLSX.utils.encode_cell({ r: row, c: 1 })]?.v
    if (value == null) continue
    const width = Array.from(String(value)).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0)
    maxWidth = Math.max(maxWidth, width)
  }
  const columns: any[] = sheet['!cols'] || []
  const width = Math.min(32, Math.max(20, maxWidth + 2))
  columns[1] = { ...(columns[1] || {}), width, wch: width }
  sheet['!cols'] = columns
}

function compactMainColumns(sheet: XLSX.WorkSheet) {
  const columns: any[] = sheet['!cols'] || []
  // 用户录入时仍保留这些辅助字段，但正式导出不展示：
  // N:O 为单项毛/净重，AC:AK 为柜号至产品实际运费。
  for (const index of [13, 14, 28, 29, 30, 31, 32, 33, 34, 35, 36]) {
    columns[index] = { ...(columns[index] || {}), hidden: true }
  }
  sheet['!cols'] = columns.map((column: any, index: number) => {
    if (!column || column.hidden) return column
    if (index === 19) return { ...column, width: 16, wch: 16 }
    const original = Number(column.width ?? column.wch)
    if (!Number.isFinite(original)) return column
    const width = Math.max(6, Math.round(original * 0.85 * 10) / 10)
    return { ...column, width, wch: width }
  })
}

function excelDate(d: any): number | string {
  if (!d) return ''
  const dt = (d instanceof Date) ? d : new Date(d)
  if (isNaN(dt.getTime())) return d
  return Math.floor((dt.getTime() - Date.UTC(1899, 11, 30)) / 86400000)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rewriteSheetReferences(wb: XLSX.WorkBook, oldName: string, newName: string) {
  if (oldName === newName) return
  const escaped = escapeRegExp(oldName)
  const patterns = [
    new RegExp(`'${escaped.replace(/'/g, "''")}'!`, 'g'),
    new RegExp(`(?:\\[\\d+\\])?${escaped}!`, 'g'),
  ]
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    for (const cell of Object.values(sheet) as any[]) {
      if (!cell || typeof cell !== 'object' || typeof cell.f !== 'string') continue
      let formula = cell.f
      for (const pattern of patterns) formula = formula.replace(pattern, `'${newName.replace(/'/g, "''")}'!`)
      cell.f = formula
    }
  }
}

function attachIndonesiaDocumentSheets(wb: XLSX.WorkBook, templateBuffer: ArrayBuffer, mainName: string) {
  const source = XLSX.read(templateBuffer, { type: 'array', cellFormula: true, cellStyles: true })
  normalizeWorkbookStyles(source)
  const sourceMainName = source.SheetNames[1]
  const sheetNames = ['印尼合同', '印尼发票']
  const insertAfter = Math.max(wb.SheetNames.indexOf('实业发票'), wb.SheetNames.indexOf('全球发票'))
  const inserted: string[] = []
  for (const sheetName of sheetNames) {
    const sourceSheet = source.Sheets[sheetName]
    if (!sourceSheet || wb.Sheets[sheetName]) continue
    wb.Sheets[sheetName] = cloneTemplateValue(sourceSheet)
    inserted.push(sheetName)
  }
  if (inserted.length) wb.SheetNames.splice(insertAfter + 1, 0, ...inserted)
  if (sourceMainName) rewriteSheetReferences(wb, sourceMainName, mainName)
}

function replaceTemplateShipmentLiterals(wb: XLSX.WorkBook, form: CustomsExportForm, newName: string) {
  const replacements: Array<[RegExp, string]> = [
    [/WHSU7042278/g, newName],
    [/WHAC079825/g, (form.blNo || '').trim()],
  ]
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    for (const cell of Object.values(sheet) as any[]) {
      if (!cell || typeof cell !== 'object' || typeof cell.v !== 'string' || cell.f) continue
      let value = cell.v
      for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement)
      if (value !== cell.v) {
        cell.v = value
        delete cell.w
      }
    }
  }
}

const RRI_BUYER_ZH = '華登製品實業有限公司'
const RRI_BUYER_EN = 'Royal Regent Products Industries Limited'

function applyCustomerDocumentEntity(wb: XLSX.WorkBook, customer?: string) {
  if ((customer || '').trim().toUpperCase() !== 'RRI') return
  const replacements: Array<[RegExp, string]> = [
    [/華登[（(]全球[）)]有限公司/g, RRI_BUYER_ZH],
    [/Royal\s+Regent\s*\(World\)\s*Co\.?\s*,?\s*Limited/gi, RRI_BUYER_EN],
  ]
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    for (const cell of Object.values(sheet) as any[]) {
      if (!cell || typeof cell !== 'object' || typeof cell.v !== 'string' || cell.f) continue
      let value = cell.v
      for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement)
      if (value !== cell.v) {
        cell.v = value
        delete cell.w
      }
    }
  }
  // RRI 使用华登实业主体，工作表名称也同步标明，避免用户误用“全球”版本。
  for (const [oldName, newName] of [['全球合同', '实业合同'], ['全球发票', '实业发票']] as const) {
    if (!wb.Sheets[oldName]) continue
    rewriteSheetReferences(wb, oldName, newName)
    wb.Sheets[newName] = wb.Sheets[oldName]
    delete wb.Sheets[oldName]
    wb.SheetNames = wb.SheetNames.map(name => name === oldName ? newName : name)
  }
}

function setPreservingStyle(ws: XLSX.WorkSheet | undefined, address: string, value: string | number | null, formula = false) {
  if (!ws) return
  const existing: any = (ws as any)[address] || {}
  delete existing.f
  delete existing.F
  delete existing.w
  if (value == null || value === '') {
    existing.t = 's'
    existing.v = ''
  } else if (formula && typeof value === 'string') {
    existing.t = 'n'
    existing.v = 0
    existing.f = value.startsWith('=') ? value.slice(1) : value
  } else {
    existing.t = typeof value === 'number' ? 'n' : 's'
    existing.v = value
  }
  ;(ws as any)[address] = existing
}

function formulaRef(sheetName: string, cell: string) {
  return `='${sheetName.replace(/'/g, "''")}'!${cell}`
}

type LinkedDocumentGroup = {
  contract: string
  contractDate: string
  invoice: string
  invoiceDate: string
  indices: number[]
  seller?: SupplierDict
  indo: boolean
}

function collectLinkedDocumentGroups(
  sorted: CustomsItem[],
  sellerForItem?: (item: CustomsItem) => SupplierDict | undefined,
): LinkedDocumentGroup[] {
  const groups: LinkedDocumentGroup[] = []
  const byKey = new Map<string, LinkedDocumentGroup>()
  sorted.forEach((item, index) => {
    const contract = (item.contract_no || '').trim()
    const invoice = (item.invoice_no || '').trim()
    const seller = sellerForItem?.(item)
    const indo = isIndonesiaBlHead(item.bl_head)
    const sellerKey = seller ? String(seller.id ?? seller.full ?? seller.keyword) : ''
    const key = `${contract}\u0000${invoice}\u0000${sellerKey}\u0000${indo ? 'ID' : 'PRIMARY'}`
    let group = byKey.get(key)
    if (!group) {
      group = {
        contract,
        contractDate: (item.contract_date || '').trim(),
        invoice,
        invoiceDate: (item.invoice_date || '').trim(),
        indices: [],
        seller,
        indo,
      }
      groups.push(group)
      byKey.set(key, group)
    }
    group.indices.push(index + 1)
  })
  return groups
}

function populateLinkedDocuments(
  wb: XLSX.WorkBook,
  mainName: string,
  sorted: CustomsItem[],
  customer = '',
  sellerForItem?: (item: CustomsItem) => SupplierDict | undefined,
  shipment?: CustomsExportForm,
) {
  type Slot = {
    contractHeader: string; contractDate: string; contractRows: [number, number]
    invoiceHeader: string; invoiceDate: string; invoiceContract: string; invoiceRows: [number, number]
    packingHeader: string; packingRows: [number, number]
    contractStart?: number; invoiceStart?: number
  }
  const groups = collectLinkedDocumentGroups(sorted, sellerForItem)

  const rri = customer.toUpperCase().includes('RRI')
  const contractSheet = wb.Sheets[rri ? '实业合同' : '全球合同']
  const invoiceSheet = wb.Sheets[rri ? '实业发票' : '全球发票']
  const indonesiaContractSheet = wb.Sheets['印尼合同']
  const indonesiaInvoiceSheet = wb.Sheets['印尼发票']
  const packingSheet = wb.Sheets['装箱单']
  const addressRow = (address: string) => Number(address.match(/\d+$/)?.[0] || 0)
  const slots: Slot[] = rri ? [
    ...[
      [5, 9, 24, 30, 9, 11, 13, 28, 34],
      [49, 53, 68, 71, 51, 53, 55, 70, 75],
      [90, 94, 109, 114, 88, 90, 92, 107, 112],
      [133, 137, 152, 157, 125, 127, 129, 146, 149],
      [176, 180, 195, 199, 162, 164, 166, 182, 186],
      [218, 222, 237, 238, 199, 201, 203, 219, 224],
      [256, 260, 275, 281, 237, 239, 241, 257, 260],
      [300, 304, 319, 321, 272, 274, 276, 292, 295],
      [338, 342, 357, 362, 307, 309, 311, 327, 331],
      [380, 384, 399, 403, 343, 345, 347, 363, 367],
      [422, 426, 441, 454, 380, 382, 384, 400, 414],
      [473, 477, 492, 505, 427, 429, 431, 447, 461],
      [524, 528, 543, 547, 474, 476, 478, 494, 498],
      [566, 570, 585, 589, 511, 513, 515, 531, 535],
    ].map(v => ({
      contractHeader: `H${v[0]}`, contractDate: `H${v[1]}`, contractRows: [v[2], v[3]] as [number, number],
      invoiceHeader: `J${v[4]}`, invoiceDate: `J${v[5]}`, invoiceContract: `J${v[6]}`, invoiceRows: [v[7], v[8]] as [number, number],
      packingHeader: '', packingRows: [0, 0] as [number, number],
    })),
  ] : [
    ...[
      [5, 9, 24, 37, 9, 11, 13, 32, 45, 9, 24, 37],
      [56, 60, 75, 75, 62, 64, 66, 83, 83, 49, 64, 64],
      [97, 101, 116, 116, 97, 99, 101, 118, 118, 79, 94, 94],
      [139, 143, 158, 158, 138, 140, 142, 160, 160, 109, 124, 124],
      [180, 184, 199, 207, 177, 179, 181, 199, 207, 140, 155, 163],
      [227, 231, 246, 258, 218, 220, 222, 240, 252, 174, 189, 201],
      [276, 280, 295, 307, 264, 266, 268, 286, 298, 213, 228, 240],
      [326, 330, 345, 357, 311, 313, 315, 333, 345, 252, 267, 279],
      [376, 380, 395, 407, 358, 360, 362, 380, 392, 291, 306, 318],
      [426, 430, 445, 457, 405, 407, 409, 427, 439, 330, 345, 357],
      [476, 480, 495, 507, 452, 454, 456, 474, 486, 369, 384, 396],
      [525, 529, 544, 552, 498, 500, 502, 519, 527, 408, 423, 431],
      [570, 574, 589, 596, 540, 542, 544, 561, 568, 443, 458, 465],
      [614, 618, 633, 641, 580, 582, 584, 601, 609, 477, 492, 500],
      [660, 664, 679, 686, 622, 624, 626, 643, 650, 512, 527, 534],
    ].map(v => ({
      contractHeader: `H${v[0]}`, contractDate: `H${v[1]}`, contractRows: [v[2], v[3]] as [number, number],
      invoiceHeader: `J${v[4]}`, invoiceDate: `J${v[5]}`, invoiceContract: `J${v[6]}`, invoiceRows: [v[7], v[8]] as [number, number],
      packingHeader: `D${v[9]}`, packingRows: [v[10], v[11]] as [number, number],
    })),
  ]
  const packingSlots: Slot[] = (rri ? [
    [9, 25, 31], [43, 59, 64], [76, 92, 96], [108, 124, 127], [139, 155, 157],
    [169, 185, 189], [201, 217, 219], [231, 247, 251], [263, 279, 281], [293, 309, 311],
    [323, 339, 352], [364, 380, 393], [405, 421, 425], [437, 453, 468], [480, 496, 501],
  ] : slots.map(slot => [addressRow(slot.packingHeader), slot.packingRows[0], slot.packingRows[1]])).map(v => ({
    contractHeader: '', contractDate: '', contractRows: [0, 0] as [number, number],
    invoiceHeader: '', invoiceDate: '', invoiceContract: '', invoiceRows: [0, 0] as [number, number],
    packingHeader: `D${v[0]}`, packingRows: [v[1], v[2]] as [number, number],
  }))
  const indonesiaSlots: Slot[] = rri ? [
    {
      contractStart: 1, contractHeader: 'H6', contractDate: 'H10', contractRows: [25, 40],
      invoiceStart: 1, invoiceHeader: 'J10', invoiceDate: 'J12', invoiceContract: 'J14', invoiceRows: [24, 39],
      packingHeader: '', packingRows: [0, 0],
    },
  ] : [
    {
      contractStart: 2, contractHeader: 'H7', contractDate: 'H11', contractRows: [26, 32],
      invoiceStart: 1, invoiceHeader: 'J10', invoiceDate: 'J12', invoiceContract: 'J14', invoiceRows: [24, 29],
      packingHeader: '', packingRows: [0, 0],
    },
    {
      contractStart: 47, contractHeader: 'H52', contractDate: 'H56', contractRows: [71, 86],
      invoiceStart: 40, invoiceHeader: 'J42', invoiceDate: 'J44', invoiceContract: 'J46', invoiceRows: [56, 72],
      packingHeader: '', packingRows: [0, 0],
    },
  ]
  const primaryGroups = groups.filter(group => !group.indo)
  const indonesiaGroups = groups.filter(group => group.indo)
  if (groups.length > packingSlots.length) throw new Error(`合同或发票数超过装箱单模板容量（最多 ${packingSlots.length} 份）`)
  if (primaryGroups.length > slots.length) throw new Error(`实业/全球合同数超过模板容量（最多 ${slots.length} 份）`)
  if (indonesiaGroups.length > indonesiaSlots.length) throw new Error(`印尼合同或发票数超过模板容量（最多 ${indonesiaSlots.length} 份）`)
  if (indonesiaGroups.length && (!indonesiaContractSheet || !indonesiaInvoiceSheet)) {
    throw new Error('缺少印尼合同/印尼发票模板')
  }

  const sheetLastRow = (sheet: XLSX.WorkSheet | undefined) => sheet?.['!ref']
    ? XLSX.utils.decode_range(sheet['!ref']).e.r + 1
    : 1
  const truncateSheetAtRow = (sheet: XLSX.WorkSheet | undefined, firstRemovedRow: number) => {
    if (!sheet || firstRemovedRow <= 1) return
    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) continue
      if (addressRow(address) >= firstRemovedRow) delete (sheet as any)[address]
    }
    sheet['!merges'] = (sheet['!merges'] || []).filter(range => range.e.r < firstRemovedRow - 1)
    if (sheet['!rows']) sheet['!rows'] = sheet['!rows'].slice(0, firstRemovedRow - 1)
    if (sheet['!ref']) {
      const range = XLSX.utils.decode_range(sheet['!ref'])
      range.e.r = Math.max(range.s.r, firstRemovedRow - 2)
      sheet['!ref'] = XLSX.utils.encode_range(range)
    }
  }
  const findLabelRow = (
    sheet: XLSX.WorkSheet | undefined,
    column: string,
    start: number,
    end: number,
    pattern: RegExp,
  ) => {
    for (let row = start; row <= end; row++) {
      const value = String((sheet as any)?.[`${column}${row}`]?.v || '')
      if (pattern.test(value)) return row
    }
    return 0
  }
  const setTradeTerms = (
    sheet: XLSX.WorkSheet | undefined,
    start: number,
    end: number,
    seller?: SupplierDict,
  ) => {
    for (const [address, cell] of Object.entries(sheet || {}) as [string, any][]) {
      if (address.startsWith('!') || typeof cell?.v !== 'string') continue
      const row = addressRow(address)
      if (row >= start && row <= end && /^(?:FOB|CIF)\s+IDSRG\s*,?\s*Semarang$/i.test(cell.v.trim())) {
        setPreservingStyle(sheet, address, seller ? `${sellerTradeTerm(seller)} IDSRG,Semarang` : '')
      }
    }
  }
  const fillSlotSeller = (
    group: LinkedDocumentGroup,
    slot: Slot,
    index: number,
    documentSlots: Slot[],
    groupContractSheet: XLSX.WorkSheet | undefined,
    groupInvoiceSheet: XLSX.WorkSheet | undefined,
    packingSlot: Slot,
  ) => {
    const seller = group?.seller
    const next = documentSlots[index + 1]
    const contractStart = slot.contractStart || addressRow(slot.contractHeader)
    const contractEnd = next ? (next.contractStart || addressRow(next.contractHeader)) - 1 : sheetLastRow(groupContractSheet)
    const invoiceStart = slot.invoiceStart || addressRow(slot.invoiceHeader)
    const invoiceEnd = next ? (next.invoiceStart || addressRow(next.invoiceHeader)) - 1 : sheetLastRow(groupInvoiceSheet)
    const name = seller?.full?.trim() || ''
    const english = seller?.nameEn?.trim() || ''
    const address = seller
      ? `${seller.addressZh!.trim()}\n${seller.addressEn!.trim()}\nTEL: ${seller.phone!.trim()}    Email: ${seller.email!.trim()}    ATTN: ${seller.contact!.trim()}`
      : ''
    const combined = seller ? `${name}\n${english}` : ''

    const contractSellerRow = findLabelRow(groupContractSheet, 'B', contractStart, slot.contractRows[0] - 1, /卖方|The Sellers/i)
    if (contractSellerRow) {
      setPreservingStyle(groupContractSheet, `C${contractSellerRow}`, name)
      setPreservingStyle(groupContractSheet, `C${contractSellerRow + 1}`, english)
      setPreservingStyle(groupContractSheet, `C${contractSellerRow + 2}`, address)
      const city = seller?.addressEn?.match(/\b(Shenzhen|Dongguan|Huizhou|Heyuan|Guangzhou|Foshan|Zhongshan|Jiangmen|Xiamen|Ningbo|Shanghai|Suzhou|Wenzhou|Yiwu)\b/i)?.[1]
      setPreservingStyle(groupContractSheet, `H${contractSellerRow + 2}`, city?.toUpperCase() || '')
    }
    const signatureRow = findLabelRow(groupContractSheet, 'D', slot.contractRows[1] + 1, contractEnd, /卖方|The Sellers/i)
    if (signatureRow) setPreservingStyle(groupContractSheet, `E${signatureRow}`, combined)
    setTradeTerms(groupContractSheet, contractStart, contractEnd, seller)

    if (group.indo) {
      const invoiceToRow = findLabelRow(groupInvoiceSheet, 'B', invoiceStart, slot.invoiceRows[0] - 1, /^To[:：]?/i)
      if (invoiceToRow) {
        setPreservingStyle(groupInvoiceSheet, `B${invoiceToRow + 1}`, combined)
        setPreservingStyle(groupInvoiceSheet, `B${invoiceToRow + 2}`, address)
      }
    } else {
      const invoiceSellerRow = findLabelRow(groupInvoiceSheet, 'B', invoiceStart, slot.invoiceRows[0] - 1, /^卖方[:：]?\s*$/i)
      if (invoiceSellerRow) {
        setPreservingStyle(groupInvoiceSheet, `B${invoiceSellerRow + 2}`, name)
        setPreservingStyle(groupInvoiceSheet, `B${invoiceSellerRow + 3}`, english)
        setPreservingStyle(groupInvoiceSheet, `B${invoiceSellerRow + 4}`, address)
      }
    }
    setTradeTerms(groupInvoiceSheet, invoiceStart, invoiceEnd, seller)
    const totalAmountRow = findLabelRow(
      groupInvoiceSheet,
      'B',
      slot.invoiceRows[1],
      invoiceEnd,
      /总值大写|Total Amount/i,
    )
    if (totalAmountRow) {
      const beneficiaryRow = totalAmountRow + 1
      const beneficiaryAddressRow = totalAmountRow + 3
      setPreservingStyle(
        groupInvoiceSheet,
        `B${beneficiaryRow}`,
        isHuashengyiSeller(seller) ? HUASHENGYI_BANK_INFO : '',
      )
      setPreservingStyle(
        groupInvoiceSheet,
        `G${beneficiaryRow}`,
        isHuashengyiSeller(seller) ? HUASHENGYI_BENEFICIARY : '',
      )
      setPreservingStyle(
        groupInvoiceSheet,
        `G${beneficiaryAddressRow}`,
        isHuashengyiSeller(seller) ? HUASHENGYI_BENEFICIARY_ADDRESS : '',
      )
    }
    if (group.indo) {
      const packingHeaderRow = addressRow(packingSlot.packingHeader)
      const packingStart = Math.max(1, packingHeaderRow - 8)
      const addressParts = (seller?.addressEn || '').split(/,\s*/).filter(Boolean)
      const addressLines = ['', '']
      let secondLine = false
      for (const part of addressParts) {
        if (!secondLine && addressLines[0] && `${addressLines[0]}, ${part}`.length > 68) secondLine = true
        const target = secondLine ? 1 : 0
        addressLines[target] = addressLines[target] ? `${addressLines[target]}, ${part}` : part
      }
      setPreservingStyle(packingSheet, `A${packingStart}`, 'PT. ROYAL REGENT INDONESIA')
      setPreservingStyle(packingSheet, `A${packingStart + 1}`, 'KAWASAN INDUSTRI KENDAL, JL. WANAMARTA RAYA NO 33A & 35, BRANGSONG, BRANGSONG, KAB. KENDAL, JAWA TENGAH, 51371, INDONESIA')
      setPreservingStyle(packingSheet, `A${packingHeaderRow}`, english)
      setPreservingStyle(packingSheet, `A${packingHeaderRow + 1}`, addressLines[0])
      setPreservingStyle(packingSheet, `A${packingHeaderRow + 2}`, addressLines[1])
      setPreservingStyle(packingSheet, `A${packingHeaderRow + 3}`, seller ? `Email: ${seller.email?.trim() || ''}` : '')
      setPreservingStyle(packingSheet, `A${packingHeaderRow + 4}`, seller ? `Tel.: ${seller.phone?.trim() || ''}` : '')
      setPreservingStyle(packingSheet, `A${packingHeaderRow + 5}`, seller ? `ATTN: ${seller.contact?.trim() || ''}` : '')
    } else if (rri) {
      const packingHeaderRow = addressRow(packingSlot.packingHeader)
      const packingStart = Math.max(1, packingHeaderRow - 8)
      const industrialName = 'ROYAL REGENT PRODUCTS INDUSTRIES LIMITED'
      const industrialAddress = 'Unit 07-08,12/F,Greenfield Tower,Concordia Plaza,No.1 Science Museum Road,Tsim Sha Tsui,Kowloon,Postal Code:999077,Hong Kong'
      setPreservingStyle(packingSheet, `A${packingStart}`, industrialName)
      setPreservingStyle(packingSheet, `A${packingStart + 1}`, industrialAddress)
      setPreservingStyle(packingSheet, `A${packingHeaderRow}`, `${industrialName}\n${industrialAddress}`)
      setPreservingStyle(packingSheet, `A${packingHeaderRow + 1}`, '')
      setPreservingStyle(packingSheet, `A${packingHeaderRow + 2}`, '')
      setPreservingStyle(packingSheet, `A${packingHeaderRow + 3}`, 'TEL: 00852-2425 0720   FAX: 00852-2424 3407')
      setPreservingStyle(packingSheet, `A${packingHeaderRow + 4}`, 'EMAIL: chloe@royalregenthk.com')
      setPreservingStyle(packingSheet, `A${packingHeaderRow + 5}`, 'Attention: Ms Tang')
    }
    // 实业/全球合同保留 Royal Regent 装箱单抬头；印尼合同改用对应供应商作为 Shipper。
  }

  const applyGroup = (
    group: LinkedDocumentGroup,
    slot: Slot,
    index: number,
    documentSlots: Slot[],
    groupContractSheet: XLSX.WorkSheet | undefined,
    groupInvoiceSheet: XLSX.WorkSheet | undefined,
    packingSlot: Slot,
  ) => {
    setPreservingStyle(groupContractSheet, slot.contractHeader, group.contract || '')
    setPreservingStyle(groupContractSheet, slot.contractDate, group.contractDate ? excelDate(group.contractDate) : '')
    setPreservingStyle(groupInvoiceSheet, slot.invoiceHeader, group.invoice || '')
    setPreservingStyle(groupInvoiceSheet, slot.invoiceDate, group.invoiceDate ? excelDate(group.invoiceDate) : '')
    setPreservingStyle(groupInvoiceSheet, slot.invoiceContract, group.contract || '')
    setPreservingStyle(packingSheet, packingSlot.packingHeader, group.invoice || '')
    const packingHeaderRow = addressRow(packingSlot.packingHeader)
    setPreservingStyle(packingSheet, `D${packingHeaderRow + 2}`, group.invoiceDate ? excelDate(group.invoiceDate) : '')
    setPreservingStyle(packingSheet, `D${packingHeaderRow + 4}`, group.contract || '')
    setPreservingStyle(packingSheet, `D${packingHeaderRow + 8}`, (shipment?.containerNo || '').trim())
    setPreservingStyle(packingSheet, `H${packingHeaderRow + 8}`, (shipment?.blNo || '').trim())

    const fillContractRows = ([from, to]: number[]) => {
      for (let row = from; row <= to; row++) {
        const serial = group?.indices[row - from]
        const mainRow = serial != null ? serial + 3 : null
        setPreservingStyle(groupContractSheet, `A${row}`, serial ?? '')
        const refs: Record<string, string> = mainRow == null ? {} : {
          B: `D${mainRow}`,
          C: `G${mainRow}&'${mainName.replace(/'/g, "''")}'!F${mainRow}`,
          D: `K${mainRow}`,
          E: `J${mainRow}`,
          F: `Z${mainRow}`,
        }
        for (const col of ['B', 'C', 'D', 'E', 'F']) {
          const mainCell = refs[col]
          setPreservingStyle(groupContractSheet, `${col}${row}`, mainCell ? formulaRef(mainName, mainCell) : '', Boolean(mainCell))
        }
        setPreservingStyle(groupContractSheet, `G${row}`, mainRow == null ? '' : `=F${row}*D${row}`, mainRow != null)
        setPreservingStyle(groupContractSheet, `H${row}`, '')
      }
    }

    const fillInvoiceRows = ([from, to]: number[]) => {
      for (let row = from; row <= to; row++) {
        const serial = group?.indices[row - from]
        const mainRow = serial != null ? serial + 3 : null
        setPreservingStyle(groupInvoiceSheet, `A${row}`, serial ?? '')
        const refs: Record<string, string> = mainRow == null ? {} : {
          B: `D${mainRow}`,
          C: `G${mainRow}&'${mainName.replace(/'/g, "''")}'!F${mainRow}`,
          D: `L${mainRow}`,
          E: `M${mainRow}`,
          F: `C${mainRow}`,
          G: `K${mainRow}`,
          H: `J${mainRow}`,
          I: `Z${mainRow}`,
        }
        for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) {
          const mainCell = refs[col]
          setPreservingStyle(groupInvoiceSheet, `${col}${row}`, mainCell ? formulaRef(mainName, mainCell) : '', Boolean(mainCell))
        }
        setPreservingStyle(groupInvoiceSheet, `J${row}`, mainRow == null ? '' : `=I${row}*G${row}`, mainRow != null)
      }
    }

    const fillPackingRows = ([from, to]: number[]) => {
      for (let row = from; row <= to; row++) {
        const serial = group?.indices[row - from]
        const mainRow = serial != null ? serial + 3 : null
        setPreservingStyle(packingSheet, `A${row}`, serial ?? '')
        const refs: Record<string, string> = mainRow == null ? {} : {
          B: `D${mainRow}`,
          C: `G${mainRow}&'${mainName.replace(/'/g, "''")}'!F${mainRow}`,
          D: `K${mainRow}`,
          E: `J${mainRow}`,
          F: `L${mainRow}`,
          G: `M${mainRow}`,
          H: `P${mainRow}`,
          I: `Q${mainRow}`,
          J: `AT${mainRow}`,
          K: `S${mainRow}`,
        }
        for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
          const mainCell = refs[col]
          setPreservingStyle(packingSheet, `${col}${row}`, mainCell ? formulaRef(mainName, mainCell) : '', Boolean(mainCell))
        }
      }
    }

    fillContractRows(slot.contractRows)
    fillInvoiceRows(slot.invoiceRows)
    fillPackingRows(packingSlot.packingRows)
    fillSlotSeller(group, slot, index, documentSlots, groupContractSheet, groupInvoiceSheet, packingSlot)
  }
  let primaryIndex = 0
  let indonesiaIndex = 0
  groups.forEach((group, packingIndex) => {
    const documentSlots = group.indo ? indonesiaSlots : slots
    const documentIndex = group.indo ? indonesiaIndex++ : primaryIndex++
    applyGroup(
      group,
      documentSlots[documentIndex],
      documentIndex,
      documentSlots,
      group.indo ? indonesiaContractSheet : contractSheet,
      group.indo ? indonesiaInvoiceSheet : invoiceSheet,
      packingSlots[packingIndex],
    )
  })
  const removeSheet = (name: string) => {
    delete wb.Sheets[name]
    wb.SheetNames = wb.SheetNames.filter(sheetName => sheetName !== name)
  }
  // 新版供应商汇总已取代参考文件中的旧出货地址字典，导出文件不再携带样例供应商页。
  removeSheet('出货地址')
  const firstUnusedPrimary = slots[primaryGroups.length]
  if (!primaryGroups.length) {
    removeSheet(rri ? '实业合同' : '全球合同')
    removeSheet(rri ? '实业发票' : '全球发票')
  } else if (firstUnusedPrimary) {
    truncateSheetAtRow(contractSheet, firstUnusedPrimary.contractStart || Math.max(1, addressRow(firstUnusedPrimary.contractHeader) - 4))
    truncateSheetAtRow(invoiceSheet, firstUnusedPrimary.invoiceStart || Math.max(1, addressRow(firstUnusedPrimary.invoiceHeader) - 8))
  }
  const firstUnusedIndonesia = indonesiaSlots[indonesiaGroups.length]
  if (!indonesiaGroups.length) {
    removeSheet('印尼合同')
    removeSheet('印尼发票')
  } else if (firstUnusedIndonesia) {
    truncateSheetAtRow(indonesiaContractSheet, firstUnusedIndonesia.contractStart || Math.max(1, addressRow(firstUnusedIndonesia.contractHeader) - 4))
    truncateSheetAtRow(indonesiaInvoiceSheet, firstUnusedIndonesia.invoiceStart || Math.max(1, addressRow(firstUnusedIndonesia.invoiceHeader) - 8))
  }
  const firstUnusedPacking = packingSlots[groups.length]
  if (firstUnusedPacking) truncateSheetAtRow(packingSheet, Math.max(1, addressRow(firstUnusedPacking.packingHeader) - 8))
  const firstSeller = groups.find(group => group.seller)?.seller
  if (firstSeller) fillGenericSeller(wb, firstSeller)

  // 通用发票、销售合同、装箱单(2)和草稿大单共用同一套序号及主明细公式。
  const genericInvoiceSheet = wb.Sheets['发票']
  const genericInvoiceRange = genericInvoiceSheet?.['!ref'] ? XLSX.utils.decode_range(genericInvoiceSheet['!ref']) : null
  const genericInvoiceRows = genericInvoiceRange
    ? Array.from({ length: genericInvoiceRange.e.r + 1 }, (_, row) => row + 1)
      .filter(row => typeof (genericInvoiceSheet as any)?.[`B${row}`]?.v === 'number')
    : []
  genericInvoiceRows.forEach((row, index) => {
    const mainRow = index + 4
    const active = index < sorted.length
    setPreservingStyle(genericInvoiceSheet, `B${row}`, active ? index + 1 : '')
    const refs: Record<string, string> = {
      C: `AY${mainRow}`, D: `F${mainRow}`, E: `G${mainRow}`, F: `L${mainRow}`, G: `M${mainRow}`,
      H: `Z${mainRow}`, I: `AA${mainRow}`, J: `P${mainRow}`, K: `Q${mainRow}`, L: `AT${mainRow}`,
    }
    for (const [col, mainCell] of Object.entries(refs)) {
      setPreservingStyle(genericInvoiceSheet, `${col}${row}`, active ? formulaRef(mainName, mainCell) : '')
      if (active) setPreservingStyle(genericInvoiceSheet, `${col}${row}`, formulaRef(mainName, mainCell), true)
    }
    setPreservingStyle(genericInvoiceSheet, `M${row}`, active ? '箱' : '')
  })

  const salesSheet = wb.Sheets['销售合同']
  for (let row = 16; row <= 52; row++) setPreservingStyle(salesSheet, `A${row}`, row - 16 < sorted.length ? row - 15 : '')
  // 修复参考文件末行原有的 #REF!，使合计仍来自通用发票。
  setPreservingStyle(salesSheet, 'E52', "='发票'!F43", true)
  setPreservingStyle(salesSheet, 'F52', "='发票'!G43", true)
  setPreservingStyle(salesSheet, 'I52', "='发票'!I43", true)
  setPreservingStyle(salesSheet, 'I53', '=SUM(I16:I52)', true)

  const simplePacking = wb.Sheets['装箱单 (2)']
  for (let row = 10; row <= 46; row++) {
    const index = row - 10
    const mainRow = index + 4
    const active = index < sorted.length
    const refs: Record<string, string> = { B: `F${mainRow}`, C: `AT${mainRow}`, E: `L${mainRow}`, G: `P${mainRow}`, H: `Q${mainRow}` }
    setPreservingStyle(simplePacking, `A${row}`, active ? index + 1 : '')
    for (const [col, mainCell] of Object.entries(refs)) setPreservingStyle(simplePacking, `${col}${row}`, active ? formulaRef(mainName, mainCell) : '', active)
    setPreservingStyle(simplePacking, `D${row}`, active ? '箱' : '')
    setPreservingStyle(simplePacking, `F${row}`, active ? '件' : '')
  }

  // 参考文件的公式单元格带有上一票走货的缓存结果。辅助单据交由 Excel/WPS
  // 打开时重算，先把缓存归零，避免旧金额在重算前短暂显示或被检索出来。
  for (const sheetName of ['发票', '销售合同', '装箱单 (2)', '草稿大单-1']) {
    for (const cell of Object.values(wb.Sheets[sheetName] || {}) as any[]) {
      if (typeof cell?.f === 'string') cell.v = 0
    }
  }

  // 参考文件中未被当前导出使用的旧 LOOKUP/HSTACK 会继续指向旧柜号并产生
  // #N/A/#VALUE!；导出时必须清空，不能把样本资料带到新文件。
  for (const sheet of Object.values(wb.Sheets)) {
    for (const [address, cell] of Object.entries(sheet) as [string, any][]) {
      if (!address.startsWith('!') && typeof cell?.f === 'string' && /(?:LOOKUP|HSTACK)\s*\(/i.test(cell.f)) {
        setPreservingStyle(sheet, address, '')
      }
    }
  }
}

type DocumentGroup = { contract: string; invoice: string; indo: boolean; indices: number[] }
type DocumentGrouping = 'contract' | 'invoice'

function collectDocumentGroups(sorted: CustomsItem[], grouping: DocumentGrouping): DocumentGroup[] {
  const groups: DocumentGroup[] = []
  const byKey = new Map<string, DocumentGroup>()
  sorted.forEach((item, index) => {
    const contract = (item.contract_no || '').trim()
    const invoice = (item.invoice_no || '').trim()
    const indo = isIndonesiaBlHead(item.bl_head)
    const documentNo = grouping === 'contract' ? contract : invoice
    const key = `${documentNo}\u0000${indo ? 'ID' : 'GLOBAL'}`
    let group = byKey.get(key)
    if (!group) {
      group = { contract, invoice, indo, indices: [] }
      groups.push(group)
      byKey.set(key, group)
    }
    group.indices.push(index + 1)
  })
  return groups
}

// 旧版单模板（template-customs.xlsx）含全球/印尼两套单据，合同与发票各自分组填充。
function populateGlobalIndoLinkedDocuments(wb: XLSX.WorkBook, mainName: string, sorted: CustomsItem[]) {
  const contractGroups = collectDocumentGroups(sorted, 'contract')
  const invoiceGroups = collectDocumentGroups(sorted, 'invoice')
  const globalContractGroups = contractGroups.filter(g => !g.indo)
  const indoContractGroups = contractGroups.filter(g => g.indo)
  const globalInvoiceGroups = invoiceGroups.filter(g => !g.indo)
  const indoInvoiceGroups = invoiceGroups.filter(g => g.indo)

  const globalSlots = [
    { contractHeader: 'H5', contractRows: [24, 40], invoiceHeader: 'J9', invoiceContract: 'J13', invoiceRows: [32, 47], packingHeader: 'D9', packingRows: [24, 39] },
    { contractHeader: 'H59', contractRows: [78, 82], invoiceHeader: 'J64', invoiceContract: 'J68', invoiceRows: [85, 90], packingHeader: 'D51', packingRows: [66, 71] },
    { contractHeader: 'H101', contractRows: [120, 127], invoiceHeader: 'J103', invoiceContract: 'J107', invoiceRows: [124, 130], packingHeader: 'D84', packingRows: [99, 104] },
  ]
  const indoSlots = [
    { contractHeader: 'H7', contractRows: [26, 32], invoiceHeader: 'J10', invoiceContract: 'J14', invoiceRows: [24, 29], packingHeader: 'D117', packingRows: [132, 137] },
    { contractHeader: 'H52', contractRows: [71, 86], invoiceHeader: 'J42', invoiceContract: 'J46', invoiceRows: [56, 72], packingHeader: 'D149', packingRows: [164, 180] },
  ]
  if (globalContractGroups.length > globalSlots.length || indoContractGroups.length > indoSlots.length
    || globalInvoiceGroups.length > globalSlots.length || indoInvoiceGroups.length > indoSlots.length)
    throw new Error('此供应商的合同或发票数超过模板容量（全球 3 份、印尼 2 份），请分票导出')
  if (sorted.length > 33) throw new Error('此供应商明细超过模板通用发票的 33 行容量，请分票导出')
  // 合同、发票和装箱单明细区会在最终 OOXML 中按实际数量动态扩展，不再受模板样例行数限制。

  const fillSerials = (sheet: XLSX.WorkSheet | undefined, [from, to]: number[], group?: DocumentGroup) => {
    for (let row = from; row <= to; row++) {
      setPreservingStyle(sheet, `A${row}`, group?.indices[row - from] ?? '')
    }
  }
  const applyContractGroup = (group: DocumentGroup | undefined, slot: typeof globalSlots[number], indo: boolean) => {
    const contractSheet = wb.Sheets[indo ? '印尼合同' : '全球合同']
    setPreservingStyle(contractSheet, slot.contractHeader, group?.contract || '')
    fillSerials(contractSheet, slot.contractRows, group)
  }
  const applyInvoiceGroup = (group: DocumentGroup | undefined, slot: typeof globalSlots[number], indo: boolean) => {
    const invoiceSheet = wb.Sheets[indo ? '印尼发票' : '全球发票']
    const packingSheet = wb.Sheets['装箱单']
    setPreservingStyle(invoiceSheet, slot.invoiceHeader, group?.invoice || '')
    setPreservingStyle(invoiceSheet, slot.invoiceContract, group?.contract || '')
    setPreservingStyle(packingSheet, slot.packingHeader, group?.invoice || '')
    fillSerials(invoiceSheet, slot.invoiceRows, group)
    fillSerials(packingSheet, slot.packingRows, group)
  }
  globalSlots.forEach((slot, i) => {
    applyContractGroup(globalContractGroups[i], slot, false)
    applyInvoiceGroup(globalInvoiceGroups[i], slot, false)
  })
  indoSlots.forEach((slot, i) => {
    applyContractGroup(indoContractGroups[i], slot, true)
    applyInvoiceGroup(indoInvoiceGroups[i], slot, true)
  })

  // 通用发票、销售合同、装箱单(2)和草稿大单共用同一套序号及主明细公式。
  const invoiceSheet = wb.Sheets['发票']
  const genericInvoiceRows = [...Array.from({ length: 15 }, (_, i) => 9 + i), ...Array.from({ length: 18 }, (_, i) => 25 + i)]
  genericInvoiceRows.forEach((row, index) => {
    const mainRow = index + 4
    const active = index < sorted.length
    setPreservingStyle(invoiceSheet, `B${row}`, active ? index + 1 : '')
    const refs: Record<string, string> = {
      C: `AY${mainRow}`, D: `F${mainRow}`, E: `G${mainRow}`, F: `L${mainRow}`, G: `M${mainRow}`,
      H: `Z${mainRow}`, I: `AA${mainRow}`, J: `P${mainRow}`, K: `Q${mainRow}`, L: `AT${mainRow}`,
    }
    for (const [col, mainCell] of Object.entries(refs)) {
      setPreservingStyle(invoiceSheet, `${col}${row}`, active ? formulaRef(mainName, mainCell) : '')
      if (active) setPreservingStyle(invoiceSheet, `${col}${row}`, formulaRef(mainName, mainCell), true)
    }
    setPreservingStyle(invoiceSheet, `M${row}`, active ? '箱' : '')
  })

  const salesSheet = wb.Sheets['销售合同']
  for (let row = 16; row <= 52; row++) setPreservingStyle(salesSheet, `A${row}`, row - 16 < sorted.length ? row - 15 : '')
  // 修复参考文件末行原有的 #REF!，使合计仍来自通用发票。
  setPreservingStyle(salesSheet, 'E52', "='发票'!F43", true)
  setPreservingStyle(salesSheet, 'F52', "='发票'!G43", true)
  setPreservingStyle(salesSheet, 'I52', "='发票'!I43", true)
  setPreservingStyle(salesSheet, 'I53', '=SUM(I16:I52)', true)

  const simplePacking = wb.Sheets['装箱单 (2)']
  for (let row = 10; row <= 46; row++) {
    const index = row - 10
    const mainRow = index + 4
    const active = index < sorted.length
    const refs: Record<string, string> = { B: `F${mainRow}`, C: `AT${mainRow}`, E: `L${mainRow}`, G: `P${mainRow}`, H: `Q${mainRow}` }
    setPreservingStyle(simplePacking, `A${row}`, active ? index + 1 : '')
    for (const [col, mainCell] of Object.entries(refs)) setPreservingStyle(simplePacking, `${col}${row}`, active ? formulaRef(mainName, mainCell) : '', active)
    setPreservingStyle(simplePacking, `D${row}`, active ? '箱' : '')
    setPreservingStyle(simplePacking, `F${row}`, active ? '件' : '')
  }
}

export async function buildCustomsWorkbook(input: CustomsExportInput): Promise<Blob> {
  const { templateBuffer, items, materials, productHs, images, form } = input
  const AUX = new Set(['类别金额', '实业合同', '实业发票', '全球合同', '全球发票', '印尼合同', '印尼发票', '装箱单', '商品汇总表', '发票',
    '出货地址', '销售合同', '装箱单 (2)', '草稿大单-1', '司机资料', '单位对照', 'WpsReserved_CellImgList'])
  // cellStyles 必须开启，否则重新写入时无法沿用模板的单元格样式。
  const wbObj = XLSX.read(templateBuffer, { type: 'array', cellFormula: true, cellStyles: true })
  // 新版 RRI 参考模板本身同时含实业与印尼单据；只有不含实业合同的旧完整模板
  // 才走旧版固定坐标管线。
  const embeddedIndonesiaDocuments = Boolean(wbObj.Sheets['印尼合同'] && wbObj.Sheets['印尼发票'])
  const legacyDocuments = Boolean(embeddedIndonesiaDocuments && !wbObj.Sheets['实业合同'])
  normalizeWorkbookStyles(wbObj)
  ;(wbObj as any).Workbook = (wbObj as any).Workbook || {}
  ;(wbObj as any).Workbook.CalcPr = {
    ...((wbObj as any).Workbook.CalcPr || {}),
    calcMode: 'auto',
    fullCalcOnLoad: true,
    forceFullCalc: true,
  }
  const oldName = wbObj.SheetNames.find(n => !AUX.has(n))!
  const newName = (form.containerNo || '').trim() || oldName
  rewriteSheetReferences(wbObj, oldName, newName)
  replaceTemplateShipmentLiterals(wbObj, form, newName)
  wbObj.Sheets[newName] = wbObj.Sheets[oldName]
  if (newName !== oldName) delete wbObj.Sheets[oldName]
  wbObj.SheetNames = wbObj.SheetNames.map(n => n === oldName ? newName : n)
  const ws = wbObj.Sheets[newName]

  // RRI/RRM 模板此区域的列序不同；导出统一采用走货明细抬头与数据列序。
  const packingHeaders: Record<string, string> = {
    AU: '长\nLength', AV: '宽\nWidth', AW: '高\nHeight',
    AX: '物料编码', AY: '每箱数量', AZ: '每箱重量',
    BA: '单个毛重', BB: '单个净重', BC: '卡板', BD: '',
  }
  for (const [column, label] of Object.entries(packingHeaders)) {
    setPreservingStyle(ws, `${column}3`, label)
  }

  // 导出文件不显示模板 M3“单位可以选择”的旧式批注提示框。
  if ((ws as any).M3) delete (ws as any).M3.c

  // 模板第 4 行是首个明细行；保留每列的样式和数字格式，供新明细行复用。
  const detailFormat = Array.from({ length: 56 }, (_, c) => {
    const cell: any = (ws as any)[XLSX.utils.encode_cell({ r: 3, c })]
    return cell ? { s: writableTemplateStyle(cell.s), z: cell.z } : undefined
  })
  const formulaNameFill = cloneTemplateValue((ws as any).E3?.s?.fill)
  const templateDetailRow = cloneTemplateValue((ws['!rows'] || [])[3] || { hpt: 108.75 })

  // 不允许参考模板里的旧柜数据残留；只保留前三行表头与样式。
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue
    const pos = XLSX.utils.decode_cell(key)
    if (pos.r >= 3) delete (ws as any)[key]
  }
  // 模板样例可能有按相同值合并的旧明细行，新导出中每条明细必须独立。
  ws['!merges'] = (ws['!merges'] || []).filter(range => range.e.r < 3)

  const tf = {
    containerNo: newName,
    shipDate: form.shipDate || '',
    blNo: (form.blNo || '').trim(),
    eta: form.eta || '',
    vessel: (form.vessel || '').trim(),
    rate: Number(form.rate) || 0,
    exportCompany: (form.exportCompany || '').trim(),
    blHead: (form.blHead || '').trim(),
    freightCN: Number(form.freightCN) || 0,
    freightID: Number(form.freightID) || 0,
  }
  setCell(ws, 0, 13, tf.rate, 'n')
  setCell(ws, 0, 25, '')
  setCell(ws, 1, 27, '')

  // 报关公司分组（华胜益置顶），同组内按供应商相邻
  const matOf = (it: CustomsItem) => (it.material_id != null ? materials.get(it.material_id) : undefined)
  const effCustoms = (it: CustomsItem) => {
    const m = matOf(it)
    // 供应商不是报关公司，不能在报关公司留空时拿来代替。
    // 无明确报关公司的旧数据按华胜益处理，以便套用华胜益的发票单价公式。
    return effectiveCustomsCompany(it, m, tf.exportCompany)
  }
  const supplierOf = (it: CustomsItem) => (it.supplier || matOf(it)?.supplier || '').trim()
  const sorted = [...items].sort((a, b) => {
    const ca = effCustoms(a), cb = effCustoms(b)
    const wa = ca === CUSTOMS_FIXED ? 0 : (ca ? 1 : 2)
    const wb = cb === CUSTOMS_FIXED ? 0 : (cb ? 1 : 2)
    if (wa !== wb) return wa - wb
    const byC = ca.localeCompare(cb, 'zh')
    if (byC !== 0) return byC
    return supplierOf(a).localeCompare(supplierOf(b), 'zh')
  })
  const companyColor = new Map<string, string>()
  for (const item of sorted) {
    const company = effCustoms(item)
    if (company && !companyColor.has(company)) {
      companyColor.set(company, CUSTOMS_COMPANY_COLORS[companyColor.size % CUSTOMS_COMPANY_COLORS.length])
    }
  }

  const sellerForItem = input.seller
    ? () => input.seller
    : input.supplierProfiles
      ? (item: CustomsItem) => isIndonesiaBlHead(item.bl_head)
        ? supplierForLine(item.supplier || matOf(item)?.supplier || '', input.supplierProfiles!)
        : documentSellerForLine(
          item.supplier || matOf(item)?.supplier || '',
          effCustoms(item),
          input.supplierProfiles!,
        )
      : undefined
  const linkedDocumentGroups = legacyDocuments ? [] : collectLinkedDocumentGroups(sorted, sellerForItem)

  if (!legacyDocuments && !embeddedIndonesiaDocuments && sorted.some(item => isIndonesiaBlHead(item.bl_head))) {
    if (!input.indonesiaTemplateBuffer) throw new Error('缺少印尼合同/印尼发票模板')
    attachIndonesiaDocumentSheets(wbObj, input.indonesiaTemplateBuffer, newName)
  }

  // 旧版单模板（含印尼合同/发票）走供应商单据管线：卖方资料、贸易术语、
  // RRI 主体替换和 OOXML 动态扩行都基于该模板；RRI/RRM 模板走统一栏位管线。
  if (!input.mainOnly) {
    if (legacyDocuments) {
      populateGlobalIndoLinkedDocuments(wbObj, newName, sorted)
      if (input.seller) {
        fillSeller(wbObj, input.seller)
        applySellerTradeTerms(wbObj, input.seller)
      }
      applyCustomerDocumentEntity(wbObj, form.customer)
    } else {
      populateLinkedDocuments(wbObj, newName, sorted, form.customer, sellerForItem, form)
    }
  }
  fitCategoryColumn(wbObj)
  compactMainColumns(ws)

  const floatImages: { rowZeroIdx: number; bytes: Uint8Array; ext: string }[] = []
  sorted.forEach((it, i) => {
    const m = matOf(it)
    const ri = 3 + i
    if (it.material_id != null && images.has(it.material_id)) {
      const img = images.get(it.material_id)!
      floatImages.push({ rowZeroIdx: ri, bytes: img.bytes, ext: img.ext })
    }
    const phs = m?.product_code ? productHs.get(m.product_code) : undefined
    setCell(ws, ri, 0, i + 1, 'n')
    setCell(ws, ri, 1, m?.hs_cn || phs?.hsCN || '', 's')
    setCell(ws, ri, 2, m?.hs_id || phs?.hsID || '', 's')
    setCell(ws, ri, 3, m?.product_code || '', 's')
    setCell(ws, ri, 4, customsFormulaName(it, m, effCustoms(it)), 's')
    setCell(ws, ri, 5, m?.name_zh || '', 's')
    setCell(ws, ri, 6, m?.name_en || '', 's')
    setCell(ws, ri, 7, m?.spec || '', 's')
    setCell(ws, ri, 8, m?.category || '', 's')
    setCell(ws, ri, 9, m?.unit_kg || 'KGM', 's')
    setCell(ws, ri, 10, it.kg || 0, 'n')
    setCell(ws, ri, 11, it.qty || 0, 'n')
    const paperRope = isPaperRope(m?.name_zh)
    setCell(ws, ri, 12, it.purchase_unit || (paperRope ? '米' : '个'), 's')
    setCell(ws, ri, 13, '=AO' + (ri + 1) + '/$N$1', 'n')
    setCell(ws, ri, 14, '=N' + (ri + 1) + '*L' + (ri + 1), 'n')
    const weightDivisor = paperRope ? '/1000' : ''
    setCell(ws, ri, 15, '=ROUND(BA' + (ri + 1) + '*L' + (ri + 1) + weightDivisor + ',2)', 'n')
    setCell(ws, ri, 16, '=ROUND(BB' + (ri + 1) + '*L' + (ri + 1) + weightDivisor + ',2)', 'n')
    setCell(ws, ri, 17, '=AU' + (ri + 1) + '*AV' + (ri + 1) + '*AW' + (ri + 1) + '/1000000', 'n')
    setCell(ws, ri, 18, '=R' + (ri + 1) + '*AT' + (ri + 1), 'n')
    setCell(ws, ri, 20, it.product_use || '', 's')
    setCell(ws, ri, 21, it.contract_no || '', 's')
    if (it.contract_date) setCell(ws, ri, 22, excelDate(it.contract_date), 'n')
    setCell(ws, ri, 23, it.invoice_no || '', 's')
    if (it.invoice_date) setCell(ws, ri, 24, excelDate(it.invoice_date), 'n')
    const customsCompany = effCustoms(it)
    const isLastCompanyItem = i === sorted.length - 1 || effCustoms(sorted[i + 1]) !== customsCompany
    const invoicePrice = customsInvoicePrice(it.price, customsCompany, it.kg, isLastCompanyItem)
    setCell(ws, ri, 25, invoicePrice, 'n')
    ws[XLSX.utils.encode_cell({ r: ri, c: 25 })].f = !customsCompany.includes('华胜益')
      ? `AO${ri + 1}`
      : isLastCompanyItem
        ? `IFERROR((AO${ri + 1}*1.05+1248/K${ri + 1})/7.2,AO${ri + 1}*1.05/7.2)`
        : `AO${ri + 1}*1.05/7.2`
    // 发票金额 = 发票单价 × 送货 KG 重量。
    setCell(ws, ri, 26, '=Z' + (ri + 1) + '*K' + (ri + 1), 'n')
    setCell(ws, ri, 28, tf.containerNo, 's')
    if (tf.shipDate) setCell(ws, ri, 29, excelDate(tf.shipDate), 'n')
    setCell(ws, ri, 30, tf.blNo, 's')
    if (tf.eta) setCell(ws, ri, 31, excelDate(tf.eta), 'n')
    setCell(ws, ri, 33, tf.vessel, 's')
    setCell(ws, ri, 34, tf.freightCN, 'n')
    setCell(ws, ri, 35, tf.freightID, 'n')
    setCell(ws, ri, 37, it.supplier || m?.supplier || '', 's')
    if (it.po_date) setCell(ws, ri, 38, excelDate(it.po_date), 'n')
    else if (it.contract_date) setCell(ws, ri, 38, excelDate(it.contract_date), 'n')
    setCell(ws, ri, 39, it.po_no || '', 's')
    setCell(ws, ri, 40, it.price || 0, 'n')
    // 采购金额 = 采购单价 × 送货 KG 重量。
    setCell(ws, ri, 41, '=AO' + (ri + 1) + '*K' + (ri + 1), 'n')
    const fmt = purchaseCurrencyFormat(it.currency)
    ;['AO', 'AP'].forEach((_col, j) => {
      const addr = XLSX.utils.encode_cell({ r: ri, c: 40 + j })
      if ((ws as any)[addr]) (ws as any)[addr].z = fmt
    })
    setCell(ws, ri, 43, effCustoms(it) || tf.exportCompany, 's')
    setCell(ws, ri, 44, it.bl_head || tf.blHead, 's')
    setCell(ws, ri, 45, it.cartons || 0, 'n')
    const qpc = it.qty_per_carton ?? 0
    setCell(ws, ri, 46, m?.length || 0, 'n')
    setCell(ws, ri, 47, m?.width || 0, 'n')
    setCell(ws, ri, 48, m?.height || 0, 'n')
    setCell(ws, ri, 49, m?.material_code || '', 's')
    setCell(ws, ri, 50, qpc, (typeof qpc === 'string' && /[^\d.]/.test(qpc)) ? 's' : 'n')
    setCell(ws, ri, 51, m?.weight_per_carton || 0, 'n')
    const weighingQty = it.weighing_qty ?? shipmentWeightQuantity(m?.name_zh, shipmentPackingAverageQty(qpc))
    setCell(ws, ri, 52, shipmentGrossPerPc(m?.weight_per_carton, weighingQty), 'n')
    ws[XLSX.utils.encode_cell({ r: ri, c: 52 })].f = `IFERROR(IF(AZ${ri + 1}>0,AZ${ri + 1}/${Number(weighingQty) || 0},0),0)`
    setCell(ws, ri, 53, m?.net_per_pc || 0, 'n')
    setCell(ws, ri, 54, it.pallet || '', 's')
  })

  // 合计不再跨行合并：合并单元格会吞掉明细行之间的横向边框。
  // 将不连续的明细行压缩成 SUM 可接受的单元格/区间引用。
  const groupedSumFormula = (column: string, indexes: number[]) => {
    const rows = indexes.map(index => index + 4)
    const references: string[] = []
    for (let start = 0; start < rows.length;) {
      let end = start
      while (end + 1 < rows.length && rows[end + 1] === rows[end] + 1) end++
      references.push(start === end ? `${column}${rows[start]}` : `${column}${rows[start]}:${column}${rows[end]}`)
      start = end + 1
    }
    return `=SUM(${references.join(',')})`
  }

  // 发票金额合计优先按合同号汇总；没有合同号时按报关公司汇总。
  // 同一分组只在第一次出现的行显示一次合计。
  const invoiceGroups = new Map<string, number[]>()
  sorted.forEach((item, index) => {
    setCell(ws, index + 3, 27, '')
    const contractNo = String(item.contract_no || '').trim()
    const key = contractNo ? `contract:${contractNo}` : `customs:${effCustoms(item) || tf.exportCompany}`
    const indexes = invoiceGroups.get(key) || []
    indexes.push(index)
    invoiceGroups.set(key, indexes)
  })
  for (const indexes of invoiceGroups.values()) {
    setCell(ws, indexes[0] + 3, 27, groupedSumFormula('AA', indexes), 'n')
  }

  // 采购总额按供应商汇总，而不是跟随报关公司分组。同一供应商即使分布在
  // 不同报关公司段，也只在第一次出现的行显示一次合计。
  const supplierGroups = new Map<string, number[]>()
  sorted.forEach((item, index) => {
    setCell(ws, index + 3, 42, '')
    const supplier = supplierOf(item)
    const key = supplier || `__blank_supplier_${index}`
    const indexes = supplierGroups.get(key) || []
    indexes.push(index)
    supplierGroups.set(key, indexes)
  })
  for (const indexes of supplierGroups.values()) {
    const firstIndex = indexes[0]
    setCell(ws, firstIndex + 3, 42, groupedSumFormula('AP', indexes), 'n')
    ;(ws as any)[XLSX.utils.encode_cell({ r: firstIndex + 3, c: 42 })].z = purchaseCurrencyFormat(sorted[firstIndex].currency)
  }
  if (sorted.length) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 3 + sorted.length - 1, c: 55 } })

  // xlsx-js-style 读取旧模板时只能还原填充色和数字格式，因此需补回
  // 模板的字体、对齐、换行和边框，否则表头会被压缩且文字串列。
  const thinBorder = { style: 'thin', color: { rgb: '999999' } }
  const border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder }
  const headerBaseStyle = {
    font: { name: 'Microsoft YaHei', sz: 10, bold: true, color: { rgb: '1A1A2E' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border,
  }
  const detailBaseStyle = {
    font: { name: 'Microsoft YaHei', sz: 10, color: { rgb: '1A1A2E' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border,
  }
  for (let c = 0; c < 56; c++) {
    const addr = XLSX.utils.encode_cell({ r: 2, c })
    const cell: any = (ws as any)[addr] || { v: '', t: 's' }
    const fill = cell.s?.fill
    cell.s = { ...headerBaseStyle, ...(fill ? { fill: cloneTemplateValue(fill) } : {}) }
    ;(ws as any)[addr] = cell
  }

  // 每个明细单元格沿用模板第 4 行的对应列填充色和数字格式。
  for (let i = 0; i < sorted.length; i++) {
    const ri = 3 + i
    const color = companyColor.get(effCustoms(sorted[i]))
    for (let c = 0; c < 56; c++) {
      const addr = XLSX.utils.encode_cell({ r: ri, c })
      if (!(ws as any)[addr]) (ws as any)[addr] = { v: '', t: 's' }
      const format = detailFormat[c]
      const templateFill = c === 4 && formulaNameFill ? formulaNameFill : format?.s?.fill
      ;(ws as any)[addr].s = {
        ...detailBaseStyle,
        ...(templateFill ? { fill: cloneTemplateValue(templateFill) } : {}),
      }
      if (!(ws as any)[addr].z && format?.z) (ws as any)[addr].z = format.z
      // 发票合计(AB)和采购总额(AQ)原模板按分组跨行合并，模板样式没有内部横线。
      // 取消合并后为每一格明确补齐四边，避免相邻明细之间仍然断线。
      if (c === 27 || c === 42) {
        ;(ws as any)[addr].s = {
          ...((ws as any)[addr].s || {}),
          border: {
            top: { style: 'thin', color: { rgb: '000000' } },
            bottom: { style: 'thin', color: { rgb: '000000' } },
            left: { style: 'thin', color: { rgb: '000000' } },
            right: { style: 'thin', color: { rgb: '000000' } },
          },
        }
      }
      if (color && c !== 4) {
        ;(ws as any)[addr].s = {
          ...((ws as any)[addr].s || {}),
          fill: { patternType: 'solid', fgColor: { rgb: color } },
        }
      }
    }
  }

  // 主明细底部动态合计：L=送货数量、P=毛重总重、Q=净重总重、S=总 CBM、AT=总箱数。
  // 合计行紧跟实际数据，避免模板固定行数造成漏算或把空白行纳入范围。
  const mainTotalRow = sorted.length ? sorted.length + 5 : undefined
  if (mainTotalRow) {
    const totalRi = mainTotalRow - 1
    const firstDataRow = 4
    const lastDataRow = mainTotalRow - 2
    // 合计区要和上方明细保持同宽的连续网格。只给有数值的单元格加边框会形成
    // 分散的小方框，在 Excel/WPS 中看起来像导出表格断线。先创建整行空单元格并补齐四边，
    // 再写入需要的合计值。上一行仍然留空，保留用户要求的一行间隔。
    for (let c = 0; c < 56; c++) {
      const addr = XLSX.utils.encode_cell({ r: totalRi, c })
      const cell: any = (ws as any)[addr] || { v: '', t: 's' }
      cell.s = {
        font: { name: 'Microsoft YaHei', sz: 10, color: { rgb: '1A1A2E' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border,
      }
      ;(ws as any)[addr] = cell
    }
    setCell(ws, totalRi, 0, '合计', 's')
    for (const column of ['L', 'P', 'Q', 'S', 'AT']) {
      const columnIndex = XLSX.utils.decode_col(column)
      setCell(ws, totalRi, columnIndex, `=SUM(${column}${firstDataRow}:${column}${lastDataRow})`, 'n')
      const cell: any = (ws as any)[`${column}${mainTotalRow}`]
      cell.z = column === 'S' ? '0.0000' : column === 'AT' ? '0' : '0.00'
      cell.s = {
        ...cell.s,
        font: { name: 'Microsoft YaHei', sz: 10, bold: true, color: { rgb: '1A1A2E' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border,
      }
    }
    const labelCell: any = (ws as any)[`A${mainTotalRow}`]
    labelCell.s = {
      ...labelCell.s,
      font: { name: 'Microsoft YaHei', sz: 10, bold: true, color: { rgb: '1A1A2E' } },
      fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border,
    }
  }


  // 按字段用途强制数字格式，避免模板样例行的货币格式串列。
  const fixedFormats: Record<number, string> = {
    0: '0', 10: '0.0000', 11: '0.0000', 13: '"HK$"#,##0.0000', 14: '"HK$"#,##0.0000',
    15: '0.00', 16: '0.00', 17: '0.0000', 18: '0.0000',
    22: 'yyyy/m/d', 24: 'yyyy/m/d', 25: '"US$"#,##0.0000', 26: '"US$"#,##0.0000',
    27: '"US$"#,##0.0000', 29: 'yyyy/m/d', 31: 'yyyy/m/d', 38: 'yyyy/m/d',
    45: '0', 46: '0.0000', 47: '0.0000', 48: '0.0000', 50: '0',
    51: '0.0000', 52: '0.00000', 53: '0.00000',
  }
  for (let i = 0; i < sorted.length; i++) {
    for (const [column, format] of Object.entries(fixedFormats)) {
      const cell: any = (ws as any)[XLSX.utils.encode_cell({ r: i + 3, c: Number(column) })]
      if (cell) cell.z = format
    }
  }

  // 列宽、隐藏列和明细行高沿用模板；缩短顶部两行空白区域。
  const rows: any[] = ws['!rows'] || []
  rows[0] = { ...(rows[0] || {}), hpt: 24, hpx: 24 }
  rows[1] = { ...(rows[1] || {}), hpt: 24, hpx: 24 }
  for (let i = 0; i < sorted.length; i++) rows[3 + i] = cloneTemplateValue(templateDetailRow)
  if (mainTotalRow) {
    rows[mainTotalRow - 2] = { hpt: 24 }
    rows[mainTotalRow - 1] = { hpt: 24 }
  }
  ws['!rows'] = rows
  ws['!autofilter'] = { ref: `A3:BD${Math.max(3, sorted.length + 3)}` }
  if (mainTotalRow) ws['!ref'] = `A1:BD${mainTotalRow}`

  if (input.mainOnly) {
    wbObj.SheetNames = [newName]
    for (const sheet of Object.keys(wbObj.Sheets)) if (sheet !== newName) delete wbObj.Sheets[sheet]
  }
  const out = XLSX.write(wbObj, { type: 'array', bookType: 'xlsx' })
  const generatedZip = await JSZip.loadAsync(out)
  let outZip: JSZip
  if (input.mainOnly) {
    outZip = generatedZip
  } else if (legacyDocuments) {
    // xlsx-js-style 会重建 styles.xml，导致原模板的字体、边框和填充色错位（部分 Office/WPS
    // 客户端会把合同页显示成整片黑底）。正式单据必须以原模板压缩包为底稿，仅把生成后的
    // 单元格内容和公式合并进去，才能完整保留模板版式和打印设置。
    outZip = await mergeGeneratedValuesIntoTemplate(templateBuffer, generatedZip, wbObj.SheetNames, mainTotalRow)
    await resizeLinkedDocumentTables(outZip, newName, sorted)
  } else {
    outZip = generatedZip
    await restoreTemplateDocumentStyles(templateBuffer, outZip, oldName, newName, sorted.map(effCustoms), sorted.map(item => item.currency || '¥'))
    if (!embeddedIndonesiaDocuments && input.indonesiaTemplateBuffer && sorted.some(item => isIndonesiaBlHead(item.bl_head))) {
      await restoreIndonesiaDocumentStyles(input.indonesiaTemplateBuffer, outZip)
    }
    await resizeModernLinkedDocumentTables(outZip, newName, linkedDocumentGroups, String(form.customer || '').toUpperCase().includes('RRI'))
  }
  await ensureMainTableGrid(outZip, newName, mainTotalRow)
  if (floatImages.length) {
    const mainSheetIdx = wbObj.SheetNames.indexOf(newName) + 1
    await injectOoxmlImages(outZip, mainSheetIdx, floatImages)
  }
  return await outZip.generateAsync({ type: 'blob' })
}

async function workbookSheetParts(zip: JSZip): Promise<Map<string, string>> {
  const parser = new DOMParser()
  const workbook = parser.parseFromString((await zip.file('xl/workbook.xml')!.async('string')).replace(/^\uFEFF/, ''), 'application/xml')
  const rels = parser.parseFromString((await zip.file('xl/_rels/workbook.xml.rels')!.async('string')).replace(/^\uFEFF/, ''), 'application/xml')
  const relationshipNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const officeRelationshipNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const relationshipNodes = Array.from(rels.getElementsByTagNameNS(relationshipNs, 'Relationship'))
  const targets = new Map(relationshipNodes.map(rel => [rel.getAttribute('Id') || '', rel.getAttribute('Target') || '']))
  const parts = new Map<string, string>()
  for (const sheet of Array.from(workbook.getElementsByTagNameNS(SPREADSHEET_NS, 'sheet'))) {
    const target = targets.get(sheet.getAttributeNS(officeRelationshipNs, 'id') || sheet.getAttribute('r:id') || '')
    if (target) parts.set(sheet.getAttribute('name') || '', `xl/${target.replace(/^\/?xl\//, '')}`)
  }
  return parts
}

// xlsx-js-style 会在读取时丢失复杂模板的字体、边框和对齐。写完数据后直接
// 恢复原模板 OOXML 样式表，并让新明细按报关公司轮用模板中的分组底色。
async function restoreTemplateDocumentStyles(
  templateBuffer: ArrayBuffer,
  outputZip: JSZip,
  oldMainName: string,
  newMainName: string,
  outputCompanies: string[],
  outputCurrencies: string[],
) {
  const templateZip = await JSZip.loadAsync(templateBuffer)
  const parser = new DOMParser()
  const serializer = new XMLSerializer()
  const rawStyles = parser.parseFromString(await templateZip.file('xl/styles.xml')!.async('string'), 'application/xml')
  const rawXfs = rawStyles.getElementsByTagName('cellXfs')[0]
  const xfNodes = Array.from(rawXfs.getElementsByTagName('xf'))
  const rawFonts = rawStyles.getElementsByTagName('fonts')[0]
  const fontNodes = Array.from(rawFonts.getElementsByTagName('font'))
  const currencyNumFmt = new Map<string, string>()
  for (const node of Array.from(rawStyles.getElementsByTagName('numFmt'))) {
    const code = node.getAttribute('formatCode') || ''
    if (code.includes('US$') && code.includes('0.0000')) currencyNumFmt.set('US$', node.getAttribute('numFmtId') || '197')
    if (code.includes('HK$') && code.includes('0.000')) currencyNumFmt.set('HK$', node.getAttribute('numFmtId') || '178')
  }
  const derivedStyles = new Map<string, string>()
  const derivedFonts = new Map<string, string>()
  const styleForCurrency = (baseStyle: string, currency: string) => {
    const numFmtId = currencyNumFmt.get(currency)
    if (!numFmtId) return baseStyle
    const key = `${baseStyle}|${numFmtId}`
    const cached = derivedStyles.get(key)
    if (cached) return cached
    const base = xfNodes[Number(baseStyle)] || xfNodes[0]
    const copy = rawStyles.importNode(base, true) as typeof base
    copy.setAttribute('numFmtId', numFmtId)
    copy.setAttribute('applyNumberFormat', '1')
    const styleId = String(xfNodes.length + derivedStyles.size)
    rawXfs.appendChild(copy)
    derivedStyles.set(key, styleId)
    return styleId
  }
  const styleWithFill = (baseStyle: string, fillStyle: string) => {
    const fillId = xfNodes[Number(fillStyle)]?.getAttribute('fillId')
    if (!fillId) return baseStyle
    const key = `${baseStyle}|fill:${fillId}`
    const cached = derivedStyles.get(key)
    if (cached) return cached
    const base = xfNodes[Number(baseStyle)] || xfNodes[0]
    const copy = rawStyles.importNode(base, true) as typeof base
    copy.setAttribute('fillId', fillId)
    copy.setAttribute('applyFill', '1')
    const styleId = String(xfNodes.length + derivedStyles.size)
    rawXfs.appendChild(copy)
    derivedStyles.set(key, styleId)
    return styleId
  }
  const styleWithFontSize = (baseStyle: string, size: number) => {
    const key = `${baseStyle}|font-size:${size}`
    const cached = derivedStyles.get(key)
    if (cached) return cached
    const base = xfNodes[Number(baseStyle)] || xfNodes[0]
    const baseFontId = Number(base.getAttribute('fontId') || 0)
    const fontKey = `${baseFontId}|size:${size}`
    let fontId = derivedFonts.get(fontKey)
    if (!fontId) {
      const font = rawStyles.importNode(fontNodes[baseFontId] || fontNodes[0], true) as XmlElement
      let sizeNode = Array.from(font.childNodes).find(node => (node as XmlElement).localName === 'sz') as XmlElement | undefined
      if (!sizeNode) {
        sizeNode = rawStyles.createElementNS(SPREADSHEET_NS, 'sz') as XmlElement
        font.appendChild(sizeNode)
      }
      sizeNode.setAttribute('val', String(size))
      rawFonts.appendChild(font)
      fontId = String(fontNodes.length + derivedFonts.size)
      derivedFonts.set(fontKey, fontId)
    }
    const copy = rawStyles.importNode(base, true) as typeof base
    copy.setAttribute('fontId', fontId)
    copy.setAttribute('applyFont', '1')
    const styleId = String(xfNodes.length + derivedStyles.size)
    rawXfs.appendChild(copy)
    derivedStyles.set(key, styleId)
    return styleId
  }
  const rawTheme = templateZip.file('xl/theme/theme1.xml')
  if (rawTheme) outputZip.file('xl/theme/theme1.xml', await rawTheme.async('uint8array'))

  const rawParts = await workbookSheetParts(templateZip)
  const outParts = await workbookSheetParts(outputZip)
  const rawMainPath = rawParts.get(oldMainName)
  const rawMainFile = rawMainPath ? templateZip.file(rawMainPath) : null
  const rawMainDoc = rawMainFile ? parser.parseFromString(await rawMainFile.async('string'), 'application/xml') : null
  const rawMainStyles = new Map(Array.from(rawMainDoc?.getElementsByTagName('c') || []).map(cell => [cell.getAttribute('r') || '', cell.getAttribute('s') || '0']))
  const colorRows: number[] = []
  const seenRowStyles = new Set<string>()
  for (const cell of Array.from(rawMainDoc?.getElementsByTagName('c') || [])) {
    const match = /^A(\d+)$/.exec(cell.getAttribute('r') || '')
    if (!match || Number(match[1]) < 4) continue
    const style = cell.getAttribute('s') || '0'
    const fillId = xfNodes[Number(style)]?.getAttribute('fillId') || style
    if (!seenRowStyles.has(fillId)) {
      seenRowStyles.add(fillId)
      colorRows.push(Number(match[1]))
    }
  }
  if (!colorRows.length) colorRows.push(4)
  const companyRows = new Map<string, number>()
  for (const company of outputCompanies) {
    if (!companyRows.has(company)) companyRows.set(company, colorRows[companyRows.size % colorRows.length])
  }

  for (const [outputName, outputPath] of outParts) {
    const sourceName = outputName === newMainName ? oldMainName : outputName
    const sourcePath = rawParts.get(sourceName)
    const sourceFile = sourcePath ? templateZip.file(sourcePath) : null
    const outputFile = outputZip.file(outputPath)
    if (!sourceFile || !outputFile) continue
    const sourceDoc = parser.parseFromString(await sourceFile.async('string'), 'application/xml')
    const styles = new Map(Array.from(sourceDoc.getElementsByTagName('c')).map(cell => [cell.getAttribute('r') || '', cell.getAttribute('s') || '0']))
    const outputDoc = parser.parseFromString(await outputFile.async('string'), 'application/xml')
    for (const cell of Array.from(outputDoc.getElementsByTagName('c'))) {
      const address = cell.getAttribute('r') || ''
      let rawStyle = styles.get(address)
      if (outputName === newMainName) {
        const match = /^([A-Z]+)(\d+)$/.exec(address)
        if (match && Number(match[2]) >= 4) {
          const sourceRow = companyRows.get(outputCompanies[Number(match[2]) - 4] || '') || colorRows[0]
          // 模板 AQ（采购总额）曾误设为人民币；与 AP 一样使用采购币种格式，
          // 美金数据必须显示 US$，不能再显示 ¥。
          const sourceColumn = match[1]
          rawStyle = rawMainStyles.get(`${sourceColumn}${sourceRow}`) ?? rawMainStyles.get(`${sourceColumn}4`)
          if (rawStyle && match[1] === 'E') rawStyle = styleWithFill(rawStyle, rawMainStyles.get('E3') || rawStyle)
          if (rawStyle && ['Z', 'AA', 'AB'].includes(match[1])) rawStyle = styleForCurrency(rawStyle, 'US$')
          if (rawStyle && ['AO', 'AP', 'AQ'].includes(match[1])) {
            rawStyle = styleForCurrency(rawStyle, outputCurrencies[Number(match[2]) - 4] || '¥')
          }
          if (rawStyle && match[1] === 'AR') rawStyle = styleWithFontSize(rawStyle, 12)
          if (rawStyle && match[1] === 'BB') {
            rawStyle = styleWithFill(rawStyle, rawMainStyles.get(`A${sourceRow}`) || rawStyle)
          }
        }
      }
      cell.setAttribute('s', rawStyle ?? '0')
    }
    outputZip.file(outputPath, serializer.serializeToString(outputDoc))
  }
  rawFonts.setAttribute('count', String(fontNodes.length + derivedFonts.size))
  rawXfs.setAttribute('count', String(xfNodes.length + derivedStyles.size))
  outputZip.file('xl/styles.xml', serializer.serializeToString(rawStyles))
}

// 模板的发票合计、采购总额等列原来使用跨行合并，其样式本身没有内部横线。
// 即使生成阶段补过边框，恢复模板样式时仍会把它们覆盖掉。这里在所有样式恢复完成后，
// 从 OOXML 层为全部明细行与合计行的 A:BD 每个单元格补齐四边；中间间隔行保持空白。
async function ensureMainTableGrid(zip: JSZip, mainName: string, totalRow?: number) {
  if (!totalRow) return
  const [stylesFile, parts] = [zip.file('xl/styles.xml'), await workbookSheetParts(zip)]
  const sheetPath = parts.get(mainName)
  const sheetFile = sheetPath ? zip.file(sheetPath) : null
  if (!stylesFile || !sheetPath || !sheetFile) return

  const parser = new DOMParser()
  const serializer = new XMLSerializer()
  const stylesDoc = parser.parseFromString(await stylesFile.async('string'), 'application/xml')
  const sheetDoc = parser.parseFromString(await sheetFile.async('string'), 'application/xml')
  const styleRoot = stylesDoc.documentElement as XmlElement
  const sheetRoot = sheetDoc.documentElement as XmlElement
  const xfs = styleCollection(styleRoot, 'cellXfs')
  const borders = styleCollection(styleRoot, 'borders')
  const sheetData = directChild(sheetRoot, 'sheetData')
  if (!xfs || !borders || !sheetData) return

  const gridBorder = stylesDoc.createElementNS(SPREADSHEET_NS, 'border') as XmlElement
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    const side = stylesDoc.createElementNS(SPREADSHEET_NS, edge) as XmlElement
    side.setAttribute('style', 'thin')
    const color = stylesDoc.createElementNS(SPREADSHEET_NS, 'color') as XmlElement
    color.setAttribute('rgb', 'FF999999')
    side.appendChild(color)
    gridBorder.appendChild(side)
  }
  gridBorder.appendChild(stylesDoc.createElementNS(SPREADSHEET_NS, 'diagonal'))
  borders.appendChild(gridBorder)
  const gridBorderId = String(directChildren(borders, 'border').length - 1)
  borders.setAttribute('count', String(directChildren(borders, 'border').length))

  const xfList = directChildren(xfs, 'xf')
  const borderedStyles = new Map<string, string>()
  const targetRows = [...Array.from({ length: Math.max(0, totalRow - 5) }, (_, index) => index + 4), totalRow]
  for (const targetRow of targetRows) {
    let row = directChildren(sheetData, 'row').find(candidate => rowNumber(candidate) === targetRow)
    if (!row) {
      row = sheetDoc.createElementNS(SPREADSHEET_NS, 'row') as XmlElement
      row.setAttribute('r', String(targetRow))
      const following = directChildren(sheetData, 'row').find(candidate => rowNumber(candidate) > targetRow)
      if (following) sheetData.insertBefore(row, following)
      else sheetData.appendChild(row)
    }
    const cells = new Map(directChildren(row, 'c').map(cell => [cell.getAttribute('r') || '', cell]))
    for (let columnIndex = 0; columnIndex < 56; columnIndex++) {
      const address = `${XLSX.utils.encode_col(columnIndex)}${targetRow}`
      let cell = cells.get(address)
      if (!cell) {
        cell = sheetDoc.createElementNS(SPREADSHEET_NS, 'c') as XmlElement
        cell.setAttribute('r', address)
        const following = directChildren(row, 'c').find(existing => {
          const existingColumn = XLSX.utils.decode_col(cellColumn(existing.getAttribute('r') || 'A'))
          return existingColumn > columnIndex
        })
        if (following) row.insertBefore(cell, following)
        else row.appendChild(cell)
        cells.set(address, cell)
      }
      const baseStyleId = cell.getAttribute('s') || '0'
      const clearFill = targetRow === totalRow
      const styleKey = `${baseStyleId}|${clearFill ? 'no-fill' : 'keep-fill'}`
      let borderedStyleId = borderedStyles.get(styleKey)
      if (!borderedStyleId) {
        const baseXf = xfList[Number(baseStyleId)] || xfList[0]
        if (!baseXf) continue
        const xf = baseXf.cloneNode(true) as XmlElement
        xf.setAttribute('borderId', gridBorderId)
        xf.setAttribute('applyBorder', '1')
        // 合计行保留数字格式和对齐方式，但使用 Excel 的“无填充”，
        // 避免模板原有的黄色/绿色背景覆盖导出结果。
        if (clearFill) {
          xf.setAttribute('fillId', '0')
          xf.setAttribute('applyFill', '1')
        }
        xfs.appendChild(xf)
        borderedStyleId = String(directChildren(xfs, 'xf').length - 1)
        borderedStyles.set(styleKey, borderedStyleId)
      }
      cell.setAttribute('s', borderedStyleId)
    }
  }
  xfs.setAttribute('count', String(directChildren(xfs, 'xf').length))
  zip.file('xl/styles.xml', serializer.serializeToString(stylesDoc))
  zip.file(sheetPath, serializer.serializeToString(sheetDoc))
}

// “印尼合同/印尼发票”来自旧版完整模板，而 RRI/RRM 主模板拥有另一套样式编号。
// 将旧模板实际使用的样式追加到当前样式表，并用旧工作表版式承载生成后的内容，
// 才能同时保住两套单据的字体、边框、行高、合并单元格和打印区域。
async function restoreIndonesiaDocumentStyles(indonesiaTemplateBuffer: ArrayBuffer, outputZip: JSZip) {
  const sourceZip = await JSZip.loadAsync(indonesiaTemplateBuffer)
  const sourceStylesFile = sourceZip.file('xl/styles.xml')
  const outputStylesFile = outputZip.file('xl/styles.xml')
  if (!sourceStylesFile || !outputStylesFile) return

  const parser = new DOMParser()
  const serializer = new XMLSerializer()
  const sourceStylesDoc = parser.parseFromString(await sourceStylesFile.async('string'), 'application/xml')
  const outputStylesDoc = parser.parseFromString(await outputStylesFile.async('string'), 'application/xml')
  const sourceRoot = sourceStylesDoc.documentElement as XmlElement
  const outputRoot = outputStylesDoc.documentElement as XmlElement
  const sourceXfs = styleCollection(sourceRoot, 'cellXfs')
  const outputXfs = styleCollection(outputRoot, 'cellXfs')
  if (!sourceXfs || !outputXfs) return

  const appendCollection = (name: string) => {
    const source = styleCollection(sourceRoot, name)
    const output = styleCollection(outputRoot, name)
    if (!source || !output) return { offset: 0, sourceCount: 0 }
    const children = directChildren(source, name === 'fonts' ? 'font' : name === 'fills' ? 'fill' : 'border')
    const offset = directChildren(output, name === 'fonts' ? 'font' : name === 'fills' ? 'fill' : 'border').length
    for (const child of children) output.appendChild(outputStylesDoc.importNode(child, true))
    output.setAttribute('count', String(offset + children.length))
    return { offset, sourceCount: children.length }
  }

  const fontInfo = appendCollection('fonts')
  const fillInfo = appendCollection('fills')
  const borderInfo = appendCollection('borders')

  const sourceNumFmts = styleCollection(sourceRoot, 'numFmts')
  let outputNumFmts = styleCollection(outputRoot, 'numFmts')
  if (!outputNumFmts && sourceNumFmts) {
    outputNumFmts = outputStylesDoc.createElementNS(SPREADSHEET_NS, 'x:numFmts') as XmlElement
    outputNumFmts.setAttribute('count', '0')
    outputRoot.insertBefore(outputNumFmts, outputRoot.firstChild)
  }
  const numFmtMap = new Map<string, string>()
  if (sourceNumFmts && outputNumFmts) {
    const byCode = new Map<string, string>()
    let maxId = 163
    for (const numFmt of directChildren(outputNumFmts, 'numFmt')) {
      const id = numFmt.getAttribute('numFmtId') || '0'
      byCode.set(numFmt.getAttribute('formatCode') || '', id)
      maxId = Math.max(maxId, Number(id) || 0)
    }
    for (const numFmt of directChildren(sourceNumFmts, 'numFmt')) {
      const sourceId = numFmt.getAttribute('numFmtId') || '0'
      const code = numFmt.getAttribute('formatCode') || ''
      let targetId = byCode.get(code)
      if (!targetId) {
        targetId = String(++maxId)
        const imported = outputStylesDoc.importNode(numFmt, true) as XmlElement
        imported.setAttribute('numFmtId', targetId)
        outputNumFmts.appendChild(imported)
        byCode.set(code, targetId)
      }
      numFmtMap.set(sourceId, targetId)
    }
    outputNumFmts.setAttribute('count', String(directChildren(outputNumFmts, 'numFmt').length))
  }

  const remapXf = (sourceXf: XmlElement) => {
    const xf = outputStylesDoc.importNode(sourceXf, true) as XmlElement
    const remapIndex = (attribute: string, offset: number, sourceCount: number) => {
      const value = Number(xf.getAttribute(attribute) || 0)
      if (value >= 0 && value < sourceCount) xf.setAttribute(attribute, String(offset + value))
    }
    remapIndex('fontId', fontInfo.offset, fontInfo.sourceCount)
    remapIndex('fillId', fillInfo.offset, fillInfo.sourceCount)
    remapIndex('borderId', borderInfo.offset, borderInfo.sourceCount)
    const sourceNumFmtId = xf.getAttribute('numFmtId') || '0'
    if (Number(sourceNumFmtId) >= 164) xf.setAttribute('numFmtId', numFmtMap.get(sourceNumFmtId) || '0')
    return xf
  }

  // 部分水平/垂直对齐定义在 cellStyleXfs，cellXfs 只通过 xfId 继承。
  // 两层必须一起追加并同步偏移，否则合同抬头会被错误地右对齐。
  const sourceStyleXfs = styleCollection(sourceRoot, 'cellStyleXfs')
  const outputStyleXfs = styleCollection(outputRoot, 'cellStyleXfs')
  const styleXfOffset = outputStyleXfs ? directChildren(outputStyleXfs, 'xf').length : 0
  const sourceStyleXfList = sourceStyleXfs ? directChildren(sourceStyleXfs, 'xf') : []
  if (outputStyleXfs) {
    for (const sourceXf of sourceStyleXfList) outputStyleXfs.appendChild(remapXf(sourceXf))
    outputStyleXfs.setAttribute('count', String(styleXfOffset + sourceStyleXfList.length))
  }

  const styleOffset = directChildren(outputXfs, 'xf').length
  const sourceXfList = directChildren(sourceXfs, 'xf')
  for (const sourceXf of sourceXfList) {
    const xf = remapXf(sourceXf)
    const sourceXfId = Number(xf.getAttribute('xfId') || 0)
    xf.setAttribute('xfId', outputStyleXfs && sourceXfId < sourceStyleXfList.length
      ? String(styleXfOffset + sourceXfId)
      : '0')
    outputXfs.appendChild(xf)
  }
  outputXfs.setAttribute('count', String(styleOffset + sourceXfList.length))
  outputZip.file('xl/styles.xml', serializer.serializeToString(outputStylesDoc))

  const sourceParts = await workbookSheetParts(sourceZip)
  const outputParts = await workbookSheetParts(outputZip)
  for (const name of ['印尼合同', '印尼发票']) {
    const sourcePath = sourceParts.get(name)
    const outputPath = outputParts.get(name)
    const sourceSheet = sourcePath ? sourceZip.file(sourcePath) : null
    const outputSheet = outputPath ? outputZip.file(outputPath) : null
    if (!sourceSheet || !outputSheet || !outputPath) continue
    const sourceDoc = parser.parseFromString(await sourceSheet.async('string'), 'application/xml')
    const indonesiaCells = Array.from(sourceDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'c')) as XmlElement[]
    for (const cell of indonesiaCells) {
      const sourceStyle = Number(cell.getAttribute('s') || 0)
      cell.setAttribute('s', String(styleOffset + sourceStyle))
    }
    const generatedXml = await outputSheet.async('string')
    const merged = mergeWorksheetXml(
      serializer.serializeToString(sourceDoc),
      generatedXml,
      false,
    )
    const mergedDoc = parser.parseFromString(merged, 'application/xml')
    const generatedDoc = parser.parseFromString(generatedXml, 'application/xml')
    const mergedRoot = mergedDoc.documentElement as XmlElement
    const generatedRoot = generatedDoc.documentElement as XmlElement
    const mergedData = directChild(mergedRoot, 'sheetData')
    const generatedData = directChild(generatedRoot, 'sheetData')
    if (mergedData && generatedData) {
      const maxGeneratedRow = Math.max(1, ...directChildren(generatedData, 'row').map(rowNumber))
      for (const row of directChildren(mergedData, 'row')) {
        if (rowNumber(row) > maxGeneratedRow) mergedData.removeChild(row)
      }
    }
    // 生成工作表已经删掉未使用的第二页；同步其有效区域和合并单元格，防止
    // 旧模板中未启用页面的 LOOKUP 公式重新出现在导出结果中。
    replaceDirectChild(mergedDoc, mergedRoot, generatedRoot, 'dimension')
    replaceDirectChild(mergedDoc, mergedRoot, generatedRoot, 'mergeCells')
    outputZip.file(outputPath, serializer.serializeToString(mergedDoc))
  }
}

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
// @xmldom 的节点类型与浏览器 lib.dom 同名但不是同一套声明；这里统一为内部 XML 节点，
// 避免把它们误当成页面 DOM 元素。
type XmlElement = any
type XmlDocument = any

function directChild(parent: XmlElement, localName: string): XmlElement | undefined {
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && node.localName === localName) return node
  }
  return undefined
}

function directChildren(parent: XmlElement, localName: string): XmlElement[] {
  const result: XmlElement[] = []
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && node.localName === localName) result.push(node)
  }
  return result
}

function rowNumber(row: XmlElement): number {
  return Number(row.getAttribute('r') || 0)
}

function cellColumn(address: string): string {
  return address.replace(/\d+$/, '')
}

function copyGeneratedCellValue(targetDoc: XmlDocument, target: XmlElement, generated: XmlElement) {
  const address = generated.getAttribute('r') || target.getAttribute('r') || ''
  const style = target.getAttribute('s')
  while (target.attributes.length) target.removeAttributeNode(target.attributes.item(0)!)
  target.setAttribute('r', address)
  if (style != null) target.setAttribute('s', style)
  for (let i = 0; i < generated.attributes.length; i++) {
    const attr = generated.attributes.item(i)!
    if (attr.name !== 'r' && attr.name !== 's') target.setAttributeNS(attr.namespaceURI, attr.name, attr.value)
  }
  while (target.firstChild) target.removeChild(target.firstChild)
  for (let child = generated.firstChild; child; child = child.nextSibling) {
    target.appendChild(targetDoc.importNode(child, true))
  }
}

function replaceDirectChild(targetDoc: XmlDocument, targetRoot: XmlElement, generatedRoot: XmlElement, localName: string) {
  const current = directChild(targetRoot, localName)
  const generated = directChild(generatedRoot, localName)
  if (current && generated) targetRoot.replaceChild(targetDoc.importNode(generated, true), current)
  else if (current && !generated) targetRoot.removeChild(current)
}

function mergeWorksheetXml(templateXml: string, generatedXml: string, mainSheet: boolean, mainTotalRow?: number): string {
  const parser = new DOMParser()
  const targetDoc = parser.parseFromString(templateXml, 'application/xml')
  const generatedDoc = parser.parseFromString(generatedXml, 'application/xml')
  const targetRoot = targetDoc.documentElement as XmlElement
  const generatedRoot = generatedDoc.documentElement as XmlElement
  const targetData = directChild(targetRoot, 'sheetData')
  const generatedData = directChild(generatedRoot, 'sheetData')
  if (!targetData || !generatedData) return templateXml

  const generatedCells = new Map<string, XmlElement>()
  for (const row of directChildren(generatedData, 'row')) {
    for (const cell of directChildren(row, 'c')) {
      const address = cell.getAttribute('r')
      if (address) generatedCells.set(address, cell)
    }
  }

  if (!mainSheet) {
    const targetCells = new Map<string, XmlElement>()
    for (const row of directChildren(targetData, 'row')) {
      for (const cell of directChildren(row, 'c')) {
        const address = cell.getAttribute('r')
        if (address) targetCells.set(address, cell)
      }
    }
    for (const [address, generatedCell] of generatedCells) {
      const targetCell = targetCells.get(address)
      // 单据模板中的目标区域本来就有格式化单元格；若遇到模板外的新单元格，宁可
      // 不带样式追加，也不能引用生成文件中与原 styles.xml 不兼容的样式编号。
      if (targetCell) copyGeneratedCellValue(targetDoc, targetCell, generatedCell)
      else {
        const generatedRow = generatedCell.parentNode as XmlElement
        const rowNo = rowNumber(generatedRow)
        let targetRow = directChildren(targetData, 'row').find(row => rowNumber(row) === rowNo)
        if (!targetRow) {
          targetRow = targetDoc.createElementNS(SPREADSHEET_NS, 'x:row')
          targetRow.setAttribute('r', String(rowNo))
          targetData.appendChild(targetRow)
        }
        const newCell = targetDoc.createElementNS(SPREADSHEET_NS, 'x:c')
        copyGeneratedCellValue(targetDoc, newCell, generatedCell)
        targetRow.appendChild(newCell)
      }
    }
  } else {
    const templateRows = directChildren(targetData, 'row')
    const templateDetailRow = templateRows.find(row => rowNumber(row) === 4)
    const detailStyles = new Map<string, string>()
    if (templateDetailRow) {
      for (const cell of directChildren(templateDetailRow, 'c')) {
        const address = cell.getAttribute('r') || ''
        const style = cell.getAttribute('s')
        if (style != null) detailStyles.set(cellColumn(address), style)
      }
    }

    // 表头三行保持模板结构，只换数据；明细行则按模板第 4 行逐行复制格式。
    for (const row of templateRows.filter(row => rowNumber(row) <= 3)) {
      for (const cell of directChildren(row, 'c')) {
        const generatedCell = generatedCells.get(cell.getAttribute('r') || '')
        if (generatedCell) copyGeneratedCellValue(targetDoc, cell, generatedCell)
      }
    }
    for (const row of templateRows.filter(row => rowNumber(row) >= 4)) targetData.removeChild(row)
    const rowPrototype = templateDetailRow
    for (const generatedRow of directChildren(generatedData, 'row').filter(row => rowNumber(row) >= 4)) {
      const newRow = targetDoc.createElementNS(SPREADSHEET_NS, 'x:row')
      const isTotalRow = mainTotalRow != null && rowNumber(generatedRow) === mainTotalRow
      const isSpacerRow = mainTotalRow != null && rowNumber(generatedRow) === mainTotalRow - 1
      const attributeSource = (isTotalRow || isSpacerRow) ? generatedRow : rowPrototype
      if (attributeSource) {
        for (let i = 0; i < attributeSource.attributes.length; i++) {
          const attr = attributeSource.attributes.item(i)!
          if (attr.name !== 'r') newRow.setAttributeNS(attr.namespaceURI, attr.name, attr.value)
        }
      }
      newRow.setAttribute('r', generatedRow.getAttribute('r') || '')
      for (const generatedCell of directChildren(generatedRow, 'c')) {
        const newCell = targetDoc.createElementNS(SPREADSHEET_NS, 'x:c')
        if (!isTotalRow) {
          const style = detailStyles.get(cellColumn(generatedCell.getAttribute('r') || ''))
          if (style != null) newCell.setAttribute('s', style)
        }
        copyGeneratedCellValue(targetDoc, newCell, generatedCell)
        newRow.appendChild(newCell)
      }
      targetData.appendChild(newRow)
    }
    replaceDirectChild(targetDoc, targetRoot, generatedRoot, 'dimension')
    replaceDirectChild(targetDoc, targetRoot, generatedRoot, 'mergeCells')
    replaceDirectChild(targetDoc, targetRoot, generatedRoot, 'autoFilter')
    const legacyDrawing = directChild(targetRoot, 'legacyDrawing')
    if (legacyDrawing) targetRoot.removeChild(legacyDrawing)
  }
  return new XMLSerializer().serializeToString(targetDoc)
}

function styleCollection(root: XmlElement, localName: string): XmlElement | undefined {
  return (Array.from(root.getElementsByTagNameNS(SPREADSHEET_NS, localName)) as XmlElement[])[0]
}

function childSignature(element: XmlElement | undefined): string {
  return element ? new XMLSerializer().serializeToString(element).replace(/\s+xmlns(?::\w+)?="[^"]*"/g, '') : ''
}

async function applyGeneratedMainFormats(templateZip: JSZip, generatedZip: JSZip) {
  const [templateStylesFile, generatedStylesFile, templateSheetFile, generatedSheetFile] = [
    templateZip.file('xl/styles.xml'), generatedZip.file('xl/styles.xml'),
    templateZip.file('xl/worksheets/sheet2.xml'), generatedZip.file('xl/worksheets/sheet2.xml'),
  ]
  if (!templateStylesFile || !generatedStylesFile || !templateSheetFile || !generatedSheetFile) return
  const parser = new DOMParser()
  const templateStylesDoc = parser.parseFromString(await templateStylesFile.async('string'), 'application/xml')
  const generatedStylesDoc = parser.parseFromString(await generatedStylesFile.async('string'), 'application/xml')
  const templateSheetDoc = parser.parseFromString(await templateSheetFile.async('string'), 'application/xml')
  const generatedSheetDoc = parser.parseFromString(await generatedSheetFile.async('string'), 'application/xml')
  const templateXfs = styleCollection(templateStylesDoc.documentElement as XmlElement, 'cellXfs')
  const generatedXfs = styleCollection(generatedStylesDoc.documentElement as XmlElement, 'cellXfs')
  const templateFills = styleCollection(templateStylesDoc.documentElement as XmlElement, 'fills')
  const generatedFills = styleCollection(generatedStylesDoc.documentElement as XmlElement, 'fills')
  const templateBorders = styleCollection(templateStylesDoc.documentElement as XmlElement, 'borders')
  const generatedBorders = styleCollection(generatedStylesDoc.documentElement as XmlElement, 'borders')
  const templateNumFmts = styleCollection(templateStylesDoc.documentElement as XmlElement, 'numFmts')
  const generatedNumFmts = styleCollection(generatedStylesDoc.documentElement as XmlElement, 'numFmts')
  if (!templateXfs || !generatedXfs || !templateFills || !generatedFills
    || !templateBorders || !generatedBorders || !templateNumFmts) return

  const templateXfList = directChildren(templateXfs, 'xf')
  const generatedXfList = directChildren(generatedXfs, 'xf')
  const generatedFillList = directChildren(generatedFills, 'fill')
  const generatedBorderList = directChildren(generatedBorders, 'border')
  const generatedFormatCodes = new Map<string, string>()
  for (const numFmt of generatedNumFmts ? directChildren(generatedNumFmts, 'numFmt') : []) {
    generatedFormatCodes.set(numFmt.getAttribute('numFmtId') || '', numFmt.getAttribute('formatCode') || '')
  }
  const templateFormatIds = new Map<string, string>()
  let maxNumFmtId = 163
  for (const numFmt of directChildren(templateNumFmts, 'numFmt')) {
    const id = numFmt.getAttribute('numFmtId') || ''
    templateFormatIds.set(numFmt.getAttribute('formatCode') || '', id)
    maxNumFmtId = Math.max(maxNumFmtId, Number(id) || 0)
  }
  const ensureNumFmt = (generatedId: string): string => {
    if (!generatedId || Number(generatedId) < 164) return generatedId || '0'
    const code = generatedFormatCodes.get(generatedId)
    if (!code) return '0'
    const existing = templateFormatIds.get(code)
    if (existing) return existing
    const id = String(++maxNumFmtId)
    const numFmt = templateStylesDoc.createElementNS(SPREADSHEET_NS, 'x:numFmt')
    numFmt.setAttribute('numFmtId', id)
    numFmt.setAttribute('formatCode', code)
    templateNumFmts.appendChild(numFmt)
    templateNumFmts.setAttribute('count', String(directChildren(templateNumFmts, 'numFmt').length))
    templateFormatIds.set(code, id)
    return id
  }

  const templateFillIds = new Map<string, string>()
  directChildren(templateFills, 'fill').forEach((fill, index) => templateFillIds.set(childSignature(fill), String(index)))
  const ensureCompanyFill = (generatedFillId: string): string | undefined => {
    const fill = generatedFillList[Number(generatedFillId)]
    const signature = childSignature(fill)
    if (!fill || !CUSTOMS_COMPANY_COLORS.some(color => signature.toUpperCase().includes(color))) return undefined
    const existing = templateFillIds.get(signature)
    if (existing) return existing
    const imported = templateStylesDoc.importNode(fill, true) as XmlElement
    templateFills.appendChild(imported)
    const id = String(directChildren(templateFills, 'fill').length - 1)
    templateFills.setAttribute('count', String(directChildren(templateFills, 'fill').length))
    templateFillIds.set(signature, id)
    return id
  }

  const templateBorderIds = new Map<string, string>()
  directChildren(templateBorders, 'border').forEach((border, index) => templateBorderIds.set(childSignature(border), String(index)))
  const ensureGridBorder = (generatedBorderId: string): string | undefined => {
    const border = generatedBorderList[Number(generatedBorderId)]
    if (!border) return undefined
    const signature = childSignature(border)
    const existing = templateBorderIds.get(signature)
    if (existing) return existing
    templateBorders.appendChild(templateStylesDoc.importNode(border, true))
    const id = String(directChildren(templateBorders, 'border').length - 1)
    templateBorders.setAttribute('count', String(directChildren(templateBorders, 'border').length))
    templateBorderIds.set(signature, id)
    return id
  }

  const targetCells = new Map<string, XmlElement>()
  for (const cell of Array.from(templateSheetDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'c')) as XmlElement[]) {
    const address = cell.getAttribute('r') || ''
    if (Number(address.match(/\d+$/)?.[0] || 0) >= 4) targetCells.set(address, cell)
  }
  const generatedCells = new Map<string, XmlElement>()
  for (const cell of Array.from(generatedSheetDoc.getElementsByTagNameNS(SPREADSHEET_NS, 'c')) as XmlElement[]) {
    const address = cell.getAttribute('r') || ''
    if (Number(address.match(/\d+$/)?.[0] || 0) >= 4) generatedCells.set(address, cell)
  }

  const appendedStyles = new Map<string, string>()
  for (const [address, targetCell] of targetCells) {
    const generatedCell = generatedCells.get(address)
    const baseStyleId = targetCell.getAttribute('s') || '0'
    const generatedStyleId = generatedCell?.getAttribute('s') || '0'
    const baseXf = templateXfList[Number(baseStyleId)]
    const generatedXf = generatedXfList[Number(generatedStyleId)]
    if (!baseXf || !generatedXf) continue
    const numFmtId = ensureNumFmt(generatedXf.getAttribute('numFmtId') || '0')
    const companyFillId = ensureCompanyFill(generatedXf.getAttribute('fillId') || '0')
    const column = cellColumn(address)
    const gridBorderId = (column === 'AB' || column === 'AQ')
      ? ensureGridBorder(generatedXf.getAttribute('borderId') || '0')
      : undefined
    const baseNumFmt = baseXf.getAttribute('numFmtId') || '0'
    const baseFill = baseXf.getAttribute('fillId') || '0'
    const baseBorder = baseXf.getAttribute('borderId') || '0'
    if (numFmtId === baseNumFmt && (!companyFillId || companyFillId === baseFill)
      && (!gridBorderId || gridBorderId === baseBorder)) continue
    const key = `${baseStyleId}|${numFmtId}|${companyFillId || baseFill}|${gridBorderId || baseBorder}`
    let styleId = appendedStyles.get(key)
    if (!styleId) {
      const xf = baseXf.cloneNode(true) as XmlElement
      xf.setAttribute('numFmtId', numFmtId)
      if (numFmtId !== '0') xf.setAttribute('applyNumberFormat', '1')
      if (companyFillId) {
        xf.setAttribute('fillId', companyFillId)
        xf.setAttribute('applyFill', '1')
      }
      if (gridBorderId) {
        xf.setAttribute('borderId', gridBorderId)
        xf.setAttribute('applyBorder', '1')
      }
      templateXfs.appendChild(xf)
      styleId = String(directChildren(templateXfs, 'xf').length - 1)
      appendedStyles.set(key, styleId)
    }
    targetCell.setAttribute('s', styleId)
  }
  templateXfs.setAttribute('count', String(directChildren(templateXfs, 'xf').length))
  templateZip.file('xl/styles.xml', new XMLSerializer().serializeToString(templateStylesDoc))
  templateZip.file('xl/worksheets/sheet2.xml', new XMLSerializer().serializeToString(templateSheetDoc))
}

type LinkedTableKind = 'contract' | 'invoice' | 'packing'
type LinkedTableSection = {
  start: number
  end: number
  totalRow: number
  pruneStart?: number
  group?: DocumentGroup
  desired: number
  delta: number
  finalStart: number
  finalTotal: number
}

function shiftA1Rows(value: string, threshold: number, delta: number): string {
  if (!delta) return value
  return value.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, (match, col, absolute, digits) => {
    const row = Number(digits)
    return row >= threshold ? `${col}${absolute}${row + delta}` : match
  })
}

function setXmlRowNumber(row: XmlElement, nextRow: number) {
  row.setAttribute('r', String(nextRow))
  for (const cell of directChildren(row, 'c')) {
    const address = cell.getAttribute('r') || ''
    cell.setAttribute('r', `${cellColumn(address)}${nextRow}`)
  }
}

function clearXmlCell(cell: XmlElement) {
  cell.removeAttribute('t')
  while (cell.firstChild) cell.removeChild(cell.firstChild)
}

function ensureXmlCell(doc: XmlDocument, row: XmlElement, column: string): XmlElement {
  const rowNo = rowNumber(row)
  let cell = directChildren(row, 'c').find(item => cellColumn(item.getAttribute('r') || '') === column)
  if (!cell) {
    cell = doc.createElementNS(SPREADSHEET_NS, 'c')
    cell.setAttribute('r', `${column}${rowNo}`)
    row.appendChild(cell)
  }
  return cell
}

function setXmlNumber(doc: XmlDocument, row: XmlElement, column: string, value: number | null) {
  const cell = ensureXmlCell(doc, row, column)
  clearXmlCell(cell)
  if (value == null) return
  const node = doc.createElementNS(SPREADSHEET_NS, 'v')
  node.appendChild(doc.createTextNode(String(value)))
  cell.appendChild(node)
}

function setXmlFormula(doc: XmlDocument, row: XmlElement, column: string, formula: string | null) {
  const cell = ensureXmlCell(doc, row, column)
  clearXmlCell(cell)
  if (!formula) return
  const f = doc.createElementNS(SPREADSHEET_NS, 'f')
  f.appendChild(doc.createTextNode(formula))
  const v = doc.createElementNS(SPREADSHEET_NS, 'v')
  v.appendChild(doc.createTextNode('0'))
  cell.appendChild(f)
  cell.appendChild(v)
}

function resizeLinkedTableXml(
  xml: string,
  rawSections: Array<{ start: number; end: number; totalRow: number; pruneStart?: number; group?: DocumentGroup }>,
  kind: LinkedTableKind,
  mainName: string,
): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  const root = doc.documentElement as XmlElement
  const sheetData = directChild(root, 'sheetData')
  if (!sheetData) return xml
  let runningOffset = 0
  const sections: LinkedTableSection[] = rawSections.map(section => {
    // 未使用的模板区块先保持原行数，稍后再连同整份空合同/发票删除。
    const desired = section.group
      ? Math.max(10, section.group.indices.length)
      : section.end - section.start + 1
    const delta = desired - (section.end - section.start + 1)
    const finalStart = section.start + runningOffset
    const finalTotal = finalStart + desired
    runningOffset += delta
    return { ...section, desired, delta, finalStart, finalTotal }
  })

  // 从底部向上改行数，保证每一段仍可用模板原始坐标定位。
  for (const section of [...sections].reverse()) {
    if (!section.group) continue
    const rows = directChildren(sheetData, 'row')
    const prototype = rows.find(row => rowNumber(row) === section.start)?.cloneNode(true) as XmlElement | undefined
    if (!prototype) continue
    for (const row of rows) {
      const current = rowNumber(row)
      if (current >= section.start && current <= section.end) sheetData.removeChild(row)
      else if (current > section.end) setXmlRowNumber(row, current + section.delta)
    }
    const formulaNodes = Array.from(doc.getElementsByTagNameNS(SPREADSHEET_NS, 'f')) as XmlElement[]
    for (const formula of formulaNodes) {
      if (formula.firstChild?.nodeValue) formula.firstChild.nodeValue = shiftA1Rows(formula.firstChild.nodeValue, section.end + 1, section.delta)
    }
    const mergeCells = directChild(root, 'mergeCells')
    if (mergeCells) {
      for (const merge of directChildren(mergeCells, 'mergeCell')) {
        const ref = merge.getAttribute('ref')
        if (ref) merge.setAttribute('ref', shiftA1Rows(ref, section.end + 1, section.delta))
      }
    }
    for (let offset = 0; offset < section.desired; offset++) {
      const row = prototype.cloneNode(true) as XmlElement
      setXmlRowNumber(row, section.start + offset)
      for (const cell of directChildren(row, 'c')) clearXmlCell(cell)
      sheetData.appendChild(row)
    }
    const sortedRows = directChildren(sheetData, 'row').sort((a, b) => rowNumber(a) - rowNumber(b))
    for (const row of sortedRows) sheetData.appendChild(row)
  }

  const escapedMain = mainName.replace(/'/g, "''")
  const formula = (column: string, mainRow: number) => `'${escapedMain}'!${column}${mainRow}`
  const finalRows = new Map<number, XmlElement>()
  for (const row of directChildren(sheetData, 'row')) finalRows.set(rowNumber(row), row)
  for (const section of sections) {
    for (let offset = 0; offset < section.desired; offset++) {
      const row = finalRows.get(section.finalStart + offset)
      if (!row) continue
      for (const cell of directChildren(row, 'c')) clearXmlCell(cell)
      const itemIndex = section.group?.indices[offset]
      if (!itemIndex) continue
      const mainRow = itemIndex + 3
      setXmlNumber(doc, row, 'A', itemIndex)
      if (kind === 'contract') {
        setXmlFormula(doc, row, 'B', formula('D', mainRow))
        setXmlFormula(doc, row, 'C', `${formula('G', mainRow)}&${formula('F', mainRow)}`)
        setXmlFormula(doc, row, 'D', formula('K', mainRow))
        setXmlFormula(doc, row, 'E', formula('J', mainRow))
        setXmlFormula(doc, row, 'F', formula('Z', mainRow))
        setXmlFormula(doc, row, 'G', `F${section.finalStart + offset}*D${section.finalStart + offset}`)
      } else if (kind === 'invoice') {
        setXmlFormula(doc, row, 'B', formula('D', mainRow))
        setXmlFormula(doc, row, 'C', `${formula('G', mainRow)}&${formula('F', mainRow)}`)
        setXmlFormula(doc, row, 'D', formula('L', mainRow))
        setXmlFormula(doc, row, 'E', formula('M', mainRow))
        setXmlFormula(doc, row, 'F', formula('C', mainRow))
        setXmlFormula(doc, row, 'G', formula('K', mainRow))
        setXmlFormula(doc, row, 'H', formula('J', mainRow))
        setXmlFormula(doc, row, 'I', formula('Z', mainRow))
        setXmlFormula(doc, row, 'J', `I${section.finalStart + offset}*G${section.finalStart + offset}`)
      } else {
        const mapping: Record<string, string> = { B: 'D', C: 'G', D: 'K', E: 'J', F: 'L', G: 'M', H: 'P', I: 'Q', J: 'AT', K: 'S' }
        for (const [column, mainColumn] of Object.entries(mapping)) {
          setXmlFormula(doc, row, column, column === 'C'
            ? `${formula('G', mainRow)}&${formula('F', mainRow)}`
            : formula(mainColumn, mainRow))
        }
      }
    }
    const totalRow = finalRows.get(section.finalTotal)
    if (!totalRow) continue
    const hasGroup = Boolean(section.group)
    if (kind === 'contract') setXmlFormula(doc, totalRow, 'G', hasGroup ? `SUM(G${section.finalStart}:G${section.finalTotal - 1})` : null)
    else if (kind === 'invoice') {
      setXmlFormula(doc, totalRow, 'I', hasGroup ? `SUM(J${section.finalStart}:J${section.finalTotal - 1})` : null)
      const amountInWordsRow = finalRows.get(section.finalTotal + 1)
      if (amountInWordsRow) setXmlFormula(doc, amountInWordsRow, 'C', hasGroup ? `I${section.finalTotal}` : null)
    }
    else {
      for (const column of ['D', 'H', 'I', 'J', 'K']) {
        setXmlFormula(doc, totalRow, column, hasGroup ? `SUM(${column}${section.finalStart}:${column}${section.finalTotal - 1})` : null)
      }
      const spacerRow = finalRows.get(section.finalTotal + 1)
      if (spacerRow) {
        for (const column of ['E', 'H', 'I', 'J', 'K']) setXmlNumber(doc, spacerRow, column, null)
      }
    }
  }

  // 合同/发票模板预留了多份完整单据。从第一份未使用单据开始删除后续行，
  // 使最终工作表的单据数与实际合同/发票数一致。
  const firstUnusedIndex = sections.findIndex(section => section.pruneStart != null && !section.group)
  if (firstUnusedIndex >= 0) {
    const pruneStart = sections[firstUnusedIndex].pruneStart!
      + sections.slice(0, firstUnusedIndex).reduce((sum, section) => sum + section.delta, 0)
    for (const row of directChildren(sheetData, 'row')) {
      if (rowNumber(row) >= pruneStart) sheetData.removeChild(row)
    }
    const mergeCells = directChild(root, 'mergeCells')
    if (mergeCells) {
      for (const merge of directChildren(mergeCells, 'mergeCell')) {
        const rows = Array.from(
          (merge.getAttribute('ref') || '').matchAll(/\d+/g),
          (match: RegExpMatchArray) => Number(match[0]),
        )
        if (rows.some(row => row >= pruneStart)) mergeCells.removeChild(merge)
      }
      mergeCells.setAttribute('count', String(directChildren(mergeCells, 'mergeCell').length))
    }
  }
  const dimension = directChild(root, 'dimension')
  if (dimension) {
    const originalRef = dimension.getAttribute('ref') || 'A1:A1'
    const endColumn = cellColumn(originalRef.split(':').pop() || 'A1') || 'A'
    const maxRow = Math.max(1, ...directChildren(sheetData, 'row').map(rowNumber))
    dimension.setAttribute('ref', `A1:${endColumn}${maxRow}`)
  }
  return new XMLSerializer().serializeToString(doc)
}

// 合同、发票和装箱单的空白明细行及合计行在原模板中只有部分单元格
// 带边框，动态扩展后会留下缺口，因此表头到合计行统一补齐四边。
// 装箱单保留模板的紫色表头/合计底色，只清掉合计行之后的模板残留样式。
async function ensureLinkedTableGrid(
  zip: JSZip,
  sheetPath: string,
  rawSections: Array<{ start: number; end: number; totalRow: number; pruneStart?: number; group?: DocumentGroup }>,
  kind: LinkedTableKind,
) {
  const stylesFile = zip.file('xl/styles.xml')
  const sheetFile = zip.file(sheetPath)
  if (!stylesFile || !sheetFile) return

  let runningOffset = 0
  const ranges: Array<{ start: number; end: number; detailStart: number }> = []
  for (const section of rawSections) {
    const desired = section.group ? Math.max(10, section.group.indices.length) : section.end - section.start + 1
    const delta = desired - (section.end - section.start + 1)
    const finalStart = section.start + runningOffset
    if (section.group) ranges.push({
      start: Math.max(1, finalStart - (kind === 'packing' ? 1 : 2)),
      end: finalStart + desired,
      detailStart: finalStart,
    })
    runningOffset += delta
  }
  if (!ranges.length) return

  const parser = new DOMParser()
  const serializer = new XMLSerializer()
  const stylesDoc = parser.parseFromString(await stylesFile.async('string'), 'application/xml')
  const sheetDoc = parser.parseFromString(await sheetFile.async('string'), 'application/xml')
  const styleRoot = stylesDoc.documentElement as XmlElement
  const sheetRoot = sheetDoc.documentElement as XmlElement
  const xfs = styleCollection(styleRoot, 'cellXfs')
  const borders = styleCollection(styleRoot, 'borders')
  const sheetData = directChild(sheetRoot, 'sheetData')
  if (!xfs || !borders || !sheetData) return

  const gridBorder = stylesDoc.createElementNS(SPREADSHEET_NS, 'border') as XmlElement
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    const side = stylesDoc.createElementNS(SPREADSHEET_NS, edge) as XmlElement
    side.setAttribute('style', 'thin')
    const color = stylesDoc.createElementNS(SPREADSHEET_NS, 'color') as XmlElement
    color.setAttribute('rgb', 'FF000000')
    side.appendChild(color)
    gridBorder.appendChild(side)
  }
  gridBorder.appendChild(stylesDoc.createElementNS(SPREADSHEET_NS, 'diagonal'))
  borders.appendChild(gridBorder)
  const gridBorderId = String(directChildren(borders, 'border').length - 1)
  borders.setAttribute('count', String(directChildren(borders, 'border').length))

  const xfList = directChildren(xfs, 'xf')
  const gridStyles = new Map<string, string>()
  const firstColumn = XLSX.utils.decode_col(kind === 'packing' ? 'A' : 'B')
  const lastColumn = XLSX.utils.decode_col(kind === 'contract' ? 'H' : kind === 'invoice' ? 'J' : 'K')
  for (const range of ranges) {
    for (let rowNo = range.start; rowNo <= range.end; rowNo++) {
      let row = directChildren(sheetData, 'row').find(candidate => rowNumber(candidate) === rowNo)
      if (!row) {
        row = sheetDoc.createElementNS(SPREADSHEET_NS, 'row') as XmlElement
        row.setAttribute('r', String(rowNo))
        const following = directChildren(sheetData, 'row').find(candidate => rowNumber(candidate) > rowNo)
        if (following) sheetData.insertBefore(row, following)
        else sheetData.appendChild(row)
      }
      const cells = new Map(directChildren(row, 'c').map(cell => [cell.getAttribute('r') || '', cell]))
      for (let columnIndex = firstColumn; columnIndex <= lastColumn; columnIndex++) {
        const address = `${XLSX.utils.encode_col(columnIndex)}${rowNo}`
        let cell = cells.get(address)
        if (!cell) {
          cell = sheetDoc.createElementNS(SPREADSHEET_NS, 'c') as XmlElement
          cell.setAttribute('r', address)
          const following = directChildren(row, 'c').find(existing =>
            XLSX.utils.decode_col(cellColumn(existing.getAttribute('r') || 'A')) > columnIndex,
          )
          if (following) row.insertBefore(cell, following)
          else row.appendChild(cell)
          cells.set(address, cell)
        }
        const baseStyleId = cell.getAttribute('s') || '0'
        const styleKey = baseStyleId
        let styleId = gridStyles.get(styleKey)
        if (!styleId) {
          const baseXf = xfList[Number(baseStyleId)] || xfList[0]
          if (!baseXf) continue
          const xf = baseXf.cloneNode(true) as XmlElement
          xf.setAttribute('borderId', gridBorderId)
          xf.setAttribute('applyBorder', '1')
          xfs.appendChild(xf)
          styleId = String(directChildren(xfs, 'xf').length - 1)
          gridStyles.set(styleKey, styleId)
        }
        cell.setAttribute('s', styleId)
      }
    }
  }
  if (kind === 'packing') {
    // 装箱单表头也属于正式单据的一部分。模板中的合并单元格只有左上角带样式，
    // 导出后在 Excel/WPS 中会出现标题区、Shipper/Consignee 区和右侧资料框缺边。
    // 按模板结构补“外框”，不在文字区内部增加无意义的满格网线。
    const headerOffset = rawSections[0]?.start === 25 ? 17 : 16
    const topOffset = rawSections[0]?.start === 25 ? 24 : 23
    const framedStyles = new Map<string, string>()

    const ensureRow = (rowNo: number) => {
      let row = directChildren(sheetData, 'row').find(candidate => rowNumber(candidate) === rowNo)
      if (!row) {
        row = sheetDoc.createElementNS(SPREADSHEET_NS, 'row') as XmlElement
        row.setAttribute('r', String(rowNo))
        const following = directChildren(sheetData, 'row').find(candidate => rowNumber(candidate) > rowNo)
        if (following) sheetData.insertBefore(row, following)
        else sheetData.appendChild(row)
      }
      return row
    }
    const ensureCell = (rowNo: number, columnIndex: number) => {
      const row = ensureRow(rowNo)
      const address = `${XLSX.utils.encode_col(columnIndex)}${rowNo}`
      let cell = directChildren(row, 'c').find(candidate => candidate.getAttribute('r') === address)
      if (!cell) {
        cell = sheetDoc.createElementNS(SPREADSHEET_NS, 'c') as XmlElement
        cell.setAttribute('r', address)
        const following = directChildren(row, 'c').find(existing =>
          XLSX.utils.decode_col(cellColumn(existing.getAttribute('r') || 'A')) > columnIndex,
        )
        if (following) row.insertBefore(cell, following)
        else row.appendChild(cell)
      }
      return cell
    }
    const styleWithEdges = (baseStyleId: string, edges: string[]) => {
      const key = `${baseStyleId}:${[...edges].sort().join(',')}`
      const cached = framedStyles.get(key)
      if (cached) return cached
      const currentXfs = directChildren(xfs, 'xf')
      const baseXf = currentXfs[Number(baseStyleId)] || currentXfs[0]
      if (!baseXf) return baseStyleId
      const xf = baseXf.cloneNode(true) as XmlElement
      const borderId = Number(baseXf.getAttribute('borderId') || 0)
      const baseBorder = directChildren(borders, 'border')[borderId]
      const border = baseBorder
        ? baseBorder.cloneNode(true) as XmlElement
        : stylesDoc.createElementNS(SPREADSHEET_NS, 'border') as XmlElement
      for (const edge of edges) {
        const current = directChild(border, edge)
        const side = current || stylesDoc.createElementNS(SPREADSHEET_NS, edge) as XmlElement
        side.setAttribute('style', 'thin')
        let color = directChild(side, 'color')
        if (!color) {
          color = stylesDoc.createElementNS(SPREADSHEET_NS, 'color') as XmlElement
          side.appendChild(color)
        }
        color.setAttribute('rgb', 'FF000000')
        if (!current) border.appendChild(side)
      }
      if (!directChild(border, 'diagonal')) {
        border.appendChild(stylesDoc.createElementNS(SPREADSHEET_NS, 'diagonal'))
      }
      borders.appendChild(border)
      const nextBorderId = String(directChildren(borders, 'border').length - 1)
      xf.setAttribute('borderId', nextBorderId)
      xf.setAttribute('applyBorder', '1')
      xfs.appendChild(xf)
      const styleId = String(directChildren(xfs, 'xf').length - 1)
      framedStyles.set(key, styleId)
      return styleId
    }
    const frame = (startColumn: string, startRow: number, endColumn: string, endRow: number) => {
      const startColumnIndex = XLSX.utils.decode_col(startColumn)
      const endColumnIndex = XLSX.utils.decode_col(endColumn)
      for (let rowNo = startRow; rowNo <= endRow; rowNo++) {
        for (let columnIndex = startColumnIndex; columnIndex <= endColumnIndex; columnIndex++) {
          const edges: string[] = []
          if (rowNo === startRow) edges.push('top')
          if (rowNo === endRow) edges.push('bottom')
          if (columnIndex === startColumnIndex) edges.push('left')
          if (columnIndex === endColumnIndex) edges.push('right')
          if (!edges.length) continue
          const cell = ensureCell(rowNo, columnIndex)
          cell.setAttribute('s', styleWithEdges(cell.getAttribute('s') || '0', edges))
        }
      }
    }

    for (const range of ranges) {
      const formStart = range.detailStart - headerOffset
      const topStart = range.detailStart - topOffset
      // 公司抬头区及其下方留白区。
      frame('A', topStart, 'K', formStart - 3)
      // 左侧发货人和收货人资料框。
      frame('A', formStart, 'C', formStart + 6)
      frame('A', formStart + 7, 'C', range.detailStart - 2)
      // 右侧装箱单号、页码、日期、PO/OF、柜号和封条号资料框。
      frame('D', formStart, 'G', formStart + 1)
      frame('H', formStart, 'K', formStart + 3)
      frame('D', formStart + 2, 'G', formStart + 3)
      frame('D', formStart + 4, 'G', formStart + 7)
      frame('H', formStart + 4, 'K', formStart + 7)
      frame('D', formStart + 8, 'G', range.detailStart - 2)
      frame('H', formStart + 8, 'K', range.detailStart - 2)
    }
    borders.setAttribute('count', String(directChildren(borders, 'border').length))

    const clearedStyles = new Map<string, string>()
    for (const spacerRowNo of ranges.map(range => range.end + 1)) {
      const spacerRow = directChildren(sheetData, 'row').find(candidate => rowNumber(candidate) === spacerRowNo)
      if (!spacerRow) continue
      for (const cell of directChildren(spacerRow, 'c')) {
        const columnIndex = XLSX.utils.decode_col(cellColumn(cell.getAttribute('r') || 'A'))
        if (columnIndex < firstColumn || columnIndex > lastColumn) continue
        const baseStyleId = cell.getAttribute('s') || '0'
        let styleId = clearedStyles.get(baseStyleId)
        if (!styleId) {
          const baseXf = xfList[Number(baseStyleId)] || xfList[0]
          if (!baseXf) continue
          const xf = baseXf.cloneNode(true) as XmlElement
          xf.setAttribute('fillId', '0')
          xf.setAttribute('applyFill', '1')
          xf.setAttribute('borderId', '0')
          xf.setAttribute('applyBorder', '1')
          xfs.appendChild(xf)
          styleId = String(directChildren(xfs, 'xf').length - 1)
          clearedStyles.set(baseStyleId, styleId)
        }
        cell.setAttribute('s', styleId)
      }
    }
  }
  xfs.setAttribute('count', String(directChildren(xfs, 'xf').length))
  zip.file('xl/styles.xml', serializer.serializeToString(stylesDoc))
  zip.file(sheetPath, serializer.serializeToString(sheetDoc))
}

async function resizeLinkedDocumentTables(zip: JSZip, mainName: string, sorted: CustomsItem[]) {
  const contractGroups = collectDocumentGroups(sorted, 'contract')
  const invoiceGroups = collectDocumentGroups(sorted, 'invoice')
  const globalContractGroups = contractGroups.filter(group => !group.indo)
  const indoContractGroups = contractGroups.filter(group => group.indo)
  const globalInvoiceGroups = invoiceGroups.filter(group => !group.indo)
  const indoInvoiceGroups = invoiceGroups.filter(group => group.indo)
  const tasks: Array<{
    path: string
    kind: LinkedTableKind
    sections: Array<{ start: number; end: number; totalRow: number; pruneStart?: number; group?: DocumentGroup }>
  }> = [
    { path: 'xl/worksheets/sheet3.xml', kind: 'contract', sections: [
      { start: 24, end: 40, totalRow: 41, pruneStart: 1, group: globalContractGroups[0] },
      { start: 78, end: 82, totalRow: 83, pruneStart: 54, group: globalContractGroups[1] },
      { start: 120, end: 127, totalRow: 128, pruneStart: 95, group: globalContractGroups[2] },
    ] },
    { path: 'xl/worksheets/sheet4.xml', kind: 'invoice', sections: [
      { start: 32, end: 47, totalRow: 48, pruneStart: 1, group: globalInvoiceGroups[0] },
      { start: 85, end: 90, totalRow: 91, pruneStart: 53, group: globalInvoiceGroups[1] },
      { start: 124, end: 130, totalRow: 131, pruneStart: 93, group: globalInvoiceGroups[2] },
    ] },
    { path: 'xl/worksheets/sheet5.xml', kind: 'contract', sections: [
      { start: 26, end: 32, totalRow: 33, pruneStart: 1, group: indoContractGroups[0] },
      { start: 71, end: 86, totalRow: 87, pruneStart: 45, group: indoContractGroups[1] },
    ] },
    { path: 'xl/worksheets/sheet6.xml', kind: 'invoice', sections: [
      { start: 24, end: 29, totalRow: 30, pruneStart: 1, group: indoInvoiceGroups[0] },
      { start: 56, end: 72, totalRow: 73, pruneStart: 32, group: indoInvoiceGroups[1] },
    ] },
    { path: 'xl/worksheets/sheet7.xml', kind: 'packing', sections: [
      { start: 24, end: 39, totalRow: 40, group: globalInvoiceGroups[0] },
      { start: 66, end: 71, totalRow: 72, group: globalInvoiceGroups[1] },
      { start: 99, end: 104, totalRow: 105, group: globalInvoiceGroups[2] },
      { start: 132, end: 137, totalRow: 138, group: indoInvoiceGroups[0] },
      { start: 164, end: 180, totalRow: 181, group: indoInvoiceGroups[1] },
    ] },
  ]
  for (const task of tasks) {
    const file = zip.file(task.path)
    if (!file) continue
    zip.file(task.path, resizeLinkedTableXml(await file.async('string'), task.sections, task.kind, mainName))
    await ensureLinkedTableGrid(zip, task.path, task.sections, task.kind)
  }
}

type ModernTableCoordinates = {
  contractStarts: number[]
  contractTotals: number[]
  invoiceStarts: number[]
  invoiceTotals: number[]
  packingStarts: number[]
  packingTotals: number[]
}

const RRI_TABLE_COORDINATES: ModernTableCoordinates = {
  contractStarts: [24, 68, 109, 152, 195, 237, 275, 319, 357, 399, 441, 492, 543, 585],
  contractTotals: [31, 72, 115, 158, 200, 239, 282, 322, 363, 404, 455, 506, 548, 590],
  invoiceStarts: [28, 70, 107, 146, 182, 219, 257, 292, 327, 363, 400, 447, 494, 531],
  invoiceTotals: [35, 76, 113, 150, 187, 225, 261, 296, 332, 368, 415, 462, 499, 536],
  packingStarts: [25, 59, 92, 124, 155, 185, 217, 247, 279, 309, 339, 380, 421, 453, 496],
  packingTotals: [32, 65, 97, 128, 158, 190, 220, 252, 282, 312, 353, 394, 426, 469, 502],
}

const RRM_TABLE_COORDINATES: ModernTableCoordinates = {
  contractStarts: [24, 75, 116, 158, 199, 246, 295, 345, 395, 445, 495, 544, 589, 633, 679],
  contractTotals: [38, 79, 121, 163, 208, 259, 308, 358, 408, 458, 508, 553, 597, 643, 688],
  invoiceStarts: [32, 83, 118, 160, 199, 240, 286, 333, 380, 427, 474, 519, 561, 601, 643],
  invoiceTotals: [46, 86, 123, 166, 208, 253, 299, 346, 393, 440, 487, 528, 569, 611, 652],
  packingStarts: [24, 64, 94, 124, 155, 189, 228, 267, 306, 345, 384, 423, 458, 492, 527],
  packingTotals: [38, 68, 98, 129, 164, 202, 241, 280, 319, 358, 397, 432, 466, 501, 535],
}

const INDONESIA_TABLE_COORDINATES = {
  contractStarts: [26, 71],
  contractTotals: [33, 87],
  invoiceStarts: [24, 56],
  invoiceTotals: [30, 73],
}

const RRI_INDONESIA_TABLE_COORDINATES = {
  contractStarts: [25],
  contractTotals: [41],
  invoiceStarts: [24],
  invoiceTotals: [40],
}

async function resizeModernLinkedDocumentTables(
  zip: JSZip,
  mainName: string,
  groups: LinkedDocumentGroup[],
  rri: boolean,
) {
  const parts = await workbookSheetParts(zip)
  const primaryGroups = groups.filter(group => !group.indo)
  const indonesiaGroups = groups.filter(group => group.indo)
  const coordinates = rri ? RRI_TABLE_COORDINATES : RRM_TABLE_COORDINATES
  const indonesiaCoordinates = rri ? RRI_INDONESIA_TABLE_COORDINATES : INDONESIA_TABLE_COORDINATES
  const asDocumentGroup = (group: LinkedDocumentGroup): DocumentGroup => ({
    contract: group.contract,
    invoice: group.invoice,
    indo: group.indo,
    indices: group.indices,
  })
  const sections = (
    starts: number[],
    totals: number[],
    sectionGroups: LinkedDocumentGroup[],
  ) => sectionGroups.map((group, index) => ({
    start: starts[index],
    end: totals[index] - 1,
    totalRow: totals[index],
    group: asDocumentGroup(group),
  }))
  const tasks: Array<{
    sheetName: string
    kind: LinkedTableKind
    sections: Array<{ start: number; end: number; totalRow: number; group: DocumentGroup }>
  }> = [
    {
      sheetName: rri ? '实业合同' : '全球合同',
      kind: 'contract',
      sections: sections(coordinates.contractStarts, coordinates.contractTotals, primaryGroups),
    },
    {
      sheetName: rri ? '实业发票' : '全球发票',
      kind: 'invoice',
      sections: sections(coordinates.invoiceStarts, coordinates.invoiceTotals, primaryGroups),
    },
    {
      sheetName: '装箱单',
      kind: 'packing',
      sections: sections(coordinates.packingStarts, coordinates.packingTotals, groups),
    },
    {
      sheetName: '印尼合同',
      kind: 'contract',
      sections: sections(
        indonesiaCoordinates.contractStarts,
        indonesiaCoordinates.contractTotals,
        indonesiaGroups,
      ),
    },
    {
      sheetName: '印尼发票',
      kind: 'invoice',
      sections: sections(
        indonesiaCoordinates.invoiceStarts,
        indonesiaCoordinates.invoiceTotals,
        indonesiaGroups,
      ),
    },
  ]
  for (const task of tasks) {
    if (!task.sections.length) continue
    const path = parts.get(task.sheetName)
    const file = path ? zip.file(path) : null
    if (!path || !file) continue
    zip.file(path, resizeLinkedTableXml(await file.async('string'), task.sections, task.kind, mainName))
    await ensureLinkedTableGrid(zip, path, task.sections, task.kind)
  }
}

async function mergeGeneratedValuesIntoTemplate(
  templateBuffer: ArrayBuffer,
  generatedZip: JSZip,
  finalSheetNames: string[],
  mainTotalRow?: number,
): Promise<JSZip> {
  const templateZip = await JSZip.loadAsync(templateBuffer)
  const workbookPath = 'xl/workbook.xml'
  const workbookFile = templateZip.file(workbookPath)
  if (workbookFile) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(await workbookFile.async('string'), 'application/xml')
    const sheets = Array.from(doc.getElementsByTagNameNS(SPREADSHEET_NS, 'sheet')) as XmlElement[]
    sheets.forEach((sheet, index) => {
      if (finalSheetNames[index]) sheet.setAttribute('name', finalSheetNames[index])
    })
    templateZip.file(workbookPath, new XMLSerializer().serializeToString(doc))
  }

  // 模板与生成文件的工作表顺序一致；第二张工作表是柜号主明细。
  for (let index = 1; index <= 15; index++) {
    const path = `xl/worksheets/sheet${index}.xml`
    const templateSheet = templateZip.file(path)
    const generatedSheet = generatedZip.file(path)
    if (!templateSheet || !generatedSheet) continue
    templateZip.file(path, mergeWorksheetXml(
      await templateSheet.async('string'),
      await generatedSheet.async('string'),
      index === 2,
      index === 2 ? mainTotalRow : undefined,
    ))
  }
  await applyGeneratedMainFormats(templateZip, generatedZip)
  // 主明细 M3 的模板批注只是旧版操作提示，导出文件不应再弹出。工作表中的
  // legacyDrawing 已移除，这里同时断开 comments/VML 关系，避免读取器仍加载批注。
  const mainRelsPath = 'xl/worksheets/_rels/sheet2.xml.rels'
  const mainRels = templateZip.file(mainRelsPath)
  if (mainRels) {
    const relsXml = (await mainRels.async('string'))
      .replace(/<Relationship\b[^>]*\bType="[^"]*\/(?:comments|vmlDrawing)"[^>]*\/>/g, '')
    templateZip.file(mainRelsPath, relsXml)
  }
  return templateZip
}

async function injectOoxmlImages(
  zip: JSZip, mainSheetIdx: number,
  rowsWithImage: { rowZeroIdx: number; bytes: Uint8Array; ext: string }[],
) {
  if (!rowsWithImage.length) return
  let mediaSeq = 100
  while (zip.file('xl/media/image' + mediaSeq + '.png') || zip.file('xl/media/image' + mediaSeq + '.jpeg')) mediaSeq++
  const mediaEntries: { path: string; num: number; rowZeroIdx: number }[] = []
  for (const r of rowsWithImage) {
    const path = 'xl/media/image' + mediaSeq + '.' + r.ext
    zip.file(path, r.bytes)
    mediaEntries.push({ path, num: mediaSeq, rowZeroIdx: r.rowZeroIdx })
    mediaSeq++
  }
  const drawingNum = 999
  const drawingPath = 'xl/drawings/drawing' + drawingNum + '.xml'
  const drawingRelsPath = 'xl/drawings/_rels/drawing' + drawingNum + '.xml.rels'
  let anchors = '', relsItems = ''
  mediaEntries.forEach((m, i) => {
    const rid = 'rId' + (i + 1)
    anchors += `<xdr:oneCellAnchor>
  <xdr:from><xdr:col>19</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${m.rowZeroIdx}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
  <xdr:ext cx="600000" cy="600000"/>
  <xdr:pic>
    <xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Picture ${i + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr>
    <xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
    <xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="600000" cy="600000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
  </xdr:pic>
  <xdr:clientData/>
</xdr:oneCellAnchor>`
    relsItems += `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m.path.split('/').pop()}"/>`
  })
  zip.file(drawingPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`)
  zip.file(drawingRelsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsItems}</Relationships>`)
  const sheetRelsPath = 'xl/worksheets/_rels/sheet' + mainSheetIdx + '.xml.rels'
  const sheetRelsFile = zip.file(sheetRelsPath)
  let relsXml = sheetRelsFile ? await sheetRelsFile.async('string')
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  const newRid = 'rIdGenDrawing999'
  // 模板本身带有样例图片 drawing。正式导出必须完全换成当前物料图片，
  // 否则旧 drawing 会占用工作表唯一的 drawing 节点，动态图片无法显示。
  relsXml = relsXml.replace(/<Relationship\b[^>]*\bType="[^"]*\/drawing"[^>]*\/>/g, '')
  relsXml = relsXml.replace('</Relationships>',
    `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNum}.xml"/></Relationships>`)
  zip.file(sheetRelsPath, relsXml)
  const sheetPath = 'xl/worksheets/sheet' + mainSheetIdx + '.xml'
  let sheetXml = await zip.file(sheetPath)!.async('string')
  sheetXml = sheetXml.replace(/<(?:\w+:)?drawing\b[^>]*\/>/g, '')
  sheetXml = sheetXml.replace(/<\/(?:\w+:)?worksheet>/, match => `<drawing r:id="${newRid}"/>${match}`)
  zip.file(sheetPath, sheetXml)
  let ct = await zip.file('[Content_Types].xml')!.async('string')
  if (!ct.includes('Extension="png"')) {
    ct = ct.replace(/<Types[^>]*>/, m => m + '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>')
  }
  if (!ct.includes('drawing' + drawingNum + '.xml')) {
    ct = ct.replace('</Types>',
      `<Override PartName="/xl/drawings/drawing${drawingNum}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`)
  }
  zip.file('[Content_Types].xml', ct)
}
