import { describe, expect, it } from 'vitest'
import { CRAFTS, REGIONS } from '../src/constants/roles'
import { loadOrderPages, orderScopeFilter } from '../src/utils/orderLoading'

describe('scoped order queries', () => {
  it('keeps order management region ahead of factory location, including legacy Dongguan', () => {
    const filter = orderScopeFilter({ craft: 'injection', region: 'dongguan' }, CRAFTS, REGIONS)
    expect(filter).toContain('factory.craft = "injection"')
    expect(filter).toContain('(region = "dongguan" || (region = "" && (factory.region = "dongguan" || factory.region = "")))')
    expect(orderScopeFilter({ region: 'hunan' }, CRAFTS, REGIONS)).toContain('(region = "hunan" || (region = "" && factory.region = "hunan"))')
  })
  it('refuses unauthorized scopes and escapes status values', () => {
    expect(orderScopeFilter({ craft: 'painting' }, ['injection'], REGIONS)).toBe('id = ""')
    expect(orderScopeFilter({ region: 'hunan' }, CRAFTS, ['dongguan'])).toBe('id = ""')
    expect(orderScopeFilter({}, [], REGIONS)).toBe('id = ""')
    expect(orderScopeFilter({}, CRAFTS, [])).toBe('id = ""')
    expect(orderScopeFilter({ status: '" || id != "' }, CRAFTS, REGIONS)).toBe('status = "\\" || id != \\""'.replace('\\\\"', '\\"'))
  })
})

describe('bounded order loading', () => {
  it('loads later pages concurrently, preserves server order, and counts only once', async () => {
    let active = 0
    let maxActive = 0
    const calls: { page: number; skipTotal: unknown }[] = []
    const progress: number[] = []
    const result = await loadOrderPages<number>(async (page, size, options) => {
      expect(size).toBe(1000)
      expect(options.sort).toBe('-order_date,-id')
      calls.push({ page, skipTotal: options.skipTotal })
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, page === 2 ? 15 : 1))
      active--
      return { page, perPage: size, totalPages: options.skipTotal ? -1 : 5, totalItems: 5, items: [page] }
    }, { sort: '-order_date,-id' }, (loaded) => progress.push(loaded))
    expect(result).toEqual([1, 2, 3, 4, 5])
    expect(maxActive).toBe(3)
    expect(calls).toHaveLength(5)
    expect(calls[0]?.skipTotal).toBe(false)
    expect(calls.slice(1).every((call) => call.skipTotal === true)).toBe(true)
    expect(progress.at(-1)).toBe(5)
  })
  it('rejects a failed page rather than returning a partial export', async () => {
    await expect(loadOrderPages(async (page) => {
      if (page === 3) throw new Error('network failure')
      return { page, perPage: 1000, totalPages: 3, totalItems: 3, items: [page] }
    }, {})).rejects.toThrow('network failure')
  })
})
