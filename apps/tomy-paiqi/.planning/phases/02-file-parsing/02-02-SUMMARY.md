---
phase: 02-file-parsing
plan: 02
subsystem: excel-parser
tags: [excel, exceljs, schedule-parsing, formula-cells, date-cells, header-mapping]
dependency_graph:
  requires: [server/types/index.ts, exceljs]
  provides: [server/lib/excelParser.ts]
  affects: [phase-03-reconciliation]
tech_stack:
  added: []
  patterns: [header-name-column-mapping, formula-cell-unwrapping, alias-resolution]
key_files:
  created:
    - server/lib/excelParser.ts
    - server/lib/excelParser.test.ts
  modified: []
decisions:
  - Header-name lookup instead of column indices to handle Dongguan/Indonesia position differences
  - unwrapCellValue extracts .result from ExcelJS formula cells to get numeric values
  - tomyPO/customerPO use alias arrays to resolve different spellings between files
  - Empty row filtering based on tomyPO being null/empty
metrics:
  duration_seconds: 110
  completed_date: "2026-03-21"
  tasks_completed: 1
  files_created: 2
---

# Phase 2 Plan 2: Excel Schedule Parser Summary

**One-liner:** ExcelJS parser for 总排期 sheet with header-name column mapping, formula-cell unwrapping, and cross-file alias resolution for Dongguan/Indonesia schedule files.

---

## What Was Built

`server/lib/excelParser.ts` exports `parseScheduleExcel(buffer: Buffer): Promise<ScheduleRow[]>` that:

1. Loads the Excel buffer with ExcelJS and finds the `总排期` worksheet
2. Reads row 1 to build a `Map<string, number>` of header name to column number
3. Resolves `tomyPO` and `customerPO` columns via alias arrays (`['Tomy PO', 'TOMY PO']` and `['Cust. PO NO.', 'CUSTOMER PO']`) to handle spelling differences between files
4. Iterates rows starting from row 2, extracting all 13 `ScheduleRow` fields
5. Unwraps ExcelJS formula cells (`{ formula, result }` objects) to extract numeric `.result` for `外箱`, `总箱数`, and `数量`
6. Keeps `PO走货期` and `接单期` as native `Date` instances (not strings)
7. Filters out rows where `tomyPO` is empty/null (blank spreadsheet rows)

`server/lib/excelParser.test.ts` covers:
- Dongguan file (42 total rows, 30+ data rows expected)
- Indonesia file (243 total rows, 200+ data rows expected)
- Formula cell numeric extraction
- Date cell instanceof Date assertion
- Alias resolution for both column name variants
- Empty row filtering (returned count < total Excel rows)
- All 13 ScheduleRow fields present on every row

---

## Test Results

- 17 tests, all passing, against real Excel fixtures
- Full suite: 36 tests passing (no regressions in pdfExtractor or normalize)
- Test duration: ~1.6s total

---

## Deviations from Plan

None - plan executed exactly as written. The research-provided code examples were accurate and required no adjustments.

---

## Self-Check: PASSED

Files created:
- server/lib/excelParser.ts — FOUND
- server/lib/excelParser.test.ts — FOUND

Commits:
- eab417c: test(02-02): add failing tests for Excel schedule parser — FOUND
- 7c4210b: feat(02-02): implement Excel schedule parser with header-based column mapping — FOUND
