// 出口报关明细 Excel 导出（基于模板 template_报关明细.xlsx）
// 移植自旧 HTML 印尼走货明细生成系统.html 的 buildExcel(6408) / setCell(6395) /
//   excelDate(6402) / dataUrlToBytes(6588) / injectOoxmlImages(6598)
// 与清溪出货样表保持 1:1：56 列布局，表格样式从模板继承，
//   产品图片用 JSZip 注入到第 20 列(T)。
import * as XLSX from 'xlsx-js-style'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import type { Material } from '../api/client'
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
  items: CustomsItem[]                              // 已按显示顺序
  materials: Map<number, Material>                  // material_id → 物料主数据
  productHs: Map<string, { hsCN?: string; hsID?: string }> // product_code → 产品级 HS（兜底）
  images: Map<number, { bytes: Uint8Array; ext: string }>  // material_id → 图片
  form: CustomsExportForm
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
  if (!sheet['!cols']) return
  sheet['!cols'] = sheet['!cols'].map((column: any, index: number) => {
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

function populateLinkedDocuments(wb: XLSX.WorkBook, mainName: string, sorted: CustomsItem[], customer = '') {
  type Group = { contract: string; contractDate: string; invoice: string; invoiceDate: string; indices: number[] }
  type Slot = {
    contractHeader: string; contractDate: string; contractRows: [number, number]
    invoiceHeader: string; invoiceDate: string; invoiceContract: string; invoiceRows: [number, number]
    packingHeader: string; packingRows: [number, number]
  }
  const groups: Group[] = []
  const byKey = new Map<string, Group>()
  sorted.forEach((item, index) => {
    const contract = (item.contract_no || '').trim()
    const invoice = (item.invoice_no || '').trim()
    const key = `${contract}\u0000${invoice}`
    let group = byKey.get(key)
    if (!group) {
      group = {
        contract,
        contractDate: (item.contract_date || '').trim(),
        invoice,
        invoiceDate: (item.invoice_date || '').trim(),
        indices: [],
      }
      groups.push(group)
      byKey.set(key, group)
    }
    group.indices.push(index + 1)
  })

  const rri = customer.toUpperCase().includes('RRI')
  const contractSheet = wb.Sheets[rri ? '实业合同' : '全球合同']
  const invoiceSheet = wb.Sheets[rri ? '实业发票' : '全球发票']
  const packingSheet = wb.Sheets['装箱单']
  const slots: Slot[] = rri ? [
    { contractHeader: 'H5', contractDate: 'H9', contractRows: [24, 25], invoiceHeader: 'J9', invoiceDate: 'J11', invoiceContract: 'J13', invoiceRows: [29, 30], packingHeader: 'D9', packingRows: [25, 26] },
    { contractHeader: 'H50', contractDate: 'H54', contractRows: [68, 68], invoiceHeader: 'J53', invoiceDate: 'J55', invoiceContract: 'J57', invoiceRows: [73, 73], packingHeader: 'D45', packingRows: [61, 61] },
    { contractHeader: 'H89', contractDate: 'H93', contractRows: [108, 109], invoiceHeader: 'J91', invoiceDate: 'J93', invoiceContract: 'J95', invoiceRows: [111, 112], packingHeader: 'D79', packingRows: [95, 96] },
    { contractHeader: 'H133', contractDate: 'H137', contractRows: [152, 155], invoiceHeader: 'J130', invoiceDate: 'J132', invoiceContract: 'J134', invoiceRows: [150, 153], packingHeader: 'D112', packingRows: [128, 131] },
    { contractHeader: 'H177', contractDate: 'H181', contractRows: [196, 197], invoiceHeader: 'J168', invoiceDate: 'J170', invoiceContract: 'J172', invoiceRows: [188, 189], packingHeader: 'D145', packingRows: [161, 162] },
    { contractHeader: 'H223', contractDate: 'H227', contractRows: [241, 241], invoiceHeader: 'J208', invoiceDate: 'J210', invoiceContract: 'J212', invoiceRows: [228, 228], packingHeader: 'D182', packingRows: [198, 198] },
    { contractHeader: 'H266', contractDate: 'H270', contractRows: [284, 284], invoiceHeader: 'J249', invoiceDate: 'J251', invoiceContract: 'J253', invoiceRows: [269, 269], packingHeader: 'D219', packingRows: [235, 235] },
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

  const applyGroup = (group: Group | undefined, slot: Slot) => {
    setPreservingStyle(contractSheet, slot.contractHeader, group?.contract || '')
    setPreservingStyle(contractSheet, slot.contractDate, group?.contractDate ? excelDate(group.contractDate) : '')
    setPreservingStyle(invoiceSheet, slot.invoiceHeader, group?.invoice || '')
    setPreservingStyle(invoiceSheet, slot.invoiceDate, group?.invoiceDate ? excelDate(group.invoiceDate) : '')
    setPreservingStyle(invoiceSheet, slot.invoiceContract, group?.contract || '')
    setPreservingStyle(packingSheet, slot.packingHeader, group?.invoice || '')

    const fillContractRows = ([from, to]: number[]) => {
      for (let row = from; row <= to; row++) {
        const serial = group?.indices[row - from]
        const mainRow = serial != null ? serial + 3 : null
        setPreservingStyle(contractSheet, `A${row}`, serial ?? '')
        const refs: Record<string, string> = mainRow == null ? {} : {
          B: `D${mainRow}`,
          C: `G${mainRow}&'${mainName.replace(/'/g, "''")}'!F${mainRow}`,
          D: `K${mainRow}`,
          E: `J${mainRow}`,
          F: `Z${mainRow}`,
        }
        for (const col of ['B', 'C', 'D', 'E', 'F']) {
          const mainCell = refs[col]
          setPreservingStyle(contractSheet, `${col}${row}`, mainCell ? formulaRef(mainName, mainCell) : '', Boolean(mainCell))
        }
        setPreservingStyle(contractSheet, `G${row}`, mainRow == null ? '' : `=F${row}*D${row}`, mainRow != null)
        setPreservingStyle(contractSheet, `H${row}`, '')
      }
    }

    const fillInvoiceRows = ([from, to]: number[]) => {
      for (let row = from; row <= to; row++) {
        const serial = group?.indices[row - from]
        const mainRow = serial != null ? serial + 3 : null
        setPreservingStyle(invoiceSheet, `A${row}`, serial ?? '')
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
          setPreservingStyle(invoiceSheet, `${col}${row}`, mainCell ? formulaRef(mainName, mainCell) : '', Boolean(mainCell))
        }
        setPreservingStyle(invoiceSheet, `J${row}`, mainRow == null ? '' : `=I${row}*G${row}`, mainRow != null)
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
    fillPackingRows(slot.packingRows)
  }
  slots.forEach((slot, i) => applyGroup(groups[i], slot))

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

export async function buildCustomsWorkbook(input: CustomsExportInput): Promise<Blob> {
  const { templateBuffer, items, materials, productHs, images, form } = input
  const AUX = new Set(['类别金额', '实业合同', '实业发票', '全球合同', '全球发票', '印尼合同', '印尼发票', '装箱单', '商品汇总表', '发票',
    '出货地址', '销售合同', '装箱单 (2)', '草稿大单-1', '司机资料', '单位对照', 'WpsReserved_CellImgList'])
  // cellStyles 必须开启，否则重新写入时无法沿用模板的单元格样式。
  const wbObj = XLSX.read(templateBuffer, { type: 'array', cellFormula: true, cellStyles: true })
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
  const sorted = [...items].sort((a, b) => {
    const ca = effCustoms(a), cb = effCustoms(b)
    const wa = ca === CUSTOMS_FIXED ? 0 : (ca ? 1 : 2)
    const wb = cb === CUSTOMS_FIXED ? 0 : (cb ? 1 : 2)
    if (wa !== wb) return wa - wb
    const byC = ca.localeCompare(cb, 'zh')
    if (byC !== 0) return byC
    const sa = (a.supplier || matOf(a)?.supplier || '').trim()
    const sb = (b.supplier || matOf(b)?.supplier || '').trim()
    return sa.localeCompare(sb, 'zh')
  })
  const companyColor = new Map<string, string>()
  for (const item of sorted) {
    const company = effCustoms(item)
    if (company && !companyColor.has(company)) {
      companyColor.set(company, CUSTOMS_COMPANY_COLORS[companyColor.size % CUSTOMS_COMPANY_COLORS.length])
    }
  }

  populateLinkedDocuments(wbObj, newName, sorted, form.customer)
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
    setCell(ws, ri, 15, '=ROUND(BB' + (ri + 1) + '*L' + (ri + 1) + weightDivisor + ',2)', 'n')
    setCell(ws, ri, 16, '=ROUND(BC' + (ri + 1) + '*L' + (ri + 1) + weightDivisor + ',2)', 'n')
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
    setCell(ws, ri, 50, '', 's')
    setCell(ws, ri, 51, qpc, (typeof qpc === 'string' && /[^\d.]/.test(qpc)) ? 's' : 'n')
    setCell(ws, ri, 52, m?.weight_per_carton || 0, 'n')
    const weighingQty = it.weighing_qty ?? shipmentWeightQuantity(m?.name_zh, shipmentPackingAverageQty(qpc))
    setCell(ws, ri, 53, shipmentGrossPerPc(m?.weight_per_carton, weighingQty), 'n')
    ws[XLSX.utils.encode_cell({ r: ri, c: 53 })].f = `IFERROR(IF(BA${ri + 1}>0,BA${ri + 1}/${Number(weighingQty) || 0},0),0)`
    setCell(ws, ri, 54, m?.net_per_pc || 0, 'n')
    setCell(ws, ri, 55, it.pallet || '', 's')
  })

  // 发票及采购合计按连续的报关公司分组，只在每组首行显示。
  for (let start = 0; start < sorted.length;) {
    const company = effCustoms(sorted[start])
    let end = start
    while (end + 1 < sorted.length && effCustoms(sorted[end + 1]) === company) end++
    const firstRow = start + 4
    const lastRow = end + 4
    setCell(ws, start + 3, 27, `=SUM(AA${firstRow}:AA${lastRow})`, 'n')
    setCell(ws, start + 3, 42, `=SUM(AP${firstRow}:AP${lastRow})`, 'n')
    ;(ws as any)[XLSX.utils.encode_cell({ r: start + 3, c: 42 })].z = purchaseCurrencyFormat(sorted[start].currency)
    setCell(ws, start + 3, 43, company || tf.exportCompany, 's')
    setCell(ws, start + 3, 44, sorted[start].bl_head || tf.blHead, 's')
    if (end > start) {
      for (let index = start + 1; index <= end; index++) {
        setCell(ws, index + 3, 27, '')
        setCell(ws, index + 3, 42, '')
        setCell(ws, index + 3, 43, '')
        setCell(ws, index + 3, 44, '')
      }
      for (const column of [27, 42, 43, 44]) {
        ws['!merges']!.push({ s: { r: start + 3, c: column }, e: { r: end + 3, c: column } })
      }
    }
    start = end + 1
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
      if (color && c !== 4) {
        ;(ws as any)[addr].s = {
          ...((ws as any)[addr].s || {}),
          fill: { patternType: 'solid', fgColor: { rgb: color } },
        }
      }
    }
  }


  // 按字段用途强制数字格式，避免模板样例行的货币格式串列。
  const fixedFormats: Record<number, string> = {
    0: '0', 10: '0.0000', 11: '0.0000', 13: '"HK$"#,##0.0000', 14: '"HK$"#,##0.0000',
    15: '0.00', 16: '0.00', 17: '0.0000', 18: '0.0000',
    22: 'yyyy/m/d', 24: 'yyyy/m/d', 25: '"US$"#,##0.0000', 26: '"US$"#,##0.0000',
    27: '"US$"#,##0.0000', 29: 'yyyy/m/d', 31: 'yyyy/m/d', 38: 'yyyy/m/d',
    45: '0', 46: '0.0000', 47: '0.0000', 48: '0.0000', 52: '0.0000',
    53: '0.0000', 54: '0.0000',
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
  ws['!rows'] = rows
  ws['!autofilter'] = { ref: `A3:BD${Math.max(3, sorted.length + 3)}` }

  const out = XLSX.write(wbObj, { type: 'array', bookType: 'xlsx' })
  const outZip = await JSZip.loadAsync(out)
  await restoreTemplateDocumentStyles(templateBuffer, outZip, oldName, newName, sorted.map(effCustoms), sorted.map(item => item.currency || '¥'))
  if (floatImages.length) {
    const mainSheetIdx = wbObj.SheetNames.indexOf(newName) + 1
    await injectOoxmlImages(outZip, mainSheetIdx, floatImages)
  }
  return await outZip.generateAsync({ type: 'blob' })
}

async function workbookSheetParts(zip: JSZip): Promise<Map<string, string>> {
  const parser = new DOMParser()
  const workbook = parser.parseFromString(await zip.file('xl/workbook.xml')!.async('string'), 'application/xml')
  const rels = parser.parseFromString(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'), 'application/xml')
  const targets = new Map(Array.from(rels.getElementsByTagName('Relationship')).map(rel => [rel.getAttribute('Id') || '', rel.getAttribute('Target') || '']))
  const parts = new Map<string, string>()
  for (const sheet of Array.from(workbook.getElementsByTagName('sheet'))) {
    const target = targets.get(sheet.getAttribute('r:id') || '')
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
  const currencyNumFmt = new Map<string, string>()
  for (const node of Array.from(rawStyles.getElementsByTagName('numFmt'))) {
    const code = node.getAttribute('formatCode') || ''
    if (code.includes('US$') && code.includes('0.0000')) currencyNumFmt.set('US$', node.getAttribute('numFmtId') || '197')
    if (code.includes('HK$') && code.includes('0.000')) currencyNumFmt.set('HK$', node.getAttribute('numFmtId') || '178')
  }
  const derivedStyles = new Map<string, string>()
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
        }
      }
      cell.setAttribute('s', rawStyle ?? '0')
    }
    outputZip.file(outputPath, serializer.serializeToString(outputDoc))
  }
  rawXfs.setAttribute('count', String(xfNodes.length + derivedStyles.size))
  outputZip.file('xl/styles.xml', serializer.serializeToString(rawStyles))
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
  if (!relsXml.includes(newRid)) {
    relsXml = relsXml.replace('</Relationships>',
      `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNum}.xml"/></Relationships>`)
    zip.file(sheetRelsPath, relsXml)
  }
  const sheetPath = 'xl/worksheets/sheet' + mainSheetIdx + '.xml'
  let sheetXml = await zip.file(sheetPath)!.async('string')
  if (!sheetXml.includes('<drawing ')) {
    sheetXml = sheetXml.replace('</worksheet>', `<drawing r:id="${newRid}"/></worksheet>`)
    zip.file(sheetPath, sheetXml)
  }
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
