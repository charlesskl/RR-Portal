import { gradeFromScore, totalFromItems } from './grading'
import type { Grade } from '../constants/grading'
import type { MonthlyScore } from '../types/score'

export type ScoringRangeMode = 'month' | 'two_months' | 'quarter' | 'year' | 'custom'

export interface ScoringMonthRange {
  start: string
  end: string
}

export interface FactoryScoreSummary {
  totalScore?: number
  grade?: Grade
  flag: MonthlyScore['flag']
  monthsScored: number
  status?: MonthlyScore['status']
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function resolveScoringRange(
  mode: ScoringRangeMode,
  anchorMonth: string,
  customStart = anchorMonth,
  customEnd = anchorMonth,
): ScoringMonthRange {
  const anchor = MONTH_PATTERN.test(anchorMonth) ? anchorMonth : new Date().toISOString().slice(0, 7)
  if (mode === 'two_months') return { start: shiftMonth(anchor, -1), end: anchor }
  if (mode === 'quarter') {
    const [year, monthNumber] = anchor.split('-').map(Number)
    const quarterStart = Math.floor((monthNumber - 1) / 3) * 3 + 1
    return { start: `${year}-${String(quarterStart).padStart(2, '0')}`, end: `${year}-${String(quarterStart + 2).padStart(2, '0')}` }
  }
  if (mode === 'year') return { start: `${anchor.slice(0, 4)}-01`, end: `${anchor.slice(0, 4)}-12` }
  if (mode === 'custom') {
    const start = MONTH_PATTERN.test(customStart) ? customStart : anchor
    const end = MONTH_PATTERN.test(customEnd) ? customEnd : anchor
    return start <= end ? { start, end } : { start: end, end: start }
  }
  return { start: anchor, end: anchor }
}

export function monthsInScoringRange({ start, end }: ScoringMonthRange): number {
  const [startYear, startMonth] = start.split('-').map(Number)
  const [endYear, endMonth] = end.split('-').map(Number)
  return Math.max(1, (endYear - startYear) * 12 + endMonth - startMonth + 1)
}

export function summarizeFactoryScores(scores: MonthlyScore[]): FactoryScoreSummary {
  const scored = scores
    .map((score) => ({
      ...score,
      calculatedTotal: Array.isArray(score.score_items) && score.score_items.length
        ? totalFromItems(score.score_items)
        : score.total_score == null ? Number.NaN : Number(score.total_score),
    }))
    .filter((score) => Number.isFinite(score.calculatedTotal))
  const totalScore = scored.length
    ? Math.round((scored.reduce((sum, score) => sum + score.calculatedTotal, 0) / scored.length) * 100) / 100
    : undefined
  const flag: MonthlyScore['flag'] = scores.some((score) => score.flag === 'red')
    ? 'red'
    : scores.some((score) => score.flag === 'yellow') ? 'yellow' : 'none'

  return {
    totalScore,
    grade: totalScore == null ? undefined : gradeFromScore(totalScore),
    flag,
    monthsScored: new Set(scored.map((score) => score.year_month)).size,
    status: scores.length === 1 ? scores[0].status : undefined,
  }
}
