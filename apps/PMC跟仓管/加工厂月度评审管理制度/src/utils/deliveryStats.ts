import * as XLSX from 'xlsx'
import type { Order } from '../types/order'
import { resolveFactoryName } from './factoryName'
import { cnyTaxToHkdUntaxed, DEFAULT_CNY_TO_HKD_RATE } from './orderPricing'

// 报表表头（单行）
export const DELIVERY_HEADERS = [
  '范围', '下单PMC', '加工厂', '货号', '模具编号', '订单号', '加工类别', '物料名称', '数量', '下单时间', '下单交货时间', '实际交货时间', '延迟时间',
  '订单总单数', '延期单数', '占比', '延期平均天数',
  '核价工价(港币不含税$)', '外发工价(港币不含税$)', '外发工价(人民币含税)', '换算汇率', '占比', '备注',
]

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: any) => Number(v) || 0
// 交期占比：整数百分比；合格率/客验货：1 位；价格占比：2 位
const pct0 = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '-')
const pct1 = (a: number, b: number) => (b ? (Math.round((a / b) * 1000) / 10).toFixed(1) + '%' : '-')
const pct2 = (a: number, b: number) => (b ? (Math.round((a / b) * 10000) / 100).toFixed(2) + '%' : '-')
const orderKey = (o: Order) => (o.order_no?.trim() ? `order:${o.order_no.trim().toLowerCase()}` : `id:${o.id}`)

export interface Metrics {
  orderCount: number
  delayedCount: number
  delayRatio: string
  delayAvg: string
  inspect: number
  qualified: number
  passRate: string
  returnCount: number
  custPassRate: string
  quote: number
  outPrice: number
  outPriceCnyTax: number
  priceRatio: string
}
export interface DetailRow extends Metrics {
  kind: 'detail'
  id: string
  range: string
  pmc: string
  factory: string
  item_no: string
  mold_no: string
  order_no: string
  category: string
  product: string
  quantity: number | null
  order_date: string
  delivery_date: string
  actual_delivery_date: string
  delay_days: number | null
  exchangeRate: number
  notes: string
  rangeSpan: number
  pmcSpan: number
  factorySpan: number
}
export interface SubtotalRow extends Metrics {
  kind: 'subtotal'
  factory: string
}
export type ReportRow = DetailRow | SubtotalRow

type OrderStat = {
  orderCount: number
  delayedCount: number
  delayRatio: string
  delayAvg: string
}

function uniqueOrderStats(os: Order[]): OrderStat {
  const byOrder = new Map<string, Order[]>()
  for (const o of os) {
    const key = orderKey(o)
    const group = byOrder.get(key)
    if (group) group.push(o)
    else byOrder.set(key, [o])
  }
  const delayedDays: number[] = []
  for (const group of byOrder.values()) {
    if (!group.some((o) => o.is_delayed)) continue
    delayedDays.push(Math.max(...group.map((o) => num(o.delay_days))))
  }
  return {
    orderCount: byOrder.size,
    delayedCount: delayedDays.length,
    delayRatio: pct0(delayedDays.length, byOrder.size),
    delayAvg: delayedDays.length ? String(r1(delayedDays.reduce((a, days) => a + days, 0) / delayedDays.length)) : '-',
  }
}

function detailOrderStats(os: Order[]) {
  const byOrder = new Map<string, Order[]>()
  const firstIds = new Set<string>()
  for (const o of os) {
    const key = orderKey(o)
    const group = byOrder.get(key)
    if (group) group.push(o)
    else {
      byOrder.set(key, [o])
      firstIds.add(o.id)
    }
  }

  const stats = new Map<string, OrderStat>()
  for (const group of byOrder.values()) {
    const delayed = group.some((o) => o.is_delayed) ? 1 : 0
    const delayAvg = delayed ? String(Math.max(...group.map((o) => num(o.delay_days)))) : '-'
    for (const o of group) {
      stats.set(o.id, firstIds.has(o.id)
        ? { orderCount: 1, delayedCount: delayed, delayRatio: pct0(delayed, 1), delayAvg }
        : { orderCount: 0, delayedCount: 0, delayRatio: '-', delayAvg: '-' })
    }
  }
  return stats
}

