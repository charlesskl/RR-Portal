import { describe, it, expect } from 'vitest'
import { summarizeByCraft } from '../src/utils/summary'

describe('summarizeByCraft', () => {
  it('跨月每家工厂只计一次，按平均分评级并累计产值', () => {
    const result = summarizeByCraft(
      [{ id: 'f1', craft: 'injection' }, { id: 'f2', craft: 'injection' }] as any[],
      [
        { factory: 'f1', year_month: '2026-08', total_score: 90, grade: 'A' },
        { factory: 'f1', year_month: '2026-09', total_score: 70, grade: 'C' },
        { factory: 'f2', year_month: '2026-09', total_score: 60, grade: 'C' },
      ] as any[],
      [
        { factory: 'f1', monthly_amount: 1000 },
        { factory: 'f1', monthly_amount: 2000 },
        { factory: 'f2', monthly_amount: 500 },
      ] as any[],
    )
    expect(result.injection).toEqual({
      factory_count: 2, grade_dist: { A: 0, B: 1, C: 1, D: 0 }, avg_score: 70, total_output: 3500,
    })
  })

  it('aggregates count, grade dist, avg score, total output per craft', () => {
    const factories = [
      { id: 'f1', craft: 'injection' }, { id: 'f2', craft: 'injection' },
    ] as any[]
    const scores = [
      { factory: 'f1', total_score: 90, grade: 'A' },
      { factory: 'f2', total_score: 70, grade: 'C' },
    ] as any[]
    const outputs = [
      { factory: 'f1', monthly_amount: 1000 },
      { factory: 'f2', monthly_amount: 500 },
    ] as any[]
    const r = summarizeByCraft(factories, scores, outputs)
    expect(r.injection.factory_count).toBe(2)
    expect(r.injection.grade_dist).toEqual({ A: 1, B: 0, C: 1, D: 0 })
    expect(r.injection.avg_score).toBe(80)
    expect(r.injection.total_output).toBe(1500)
  })
})
