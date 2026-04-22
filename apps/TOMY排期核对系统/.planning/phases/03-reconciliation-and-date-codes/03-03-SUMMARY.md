---
phase: 03-reconciliation-and-date-codes
plan: 03
subsystem: api
tags: [exceljs, vitest, typescript, tdd, reconciliation, excel-styling]

# Dependency graph
requires:
  - phase: 03-01
    provides: generateDateCode() for 日期码 column fill
  - phase: 03-02
    provides: reconcile() function, ReconciliationResult, RowMatchResult types
  - phase: 02-file-parsing
    provides: parseScheduleExcel(), ExcelJS workbook patterns
provides:
  - writeAnnotatedSchedule() function in server/lib/excelWriter.ts
  - GET /api/download/:sessionId endpoint for annotated Excel download
  - Reconciliation summary in ProcessResponse (matchedCount, unmatchedCount, mismatchedFieldCount)
  - Frontend reconciliation result card and download button
affects:
  - 04 (output phase: factory-split ZIP download will build on session store pattern)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ExcelJS cell.fill pattern: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } }"
    - "ExcelJS cell.note for PO value annotations on mismatched cells"
    - "Session store with crypto.randomUUID() + 30-min setTimeout cleanup for stateless file delivery"
    - "One-time download: clearTimeout + delete from Map on GET /api/download/:sessionId"
    - "Column color priority: red (mismatch) overrides green (matched row default)"
    - "Status column added at ws.columnCount+1 before any row styling"

key-files:
  created:
    - server/lib/excelWriter.ts
    - server/lib/excelWriter.test.ts
  modified:
    - server/routes/upload.ts
    - server/types/index.ts
    - client/src/App.tsx

key-decisions:
  - "Status column added before row styling loop so statusColIdx is stable"
  - "Unmatched PO items appended via ws.addRow() — rowCount changes but status column index is pre-computed"
  - "Download is one-time: buffer cleared from store after GET to avoid memory growth"
  - "Reconciliation failure is non-fatal: API still returns parse results with empty reconciliation summary"

requirements-completed: [COMP-13, COMP-14, DATE-05]

# Metrics
duration: 3min
completed: 2026-03-21
---

# Phase 3 Plan 03: Annotated Excel Writer Summary

**ExcelJS annotated output with red/green/yellow cell fills, PO value notes on mismatches, status column, and one-time session-keyed download — wired end-to-end through the upload API**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-21T07:53:59Z
- **Completed:** 2026-03-21T07:56:50Z
- **Tasks:** 2 automated + 1 human-verify checkpoint (pending)
- **Files modified:** 5

## Accomplishments

- Built `writeAnnotatedSchedule()` in `server/lib/excelWriter.ts`:
  - Loads schedule buffer into ExcelJS workbook, adds `状态` status column
  - Red fill (FFFFCCCC) + `PO value: X` note on each mismatched cell
  - Green fill (FF90EE90) on all cells of fully/partially matched rows (red overrides green for mismatch cells)
  - `已核对` status on matched rows; `未核对` on schedule rows sharing a PO but not directly matched
  - Yellow fill (FFFFFF99) + `未匹配` status on unmatched PO items appended at bottom
  - Date code written to `日期码` only if cell is currently empty (DATE-05)
- Extended `ProcessResponse` with `reconciliation`, `outputReady`, `sessionId` fields
- Updated `upload.ts` to run `reconcile()` + `writeAnnotatedSchedule()` after parsing; stores output in session map with 30-min TTL
- Added `GET /api/download/:sessionId` endpoint (one-time download, auto-cleanup)
- Updated `App.tsx` to show reconciliation summary card and `下载核对结果` download button
- Full TDD cycle: 10 failing tests written first, then implementation passed all 10
- Full suite: 90/90 tests passing (80 pre-existing + 10 new)

## Task Commits

1. **Task 1 RED: failing excelWriter tests** - `7bdc390` (test)
2. **Task 1 GREEN: writeAnnotatedSchedule implementation** - `9990773` (feat)
3. **Task 2: upload route wiring + frontend** - `79a1e3f` (feat)

## Files Created/Modified

- `server/lib/excelWriter.ts` — writeAnnotatedSchedule() with full cell styling logic
- `server/lib/excelWriter.test.ts` — 10 tests: fills, notes, status column, date code, appended rows
- `server/routes/upload.ts` — reconcile + writeAnnotatedSchedule wired in; GET /api/download/:sessionId added
- `server/types/index.ts` — ProcessResponse extended with reconciliation, outputReady, sessionId
- `client/src/App.tsx` — ReconciliationSummary type; summary card; download button

## Decisions Made

- **Status column added before row loop:** `statusColIdx = ws.columnCount + 1` computed once before any styling, so all row operations use a stable column index.
- **One-time download pattern:** On `GET /api/download/:sessionId`, timer is cleared and entry deleted before sending response. Prevents lingering buffers but means the download link can only be used once.
- **Reconciliation failure is non-fatal:** If `reconcile()` or `writeAnnotatedSchedule()` throws, the API still returns 200 with the parse results and an error message in `reconciliation.errors`. The upload workflow continues even if annotation fails.
- **Red overrides green for mismatch cells:** Green fill applied to all cells first in the row loop, then red applied to specific mismatch cells, naturally overriding green without conditional logic.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `writeAnnotatedSchedule()` is complete and tested; Phase 4 (factory-split ZIP) will call it or use its output buffer
- Session store pattern established for stateless file delivery; Phase 4 may extend this for ZIP downloads
- Checkpoint Task 3 (human browser verification) is pending — user must verify reconciliation end-to-end

---
*Phase: 03-reconciliation-and-date-codes*
*Completed: 2026-03-21*
