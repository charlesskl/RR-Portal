import type { MonthlyScore } from '../types/score'
import type { OrderDateFilter } from './orderDateFilter'
import { summarizeFactoryScores } from './scoringDateRange'

/** Month filters use the scoring month, not a synthetic first-day date.
 * All dates keeps the most recent month per factory; a range averages its
 * recorded monthly scores, matching the monthly scoring range view. */
export function factorySummaryGrades(scores: MonthlyScore[], filter: OrderDateFilter): Map<string, string> {
  const grouped = new Map<string, MonthlyScore[]>()
  for (const score of scores) {
    if (filter.mode === 'month' && filter.month && score.year_month !== filter.month) continue
    if (filter.mode === 'range' && ((filter.start && score.year_month < filter.start.slice(0, 7)) || (filter.end && score.year_month > filter.end.slice(0, 7)))) continue
    const list = grouped.get(score.factory) ?? []
    list.push(score)
    grouped.set(score.factory, list)
  }
  return new Map([...grouped].map(([id, records]) => {
    const latestOnly = filter.mode === 'all' || (filter.mode === 'month' && !filter.month)
    const selected = latestOnly ? [...records].sort((a, b) => b.year_month.localeCompare(a.year_month)).slice(0, 1) : records
    return [id, summarizeFactoryScores(selected).grade ?? '-']
  }))
}
