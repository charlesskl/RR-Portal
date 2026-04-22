import { describe, it, expect } from 'vitest'
import { normalize } from './normalize.js'

describe('normalize', () => {
  it('strips full-width digits and converts to ASCII', () => {
    // Full-width space + full-width digits
    expect(normalize('　１２３ ')).toBe('123')
  })

  it('converts non-breaking space to regular space', () => {
    expect(normalize('hello\u00A0world')).toBe('hello world')
  })

  it('returns empty string for null input', () => {
    expect(normalize(null)).toBe('')
  })

  it('returns empty string for undefined input', () => {
    expect(normalize(undefined)).toBe('')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalize('  TOMY UK  ')).toBe('TOMY UK')
  })

  it('handles normal ASCII string without modification', () => {
    expect(normalize('10114426')).toBe('10114426')
  })

  it('handles empty string', () => {
    expect(normalize('')).toBe('')
  })
})
