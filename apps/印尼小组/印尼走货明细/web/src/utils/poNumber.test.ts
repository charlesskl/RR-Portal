import { afterEach, describe, expect, it, vi } from 'vitest'
import { poDetermineEntity, poGenContractNo } from './poNumber'

describe('排期来源对应采购主体', () => {
  it('RRM 排期强制使用全球采购单', () => {
    const entity = poDetermineEntity('东莞市台聚印刷有限公司', '', 'RRM')
    expect(entity).toBe('HD_GLOBAL')
    expect(poGenContractNo([], entity, 'HS')).toBe('IRRMHS0060')
  })

  it('RRM 不被物料报关公司覆盖成实业或华胜益采购单', () => {
    expect(poDetermineEntity('供应商', '深圳市华胜益出口贸易有限公司', ' rrm ')).toBe('HD_GLOBAL')
  })

  it('非 RRM 排期沿用原有主体判断', () => {
    expect(poDetermineEntity('供应商', '', 'RRI')).toBe('HD_INDUSTRY')
    expect(poDetermineEntity('供应商', '深圳市华胜益出口贸易有限公司', 'RRI')).toBe('HSY')
  })
})

describe('采购订单衔接线下编号', () => {
  afterEach(() => vi.useRealTimers())

  it('RRI 和 RRM 从指定编号之后起排，已有更大编号时继续递增', () => {
    expect(poGenContractNo([], 'HD_INDUSTRY', 'HS')).toBe('IRRIHS0402')
    expect(poGenContractNo(['IRRIHS0401'], 'HD_INDUSTRY', 'HS')).toBe('IRRIHS0402')
    expect(poGenContractNo(['IRRIHS0450'], 'HD_INDUSTRY', 'HS')).toBe('IRRIHS0451')
    expect(poGenContractNo(['IRRMHS0059'], 'HD_GLOBAL', 'HS')).toBe('IRRMHS0060')
    expect(poGenContractNo(['IRRMHS0100'], 'HD_GLOBAL', 'HS')).toBe('IRRMHS0101')
    expect(poGenContractNo([], 'HD_INDUSTRY', 'HD')).toBe('IRRIHD0001')
  })

  it('华胜益 2026 年从 2026900171 开始并保持连续', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 8))
    expect(poGenContractNo([], 'HSY', 'HS')).toBe('2026900171')
    expect(poGenContractNo(['2026900170'], 'HSY', 'HS')).toBe('2026900171')
    expect(poGenContractNo(['2026900200'], 'HSY', 'HS')).toBe('2026900201')
    expect(poGenContractNo(['2026900171', '2026900172'], 'HSY', 'HS')).toBe('2026900173')
  })

  it('华胜益其他年份不继承 2026 年的基线', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2027, 0, 1))
    expect(poGenContractNo(['2026900170'], 'HSY', 'HS')).toBe('2027000001')
  })
})