function metricsOf(os: Order[]): Metrics {
  const orderStats = uniqueOrderStats(os)
  const inspect = os.reduce((a, o) => a + num(o.inspect_count), 0)
  const qualified = os.reduce((a, o) => a + Math.max(0, num(o.inspect_count) - num(o.defect_count)), 0)
  const returnCount = os.reduce((a, o) => a + num(o.return_count), 0)
  const quote = r2(os.reduce((a, o) => a + num(o.quote_labor_price), 0))
  const outPrice = r2(os.reduce((a, o) => a + effectiveHkdPrice(o), 0))
  const outPriceCnyTax = r2(os.reduce((a, o) => a + num(o.unit_price_cny_tax), 0))
  return {
    orderCount: orderStats.orderCount,
    delayedCount: orderStats.delayedCount,
    delayRatio: orderStats.delayRatio,
    delayAvg: orderStats.delayAvg,
    inspect,
    qualified,
    passRate: pct1(qualified, inspect),
    returnCount,
    custPassRate: pct1(qualified - returnCount, inspect),
    quote,
    outPrice,
    outPriceCnyTax,
    priceRatio: pct2(outPrice, quote),
  }
}

function effectiveHkdPrice(order: Order) {
  const hkdPrice = num(order.unit_price)
  const cnyTaxPrice = num(order.unit_price_cny_tax)
  const exchangeRate = num(order.exchange_rate) || DEFAULT_CNY_TO_HKD_RATE
  return hkdPrice || (cnyTaxPrice ? cnyTaxToHkdUntaxed(cnyTaxPrice, exchangeRate) : 0)
}

export function buildDeliveryReport(
  orders: Order[],
  range: string,
  factoryName: (o: Order) => string,
): ReportRow[] {
  // 分组 下单PMC → 加工厂（保持组内相邻）
  const sorted = [...orders].sort((a, b) =>
    (a.pmc ?? '').localeCompare(b.pmc ?? '') ||
    factoryName(a).localeCompare(factoryName(b)))
  const pmcOrder: string[] = []
  const byPmc = new Map<string, Order[]>()
  for (const o of sorted) {
    const k = o.pmc ?? ''
    if (!byPmc.has(k)) { byPmc.set(k, []); pmcOrder.push(k) }
    byPmc.get(k)!.push(o)
  }
  type Block = { pmc: string; factories: { factory: string; orders: Order[] }[]; rows: number }
  const blocks: Block[] = []
  let totalRows = 0
  for (const pmc of pmcOrder) {
    const os = byPmc.get(pmc)!
    const facOrder: string[] = []
    const byFac = new Map<string, Order[]>()
    for (const o of os) {
      const fn = factoryName(o)
      if (!byFac.has(fn)) { byFac.set(fn, []); facOrder.push(fn) }
      byFac.get(fn)!.push(o)
    }
    const factories = facOrder.map((factory) => ({ factory, orders: byFac.get(factory)! }))
    const rows = factories.reduce((a, f) => a + f.orders.length + 1, 0) // +1 小计
    blocks.push({ pmc, factories, rows })
    totalRows += rows
  }

  const out: ReportRow[] = []
  let firstRow = true
  for (const block of blocks) {
    let pmcFirst = true
    for (const fac of block.factories) {
      let facFirst = true
      const orderStatsById = detailOrderStats(fac.orders)
      for (const o of fac.orders) {
        const inspect = num(o.inspect_count)
        const qualified = Math.max(0, inspect - num(o.defect_count))
        const returnCount = num(o.return_count)
        const quote = o.quote_labor_price ?? 0
        const outPrice = effectiveHkdPrice(o)
        const outPriceCnyTax = o.unit_price_cny_tax ?? 0
        const orderStats = orderStatsById.get(o.id) ?? {
          orderCount: 1,
          delayedCount: o.is_delayed ? 1 : 0,
          delayRatio: pct0(o.is_delayed ? 1 : 0, 1),
          delayAvg: o.delay_days != null ? String(o.delay_days) : '-',
        }
        out.push({
          kind: 'detail',
          id: o.id,
          range,
          pmc: block.pmc,
          factory: fac.factory,
          item_no: o.item_no ?? '',
          mold_no: o.mold_no ?? '',
          order_no: o.order_no ?? '',
          category: o.process_category ?? '',
          product: o.product ?? '',
          quantity: o.quantity ?? null,
          order_date: o.order_date ? o.order_date.slice(0, 10) : '',
          delivery_date: o.delivery_date ? o.delivery_date.slice(0, 10) : '',
          actual_delivery_date: o.actual_delivery_date ? o.actual_delivery_date.slice(0, 10) : '',
          delay_days: o.delay_days ?? null,
          exchangeRate: num(o.exchange_rate) || DEFAULT_CNY_TO_HKD_RATE,
          notes: o.notes ?? '',
          orderCount: orderStats.orderCount,
          delayedCount: orderStats.delayedCount,
          delayRatio: orderStats.delayRatio,
          delayAvg: orderStats.delayAvg,
          inspect,
          qualified,
          passRate: pct1(qualified, inspect),
          returnCount,
          custPassRate: pct1(qualified - returnCount, inspect),
          quote,
          outPrice,
          outPriceCnyTax,
          priceRatio: pct2(outPrice, quote),
          rangeSpan: firstRow ? totalRows : 0,
          pmcSpan: pmcFirst ? block.rows : 0,
          factorySpan: facFirst ? fac.orders.length + 1 : 0,
        })
        firstRow = false
        pmcFirst = false
        facFirst = false
      }
      out.push({ kind: 'subtotal', factory: fac.factory, ...metricsOf(fac.orders) })
    }
  }
  return out
}

