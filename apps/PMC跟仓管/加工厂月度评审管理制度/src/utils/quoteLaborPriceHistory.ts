import type { Order } from '../types/order'
import { splitSewingContractItemNo } from './deliveryReportFormat'

type QuoteHistoryOrder = Pick<Order, 'id' | 'quote_labor_price' | 'order_date' | 'created' | 'updated'>
  & Partial<Pick<Order, 'mold_no' | 'item_no' | 'product'>>

/** 忽略用户容易输入的首尾空格和英文大小写差异，其余字符仍需完全相同。 */
export function normalizeMoldNumber(value: unknown) {
  return String(value ?? '').trim().toUpperCase()
}

/** 货号和物料名称各自精确匹配，仅忽略首尾空格及英文大小写。 */
export function normalizeQuoteMatchText(value: unknown) {
  return String(value ?? '').trim().toUpperCase()
}

export function itemProductQuoteKey(itemNumber: unknown, product: unknown, sewing = false) {
  const visibleItemNumber = sewing ? splitSewingContractItemNo(itemNumber).itemNo : itemNumber
  const itemKey = normalizeQuoteMatchText(visibleItemNumber)
  const productKey = normalizeQuoteMatchText(product)
  return itemKey && productKey ? `${itemKey}\u0000${productKey}` : ''
}

export function needsHistoricalQuote(value: unknown) {
  if (value == null || value === '') return true
  const price = Number(value)
  return !Number.isFinite(price) || price <= 0
}

function validHistoricalQuote(value: unknown): number | null {
  const price = Number(value)
  return Number.isFinite(price) && price > 0 ? price : null
}

function historyKey(order: QuoteHistoryOrder) {
  // 业务上以下单日期判断“最近”；同日再用建档/更新时间作为稳定次序。
  return [order.order_date ?? '', order.created ?? '', order.updated ?? '', order.id].join('\u0000')
}

/** 每个模具只保留最近一张订单中大于 0 的已保存核价。 */
export function buildLatestQuoteByMold(orders: readonly QuoteHistoryOrder[]) {
  const prices = new Map<string, number>()
  const newestFirst = [...orders].sort((a, b) => historyKey(b).localeCompare(historyKey(a)))
  for (const order of newestFirst) {
    const moldNumber = normalizeMoldNumber(order.mold_no)
    const price = validHistoricalQuote(order.quote_labor_price)
    if (moldNumber && price != null && !prices.has(moldNumber)) prices.set(moldNumber, price)
  }
  return prices
}

export function historicalQuoteForMold(prices: ReadonlyMap<string, number>, moldNumber: unknown) {
  const key = normalizeMoldNumber(moldNumber)
  return key ? prices.get(key) : undefined
}

/** 每个“货号 + 物料名称”组合只保留最近一张订单中大于 0 的已保存核价。 */
export function buildLatestQuoteByItemProduct(orders: readonly QuoteHistoryOrder[], sewing = false) {
  const prices = new Map<string, number>()
  const newestFirst = [...orders].sort((a, b) => historyKey(b).localeCompare(historyKey(a)))
  for (const order of newestFirst) {
    const key = itemProductQuoteKey(order.item_no, order.product, sewing)
    const price = validHistoricalQuote(order.quote_labor_price)
    if (key && price != null && !prices.has(key)) prices.set(key, price)
  }
  return prices
}

export function historicalQuoteForItemProduct(
  prices: ReadonlyMap<string, number>,
  itemNumber: unknown,
  product: unknown,
  sewing = false,
) {
  const key = itemProductQuoteKey(itemNumber, product, sewing)
  return key ? prices.get(key) : undefined
}
