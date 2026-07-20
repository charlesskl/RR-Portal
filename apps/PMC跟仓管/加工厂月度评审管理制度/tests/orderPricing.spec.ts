import { describe, expect, it } from 'vitest'
import { applyCnyTaxPrice, cnyTaxToHkdUntaxed } from '../src/utils/orderPricing'

describe('order pricing conversion', () => {
  it('converts CNY tax-inclusive price to HKD tax-exclusive price', () => {
    expect(cnyTaxToHkdUntaxed(2.853)).toBe(2.902)
  })

  it('moves imported external price into the CNY field when requested', () => {
    expect(applyCnyTaxPrice({ unit_price: 2.853 }, true)).toMatchObject({
      unit_price_cny_tax: 2.853,
      unit_price: 2.902,
    })
  })
})
