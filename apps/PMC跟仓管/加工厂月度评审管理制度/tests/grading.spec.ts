import { describe, it, expect } from 'vitest'
import { gradeFromScore } from '../src/utils/grading'

describe('gradeFromScore', () => {
  it('returns A for >= 90', () => expect(gradeFromScore(90)).toBe('A'))
  it('returns B for 70..89', () => expect(gradeFromScore(70)).toBe('B'))
  it('returns C for 50..69', () => expect(gradeFromScore(50)).toBe('C'))
  it('returns D for < 50', () => expect(gradeFromScore(49.9)).toBe('D'))
})
