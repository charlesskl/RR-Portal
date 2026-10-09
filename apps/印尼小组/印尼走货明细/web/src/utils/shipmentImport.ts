import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import type { Material } from '../api/client'
import { extractSheetImages } from './engineeringImport'
import { readToolPrice } from './toolPrice'
import { shipmentKgWeight, shipmentPackingAverageQty, shipmentWeightQuantity } from './shipmentWeight'

export interface ShipmentImportItem {
  material_snapshot: Material
  qty?: number; kg?: number; cartons?: number; carton_group?: string; carton_no?: string
  qty_per_carton?: string; weighing_qty?: number; purchase_unit?: string; pallet?: string
  price?: number; currency?: string; supplier?: string; customs_company?: string
  po_no?: string; po_date?: string; contract_no?: string; contract_date?: string
  invoice_no?: string; invoice_date?: string; product_use?: string; formula_name?: string; bl_head?: string
}
export interface ShipmentImportRow { key: string; sheet: string; row: number; imageCol: number; selected: boolean; warnings: string[]; item: ShipmentImportItem }
export interface ShipmentImportResult { rows: ShipmentImportRow[]; warnings: string[] }
export interface ExistingShipmentImportRow {
  material_snapshot?: Material; supplier?: string; customs_company?: string; po_no?: string; outbound_id?: number
}
export function planShipmentImport(imported: ShipmentImportItem[], existing: ExistingShipmentImportRow[]) {
  const targets = imported.map(item => {
    const source = item.material_snapshot
    const matches = existing.flatMap((row, index) => {
      const m = row.material_snapshot
      if (!m || !norm(source.name_zh) || norm(m.name_zh) !== norm(source.name_zh)) return []
      if (norm(m.product_code || m.related_product_code) !== norm(source.product_code || source.related_product_code)) return []
      if (norm(m.spec) !== norm(source.spec)) return []
      if (norm(row.supplier || m.supplier) !== norm(item.supplier || source.supplier)) return []
      if (item.customs_company && norm(row.customs_company || m.customs_company) !== norm(item.customs_company)) return []
      if (item.po_no && norm(row.po_no) !== norm(item.po_no)) return []
      return [index]
    })
    return matches.length > 1 ? -2 : matches.length === 1 ? (existing[matches[0]].outbound_id ? -3 : matches[0]) : -1
  })
  return targets.map(target => target >= 0 && targets.filter(t => t === target).length > 1 ? -2 : target)
}
const text = (v: unknown) => String(v ?? '').trim()
const norm = (v: unknown) => text(v).normalize('NFKC').replace(/\s+/g, '').toLowerCase()
const units: Record<string, string> = { kg: 'KGM', kgm: 'KGM', 公斤: 'KGM', 千克: 'KGM', 个: 'PCE', 件: 'PCE', pcs: 'PCE', pce: 'PCE', set: 'SET', 套: 'SET', tne: 'TNE', 吨: 'TNE', m: 'MTR', 米: 'MTR' }
const currencies: Record<string, string> = { CNY: '¥', USD: 'US$', HKD: 'HK$', IDR: 'IDR' }

