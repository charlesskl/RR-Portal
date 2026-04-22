---
phase: 04-output-download-and-integration
plan: 02
subsystem: api
tags: [express, multer, zip, react, antd, typescript, dual-schedule, factory-filter]

# Dependency graph
requires:
  - phase: 04-output-download-and-integration
    provides: buildZipBuffer() and buildSummaryReport() from plan 01
  - phase: 03-reconciliation-and-date-codes
    provides: reconcile() and writeAnnotatedSchedule() for per-factory output
provides:
  - Dual schedule upload route (scheduleDg + scheduleId multer fields)
  - Factory-filtered reconciliation (RR01->DG, RR02->ID)
  - ZIP output with DG/东莞排期核对结果.xlsx, ID/印尼排期核对结果.xlsx, 核对汇总报告.txt
  - Per-factory reconciliation stats in ProcessResponse (reconciliationDg + reconciliationId)
  - Frontend with two schedule upload slots and per-factory stat cards
affects:
  - End-to-end user flow (human verification in Task 3 checkpoint)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Factory-filtered PO list before reconciliation (po.items[0]?.factoryCode === 'RR01')
    - Dual optional schedule pattern — either or both schedules can be omitted gracefully
    - ZIP entries built conditionally — only include factories with uploaded schedules
    - Frontend ReconciliationCard extracted as reusable component for DG and ID stats

key-files:
  created: []
  modified:
    - server/types/index.ts (ProcessResponse updated: scheduleDg/scheduleId, reconciliationDg/reconciliationId)
    - server/routes/upload.ts (dual schedule upload, factory-filtered reconciliation, ZIP output)
    - server/routes/upload.test.ts (updated assertions for new scheduleDg/scheduleId field names)
    - client/src/App.tsx (two schedule upload slots, per-factory stat display, ZIP download filename)
    - client/src/components/FileStatusList.tsx (schedules[] array prop replaces single schedule prop)

key-decisions:
  - "Factory PO filtering by items[0].factoryCode before reconciliation — prevents spurious unmatched entries across factories"
  - "schedules[] array prop in FileStatusList — simpler than two separate optional props, handles 0/1/2 schedules uniformly"
  - "Conditional ZIP entries — only include Excel file for each factory if that schedule was uploaded"
  - "ReconciliationCard extracted as local component — avoids duplication between DG and ID stat displays"

patterns-established:
  - "Dual optional schedule pattern: dgBuffer/idBuffer null-checked independently; ZIP built from non-null entries only"
  - "Per-factory stats in API response: reconciliationDg and reconciliationId mirror same ReconciliationSummary shape"

requirements-completed: [OUT-01, OUT-02, OUT-03, OUT-04]

# Metrics
duration: 13min
completed: 2026-03-23
---

# Phase 4 Plan 02: Upload Route Integration and Frontend Summary

**Dual-schedule upload route with factory-filtered reconciliation producing a ZIP archive containing per-factory annotated Excel files (DG/ and ID/) plus a plain-text summary report**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-03-23T01:53:13Z
- **Completed:** 2026-03-23T02:06:00Z
- **Tasks:** 2 automated (Task 3 is human-verify checkpoint)
- **Files modified:** 5

## Accomplishments

- Upload route now accepts `scheduleDg` and `scheduleId` multer fields; processes each independently and filters PO lists by factory code before reconciling
- ZIP output contains `DG/东莞排期核对结果.xlsx`, `ID/印尼排期核对结果.xlsx` (conditionally), and `核对汇总报告.txt`; download endpoint serves `application/zip` with `TOMY_reconciliation.zip` filename
- Frontend shows two separate upload cards (东莞 and 印尼), sends correct FormData fields, displays per-factory reconciliation stat cards, and downloads ZIP as `TOMY_核对结果.zip`
- All 99 tests continue to pass after both task changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Update types, upload route for dual schedules and ZIP output** - `7a8f37e` (feat)
2. **Task 2: Update frontend for dual schedule upload and per-factory stats** - `ca7b1e6` (feat)

_Task 3 is a human-verify checkpoint — awaiting user verification._

## Files Created/Modified

- `server/types/index.ts` - ProcessResponse now has scheduleDg/scheduleId and reconciliationDg/reconciliationId fields
- `server/routes/upload.ts` - Dual schedule processing, factory-filtered reconciliation, ZIP output, application/zip download headers
- `server/routes/upload.test.ts` - Updated test assertions: schedule->scheduleDg, null check for scheduleId
- `client/src/App.tsx` - Two schedule upload slots, per-factory ReconciliationCard components, ZIP filename, schedules[] passed to FileStatusList
- `client/src/components/FileStatusList.tsx` - Changed schedule prop to schedules[] array for uniform 0/1/2 schedule display

## Decisions Made

- **Factory PO filtering before reconciliation:** `po.items[0]?.factoryCode === 'RR01'` for DG, `=== 'RR02'` for ID. All items in a real PO share the same factory code. This prevents spurious unmatched entries (plan Pitfall 3).
- **schedules[] array in FileStatusList:** One prop handles 0, 1, or 2 schedule results uniformly without conditional prop juggling in App.tsx.
- **Conditional ZIP entries:** `if (dgExcel) zipEntries.push(...)` — only include factories with uploaded and successfully processed schedules.
- **ReconciliationCard local component:** Extracted to avoid duplicating the stat display JSX for DG and ID factories.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all interfaces from Plan 01 matched perfectly. Test updates were straightforward field name renames.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Complete Phase 4 end-to-end flow is ready for human verification (Task 3 checkpoint)
- User needs to: start dev server, upload real PO PDFs + both schedule Excel files, verify two reconciliation cards appear, download and extract ZIP, confirm DG/ID folder separation and red-highlight styling

---
## Self-Check: PASSED

- FOUND: server/types/index.ts
- FOUND: server/routes/upload.ts
- FOUND: client/src/App.tsx
- FOUND: client/src/components/FileStatusList.tsx
- FOUND: .planning/phases/04-output-download-and-integration/04-02-SUMMARY.md
- FOUND commit 7a8f37e (feat: dual schedule upload, factory-filtered reconciliation, ZIP output)
- FOUND commit ca7b1e6 (feat: update frontend for dual schedule upload and per-factory stats)
- All 99 tests passing

*Phase: 04-output-download-and-integration*
*Completed: 2026-03-23*
