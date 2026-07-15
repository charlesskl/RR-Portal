import { describe, it, expect } from 'vitest'
import { onTimeRate } from '../src/utils/kpi'

describe('onTimeRate', () => {
  it('returns 0 for empty', () => expect(onTimeRate([])).toBe(0))
  it('computes percentage of on-time logs', () => {
    const logs = [
      { is_on_time: true }, { is_on_time: true }, { is_on_time: false }, { is_on_time: true },
    ] as any[]
    expect(onTimeRate(logs)).toBe(75)
  })
})
