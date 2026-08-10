import { describe, expect, it } from 'vitest'
import { taxPointFactor, taxPointRate } from '../src/utils/taxPoint'

describe('tax point display and storage conversion', () => {
  it('displays stored rates as tax factors', () => {
    expect(taxPointFactor(0.03)).toBe(1.03)
    expect(taxPointFactor(0.13)).toBe(1.13)
  })

  it('stores either rate or factor input as a rate', () => {
    expect(taxPointRate(0.03)).toBe(0.03)
    expect(taxPointRate(1.03)).toBe(0.03)
    expect(taxPointRate(1.13)).toBe(0.13)
  })
})
