import { describe, expect, it } from 'vitest'
import {
  buildLatestQuoteByItemProduct,
  buildLatestQuoteByMold,
  historicalQuoteForItemProduct,
  historicalQuoteForMold,
  needsHistoricalQuote,
} from '../src/utils/quoteLaborPriceHistory'

describe('注塑模具历史核价', () => {
  it('按模具编号带出最近一张订单的有效核价', () => {
    const prices = buildLatestQuoteByMold([
      { id: 'old', mold_no: 'FSMNFS-06M-01', quote_labor_price: 0.52, order_date: '2026-07-01' },
      { id: 'new', mold_no: ' fsmnfs-06m-01 ', quote_labor_price: 0.58, order_date: '2026-08-01' },
      { id: 'blank', mold_no: 'FSMNFS-06M-01', quote_labor_price: 0, order_date: '2026-09-01' },
    ])
    expect(historicalQuoteForMold(prices, '  Fsmnfs-06m-01 ')).toBe(0.58)
  })

  it('不把空值、非数字或 0 当作可复用的历史核价', () => {
    const prices = buildLatestQuoteByMold([
      { id: 'zero', mold_no: 'MOLD-1', quote_labor_price: 0, order_date: '2026-09-01' },
      { id: 'missing', mold_no: 'MOLD-2', order_date: '2026-09-01' },
    ])
    expect(historicalQuoteForMold(prices, 'MOLD-1')).toBeUndefined()
    expect(historicalQuoteForMold(prices, 'MOLD-2')).toBeUndefined()
    expect(needsHistoricalQuote(0)).toBe(true)
    expect(needsHistoricalQuote('')).toBe(true)
    expect(needsHistoricalQuote(0.305)).toBe(false)
  })

  it('只有货号和物料名称同时相同时才匹配', () => {
    const prices = buildLatestQuoteByItemProduct([
      { id: 'old', item_no: '71172-大脑', product: '水泵组装', quote_labor_price: 1.7, order_date: '2026-07-01' },
      { id: 'new', item_no: '71172-大脑', product: '水泵组装', quote_labor_price: 1.85, order_date: '2026-08-01' },
      { id: 'other-product', item_no: '71172-大脑', product: '眼镜', quote_labor_price: 0.198, order_date: '2026-09-01' },
    ])
    expect(historicalQuoteForItemProduct(prices, ' 71172-大脑 ', '水泵组装')).toBe(1.85)
    expect(historicalQuoteForItemProduct(prices, '71172-大脑', '不同物料')).toBeUndefined()
    expect(historicalQuoteForItemProduct(prices, '不同货号', '水泵组装')).toBeUndefined()
  })

  it('车缝部按界面显示的货号匹配，不受合同号变化影响', () => {
    const prices = buildLatestQuoteByItemProduct([
      { id: 'sewing', item_no: 'MA-RR-2345/15783', product: '独眼鸡块', quote_labor_price: 1.33, order_date: '2026-08-01' },
    ], true)
    expect(historicalQuoteForItemProduct(prices, 'MA-RR-9999/15783', '独眼鸡块', true)).toBe(1.33)
    expect(historicalQuoteForItemProduct(prices, '15783', '独眼鸡块', true)).toBe(1.33)
  })
})
