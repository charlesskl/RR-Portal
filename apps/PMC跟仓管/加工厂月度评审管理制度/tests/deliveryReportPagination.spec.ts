import { describe, expect, it } from 'vitest'
import { buildDeliveryReport } from '../src/utils/deliveryStats'
import { paginateDeliveryReport } from '../src/utils/deliveryReportPagination'
import type { Order } from '../src/types/order'

function makeOrders(count: number, factory = 'A', pmc = 'PMC1'): Order[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${pmc}-${factory}-${index}`,
    factory,
    pmc,
    product: '物料',
    order_no: `${pmc}-${factory}-${index}`,
    unit_price: 1,
  }))
}

describe('delivery report pagination', () => {
  it('clips and restores range/factory spans when a group crosses pages, without changing source rows', () => {
    const rows = buildDeliveryReport(makeOrders(205), '东莞注塑部', (order) => order.factory)
    const original = structuredClone(rows)
    const pages = [1, 2, 3].map((page) => paginateDeliveryReport(rows, page, 100))
    expect(pages.map((page) => page.rows.filter((row) => row.kind === 'detail').length)).toEqual([100, 100, 5])
    expect(pages.map((page) => page.rows[0])).toMatchObject([
      { range: '东莞注塑部', factory: 'A', rangeSpan: 100, factorySpan: 100 },
      { range: '东莞注塑部', factory: 'A', rangeSpan: 100, factorySpan: 100 },
      { range: '东莞注塑部', factory: 'A', rangeSpan: 6, factorySpan: 5 },
    ])
    expect(pages[0]!.rows.some((row) => row.kind === 'subtotal')).toBe(false)
    expect(pages[2]!.rows.at(-1)).toMatchObject({ kind: 'subtotal', orderCount: 205, outPrice: 205 })
    expect(rows).toEqual(original)
  })

  it('keeps subtotals on a full page and never creates a page beginning with a subtotal', () => {
    const rows = buildDeliveryReport([...makeOrders(100), ...makeOrders(2, 'B')], '范围', (order) => order.factory)
    const first = paginateDeliveryReport(rows, 1, 100)
    const second = paginateDeliveryReport(rows, 2, 100)
    expect(first.rows).toHaveLength(101)
    expect(first.rows[0]).toMatchObject({ rangeSpan: 101, factorySpan: 100 })
    expect(first.rows.at(-1)).toMatchObject({ kind: 'subtotal', factory: 'A' })
    expect(second.rows[0]).toMatchObject({ kind: 'detail', factory: 'B', rangeSpan: 3, factorySpan: 2 })
  })

  it('does not merge the same factory across PMC groups and gives every row a stable key', () => {
    const rows = buildDeliveryReport([...makeOrders(2), ...makeOrders(2, 'A', 'PMC2')], '范围', (order) => order.factory)
    const page = paginateDeliveryReport(rows, 1, 100)
    expect(page.rows[0]).toMatchObject({ rangeSpan: 6, factorySpan: 2 })
    expect(page.rows[3]).toMatchObject({ rangeSpan: 0, factorySpan: 2 })
    expect(new Set(page.rows.map((row) => row.pageKey)).size).toBe(6)
    expect(paginateDeliveryReport(rows, 2, 2).rows.map((row) => row.pageKey)).toEqual(page.rows.slice(3).map((row) => row.pageKey))
  })

  it('clips the next factory separately when a page includes an earlier subtotal', () => {
    const rows = buildDeliveryReport([...makeOrders(99), ...makeOrders(5, 'B')], '范围', (order) => order.factory)
    const first = paginateDeliveryReport(rows, 1, 100)
    const second = paginateDeliveryReport(rows, 2, 100)
    expect(first.rows[0]).toMatchObject({ rangeSpan: 101, factorySpan: 99 })
    expect(first.rows.at(-1)).toMatchObject({ kind: 'detail', factory: 'B', factorySpan: 1 })
    expect(second.rows[0]).toMatchObject({ kind: 'detail', factory: 'B', rangeSpan: 5, factorySpan: 4 })
    expect(second.rows.at(-1)).toMatchObject({ kind: 'subtotal', factory: 'B', orderCount: 5 })
  })

  it('clamps a stale page after filtering and handles empty results', () => {
    const rows = buildDeliveryReport(makeOrders(3), '范围', (order) => order.factory)
    expect(paginateDeliveryReport(rows, 42, 100)).toMatchObject({ page: 1, pageCount: 1, first: 1, last: 3, total: 3 })
    expect(paginateDeliveryReport([], 42, 100)).toMatchObject({ page: 1, pageCount: 1, first: 0, last: 0, total: 0, rows: [] })
  })
})
