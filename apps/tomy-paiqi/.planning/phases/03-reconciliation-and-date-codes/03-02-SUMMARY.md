---
phase: 03-reconciliation-and-date-codes
plan: 02
subsystem: api
tags: [vitest, typescript, reconciliation, tdd, date-fns, chinese-days]

# Dependency graph
requires:
  - phase: 03-01
    provides: generateDateCode() for dateCode field population per matched item
  - phase: 02-file-parsing
    provides: POData, POItem, ScheduleRow types from parsing pipeline
provides:
  - reconcile() function in server/lib/reconciler.ts
  - FieldMismatch, RowMatchResult, ReconciliationResult types in server/types/index.ts
  - qcInstructions field on POData extracted by pdfExtractor
  - 29 passing tests covering COMP-01 through COMP-12, COMP-14, dateCode wiring
affects:
  - 03-03 (excelWriter reads result.matched[].dateCode, result.matched[].mismatches)
  - 04 (output phase uses ReconciliationResult for Excel generation)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "normalize() applied to both PO and schedule sides before comparison"
    - "COUNTRY_MAP Record<string, string> for EN→ZH translation keyed on uppercased normalized country name"
    - "date-fns parse(str, 'd MMM yyyy', new Date()) for PO走货期 string parsing"
    - "Composite key normalize(tomyPO) + ':' + normalize(货号) for schedule index lookup"
    - "generateDateCode() called inline when building RowMatchResult (not post-processed)"
    - "Chinese variable names avoided in const declarations (TypeScript parser issue on Windows)"

key-files:
  created:
    - server/lib/reconciler.ts
    - server/lib/reconciler.test.ts
  modified:
    - server/types/index.ts
    - server/lib/pdfExtractor.ts

key-decisions:
  - "Chinese identifiers avoided in const declarations: const货号Counts caused ReferenceError — renamed to goodsNoCounts"
  - "generate箱唛资料 is a function name (function keyword avoids the const issue)"
  - "总箱数 always skipped per COMP-10 — not extractable from PDF, never compared"
  - "COUNTRY_MAP lookup uses normalize().toUpperCase() to handle casing variations"
  - "Multiple schedule rows matching same composite key: first row used (edge case, not in requirements)"

# Metrics
duration: 3min
completed: 2026-03-21
---

# Phase 3 Plan 02: Reconciliation Engine Summary

**Reconciliation engine with composite-key matching, 10-field comparison, EN→ZH country mapping, 箱唛资料 rule generation, and generateDateCode wiring — all verified via TDD with 29 passing tests**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-21T07:34:49Z
- **Completed:** 2026-03-21T07:38:10Z
- **Tasks:** 2 (Task 1: auto; Task 2: TDD RED + GREEN)
- **Files modified:** 4

## Accomplishments

- Extended `server/types/index.ts` with `qcInstructions` on POData, plus `FieldMismatch`, `RowMatchResult`, `ReconciliationResult` types
- Added `extractQCInstructions()` to `pdfExtractor.ts`; pdfExtractor now returns `qcInstructions` from PDF text
- Built `reconcile()` in `server/lib/reconciler.ts`:
  - Matches by composite key `normalize(tomyPO) + ":" + normalize(货号)`
  - Compares 10 active fields (国家, 第三客户名称, 客跟单, TOMY PO, CUSTOMER PO, 货号, 数量, 外箱, PO走货期, 箱唛资料)
  - Translates destCountry EN→ZH via COUNTRY_MAP before comparison
  - Generates 箱唛资料 from rules: TOMY→标准唛/待定, qcInstructions TTT→+TTT, EU shipments→+欧盟联盟
  - Skips 总箱数 always (COMP-10)
  - Populates `dateCode` via `generateDateCode(poItem.PO走货期, poItem.factoryCode)` per matched item
  - Flags duplicate 货号 within same PO as ambiguous
  - Collects unmatched items in `unmatchedPOItems`
- Full TDD cycle: 29 failing tests written first, then implementation made all pass
- Full suite: 80/80 tests passing (51 pre-existing + 29 new)

## Task Commits

1. **Task 1 (auto): extend types and qcInstructions** - `dec0e4b` (feat)
2. **Task 2 RED: failing reconciler tests** - `35c6d45` (test)
3. **Task 2 GREEN: reconciliation engine implementation** - `05930ec` (feat)

## Files Created/Modified

- `server/lib/reconciler.ts` — reconcile() export, compareFields(), buildScheduleIndex(), generate箱唛资料()
- `server/lib/reconciler.test.ts` — 29 tests covering all COMP requirements and dateCode wiring
- `server/types/index.ts` — qcInstructions on POData; FieldMismatch, RowMatchResult, ReconciliationResult types
- `server/lib/pdfExtractor.ts` — extractQCInstructions() helper; qcInstructions populated in extractPO()

## Decisions Made

- **Chinese identifiers in const declarations cause ReferenceError:** TypeScript/V8 on this platform has an issue with `const货号Counts` (const immediately followed by Chinese character). Renamed to `goodsNoCounts`. Function names (using `function` keyword) handle Chinese characters fine.
- **First matching schedule row wins:** If multiple schedule rows share the same composite key (unusual but possible), the first is used. Not in requirements scope.
- **COUNTRY_MAP lookup uses toUpperCase():** Handles PDFs that might extract lowercase or mixed-case country names.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Renamed Chinese-prefixed const variable**

- **Found during:** Task 2 GREEN phase run
- **Issue:** `const货号Counts` caused `ReferenceError: const货号Counts is not defined` at runtime — TypeScript compiled successfully but V8 failed to parse the identifier when `const` is immediately followed by a non-ASCII character.
- **Fix:** Renamed `const货号Counts` → `const goodsNoCounts` and updated all references.
- **Files modified:** server/lib/reconciler.ts
- **Verification:** All 29 tests pass after fix.
- **Committed in:** 05930ec (GREEN commit, alongside implementation)

---

**Total deviations:** 1 auto-fixed (identifier naming issue)
**Impact on plan:** No scope change. Logic was correct; only variable name changed.

## Issues Encountered

None beyond the variable naming fix above.

## User Setup Required

None.

## Next Phase Readiness

- `reconcile(poDataList, scheduleRows)` is ready to call in the upload route (Phase 3 Plan 03)
- Import pattern: `import { reconcile } from './lib/reconciler.js'`
- Returns `ReconciliationResult` with `matched[]`, `unmatchedPOItems[]`, `ambiguousPOItems[]`, `errors[]`
- Each `matched[i].dateCode` is already populated — excelWriter can use it directly for 日期码 column
- Each `matched[i].mismatches` lists fields with differing values for red-highlight logic

---
*Phase: 03-reconciliation-and-date-codes*
*Completed: 2026-03-21*
