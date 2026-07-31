import { describe, expect, it } from 'vitest'
import { matchesOrderDate } from '../src/utils/orderDateFilter'

describe('matchesOrderDate', () => {
  it('filters orders by month', () => {
    expect(matchesOrderDate('2026-07-15', { mode: 'month', month: '2026-07' })).toBe(true)
    expect(matchesOrderDate('2026-06-30', { mode: 'month', month: '2026-07' })).toBe(false)
  })

  it('filters an inclusive date range', () => {
    const filter = { mode: 'range', start: '2026-07-01', end: '2026-07-31' } as const
    expect(matchesOrderDate('2026-07-01 00:00:00.000Z', filter)).toBe(true)
    expect(matchesOrderDate('2026-07-31', filter)).toBe(true)
    expect(matchesOrderDate('2026-08-01', filter)).toBe(false)
  })

  it('supports an open-ended range and excludes missing order dates', () => {
    expect(matchesOrderDate('2026-07-20', { mode: 'range', start: '2026-07-15', end: '' })).toBe(true)
    expect(matchesOrderDate('', { mode: 'range', start: '2026-07-15', end: '' })).toBe(false)
  })
})
