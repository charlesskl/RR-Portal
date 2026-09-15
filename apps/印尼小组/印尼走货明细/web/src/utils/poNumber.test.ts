import { describe, expect, it } from 'vitest'
import { poDetermineEntity, poGenContractNo } from './poNumber'

describe('排期来源对应采购主体', () => {
  it('RRM 排期强制使用全球采购单', () => {
    const entity = poDetermineEntity('东莞市台聚印刷有限公司', '', 'RRM')
    expect(entity).toBe('HD_GLOBAL')
    expect(poGenContractNo([], entity, 'HS')).toBe('IRRMHS0001')
  })

  it('RRM 不被物料报关公司覆盖成实业或华胜益采购单', () => {
    expect(poDetermineEntity('供应商', '深圳市华胜益出口贸易有限公司', ' rrm ')).toBe('HD_GLOBAL')
  })

  it('非 RRM 排期沿用原有主体判断', () => {
    expect(poDetermineEntity('供应商', '', 'RRI')).toBe('HD_INDUSTRY')
    expect(poDetermineEntity('供应商', '深圳市华胜益出口贸易有限公司', 'RRI')).toBe('HSY')
  })
})
