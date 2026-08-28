import { describe, expect, it } from 'vitest'
import { factoryTaxPointFactors, taxPointFactor, taxPointRate } from '../src/utils/taxPoint'

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

describe('factoryTaxPointFactors', () => {
  it('uses one latest active master tax point for duplicate factory ids with the same full name', () => {
    const factors = factoryTaxPointFactors([
      { id: 'old', name: '邵阳市华登塑胶制品有限公司', craft: 'assembly', region: 'hunan', tax_point: 0.03, status: 'active', updated: '2026-01-01' },
      { id: 'current', name: '邵阳市华登塑胶制品有限公司', craft: 'assembly', region: 'dongguan', tax_point: 0.115, status: 'active', updated: '2026-08-01' },
    ])

    expect(factors.get('old')).toBe(1.115)
    expect(factors.get('current')).toBe(1.115)
  })

  it('does not merge same-name factories from different departments', () => {
    const factors = factoryTaxPointFactors([
      { id: 'assembly', name: '同名加工厂', craft: 'assembly', region: 'dongguan', tax_point: 0.03, status: 'active' },
      { id: 'sewing', name: '同名加工厂', craft: 'sewing', region: 'hunan', tax_point: 0.115, status: 'active' },
    ])

    expect(factors.get('assembly')).toBe(1.03)
    expect(factors.get('sewing')).toBe(1.115)
  })
})
