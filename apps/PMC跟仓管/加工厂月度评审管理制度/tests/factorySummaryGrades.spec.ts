import { expect, it } from 'vitest'
import { factorySummaryGrades } from '../src/utils/factorySummaryGrades'
import type { MonthlyScore } from '../src/types/score'
const scores = [
  { factory: 'a', year_month: '2026-08', grade: 'D', total_score: 25, score_items: [{ template_id: '1', score: 72 }] },
  { factory: 'a', year_month: '2026-09', grade: 'D', total_score: 25 },
  { factory: 'b', year_month: '2026-08', total_score: 68, grade: 'D' },
] as MonthlyScore[]
it('按选择月份与评分明细一致计算，不回退至其他月份', () => {
  expect([...factorySummaryGrades(scores, { mode: 'month', month: '2026-08' })]).toEqual([['a', 'B'], ['b', 'C']])
  expect(factorySummaryGrades(scores, { mode: 'month', month: '2026-07' }).size).toBe(0)
})
it('全部日期取最近月，日期范围按覆盖月份平均评分', () => {
  expect(factorySummaryGrades(scores, { mode: 'all' }).get('a')).toBe('D')
  expect(factorySummaryGrades(scores, { mode: 'range', start: '2026-08-15', end: '2026-08-31' }).get('a')).toBe('B')
  expect(factorySummaryGrades(scores, { mode: 'range', start: '2026-08-15', end: '2026-09-20' }).get('a')).toBe('D')
})
