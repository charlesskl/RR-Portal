import { describe, it, expect } from 'vitest'
import { gradeFromScore } from '../src/utils/grading'

describe('gradeFromScore', () => {
  it('returns A for >= 90', () => expect(gradeFromScore(90)).toBe('A'))
  it('returns B for 80..89', () => expect(gradeFromScore(85)).toBe('B'))
  it('returns C for 70..79', () => expect(gradeFromScore(70)).toBe('C'))
  it('returns D for < 70', () => expect(gradeFromScore(69.9)).toBe('D'))
})
