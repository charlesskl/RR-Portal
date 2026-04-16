---
phase: 02-file-parsing
plan: 01
subsystem: api
tags: [pdfjs-dist, typescript, vitest, normalize, pdf-parsing]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: Express server, multer upload stub, pdfjs-dist and exceljs installed

provides:
  - POData, POItem, ScheduleRow, FileResult, ProcessResponse TypeScript interfaces (server/types/index.ts)
  - normalize() string utility handling full-width chars, non-breaking spaces, null-safe trimming
  - extractPO(buffer, filename) function extracting header fields + all line items from real PO PDFs
  - 19 passing unit tests against real PDF fixtures

affects:
  - 02-02-excel-parser (imports ScheduleRow type)
  - 02-03-route-wiring (imports POData, FileResult, ProcessResponse; calls extractPO)
  - 03-reconciliation (uses POData.items array structure and field names)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - pdfjs-dist legacy build with pathToFileURL for Windows compatibility
    - Label-anchored regex against raw PDF text stream (handles \n \n separator format)
    - TDD execution: RED (failing test) then GREEN (implementation) per task

key-files:
  created:
    - server/types/index.ts
    - server/lib/normalize.ts
    - server/lib/normalize.test.ts
    - server/lib/pdfExtractor.ts
    - server/lib/pdfExtractor.test.ts
  modified: []

key-decisions:
  - "Part number regex [A-Z0-9][A-Z0-9]+ not [A-Z][A-Z0-9]* - discovered 47280A starts with digit 4"
  - "pdfjs-dist legacy build required on Node.js - standard build fails with DOMMatrix not defined"
  - "pathToFileURL() required for workerSrc on Windows - raw paths rejected by Node ESM loader"
  - "Item separator in PDF text stream is \\n \\n (newline-space-newline) not just \\n"

patterns-established:
  - "Pattern: label-anchored regex for PDF extraction - escapedLabel + \\s*:\\s* + capture group"
  - "Pattern: gm flags removed from item pattern (^ anchor conflicted with mid-text part number lines)"
  - "Pattern: factoryCode extracted from segment between consecutive item matches, not full text"

requirements-completed: [FILE-02]

# Metrics
duration: 5min
completed: 2026-03-21
---

# Phase 2 Plan 01: Type Definitions, Normalize Utility, and PDF Extractor Summary

**pdfjs-dist legacy build PDF extractor returning structured POData with items array, tested against 4 real TOMY PO files (PURCHASE ORDER and SUBSEQUENT ORDER types, single and multi-item)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-21T00:07:49Z
- **Completed:** 2026-03-21T00:13:12Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Shared TypeScript interfaces (POData, POItem, ScheduleRow, FileResult, ProcessResponse) ready for all Phase 2 and 3 plans
- normalize() utility correctly handles full-width digits (NFKC), non-breaking spaces (\u00A0), null/undefined, and trimming
- extractPO() successfully parses all 8 real PO PDFs: header fields (tomyPO, customerPO, handleBy, customerName, destCountry) and all line items (货号, PO走货期, 数量, factoryCode, 外箱)
- 19/19 unit tests green against real PDF fixtures (no mocks)

## Task Commits

Each task was committed atomically:

1. **Task 1: Type definitions and normalize utility** - `19ba5e4` (feat)
2. **Task 2: PDF extractor with tests against real fixtures** - `6b39526` (feat)

## Files Created/Modified

- `server/types/index.ts` - POData, POItem, ScheduleRow, FileResult, ProcessResponse interfaces
- `server/lib/normalize.ts` - normalize() string utility (NFKC + \u00A0 + trim + null-safe)
- `server/lib/normalize.test.ts` - 7 unit tests for normalize()
- `server/lib/pdfExtractor.ts` - extractPO() using pdfjs-dist legacy build; label-anchored regex; multi-item array extraction
- `server/lib/pdfExtractor.test.ts` - 12 unit tests against real PDF fixtures (4 PO files)

## Decisions Made

- Part number regex changed to `[A-Z0-9][A-Z0-9]+` after discovering `47280A` starts with digit `4` (the research Pattern 2 in 02-RESEARCH.md had `[A-Z][A-Z0-9]+` which was wrong for this real data)
- Removed `^` (start-of-line) multiline anchor from item pattern: part numbers appear mid-text and `^` with `gm` failed to match them even though they ARE at the start of a line (conflict with how gm anchoring works with the separator pattern)
- Carton packing regex is `(\d+)\s*(?:EA|SET|PC)\s*\/\s*MASTER CARTON` (space before `/` is in real text)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed item pattern regex - part numbers starting with digits not matched**
- **Found during:** Task 2 (PDF extractor implementation and test run)
- **Issue:** Research Pattern 2 specified `[A-Z][A-Z0-9]*` but real part number `47280A` starts with digit `4`, so the pattern matched only the trailing `A` character, producing wrong results
- **Fix:** Changed to `[A-Z0-9][A-Z0-9]+` to allow digit-starting part numbers; also removed `^gm` anchor which caused no matches to be found
- **Files modified:** server/lib/pdfExtractor.ts
- **Verification:** Re-ran tests; all 4 PO item extractions pass with correct part numbers
- **Committed in:** `6b39526` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential fix; without it 0 items would be extracted from PO 10114426. No scope creep.

## Issues Encountered

- pdfjs-dist emits `standardFontDataUrl` warnings during extraction (non-blocking); all text still extracted correctly from these English-text PDFs

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Types exported from `server/types/index.ts` ready for Plan 02-02 (Excel parser) and 02-03 (route wiring)
- extractPO() function ready to be called from the upload route handler
- ScheduleRow interface already designed to match the Excel column mapping from research
- Concern: destCountry extracted in English ("BELGIUM", "USA") while schedule has Chinese ("比利时", "美国") - country translation deferred to Phase 3 as planned

---
*Phase: 02-file-parsing*
*Completed: 2026-03-21*