export function parseShipmentWorkbook(wb: XLSX.WorkBook): ShipmentImportResult {
  const rows: ShipmentImportRow[] = [], warnings: string[] = []
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet]
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    if (range.e.r > 10000 || range.e.c > 200) { warnings.push(`${sheet}：范围过大，未读取`); continue }
    let hi = -1, names: string[] = []
    for (let r = 0; r <= Math.min(range.e.r, 29); r++) {
      const candidate = Array.from({ length: range.e.c + 1 }, (_, c) => norm(ws[XLSX.utils.encode_cell({ r, c })]?.v))
      if (candidate.some(n => n.startsWith('产品中文名称')) && candidate.some(n => n.startsWith('货号'))) {
        hi = r; names = candidate; break
      }
    }
    if (hi < 0) continue // Contracts, invoices and summary sheets are not source detail.
    const col = (...labels: string[]) => {
      const candidates = labels.map(norm)
      const exact = names.findIndex(n => candidates.includes(n))
      return exact >= 0 ? exact : names.findIndex(n => candidates.some(label => n.startsWith(label)))
    }
    const unitCols = names.map((n, i) => n.startsWith('单位') ? i : -1).filter(i => i >= 0)
    const cartonCol = col('箱数'), imageCol = col('图片')
    for (let r = hi + 1; r <= range.e.r; r++) {
      const notices: string[] = []
      const cell = (c: number, inherit = true): XLSX.CellObject | undefined => {
        if (c < 0) return undefined
        if (inherit) {
          const merge = ws['!merges']?.find(m => m.s.c === c && m.e.c === c && m.s.r <= r && m.e.r >= r)
          if (merge) return ws[XLSX.utils.encode_cell(merge.s)]
        }
        return ws[XLSX.utils.encode_cell({ r, c })]
      }
      const value = (c: number, inherit = true) => {
        const x = cell(c, inherit)
        if (x?.t === 'e' || (x?.f && x.v == null)) { notices.push(`${XLSX.utils.encode_col(c)}${r + 1} 公式无有效结果，未带入`); return undefined }
        return x?.v
      }
      const str = (...labels: string[]) => {
        const c = col(...labels), x = cell(c)
        const v = value(c)
        return v == null ? '' : typeof v === 'number' && x?.w && /^0+$/.test(String(x.z || '')) ? x.w : text(v)
      }
      const number = (labels: string[], dimension = false, inherit = true) => {
        const v = value(col(...labels), inherit)
        if (v == null || v === '') return undefined
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
        const match = text(v).replace(/,/g, '').match(dimension ? /^(\d+(?:\.\d+)?)\s*(cm|mm|m|厘米|毫米|米)?$/i : /^(\d+(?:\.\d+)?)$/)
        if (!match) { notices.push(`${labels[0]}无法识别：${text(v)}`); return undefined }
        const u = (match[2] || '').toLowerCase()
        return Number(match[1]) * (['mm', '毫米'].includes(u) ? 0.1 : ['m', '米'].includes(u) ? 100 : 1)
      }
      const date = (...labels: string[]) => {
        const v = value(col(...labels))
        if (v == null || v === '') return undefined
        const parts = typeof v === 'number' ? XLSX.SSF.parse_date_code(v, { date1904: !!wb.Workbook?.WBProps?.date1904 }) : null
        const match = text(v).match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:\s.*)?$/)
        const [y, m, d] = parts ? [parts.y, parts.m, parts.d] : match ? match.slice(1).map(Number) : [0, 0, 0]
        const check = new Date(Date.UTC(y, m - 1, d))
        if (y < 1900 || y > 2200 || check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
          notices.push(`${labels[0]}日期无效，未带入`); return undefined
        }
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      }
      const name = text(value(col('产品中文名称'), false))
      if (!name || /^(合计|总计|总合计|产品中文名称|total)/i.test(name)) continue
      const unitText = text(value(unitCols[0] ?? -1)).toLowerCase()
      const unit = units[unitText] || unitText.toUpperCase()
      const qtyExplicit = number(['送货数量', '产品数量'])
      const demand = number(['需求数量'])
      const qty = qtyExplicit ?? (!['KGM', 'TNE'].includes(unit) ? demand : undefined)
      if (qty == null) notices.push('未明确提供件数，请核对送货数量（重量不能当件数）')
      const material: Material = {
        product_code: str('货号'), name_zh: name, name_en: str('产品英文名称'), spec: str('规格'),
        category: str('类别'), unit_kg: unit || undefined, supplier: str('供应商'),
        hs_cn: str('中国HSCODE'), hs_id: str('印尼HSCODE', '印尼编码'), material_code: str('物料编码', '物料编号'),
        customs_company: str('报关出口公司', '报关公司'),
        length: number(['箱长', '长'], true), width: number(['箱宽', '宽'], true), height: number(['箱高', '高'], true),
        net_per_pc: number(['单个净重', '单件净重']), gross_per_pc: number(['单个毛重', '单件毛重']),
        weight_per_carton: number(['每箱重量', '每箱毛重']),
      }
      const use = str('产品用途')
      if (['工具', '模具', '耗材'].includes(use)) material.tool_kind = '工具'
      else if (['机器设备', '设备', '机器'].includes(use)) material.tool_kind = '机器设备'
      const qpc = str('每箱数量')
      const weightQty = shipmentWeightQuantity(name, qty)
      const grossTotal = number(['毛重总重'], false, false), netTotal = number(['净重总重'], false, false)
      if (material.net_per_pc == null && netTotal != null && weightQty > 0) material.net_per_pc = netTotal / weightQty
      if (material.gross_per_pc == null && grossTotal != null && weightQty > 0) material.gross_per_pc = grossTotal / weightQty
      const weighing = number(['称重数量']) ?? shipmentWeightQuantity(name, shipmentPackingAverageQty(qpc))
      // Preserve a supplied per-piece gross weight without treating total weight as per-carton weight.
      const effectiveWeighing = weighing > 0 ? weighing : material.gross_per_pc != null ? 1 : undefined
      if (material.weight_per_carton == null && material.gross_per_pc != null && effectiveWeighing) material.weight_per_carton = material.gross_per_pc * effectiveWeighing
      const price = readToolPrice(cell(col('采购单价')), str('币种', 'Currency'))
      if (price.price != null && !price.currency) notices.push('采购币种未明确，请选择后导入')
      if (price.conflict) notices.push('采购单价格式与币种冲突，请核对')
      let po = str('采购单号')
      const poCell = cell(col('采购单号'))
      if (poCell && typeof poCell.v === 'number' && XLSX.SSF.is_date(poCell.z || '')) { po = ''; notices.push('采购单号为日期格式，未当作订单号导入') }
      const cartonMerge = ws['!merges']?.find(m => m.s.c === cartonCol && m.e.c === cartonCol && m.e.r > m.s.r && m.s.r <= r && m.e.r >= r)
      const item: ShipmentImportItem = {
        material_snapshot: material, qty, kg: number(['送货KG重量', '送货重量']) ?? (['KGM', 'TNE'].includes(unit) ? demand : undefined) ??
          (qty != null ? shipmentKgWeight(unit, qty, material.net_per_pc, name) : undefined),
        cartons: number(['箱数']), carton_group: cartonMerge ? `source:${sheet}:${cartonMerge.s.r}` : undefined,
        carton_no: str('箱号'), pallet: str('卡板', '卡板号'), qty_per_carton: qpc, weighing_qty: effectiveWeighing,
        purchase_unit: text(value(unitCols[1] ?? -1)) || unitText || undefined,
        price: price.price, currency: price.currency ? currencies[price.currency] : undefined,
        supplier: material.supplier, customs_company: material.customs_company,
        po_no: po, po_date: date('采购单日期'), contract_no: str('合同号码', '合同编号'),
        contract_date: date('合同日期'), invoice_no: str('发票号'), invoice_date: date('发票日期'),
        product_use: str('产品用途'), formula_name: str('套公式名称栏') || name, bl_head: str('提单抬头'),
      }
      if (item.cartons != null && !Number.isInteger(item.cartons)) { notices.push('箱数不是整数，未带入'); item.cartons = undefined }
      if (material.net_per_pc != null && material.gross_per_pc != null && material.net_per_pc > material.gross_per_pc)
        notices.push('单件净重大于毛重，已保留源值，请核对')
      rows.push({ key: `${sheet}:${r + 1}`, sheet, row: r + 1, imageCol, selected: true, warnings: notices, item })
    }
  }
  if (!rows.length) warnings.push('未识别到含货号、产品中文名称的主明细表')
  return { rows, warnings }
}

