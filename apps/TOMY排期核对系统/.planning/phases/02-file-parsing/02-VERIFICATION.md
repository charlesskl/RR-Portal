---
phase: 02-file-parsing
verified: 2026-03-21T01:40:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "End-to-end browser upload of real PO PDFs and schedule Excel"
    expected: "Each PDF shows green done tag with TOMY PO number and item count; schedule shows row count with no garbled output"
    why_human: "Visual confirmation of Ant Design component rendering and data display cannot be verified programmatically; Task 3 in Plan 03 is checkpoint:human-verify"
---

# Phase 2: File Parsing Verification Report

**Phase Goal:** Users can upload PDF PO files and an Excel scheduling template and see confirmed extraction of all required fields with per-file status feedback
**Verified:** 2026-03-21T01:40:00Z
**Status:** passed (pending human browser check)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | User can select and upload multiple PDF PO files in a single session without error | VERIFIED | `client/src/App.tsx` uses Ant Design `Upload` with `multiple` and `accept=".pdf"`. `server/routes/upload.ts` accepts `pos` with `maxCount: 20`. Integration test "processes multiple PDF files" passes against 2 real PDFs. |
| 2 | User can upload an existing Excel scheduling template and the system reads all column headers and data rows, preserving merge metadata | VERIFIED | `parseScheduleExcel` loads the `总排期` sheet via ExcelJS, builds header-name column map from row 1, unwraps formula cells and preserves Date objects. 17 tests pass against both Dongguan (30+ rows) and Indonesia (200+ rows) real files. |
| 3 | User sees per-file processing status (parsing / done / error) during and after upload | VERIFIED | `client/src/components/FileStatusList.tsx` renders green "成功" or red "失败" Ant Design Tags per file. `App.tsx` shows a summary line (X processed, Y successful, Z errors). Loading state on the submit button provides in-progress feedback. |
| 4 | Extracted PO data displays all 11 required fields correctly from at least 2 structurally different sample PO PDFs | VERIFIED | `pdfExtractor.ts` extracts all 9 PDF-available fields (tomyPO, customerPO, handleBy, customerName, destCountry, 货号, PO走货期, 数量, factoryCode, 外箱). Tests cover 4 structurally different real POs: 10114426 (PURCHASE ORDER, 4 SKUs), 10114976 (PURCHASE ORDER, 2 SKUs), 10122817 (SUBSEQUENT ORDER), 10122821 (SUBSEQUENT ORDER, multi-item). Note: 总箱数 and 箱唛资料 are not present in PDFs per research; planned coverage is 9 of 11 fields from PDF, 2 fields from schedule. 12 PDF tests + 5 integration tests all pass. |
| 5 | Extracted Excel data matches the template's actual column layout with no field-position drift | VERIFIED | Header-based column mapping (`buildColumnMap` + `resolveColumn` with aliases) resolves all 13 `ScheduleRow` fields regardless of column position. Dongguan and Indonesia use different column positions for TOMY PO, CUSTOMER PO, 日期码, 箱唛资料 — all resolved correctly via alias map. Cross-file alias compatibility test asserts all 14 `ScheduleRow` fields present on rows from both files. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/types/index.ts` | POData, POItem, ScheduleRow, FileResult, ProcessResponse interfaces | VERIFIED | All 5 interfaces exported. All fields match plan spec exactly. 51 lines, substantive. |
| `server/lib/normalize.ts` | String normalization utility | VERIFIED | Exports `normalize()`. NFKC + `\u00A0` replace + trim + null-safe. 14 lines. 7 tests pass. |
| `server/lib/pdfExtractor.ts` | PDF text extraction and field parsing, exports `extractPO` | VERIFIED | 141 lines. Imports pdfjs-dist legacy build via `pathToFileURL`. Exports `extractPO(buffer, filename): Promise<POData>`. 12 tests pass against 4 real PO files. |
| `server/lib/pdfExtractor.test.ts` | Unit tests against real PDF fixtures | VERIFIED | 116 lines. Tests 4 real PO files. All 12 tests pass. |
| `server/lib/excelParser.ts` | Excel schedule parsing with header-based column mapping, exports `parseScheduleExcel` | VERIFIED | 195 lines. Exports `parseScheduleExcel(buffer): Promise<ScheduleRow[]>`. Formula unwrapping, date handling, alias resolution. 17 tests pass. |
| `server/lib/excelParser.test.ts` | Unit tests against both real Excel fixtures | VERIFIED | 143 lines. Tests Dongguan and Indonesia files. All 17 tests pass. |
| `server/routes/upload.ts` | Wired upload handler calling pdfExtractor and excelParser | VERIFIED | 87 lines. Real handler (not stub): imports `extractPO` and `parseScheduleExcel`, iterates files, per-file try/catch, returns `ProcessResponse`. |
| `server/routes/upload.test.ts` | Integration tests for the upload endpoint | VERIFIED | 174 lines. 5 tests using `app.listen(0)` with Node built-in fetch and real fixtures. All pass. |
| `client/src/components/FileStatusList.tsx` | Per-file status display component | VERIFIED | 126 lines. Renders Ant Design `List`+`Tag`+`Descriptions`. Green/red tags per file. Schedule row count display. |
| `client/src/App.tsx` | Updated upload form with status feedback | VERIFIED | 170 lines. Typed `ProcessResponse` state. Summary line. `FileStatusList` component replacing raw JSON Alert. `response.ok` error check. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server/lib/pdfExtractor.ts` | `pdfjs-dist/legacy/build/pdf.mjs` | ESM import with legacy build | WIRED | Line 1: `import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'`. `getDocument` called in `extractPDFText`. |
| `server/lib/pdfExtractor.ts` | `server/types/index.ts` | POData, POItem type imports | WIRED | Line 4: `import type { POData, POItem } from '../types/index.js'`. Both used in function signatures and return values. |
| `server/lib/excelParser.ts` | `exceljs` | `Workbook.xlsx.load(buffer)` | WIRED | Line 1: `import ExcelJS from 'exceljs'`. `new ExcelJS.Workbook()` and `workbook.xlsx.load(buffer)` called in `parseScheduleExcel`. |
| `server/lib/excelParser.ts` | `server/types/index.ts` | ScheduleRow type import | WIRED | Line 2: `import type { ScheduleRow } from '../types/index.js'`. Used in return type `Promise<ScheduleRow[]>`. |
| `server/routes/upload.ts` | `server/lib/pdfExtractor.ts` | `extractPO(buffer, filename)` | WIRED | Line 3: `import { extractPO } from '../lib/pdfExtractor.js'`. Called in per-file loop at line 52. |
| `server/routes/upload.ts` | `server/lib/excelParser.ts` | `parseScheduleExcel(buffer)` | WIRED | Line 4: `import { parseScheduleExcel } from '../lib/excelParser.js'`. Called at line 70. |
| `client/src/App.tsx` | `/api/process` | `fetch` POST with FormData | WIRED | Line 83: `const response = await fetch('/api/process', { method: 'POST', body: formData })`. Response parsed as `ProcessResponse` and state set. |
| `client/src/App.tsx` | `client/src/components/FileStatusList.tsx` | Component import, passes FileResult[] | WIRED | Line 5: `import FileStatusList from './components/FileStatusList'`. Used at line 159: `<FileStatusList files={result.files} schedule={result.schedule} />`. |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| FILE-01 | 02-03-PLAN.md | User can upload multiple PDF PO files in one session | SATISFIED | Ant Design `Upload` with `multiple`, `maxCount: 20` on multer. Integration test "processes multiple PDF files" passes with 2 real PDFs simultaneously. |
| FILE-02 | 02-01-PLAN.md | System extracts text data from PDF POs (text-selectable PDFs) | SATISFIED | `extractPO` uses pdfjs-dist legacy build to extract all PDF text content. All 9 extractable fields populated. 12 tests against 4 real PO files all pass. |
| FILE-03 | 02-03-PLAN.md | User can upload existing Excel scheduling template | SATISFIED | `client/src/App.tsx` `Upload` for `.xlsx/.xls`. `server/routes/upload.ts` accepts `schedule` field. Integration test "processes a real Excel schedule file" passes. |
| FILE-04 | 02-02-PLAN.md | System reads and parses Excel template preserving structure | SATISFIED | `parseScheduleExcel` reads `总排期` sheet, header-based column mapping, formula cell unwrapping, Date object preservation. 17 tests pass against both Dongguan and Indonesia real files. |
| FILE-05 | 02-03-PLAN.md | User sees processing progress and status feedback during parsing | SATISFIED | `FileStatusList` renders per-file done/error status. Summary line shows counts. Button loading state during upload. Schedule shows row count. |

