import * as XLSX from 'xlsx'
import type { Order } from '../types/order'

export interface PriceExcelFile {
  name: string
  arrayBuffer: () => Promise<ArrayBuffer>
}

export interface PriceImportRow {
  sheet: string
  rowNumber: number
  factory: string
  itemNo: string
  product: string
  quoteLaborPrice: number
}

export interface PriceImportParseResult {
  rows: PriceImportRow[]
  invalidRows: number
  unrecognizedSheets: string[]
}

export interface PriceImportMatchResult {
  updates: { order: Order; quoteLaborPrice: number }[]
  matchedRows: number
  unmatchedRows: PriceImportRow[]
  ambiguousRows: PriceImportRow[]
  conflictingRows: PriceImportRow[]
}

const text = (value: unknown) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, '')
const normalized = (value: unknown) => text(value).toLowerCase()
const header = (value: unknown) => normalized(value).replace(/[()（）\[\]【】]/g, '')

function isFactoryHeader(value: unknown) {
  const h = header(value)
  return h === '加工厂' || h.includes('加工厂名称') || h.includes('供应商名称')
}
function isItemHeader(value: unknown) {
  const h = header(value)
  return h === '货号' || h.includes('合同号/货号') || h.includes('款号')
}
function isProductHeader(value: unknown) {
  const h = header(value)
  return h.includes('工序名称') || h.includes('配件名称') || h.includes('货品名称') || h === '产品名称'
}
function isQuoteHeader(value: unknown) {
  const h = header(value)
  return h.includes('核价') && (h.includes('工价') || h.includes('生产工价'))
}

function findColumn(rows: unknown[][], endRow: number, predicate: (value: unknown) => boolean): number {
  for (let r = endRow; r >= Math.max(0, endRow - 3); r--) {
    const index = (rows[r] ?? []).findIndex(predicate)
    if (index >= 0) return index
  }
  return -1
}

function numericPrice(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  const cleaned = String(value ?? '').replace(/[￥¥,元\s]/g, '')
  if (!cleaned) return null
  const result = Number(cleaned)
  return Number.isFinite(result) && result >= 0 ? result : null
}

export async function parsePriceStatsExcel(file: PriceExcelFile): Promise<PriceImportParseResult> {
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true })
  const result: PriceImportParseResult = { rows: [], invalidRows: 0, unrecognizedSheets: [] }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true })
    const quoteHeaderRow = rows.slice(0, 30).findIndex((row) => row.some(isQuoteHeader))
    if (quoteHeaderRow < 0) {
      result.unrecognizedSheets.push(sheetName)
      continue
    }
    const factoryCol = findColumn(rows, quoteHeaderRow, isFactoryHeader)
    const itemCol = findColumn(rows, quoteHeaderRow, isItemHeader)
    const productCol = findColumn(rows, quoteHeaderRow, isProductHeader)
    const quoteCol = findColumn(rows, quoteHeaderRow, isQuoteHeader)
    if ([itemCol, productCol, quoteCol].some((col) => col < 0)) {
      result.unrecognizedSheets.push(sheetName)
      continue
    }

    for (let r = quoteHeaderRow + 1; r < rows.length; r++) {
      const row = rows[r] ?? []
      // 加工厂名称仅保留在结果中用于导入报告，不参与匹配。
      const factory = factoryCol >= 0 ? text(row[factoryCol]) : ''
      const itemNo = text(row[itemCol])
      const product = text(row[productCol])
      const price = numericPrice(row[quoteCol])
      const hasAnyImportValue = !!(itemNo || product || text(row[quoteCol]))
      if (!hasAnyImportValue) continue
      if (!itemNo || !product || price == null) {
        result.invalidRows++
        continue
      }
      result.rows.push({ sheet: sheetName, rowNumber: r + 1, factory, itemNo, product, quoteLaborPrice: price })
    }
  }
  return result
}

function itemKeys(value: unknown): Set<string> {
  const full = normalized(value).replace(/[\\]/g, '/')
  const keys = new Set([full])
  for (const part of full.split('/')) if (part) keys.add(part)
  return keys
}

function sameItem(a: unknown, b: unknown): boolean {
  const left = itemKeys(a)
  const right = itemKeys(b)
  return [...left].some((key) => right.has(key))
}

export function matchPriceImportRows(importRows: PriceImportRow[], orders: Order[]): PriceImportMatchResult {
  const updates = new Map<string, { order: Order; quoteLaborPrice: number }>()
  const conflictedOrderIds = new Set<string>()
  const result: PriceImportMatchResult = {
    updates: [], matchedRows: 0, unmatchedRows: [], ambiguousRows: [], conflictingRows: [],
  }
  for (const row of importRows) {
    const matches = orders.filter((order) =>
      sameItem(order.item_no, row.itemNo)
      && normalized(order.product) === normalized(row.product))
    if (!matches.length) {
      result.unmatchedRows.push(row)
      continue
    }
    const hasConflict = matches.some((order) => {
      const queued = updates.get(order.id)
      return queued != null && queued.quoteLaborPrice !== row.quoteLaborPrice
    })
    if (hasConflict) {
      result.conflictingRows.push(row)
      for (const order of matches) {
        updates.delete(order.id)
        conflictedOrderIds.add(order.id)
      }
      continue
    }
    if (matches.some((order) => conflictedOrderIds.has(order.id))) {
      result.conflictingRows.push(row)
      continue
    }
    for (const order of matches) updates.set(order.id, { order, quoteLaborPrice: row.quoteLaborPrice })
    result.matchedRows++
  }
  result.updates = [...updates.values()]
  return result
}
