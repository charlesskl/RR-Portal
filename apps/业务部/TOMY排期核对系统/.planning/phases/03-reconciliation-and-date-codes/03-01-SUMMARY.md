---
phase: 03-reconciliation-and-date-codes
plan: 01
subsystem: api
tags: [date-fns, chinese-days, vitest, typescript, date-arithmetic]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: vitest test runner configured, TypeScript project structure
  - phase: 02-file-parsing
    provides: POItem type with PO走货期 and factoryCode fields
provides:
  - generateDateCode() function in server/lib/dateCodeGenerator.ts
  - 10 passing tests covering DATE-01 through DATE-05 requirements
affects:
  - 03-02 (reconciler will call generateDateCode per POItem)
  - 03-03 (excelWriter will use date codes for 日期码 column fill)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CJS default import for chinese-days in ESM context: import pkg from 'chinese-days'; const { isWorkday, findWorkday } = pkg"
    - "isWorkday() check before findWorkday(-1, x) — findWorkday is exclusive, must not call it on already-workday dates"
    - "date-fns subMonths() for end-of-month-safe calendar subtraction"

key-files:
  created:
    - server/lib/dateCodeGenerator.ts
    - server/lib/dateCodeGenerator.test.ts
  modified: []

key-decisions:
  - "Feb 28, 2026 (Saturday) is a makeup workday — chinese-days treats it as a workday; Mar 31 - 1 month = Feb 28, no further rollback"
  - "findWorkday(-1, x) is exclusive: always call isWorkday(x) first; only call findWorkday if not a workday"

patterns-established:
  - "Pattern: chinese-days CJS import via default import destructuring, never named imports"
  - "Pattern: isWorkday-first guard before findWorkday to avoid off-by-one rollback"

requirements-completed: [DATE-01, DATE-02, DATE-03, DATE-04, DATE-05]

# Metrics
duration: 10min
completed: 2026-03-21
---

# Phase 3 Plan 01: Date Code Generator Summary

**generateDateCode() with date-fns subMonths + chinese-days workday rollback, verified against Spring Festival makeup Saturdays and National Day holidays**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-21T07:30:15Z
- **Completed:** 2026-03-21T07:40:00Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments

- Implemented `generateDateCode(poZouHuoQiStr, factoryCode)` returning formatted date code or null
- Full TDD cycle: 10 failing tests written first, then implementation made all pass
- Confirmed Feb 28, 2026 (Saturday) is a chinese-days makeup workday — Mar 31 - 1 month correctly stays on Feb 28
- Verified Spring Festival Feb 14, 2026 rollback case (Feb 15 = Sunday rolls back to Feb 14 makeup Saturday)
- Verified National Day Oct 1, 2026 rollback case (Oct 1 = holiday rolls back to Sep 30)
- Full test suite: 51/51 passing (41 pre-existing + 10 new)

## Task Commits

1. **Test (RED): dateCodeGenerator failing tests** - `4049714` (test)
2. **Implementation (GREEN): dateCodeGenerator module** - `7114a0f` (feat)

## Files Created/Modified

- `server/lib/dateCodeGenerator.ts` - generateDateCode() export; date-fns + chinese-days integration
- `server/lib/dateCodeGenerator.test.ts` - 10 tests covering DATE-01 through DATE-05

## Decisions Made

- **Feb 28, 2026 is a workday:** The plan's must_have truth said "subMonths correctly clamps end-of-month dates (Mar 31 → Feb 28)". During execution, the test discovered Feb 28 is itself a makeup Saturday — no further rollback needed. Test expectation corrected from B2726RR01 to B2826RR01 to match the correct behavior.
- **isWorkday-first pattern enforced:** Per the research pitfall (#4), `findWorkday(-1, x)` is exclusive. The implementation checks `isWorkday(dateStr)` before calling `findWorkday`, ensuring no off-by-one rollback on valid workdays.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected test expectation for Mar 31 end-of-month clamping**

- **Found during:** Task 1 GREEN phase run
- **Issue:** Test expected `B2726RR01` (assuming Feb 28 would roll back to Feb 27 as a Saturday). Actual: Feb 28, 2026 is a makeup Saturday (Spring Festival) and is treated as a workday by chinese-days — so Feb 28 is the correct result.
- **Fix:** Updated test comment and expectation from `B2726RR01` to `B2826RR01`
- **Files modified:** server/lib/dateCodeGenerator.test.ts
- **Verification:** All 10 tests pass after correction
- **Committed in:** 7114a0f (GREEN commit, alongside implementation)

---

**Total deviations:** 1 auto-fixed (test expectation corrected to match verified behavior)
**Impact on plan:** No scope change. The algorithm was correct; the test expectation was based on an incorrect assumption about Feb 28 workday status.

## Issues Encountered

None beyond the test expectation correction above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `generateDateCode()` is ready to import in the reconciler (Phase 3 Plan 02)
- Import pattern: `import { generateDateCode } from './dateCodeGenerator'`
- Returns null for unknown factory codes and invalid date strings — caller should handle null
- All DATE-01 through DATE-05 requirements satisfied

---
*Phase: 03-reconciliation-and-date-codes*
*Completed: 2026-03-21*
