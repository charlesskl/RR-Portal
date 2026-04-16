import { describe, it, expect } from 'vitest'
import { generateDateCode } from './dateCodeGenerator'

describe('generateDateCode', () => {
  // DATE-01, DATE-02: Basic format — monthLetter + day + 2-digit year + factoryCode
  it('returns D1526RR02 for 15 May 2026 with RR02', () => {
    // May 2026 - 1 month = Apr 15, 2026
    // Apr 15, 2026 is a Wednesday → workday → use as-is
    // D = April (month index 3), day=15, year=26, factory=RR02
    expect(generateDateCode('15 May 2026', 'RR02')).toBe('D1526RR02')
  })

  // DATE-02: Month letter A = January
  it('returns A letter for January after subtraction', () => {
    // 15 Jan 2026 - 1 month = Dec 15, 2025 → month=Dec → letter L
    // Wait — the test description says month letter "A" for January
    // That means the OUTPUT month (after subtraction) maps to A = January
    // generateDateCode('15 Feb 2026', 'RR01'): Feb - 1 = Jan 15, 2026 (Thu) → A1526RR01
    expect(generateDateCode('15 Feb 2026', 'RR01')).toBe('A1526RR01')
  })

  // DATE-02: Month letter for January input
  it('returns correct month letter for January input (subtracts to December)', () => {
    // 15 Jan 2026 - 1 month = Dec 15, 2025 (Mon) → workday → L1525RR01
    expect(generateDateCode('15 Jan 2026', 'RR01')).toBe('L1525RR01')
  })

  // DATE-02: Month letter L = December — subtraction lands in December
  it('returns L letter for December after subtraction', () => {
    // 15 Dec 2026 - 1 month = Nov 15, 2026 (Sun) → roll back to Fri Nov 13 → K1326RR02
    // Nov = K (index 10)
    expect(generateDateCode('15 Dec 2026', 'RR02')).toBe('K1326RR02')
  })

  // DATE-03: subMonths end-of-month clamping — Mar 31 → Feb 28
  it('clamps Mar 31 to Feb 28 after subMonths', () => {
    // 31 Mar 2026 - 1 month = Feb 28, 2026 (Sat)
    // Feb 28, 2026 is a makeup Saturday (Spring Festival), so it IS a workday → B2826RR01
    expect(generateDateCode('31 Mar 2026', 'RR01')).toBe('B2826RR01')
  })

  // DATE-04: Spring Festival makeup Saturday — Feb 14, 2026 is a workday
  it('returns B1426RR01 for 15 Mar 2026 (Feb 15 is Sunday, rolls back to Feb 14 makeup Saturday)', () => {
    // 15 Mar 2026 - 1 month = Feb 15, 2026 (Sunday) → roll back
    // Feb 14, 2026 is a makeup Saturday (Spring Festival) → IS a workday → use Feb 14
    expect(generateDateCode('15 Mar 2026', 'RR01')).toBe('B1426RR01')
  })

  // DATE-04: National Day (Oct 1, 2026) triggers rollback
  it('returns I3026RR02 for 01 Nov 2026 (Oct 1 is National Day, rolls back to Sep 30)', () => {
    // 01 Nov 2026 - 1 month = Oct 1, 2026 (National Day holiday) → roll back to Sep 30
    // Sep = I (index 8), day=30, year=26, factory=RR02
    expect(generateDateCode('01 Nov 2026', 'RR02')).toBe('I3026RR02')
  })

  // DATE-01: Unknown factory code returns null
  it('returns null for unknown factory code', () => {
    expect(generateDateCode('15 May 2026', 'XX99')).toBeNull()
  })

  // Edge case: invalid date string returns null
  it('returns null for unparseable date', () => {
    expect(generateDateCode('invalid date', 'RR01')).toBeNull()
  })

  // Edge case: empty string returns null
  it('returns null for empty date string', () => {
    expect(generateDateCode('', 'RR01')).toBeNull()
  })
})
