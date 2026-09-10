import { describe, expect, it } from 'vitest'
import { monthsInScoringRange, resolveScoringRange, summarizeFactoryScores } from '../src/utils/scoringDateRange'
import type { MonthlyScore } from '../src/types/score'

const score = (overrides: Partial<MonthlyScore>): MonthlyScore => ({
  id: 'score', factory: 'factory-1', year_month: '2026-01', score_items: [],
  flag: 'none', status: 'draft', ...overrides,
})

describe('工厂月度评分时间范围', () => {
  it('支持近2个月、季度、年度和任意起止月份', () => {
    expect(resolveScoringRange('two_months', '2026-01')).toEqual({ start: '2025-12', end: '2026-01' })
    expect(resolveScoringRange('quarter', '2026-05')).toEqual({ start: '2026-04', end: '2026-06' })
    expect(resolveScoringRange('year', '2026-09')).toEqual({ start: '2026-01', end: '2026-12' })
    expect(resolveScoringRange('custom', '2026-09', '2026-08', '2026-03')).toEqual({ start: '2026-03', end: '2026-08' })
    expect(monthsInScoringRange({ start: '2025-12', end: '2026-02' })).toBe(3)
  })

  it('多月评分按有分数的月份计算平均分、综合等级和最高牌级', () => {
    const summary = summarizeFactoryScores([
      score({ id: '1', year_month: '2026-01', total_score: 80, grade: 'B', flag: 'yellow' }),
      score({ id: '2', year_month: '2026-02', total_score: 60, grade: 'C', flag: 'red' }),
      score({ id: '3', year_month: '2026-03', total_score: undefined, flag: 'none' }),
    ])
    expect(summary).toMatchObject({ totalScore: 70, grade: 'B', flag: 'red', monthsScored: 2 })
  })
})
