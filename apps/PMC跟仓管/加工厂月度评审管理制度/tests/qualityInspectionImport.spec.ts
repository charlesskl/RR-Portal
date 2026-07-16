import { describe, it, expect } from 'vitest'
import { buildQualityInspectionImportColumns, formatImportedDate } from '../src/utils/qualityInspectionImport'

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
