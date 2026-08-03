import { describe, expect, it } from 'vitest'
import { isPercentOver100 } from '../src/utils/percentage'

describe('isPercentOver100', () => {
  it('marks numeric and formatted percentages strictly above 100', () => {
    expect(isPercentOver100(100.1)).toBe(true)
    expect(isPercentOver100('113.42%')).toBe(true)
  })

  it('keeps 100 percent and invalid values unchanged', () => {
    expect(isPercentOver100(100)).toBe(false)
    expect(isPercentOver100('100%')).toBe(false)
    expect(isPercentOver100('-')).toBe(false)
    expect(isPercentOver100(null)).toBe(false)
  })
})
