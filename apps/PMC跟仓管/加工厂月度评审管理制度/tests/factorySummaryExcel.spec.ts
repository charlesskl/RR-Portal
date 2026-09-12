import { describe, expect, it } from 'vitest'
import { buildFactorySummaryWorkbook, factorySummaryExportRow } from '../src/utils/factorySummaryExcel'
import type { FactoryStats } from '../src/utils/factoryStats'

function sampleStats(): FactoryStats {
  return {
    quoteSum: 0,
    unitSum: 0,
    priceRatio: '-',
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
    custInspect: 0,
    custPass: 0,
    custRate: '-',
    combinedRate: '96.82%',
  }
}

describe('factory summary Excel rows', () => {
  it('keeps amounts and counts numeric and converts displayed rates to Excel percentages', () => {
    const stats = sampleStats()

    expect(factorySummaryExportRow({ name: '测试工厂', grade: 'A', ipControl: '已授权', stats, siteScore: 70, siteRate: '70%' }))
      .toEqual(['测试工厂', 'A', 607123.04, 578588.95, 0.953, 57, 2, 0.0351, 2.5, 157, 152, 0.9682, '已授权', 70, 0.7])
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

    const row = factorySummaryExportRow({ name: '空数据工厂', grade: '-', ipControl: '-', stats, siteScore: '-', siteRate: '-' })
    expect(row.slice(4)).toEqual([null, 0, 0, null, null, 0, 0, null, '-', null, null])
  })

  it('builds region workbooks as vertically stacked department sections matching the reference style', () => {
    const item = { name: '测试工厂', grade: 'A', ipControl: '-', stats: sampleStats(), siteScore: 70, siteRate: '70%' }
    const workbook = buildFactorySummaryWorkbook([
      { title: '东莞厂区 · 注塑部·2026-08加工厂汇总表', items: [item], total: { ...item, name: '1 家加工厂总计' } },
      { title: '东莞厂区 · 喷油部·2026-08加工厂汇总表', items: [item], total: { ...item, name: '1 家加工厂总计' } },
    ])
    const sheet = workbook.Sheets['汇总表']!

    expect(sheet.A1.v).toBe('东莞厂区 · 注塑部·2026-08加工厂汇总表')
    expect(sheet.A6.v).toBe('东莞厂区 · 喷油部·2026-08加工厂汇总表')
    expect(sheet['!merges']).toEqual([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 14 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 14 } },
    ])
    expect(sheet['!autofilter']?.ref).toBe('A2:O4')
    expect(sheet['!cols']?.map((column) => column.wch)).toEqual([32, 8, 15, 15, 12, 13, 12, 12, 16, 13, 12, 12, 16, 12, 12])
    expect(sheet['!rows']?.[0]?.hpt).toBe(28)
    expect(sheet['!rows']?.[1]?.hpt).toBe(24)
    expect(sheet['!rows']?.[2]?.hpt).toBe(16.8)
    expect(sheet['!rows']?.[4]?.hpt).toBe(16.8)
    expect(sheet['!rows']?.[5]?.hpt).toBe(23.2)
    expect(sheet['!rows']?.[6]?.hpt).toBe(17)

    expect(sheet.A2.s?.fill?.fgColor).toEqual({ rgb: 'FFFFFF' })
    expect(sheet.C2.s?.fill?.fgColor).toEqual({ theme: 4, tint: 0.8 })
    expect(sheet.F2.s?.fill?.fgColor).toEqual({ theme: 5, tint: 0.8 })
    expect(sheet.J2.s?.fill?.fgColor).toEqual({ theme: 7, tint: 0.8 })
    expect(sheet.M2.s?.fill?.fgColor).toEqual({ theme: 9, tint: 0.8 })
    expect(sheet.C3.z).toBe('#,##0')
    expect(sheet.E3.z).toBe('0.0%')
    expect(sheet.N3.z).toBe('0.00')
    expect(sheet.A4.s?.font?.bold).toBe(true)
    expect(sheet.A5.v).toBe('')
    expect(sheet.A5.s?.fill?.fgColor).toEqual({ rgb: 'FFFFFF' })
    expect(sheet.A5.s?.border).toBeUndefined()
  })
})