// 导出交货延期统计表 Excel(标题行 + 合并单元格)
export function exportDeliveryExcel(rows: ReportRow[], title: string) {
  const H = DELIVERY_HEADERS
  const titleRow = new Array(H.length).fill('')
  titleRow[0] = title
  const body: any[][] = []
  const merges: any[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: H.length - 1 } }]
  rows.forEach((r, i) => {
    const rr = 2 + i
    if (r.kind === 'detail') {
      body.push([
        r.rangeSpan ? r.range : '', r.pmcSpan ? r.pmc : '', r.factorySpan ? r.factory : '',
        r.item_no, r.mold_no, r.order_no, r.category, r.product, r.quantity ?? '',
        r.order_date, r.delivery_date, r.actual_delivery_date, r.delay_days ?? '',
        r.orderCount, r.delayedCount, r.delayRatio, r.delayAvg, r.quote, r.outPrice, r.outPriceCnyTax, r.exchangeRate, r.priceRatio, r.notes,
      ])
      if (r.rangeSpan > 1) merges.push({ s: { r: rr, c: 0 }, e: { r: rr + r.rangeSpan - 1, c: 0 } })
      if (r.pmcSpan > 1) merges.push({ s: { r: rr, c: 1 }, e: { r: rr + r.pmcSpan - 1, c: 1 } })
      if (r.factorySpan > 1) merges.push({ s: { r: rr, c: 2 }, e: { r: rr + r.factorySpan - 1, c: 2 } })
    } else {
      body.push([
        '', '', '', `${r.factory}-小计`, '', '', '', '', '', '', '', '', '',
        r.orderCount, r.delayedCount, r.delayRatio, r.delayAvg, r.quote, r.outPrice, r.outPriceCnyTax, '', r.priceRatio, '',
      ])
      merges.push({ s: { r: rr, c: 3 }, e: { r: rr, c: 12 } })
    }
  })
  const ws = XLSX.utils.aoa_to_sheet([titleRow, H, ...body])
  ws['!merges'] = merges
  const cw = (v: any) => { let w = 0; for (const ch of String(v ?? '')) w += /[⺀-￿]/.test(ch) ? 2 : 1; return w }
  ws['!cols'] = H.map((h, c) => {
    let max = cw(h)
    for (const row of body) max = Math.max(max, cw(row[c]))
    return { wch: Math.min(Math.max(max + 2, 6), 32) }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '交货延期统计表')
  XLSX.writeFile(wb, `${title}.xlsx`)
}