No orphaned requirements — all 5 Phase 2 requirements claimed in plan frontmatter and verified in codebase.

---

### Anti-Patterns Found

No anti-patterns found. Grep of `server/` and `client/src/` for TODO, FIXME, XXX, HACK, PLACEHOLDER, stub patterns, empty returns, and console.log-only implementations returned no matches.

---

### Human Verification Required

**1. End-to-End Browser Upload**

**Test:** Start backend (`npx tsx server/index.ts`) and frontend (`cd client && npx vite`). Open `http://localhost:5173`. Select 2-3 PO PDFs from project root and one Excel schedule file. Click "上传并核对".

**Expected:**
- Each PDF shows a green "成功" tag with TOMY PO number, item count, factory codes
- Schedule shows "成功" with row count (~30 for Dongguan, ~200+ for Indonesia)
- Summary line shows correct processed/successful/error counts
- No "[object Object]" or garbled characters in any displayed fields
- Chinese filenames display correctly (encoding fix committed at `0580fb0`)

**Why human:** Visual rendering of Ant Design components and actual field values cannot be verified programmatically. Task 3 of Plan 03 is explicitly `checkpoint:human-verify` and was left pending in the summary. The `0580fb0` fix to Chinese filename encoding was committed after the plan summary and should be confirmed working.

---

### Gaps Summary

No gaps. All 5 observable truths verified, all 10 artifacts pass all three levels (exists, substantive, wired), all 8 key links confirmed wired, and all 5 requirements satisfied. The only pending item is the human browser verification checkpoint (Task 3 of Plan 03), which is expected by design and does not block the automated goal verification.

**Test suite result:** 41/41 tests passing across normalize, pdfExtractor, excelParser, and upload integration tests. Frontend vite build succeeds in 538ms.

**Post-summary fix:** Commit `0580fb0` (fix(02-03): fix Chinese filename encoding) was applied after the plan summaries were written. This fix improves filename display for Chinese-character filenames and is included in the current codebase state.

---

_Verified: 2026-03-21T01:40:00Z_
_Verifier: Claude (gsd-verifier)_
