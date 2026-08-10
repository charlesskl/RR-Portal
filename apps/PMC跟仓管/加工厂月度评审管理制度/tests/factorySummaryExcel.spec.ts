import { describe, expect, it } from 'vitest'
import { factorySummaryExportRow } from '../src/utils/factorySummaryExcel'
import type { FactoryStats } from '../src/utils/factoryStats'

describe('factory summary Excel rows', () => {
  it('keeps amounts and counts numeric and converts displayed rates to Excel percentages', () => {
    const stats = {
      quoteAmount: 607123.04,
      outAmount: 578588.95,
      amountRatio: '95.30%',
      orderCount: 57,
      delayedCount: 2,
      delayRatio: '3.51%',
      delayDaysAvg: '2.5天',
      intInspect: 157,
      intPass: 152,
      intRate: '96.82%',
    } as FactoryStats

    expect(factorySummaryExportRow({ name: '测试工厂', stats, siteScore: 70, siteRate: '70%' }))
      .toEqual(['测试工厂', 607123.04, 578588.95, 0.953, 57, 2, 0.0351, 2.5, 157, 152, 0.9682, 70, 0.7])
  })

  it('exports unavailable metrics as blank cells', () => {
    const stats = {
      quoteAmount: 0,
      outAmount: 0,
      amountRatio: '-',
      orderCount: 0,
      delayedCount: 0,
      delayRatio: '-',
      delayDaysAvg: '-',
      intInspect: 0,
      intPass: 0,
      intRate: '-',
    } as FactoryStats

    const row = factorySummaryExportRow({ name: '空数据工厂', stats, siteScore: '-', siteRate: '-' })
    expect(row.slice(3)).toEqual([null, 0, 0, null, null, 0, 0, null, null, null])
  })
})
