import { describe, expect, it } from 'vitest'
import { matchesQualityInspectionFilters, qualityInspectionProcessTypes } from '../src/utils/qualityInspectionFilters'
import type { QualityInspection } from '../src/types/qualityInspection'

const record = (processType: string, date: string): QualityInspection => ({
  id: `${processType}-${date}`,
  process_type: processType,
  inspect_date: date,
})

describe('品质检验明细筛选', () => {
  it('整理不重复的加工类型供下拉筛选', () => {
    const records = [record('装配', '2026-06-01'), record('啤机', '2026-06-02'), record('装配', '2026-06-03')]
    expect(qualityInspectionProcessTypes(records)).toEqual(['啤机', '装配'])
  })

  it('同时满足加工类型和月份条件才显示', () => {
    const filter = { mode: 'month', month: '2026-06' } as const
    expect(matchesQualityInspectionFilters(record('装配', '2026-06-24'), '装配', filter)).toBe(true)
    expect(matchesQualityInspectionFilters(record('啤机', '2026-06-24'), '装配', filter)).toBe(false)
    expect(matchesQualityInspectionFilters(record('装配', '2026-07-01'), '装配', filter)).toBe(false)
  })

  it('自定义时间段包含起止当天', () => {
    const filter = { mode: 'range', start: '2026-06-10', end: '2026-06-20' } as const
    expect(matchesQualityInspectionFilters(record('喷油', '2026-06-10'), '', filter)).toBe(true)
    expect(matchesQualityInspectionFilters(record('喷油', '2026-06-20'), '', filter)).toBe(true)
    expect(matchesQualityInspectionFilters(record('喷油', '2026-06-21'), '', filter)).toBe(false)
  })
})
