// 出口报关明细 Excel 导出（基于模板 template_报关明细.xlsx）
// 移植自旧 HTML 印尼走货明细生成系统.html 的 buildExcel(6408) / setCell(6395) /
//   excelDate(6402) / dataUrlToBytes(6588) / injectOoxmlImages(6598)
// 与清溪出货样表保持 1:1：56 列布局，表格样式从模板继承，
//   产品图片用 JSZip 注入到第 20 列(T)。
import * as XLSX from 'xlsx-js-style'
import JSZip from 'jszip'
import type { Material } from '../api/client'
import { isPaperRope, shipmentGrossPerPc, shipmentPackingAverageQty, shipmentWeightQuantity } from './shipmentWeight'

export const CUSTOMS_FIXED = '深圳市华胜益出口贸易有限公司'

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

function populateLinkedDocuments(wb: XLSX.WorkBook, mainName: string, sorted: CustomsItem[]) {
  type Group = { contract: string; invoice: string; indo: boolean; indices: number[] }
  const groups: Group[] = []
  const byKey = new Map<string, Group>()
  sorted.forEach((item, index) => {
    const contract = (item.contract_no || '').trim()
    const invoice = (item.invoice_no || '').trim()
    const head = (item.bl_head || '').trim()
    const indo = /印尼|INDONESIA|MANUFACTURING/i.test(head)
    const key = `${contract}\u0000${invoice}\u0000${indo ? 'ID' : 'GLOBAL'}`
    let group = byKey.get(key)
    if (!group) {
      group = { contract, invoice, indo, indices: [] }
      groups.push(group)
      byKey.set(key, group)
    }
    group.indices.push(index + 1)
  })

  let globalGroups = groups.filter(g => !g.indo)
  let indoGroups = groups.filter(g => g.indo)
  // 旧数据没有维护提单抬头时，沿用参考模板的 3 份全球单据 + 2 份印尼单据容量。
  if (!indoGroups.length && globalGroups.length > 3) {
    indoGroups = globalGroups.slice(3)
    globalGroups = globalGroups.slice(0, 3)
  }

  const globalSlots = [
    { contractHeader: 'H5', contractRows: [24, 40], invoiceHeader: 'J9', invoiceContract: 'J13', invoiceRows: [32, 47], packingHeader: 'D9', packingRows: [24, 39] },
    { contractHeader: 'H59', contractRows: [78, 82], invoiceHeader: 'J64', invoiceContract: 'J68', invoiceRows: [85, 90], packingHeader: 'D51', packingRows: [66, 71] },
    { contractHeader: 'H101', contractRows: [120, 127], invoiceHeader: 'J103', invoiceContract: 'J107', invoiceRows: [124, 130], packingHeader: 'D84', packingRows: [99, 104] },
  ]
  const indoSlots = [
    { contractHeader: 'H7', contractRows: [26, 32], invoiceHeader: 'J10', invoiceContract: 'J14', invoiceRows: [24, 29], packingHeader: 'D117', packingRows: [132, 137] },
    { contractHeader: 'H52', contractRows: [71, 86], invoiceHeader: 'J42', invoiceContract: 'J46', invoiceRows: [56, 72], packingHeader: 'D149', packingRows: [164, 180] },
  ]

  const applyGroup = (group: Group | undefined, slot: typeof globalSlots[number], indo: boolean) => {
    const contractSheet = wb.Sheets[indo ? '印尼合同' : '全球合同']
    const invoiceSheet = wb.Sheets[indo ? '印尼发票' : '全球发票']
    const packingSheet = wb.Sheets['装箱单']
    setPreservingStyle(contractSheet, slot.contractHeader, group?.contract || '')
    setPreservingStyle(invoiceSheet, slot.invoiceHeader, group?.invoice || '')
    setPreservingStyle(invoiceSheet, slot.invoiceContract, group?.contract || '')
    setPreservingStyle(packingSheet, slot.packingHeader, group?.invoice || '')
    const fillSerials = (sheet: XLSX.WorkSheet | undefined, [from, to]: number[]) => {
      for (let row = from; row <= to; row++) {
        setPreservingStyle(sheet, `A${row}`, group?.indices[row - from] ?? '')
      }
    }
    fillSerials(contractSheet, slot.contractRows)
    fillSerials(invoiceSheet, slot.invoiceRows)
    fillSerials(packingSheet, slot.packingRows)
  }
  globalSlots.forEach((slot, i) => applyGroup(globalGroups[i], slot, false))
  indoSlots.forEach((slot, i) => applyGroup(indoGroups[i], slot, true))

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
  normalizeWorkbookStyles(wbObj)
  const oldName = wbObj.SheetNames.find(n => !AUX.has(n))!
  const newName = (form.containerNo || '').trim() || oldName
  rewriteSheetReferences(wbObj, oldName, newName)
  replaceTemplateShipmentLiterals(wbObj, form, newName)
  wbObj.Sheets[newName] = wbObj.Sheets[oldName]
  if (newName !== oldName) delete wbObj.Sheets[oldName]
  wbObj.SheetNames = wbObj.SheetNames.map(n => n === oldName ? newName : n)
  const ws = wbObj.Sheets[newName]

  // 模板第 4 行是首个明细行；保留每列的样式和数字格式，供新明细行复用。
  const detailFormat = Array.from({ length: 56 }, (_, c) => {
    const cell: any = (ws as any)[XLSX.utils.encode_cell({ r: 3, c })]
    return cell ? { s: writableTemplateStyle(cell.s), z: cell.z } : undefined
  })
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

  // 报关公司分组（华胜益置顶），同组内按供应商相邻
  const matOf = (it: CustomsItem) => (it.material_id != null ? materials.get(it.material_id) : undefined)
  const effCustoms = (it: CustomsItem) => {
    const m = matOf(it)
    return ((it.customs_company || m?.customs_company || it.supplier || m?.supplier) || '').trim()
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

  populateLinkedDocuments(wbObj, newName, sorted)

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
    setCell(ws, ri, 4, it.formula_name || m?.name_zh || m?.item_no || '', 's')
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
    setCell(ws, ri, 17, '=AV' + (ri + 1) + '*AW' + (ri + 1) + '*AX' + (ri + 1) + '/1000000', 'n')
    setCell(ws, ri, 18, '=R' + (ri + 1) + '*AT' + (ri + 1), 'n')
    setCell(ws, ri, 20, it.product_use || '', 's')
    setCell(ws, ri, 21, it.contract_no || '', 's')
    if (it.contract_date) setCell(ws, ri, 22, excelDate(it.contract_date), 'n')
    setCell(ws, ri, 23, it.invoice_no || '', 's')
    if (it.invoice_date) setCell(ws, ri, 24, excelDate(it.invoice_date), 'n')
    if (it.invoice_price) setCell(ws, ri, 25, it.invoice_price, 'n')
    if (it.invoice_price) setCell(ws, ri, 26, '=Z' + (ri + 1) + '*L' + (ri + 1), 'n')
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
    setCell(ws, ri, 41, '=AO' + (ri + 1) + '*L' + (ri + 1), 'n')
    const currency = it.currency || '¥'
    const fmtMap: Record<string, string> = {
      '¥': '¥#,##0.0000', 'HK$': '"HK$"#,##0.0000', 'US$': '"US$"#,##0.0000',
      '€': '"€"#,##0.0000', '£': '"£"#,##0.0000', '¥(JPY)': '"¥"#,##0',
    }
    const fmt = fmtMap[currency] || '#,##0.0000'
    ;['AO', 'AP'].forEach((_col, j) => {
      const addr = XLSX.utils.encode_cell({ r: ri, c: 40 + j })
      if ((ws as any)[addr]) (ws as any)[addr].z = fmt
    })
    setCell(ws, ri, 43, it.customs_company || m?.customs_company || tf.exportCompany, 's')
    setCell(ws, ri, 44, it.bl_head || tf.blHead, 's')
    setCell(ws, ri, 45, it.cartons || 0, 'n')
    const qpc = it.qty_per_carton ?? 0
    setCell(ws, ri, 46, qpc, (typeof qpc === 'string' && /[^\d.]/.test(qpc)) ? 's' : 'n')
    setCell(ws, ri, 47, m?.length || 0, 'n')
    setCell(ws, ri, 48, m?.width || 0, 'n')
    setCell(ws, ri, 49, m?.height || 0, 'n')
    setCell(ws, ri, 50, m?.material_code || '', 's')
    setCell(ws, ri, 51, '', 's')
    setCell(ws, ri, 52, m?.weight_per_carton || 0, 'n')
    const weighingQty = it.weighing_qty ?? shipmentWeightQuantity(m?.name_zh, shipmentPackingAverageQty(qpc))
    setCell(ws, ri, 53, shipmentGrossPerPc(m?.weight_per_carton, weighingQty), 'n')
    ws[XLSX.utils.encode_cell({ r: ri, c: 53 })].f = `IFERROR(IF(BA${ri + 1}>0,BA${ri + 1}/${Number(weighingQty) || 0},0),0)`
    setCell(ws, ri, 54, m?.net_per_pc || 0, 'n')
    setCell(ws, ri, 55, it.pallet || '', 's')
  })
  if (sorted.length) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 3 + sorted.length - 1, c: 55 } })

  // 不再用代码重画样式；每个明细单元格都沿用模板第 4 行的对应列格式。
  for (let i = 0; i < sorted.length; i++) {
    const ri = 3 + i
    for (let c = 0; c < 56; c++) {
      const addr = XLSX.utils.encode_cell({ r: ri, c })
      if (!(ws as any)[addr]) (ws as any)[addr] = { v: '', t: 's' }
      const format = detailFormat[c]
      if (format?.s) (ws as any)[addr].s = cloneTemplateValue(format.s)
      if (!(ws as any)[addr].z && format?.z) (ws as any)[addr].z = format.z
    }
  }

  // 列宽、隐藏列和表头行高均由模板决定，只扩展新明细行的行高。
  const rows: any[] = ws['!rows'] || []
  for (let i = 0; i < sorted.length; i++) rows[3 + i] = cloneTemplateValue(templateDetailRow)
  ws['!rows'] = rows
  ws['!autofilter'] = { ref: `A3:BD${Math.max(3, sorted.length + 3)}` }

  const out = XLSX.write(wbObj, { type: 'array', bookType: 'xlsx' })
  const outZip = await JSZip.loadAsync(out)
  if (floatImages.length) {
    const mainSheetIdx = wbObj.SheetNames.indexOf(newName) + 1
    await injectOoxmlImages(outZip, mainSheetIdx, floatImages)
  }
  return await outZip.generateAsync({ type: 'blob' })
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