export async function importShipmentFile(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error('文件不能超过 20MB')
  const buffer = await file.arrayBuffer()
  const parsed = parseShipmentWorkbook(XLSX.read(buffer, { type: 'array', cellNF: true }))
  if (parsed.rows.length > 500) throw new Error('一次最多导入 500 行，请分批导入')
  const zip = await JSZip.loadAsync(buffer)
  for (const sheet of new Set(parsed.rows.map(row => row.sheet))) {
    const images = await extractSheetImages(zip, sheet, true)
    for (const row of parsed.rows.filter(row => row.sheet === sheet)) {
      const matched = images.filter(image => image.row === row.row - 1 && image.col === row.imageCol)
      if (matched.length === 1) row.item.material_snapshot.image = matched[0].dataUrl
      else if (matched.length > 1) row.warnings.push('多张图片对应同一行，未自动选择')
    }
  }
  return parsed
}

export function matchShipmentMaterial(source: Material, candidates: Material[]) {
  const matches = candidates.filter(m => m.active !== false && norm(m.name_zh) === norm(source.name_zh) &&
    (!source.product_code || norm(m.product_code || m.related_product_code) === norm(source.product_code)) &&
    (!source.spec || norm(m.spec) === norm(source.spec)) &&
    (!source.supplier || norm(m.supplier) === norm(source.supplier)))
  if (matches.length !== 1) return { material: source, matches: matches.length }
  const provided = Object.fromEntries(Object.entries(source).filter(([, v]) => v != null && v !== ''))
  return { material: { ...matches[0], ...provided }, matches: 1 }
}