const compactText = (s: any) => String(s ?? '').replace(/\s+/g, '')
const cleanText = (s: any) => String(s ?? '').trim()

function parseNumberCell(value: any): number | undefined {
  if (value === '' || value == null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const cleaned = String(value).replace(/[,，\s]/g, '').trim()
  if (!cleaned || /^[-－—]+$/.test(cleaned)) return undefined
  const next = Number(cleaned)
  return Number.isFinite(next) ? next : undefined
}

function formatImportDate(value: any): string {
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const text = cleanText(value)
  const m = text.match(/(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/)
  if (!m) return text
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

function factoryIdOf(factoryIdByName: Record<string, string>, name: string) {
  const factories = Object.entries(factoryIdByName).map(([factoryName, id]) => ({ id, name: factoryName }))
  const candidates = [name, name.replace(/[省市县区镇乡]/g, '')]
  for (const candidate of candidates) {
    const match = resolveFactoryName(factories, candidate)
    if (match.status === 'matched') return match.id
  }
  return undefined
}

function labeledValue(cells: any[], label: string, stopLabels: string[]) {
  const stops = stopLabels.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const labelPattern = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|[\\s　])${labelPattern}\\s*[:：]\\s*([\\s\\S]*?)(?=\\s*(?:${stops})\\s*[:：]|$)`)
  for (const cell of cells) {
    const match = cleanText(cell).match(pattern)
    if (match) return match[1].trim()
  }
  return ''
}

function parsePurchaseOrderImport(
  aoa: any[][],
  headerIdx: number,
  header: string[],
  factoryIdByName: Record<string, string>,
): { payloads: Record<string, any>[]; failed: number } {
  const colOf = (...al: string[]) => { for (const a of al) { const i = header.indexOf(compactText(a)); if (i >= 0) return i } return -1 }
  const C = {
    item_no: colOf('款号', '货号'),
    mold_no: colOf('模具编号'),
    product: colOf('物料名称', '货物名称', '产品名称'),
    category: colOf('加工内容', '加工类别'),
    qty: colOf('数量'),
    out: colOf('单价', '外发单价', '外发工价'),
    amount: colOf('金额'),
    notes: colOf('备注'),
  }
  const metaCells = aoa.slice(0, headerIdx).flat()
  const stopLabels = ['加工厂', '日期', '交货日期', '备注', '单号']
  const factoryName = labeledValue(metaCells, '加工厂', stopLabels)
  const orderDate = formatImportDate(labeledValue(metaCells, '日期', stopLabels))
  const deliveryDate = formatImportDate(labeledValue(metaCells, '交货日期', stopLabels))
  const metaNotes = labeledValue(metaCells, '备注', stopLabels)
  const orderNo = labeledValue(metaCells, '单号', stopLabels)
  const pmc = labeledValues(aoa, '操作员').at(-1) ?? ''
  const factoryId = factoryIdOf(factoryIdByName, factoryName)

  const payloads: Record<string, any>[] = []
  let failed = 0
  const cell = (row: any[], i: number) => (i >= 0 ? row[i] : '')
  for (const row of aoa.slice(headerIdx + 1)) {
    const product = cleanText(cell(row, C.product))
    const itemNo = cleanText(cell(row, C.item_no))
    if (!product && !itemNo) continue
    if (!product || !factoryId) { failed++; continue }
    const qty = parseNumberCell(cell(row, C.qty))
    const out = parseNumberCell(cell(row, C.out))
    const amount = parseNumberCell(cell(row, C.amount))
    const rowNotes = cleanText(cell(row, C.notes))
    const notes = [metaNotes, rowNotes].filter(Boolean).join(' ')
    const p: Record<string, any> = {
      factory: factoryId,
      pmc,
      product,
      item_no: itemNo,
      mold_no: cleanText(cell(row, C.mold_no)),
      order_no: orderNo,
      process_category: cleanText(cell(row, C.category)),
      notes,
      status: 'placed',
      is_delayed: false,
    }
    if (qty != null) p.quantity = qty
    if (orderDate) p.order_date = orderDate
    if (deliveryDate) p.delivery_date = deliveryDate
    if (out != null) p.unit_price = out
    if (amount != null) p.amount = amount
    else if (qty != null && out != null) p.amount = qty * out
    payloads.push(p)
  }
  return { payloads, failed }
}

function labeledValues(aoa: any[][], label: string, endRow = aoa.length) {
  const values: string[] = []
  const labelKey = compactText(label).replace(/[：:]$/, '')
  for (const row of aoa.slice(0, endRow)) {
    for (let i = 0; i < row.length; i++) {
      const text = cleanText(row[i])
      const compact = compactText(text)
      const match = compact.match(new RegExp(`^${labelKey}[：:]?(.*)$`))
      if (!match) continue
      if (match[1]) {
        values.push(match[1].trim())
        continue
      }
      for (let j = i + 1; j < row.length; j++) {
        const next = cleanText(row[j])
        if (next) { values.push(next); break }
      }
    }
  }
  return values
}

function parseSewingPurchaseOrderImport(
  aoa: any[][],
  headerIdx: number,
  header: string[],
  factoryIdByName: Record<string, string>,
): { payloads: Record<string, any>[]; failed: number } {
  const colContaining = (...aliases: string[]) => header.findIndex((cell) => aliases.some((alias) => cell.includes(compactText(alias))))
  const C = {
    item_no: colContaining('合同号/货号', '合同号', '货号'),
    product: colContaining('货品名称', '货物名称', '物料名称'),
    qty: colContaining('数量'),
    out: colContaining('单价'),
    amount: colContaining('金额'),
    notes: colContaining('备注'),
  }
  const factoryName = labeledValues(aoa, '供应商', headerIdx).at(-1) ?? ''
  const orderNo = labeledValues(aoa, '订单编号', headerIdx).at(-1) ?? ''
  const contacts = labeledValues(aoa, '联络人', headerIdx)
  const pmc = contacts.at(-1) ?? ''
  const allText = aoa.flat().map(cleanText).filter(Boolean)
  const orderDateText = labeledValues(aoa, '时间').at(-1) ?? ''
  const deliveryText = allText.find((text) => /前交货/.test(text) && /\d{4}\s*年/.test(text)) ?? ''
  const orderDate = formatImportDate(orderDateText)
  const deliveryDate = formatImportDate(compactText(deliveryText))
  const factoryId = factoryIdOf(factoryIdByName, factoryName)

  const payloads: Record<string, any>[] = []
  let failed = 0
  const cell = (row: any[], i: number) => (i >= 0 ? row[i] : '')
  for (const row of aoa.slice(headerIdx + 1)) {
    const itemNo = cleanText(cell(row, C.item_no))
    const product = cleanText(cell(row, C.product))
    if (!itemNo && !product) continue
    if (/合计|小计/.test(itemNo) || /合计|小计/.test(product)) continue
    if (!product) continue
    if (!factoryId) { failed++; continue }
    const qty = parseNumberCell(cell(row, C.qty))
    const out = parseNumberCell(cell(row, C.out))
    const amount = parseNumberCell(cell(row, C.amount))
    const p: Record<string, any> = {
      factory: factoryId,
      pmc,
      product,
      item_no: itemNo,
      order_no: orderNo,
      process_category: '车缝',
      notes: cleanText(cell(row, C.notes)),
      status: 'placed',
      is_delayed: false,
    }
    if (qty != null) p.quantity = qty
    if (out != null) p.unit_price = out
    if (amount != null) p.amount = amount
    else if (qty != null && out != null) p.amount = qty * out
    if (orderDate) p.order_date = orderDate
    if (deliveryDate) p.delivery_date = deliveryDate
    payloads.push(p)
  }
  return { payloads, failed }
}

function parseMoldingContractImport(
  aoa: any[][],
  headerIdx: number,
  header: string[],
  factoryIdByName: Record<string, string>,
): { payloads: Record<string, any>[]; failed: number } {
  const colOf = (...aliases: string[]) => header.findIndex((cell) => aliases.some((alias) => cell === compactText(alias)))
  const C = {
    item_no: colOf('款号', '货号'),
    mold_no: colOf('模具编号'),
    product: colOf('工模名称', '模具名称'),
    qty: header.indexOf('啤数') >= 0 ? header.indexOf('啤数') : colOf('数量'),
    out: colOf('加工单价', '单价'),
    amount: colOf('加工金额', '金额'),
    notes: colOf('备注'),
  }
  const metaBeforeHeader = aoa.slice(0, headerIdx)
  const factoryName = labeledValues(metaBeforeHeader, '供应商').at(-1) ?? ''
  const orderNo = labeledValues(metaBeforeHeader, '单号').at(-1) ?? ''
  const deliveryDate = formatImportDate(labeledValues(metaBeforeHeader, '交货日期').at(-1) ?? '')
  const orderDate = formatImportDate(labeledValues(aoa, '下单日期').at(-1) ?? '')
  const pmc = labeledValues(aoa, '操作员').at(-1) ?? labeledValues(aoa, '下单人').at(-1) ?? ''
  const factoryId = factoryIdOf(factoryIdByName, factoryName)

  const payloads: Record<string, any>[] = []
  let failed = 0
  const cell = (row: any[], i: number) => (i >= 0 ? row[i] : '')
  for (const row of aoa.slice(headerIdx + 1)) {
    const itemNo = cleanText(cell(row, C.item_no))
    const moldNo = cleanText(cell(row, C.mold_no))
    const product = cleanText(cell(row, C.product))
    if ((!itemNo && !moldNo) || !product || /合计|小计|备注/.test(itemNo || moldNo)) continue
    if (!factoryId) { failed++; continue }
    const qty = parseNumberCell(cell(row, C.qty))
    const out = parseNumberCell(cell(row, C.out))
    const amount = parseNumberCell(cell(row, C.amount))
    const p: Record<string, any> = {
      factory: factoryId,
      pmc,
      product,
      item_no: itemNo,
      mold_no: moldNo,
      order_no: orderNo,
      process_category: '啤机',
      notes: cleanText(cell(row, C.notes)),
      status: 'placed',
      is_delayed: false,
    }
    if (qty != null) p.quantity = qty
    if (out != null) p.unit_price_cny_tax = out
    if (amount != null) p.amount = amount
    else if (qty != null && out != null) p.amount = qty * out
    if (orderDate) p.order_date = orderDate
    if (deliveryDate) p.delivery_date = deliveryDate
    payloads.push(p)
  }
  return { payloads, failed }
}

// 解析导入的 Excel(识别表头、跳过小计、加工厂合并向下填充)→ 订单 payload 数组
export function parseDeliveryImport(
  aoa: any[][],
  factoryIdByName: Record<string, string>,
): { payloads: Record<string, any>[]; failed: number } {
  const norm = compactText
  const headerIdx = aoa.findIndex((row) => row.some((c) => {
    const text = norm(c)
    return ['货号', '款号', '物料名称', '订单号'].includes(text) || text.includes('合同号/货号') || text.includes('货品名称')
  }))
  if (headerIdx < 0) return { payloads: [], failed: 0 }
  const header = aoa[headerIdx].map(norm)
  const colOf = (...al: string[]) => { for (const a of al) { const i = header.indexOf(norm(a)); if (i >= 0) return i } return -1 }
  if (header.some((cell) => cell.includes('合同号/货号')) && header.some((cell) => cell.includes('含税价'))) {
    return parseSewingPurchaseOrderImport(aoa, headerIdx, header, factoryIdByName)
  }
  if (header.includes('款号') && header.includes('工模名称') && header.includes('加工单价')) {
    return parseMoldingContractImport(aoa, headerIdx, header, factoryIdByName)
  }
  if (header.includes('款号') && header.includes('加工内容') && header.includes('单价')) {
    return parsePurchaseOrderImport(aoa, headerIdx, header, factoryIdByName)
  }
  const C = {
    pmc: colOf('下单PMC'), factory: colOf('加工厂'), item_no: colOf('货号', '款号'), mold_no: colOf('模具编号'), order_no: colOf('订单号'),
    category: colOf('加工类别'), product: colOf('物料名称', '产品'), qty: colOf('数量'),
    order_date: colOf('下单时间', '下单日期'), delivery_date: colOf('下单交货时间', '交货日期'),
    actual: colOf('实际交货时间'), delay: colOf('延迟时间'), delayedCnt: colOf('延期单数'),
    inspect: colOf('验货总单数', '来料抽检单数'), qualified: colOf('合格单数'), ret: colOf('客退货单数'),
    quote: colOf('核价工价(港币不含税$)', '核价工价', '核价生产工价'),
    out: colOf('外发工价(港币不含税$)', '外发工价', '外发单价', '单价'), notes: colOf('备注'),
  }
  const cell = (row: any[], i: number) => (i >= 0 ? row[i] : '')
  const toDate = formatImportDate
  const payloads: Record<string, any>[] = []
  let lastFactory = ''
  let failed = 0
  for (const row of aoa.slice(headerIdx + 1)) {
    const itemRaw = String(cell(row, C.item_no) ?? '')
    const prod = String(cell(row, C.product) ?? '').trim()
    if (itemRaw.includes('小计') || prod.includes('小计') || prod.includes('合计')) continue
    let fname = String(cell(row, C.factory) ?? '').trim()
    if (fname) lastFactory = fname; else fname = lastFactory
    if (!prod && !fname) continue
    if (!prod) continue
    const factoryId = factoryIdOf(factoryIdByName, fname)
    if (!fname || !factoryId) { failed++; continue }
    const numv = (i: number) => parseNumberCell(cell(row, i))
    const str = (i: number) => { const v = cell(row, i); return v == null ? '' : String(v).trim() }
    const inspect = numv(C.inspect), qualified = numv(C.qualified), out = numv(C.out), qty = numv(C.qty)
    const p: Record<string, any> = {
      factory: factoryId, product: prod, pmc: str(C.pmc), order_no: str(C.order_no),
      item_no: str(C.item_no), mold_no: str(C.mold_no), process_category: str(C.category), notes: str(C.notes), status: 'placed',
    }
    if (qty != null) p.quantity = qty
    const od = cell(row, C.order_date); if (od) p.order_date = toDate(od)
    const dd = cell(row, C.delivery_date); if (dd) p.delivery_date = toDate(dd)
    const ad = cell(row, C.actual); if (ad) p.actual_delivery_date = toDate(ad)
    const delay = numv(C.delay); if (delay != null) p.delay_days = delay
    const dcnt = numv(C.delayedCnt)
    p.is_delayed = dcnt != null ? dcnt > 0 : (delay != null && delay > 0)
    if (inspect != null) p.inspect_count = inspect
    if (inspect != null && qualified != null) p.defect_count = Math.max(0, inspect - qualified)
    const ret = numv(C.ret); if (ret != null) p.return_count = ret
    const quote = numv(C.quote); if (quote != null) p.quote_labor_price = quote
    if (out != null) p.unit_price = out
    if (qty != null && out != null) p.amount = qty * out
    payloads.push(p)
  }
  return { payloads, failed }
}
