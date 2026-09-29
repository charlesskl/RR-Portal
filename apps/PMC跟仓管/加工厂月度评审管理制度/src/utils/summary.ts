import { summarizeFactoryScores } from './scoringDateRange'
import type { Factory } from '../types/factory'
import type { MonthlyScore } from '../types/score'
import type { MonthlyOutput } from '../types/output'
import type { CraftSummary } from '../types/review'
import type { Craft } from '../constants/roles'

export function summarizeByCraft(
  factories: Factory[], scores: MonthlyScore[], outputs: MonthlyOutput[],
): Record<Craft, CraftSummary> {
  const scoresByFactory = new Map<string, MonthlyScore[]>()
  for (const score of scores) {
    const group = scoresByFactory.get(score.factory) ?? []
    group.push(score)
    scoresByFactory.set(score.factory, group)
  }
  const outputByFactory = new Map<string, number>()
  for (const output of outputs) {
    outputByFactory.set(output.factory, (outputByFactory.get(output.factory) ?? 0) + (output.monthly_amount ?? 0))
  }
  const result = {} as Record<Craft, CraftSummary>

  for (const f of factories) {
    const c = f.craft
    if (!result[c]) {
      result[c] = { factory_count: 0, grade_dist: { A: 0, B: 0, C: 0, D: 0 }, avg_score: 0, total_output: 0 }
    }
    const bucket = result[c]
    bucket.factory_count++
    const records = scoresByFactory.get(f.id) ?? []
    const period = records.length > 1 ? summarizeFactoryScores(records) : undefined
    const s = period ? { grade: period.grade, total_score: period.totalScore } : records[0]
    if (s?.grade) bucket.grade_dist[s.grade]++
    bucket.total_output += outputByFactory.get(f.id) ?? 0
    bucket.avg_score += s?.total_score ?? 0
  }
  for (const c of Object.keys(result) as Craft[]) {
    const b = result[c]
    b.avg_score = b.factory_count ? Math.round((b.avg_score / b.factory_count) * 100) / 100 : 0
  }
  return result
}
