import { describe, it, expect } from 'vitest'
import { summarizeByCraft } from '../src/utils/summary'

describe('summarizeByCraft', () => {
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
