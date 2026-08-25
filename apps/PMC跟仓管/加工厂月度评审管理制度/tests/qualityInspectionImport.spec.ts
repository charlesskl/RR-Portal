import { describe, it, expect } from 'vitest'
import { buildQualityInspectionImportColumns, formatImportedDate, resolveQualityInspectionFactory } from '../src/utils/qualityInspectionImport'
import type { Factory } from '../src/types/factory'

const factory = (id: string, name: string, craft: Factory['craft'], region: Factory['region'], processable_types?: string): Factory =>
  ({ id, name, craft, region, processable_types, status: 'active' })

describe('buildQualityInspectionImportColumns', () => {
  it('starts internal inspection fields after 单数 when the exported template has that column', () => {
    const idx = buildQualityInspectionImportColumns([
      '序号', '送货日期', '加工厂名称', '加工类型', '客户', '送货单号',
      '货号', '产品名称', '数量', '单数',
      '内部验货状态', '', '',
      '客户验货状态（适用于装配与包装加工）', '', '', '备注',
    ])

    expect(idx.qty).toBe(8)
    expect(idx.single).toBe(9)
    expect(idx.ir).toBe(10)
    expect(idx.idf).toBe(11)
    expect(idx.iins).toBe(12)
    expect(idx.cdate).toBe(13)
    expect(idx.cres).toBe(14)
    expect(idx.cdef).toBe(15)
  })

  it('keeps compatibility with older templates that do not have 单数', () => {
    const idx = buildQualityInspectionImportColumns([
      '序号', '送货日期', '加工厂名称', '加工类型', '客户', '送货单号',
      '货号', '产品名称', '数量',
      '内部验货状态', '', '',
      '客户验货状态（适用于装配与包装加工）', '', '', '备注',
    ])

    expect(idx.qty).toBe(8)
    expect(idx.single).toBe(-1)
    expect(idx.ir).toBe(9)
    expect(idx.idf).toBe(10)
    expect(idx.iins).toBe(11)
    expect(idx.cdate).toBe(12)
    expect(idx.cres).toBe(13)
    expect(idx.cdef).toBe(14)
  })

  it('detects templates that only have internal inspection columns', () => {
    const idx = buildQualityInspectionImportColumns([
      '序号', '送货日期', '加工厂名称', '加工类型', '客户', '送货单号',
      '货号', '产品名称', '数量', '单数',
      '内部验货状态', '', '', '备注',
    ])

    expect(idx.ir).toBe(10)
    expect(idx.idf).toBe(11)
    expect(idx.iins).toBe(12)
    expect(idx.cdate).toBe(-1)
    expect(idx.cres).toBe(-1)
    expect(idx.cdef).toBe(-1)
    expect(idx.notes).toBe(13)
  })
})

describe('formatImportedDate', () => {
  it('parses displayed Excel m/d/yy dates without timezone shifting', () => {
    expect(formatImportedDate('6/1/26')).toBe('2026-06-01')
  })

  it('keeps yyyy-mm-dd dates normalized', () => {
    expect(formatImportedDate('2026-6-1')).toBe('2026-06-01')
  })

  it('returns empty values as empty strings', () => {
    expect(formatImportedDate('')).toBe('')
  })
})

describe('resolveQualityInspectionFactory', () => {
  const factories = [
    factory('assembly-spring', '东莞市春风玩具有限公司', 'assembly', 'dongguan'),
    factory('injection-spring', '东莞市春风塑胶厂', 'injection', 'dongguan'),
    factory('hunan-spring', '邵阳市晨风玩具厂', 'assembly', 'hunan'),
  ]

  it('uses the imported processing type before resolving a factory abbreviation', () => {
    expect(resolveQualityInspectionFactory(factories, '春风', '装配', '')).toMatchObject({ status: 'matched', id: 'assembly-spring' })
  })

  it('also narrows an import to the selected region', () => {
    expect(resolveQualityInspectionFactory(factories, '晨风', '装配', 'hunan')).toMatchObject({ status: 'matched', id: 'hunan-spring' })
  })

  it('does not reject a unique factory when the imported project differs from its configured processing type', () => {
    const uniqueFactory = [
      factory('kuailichong', '邵阳快立充电子科技有限公司', 'assembly', 'hunan', '装配加工'),
      factory('plastic', '冷水江市红飞塑料制品有限公司', 'injection', 'hunan', '塑胶半成品'),
    ]

    expect(resolveQualityInspectionFactory(uniqueFactory, '快立充', '半成品', 'hunan'))
      .toMatchObject({ status: 'matched', id: 'kuailichong' })
  })

  it('uses the configured processing type to disambiguate factories with the same abbreviation', () => {
    const sameNameFactories = [
      factory('longxin-plastic', '邵阳县罗城乡隆鑫加工厂', 'injection', 'hunan', '塑胶半成品'),
      factory('longxin-assembly', '邵阳县罗城乡隆鑫加工厂', 'assembly', 'hunan', '装配加工'),
    ]
    expect(resolveQualityInspectionFactory(sameNameFactories, '隆鑫', '塑胶半成品', 'hunan'))
      .toMatchObject({ status: 'matched', id: 'longxin-plastic' })
    expect(resolveQualityInspectionFactory(sameNameFactories, '隆鑫', '装配加工', 'hunan'))
      .toMatchObject({ status: 'matched', id: 'longxin-assembly' })
  })
})
