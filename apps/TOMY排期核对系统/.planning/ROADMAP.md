# Roadmap: TOMY排期核对系统

**Core Value:** 准确核对PO与排期表数据，快速发现不一致项并标红提示，减少人工核对的时间和出错率
**Granularity:** Standard
**Total v1 Requirements:** 30
**Coverage:** 30/30 mapped

---

## Phases

- [x] **Phase 1: Foundation** - Establish web app infrastructure, lock in critical library choices, and set up the deployment stack (completed 2026-03-20)
- [x] **Phase 2: File Parsing** - PDF and Excel parsing pipeline that correctly extracts all PO fields and reads the scheduling template (completed 2026-03-21)
- [x] **Phase 3: Reconciliation and Date Codes** - Field-by-field comparison engine with red-cell highlighting, date code generation, and unmatched PO detection (completed 2026-03-21)
- [x] **Phase 4: Output, Download, and Integration** - Factory classification, ZIP download, summary report, and end-to-end wired API (completed 2026-03-23)

---

## Phase Details

### Phase 1: Foundation

**Goal**: Users can access the web application from any computer via browser, and the development environment is correctly configured with all critical library choices locked in

**Depends on**: Nothing (first phase)

**Requirements**: PLAT-01, PLAT-02

**Success Criteria** (what must be TRUE):
  1. User can open the application in a browser on a computer that has never run the project before (cross-computer access verified)
  2. Application serves correctly through Docker + Nginx with `client_max_body_size 50M` configured
  3. ExcelJS, pdfjs-dist (or pdf-parse), chinese-days, multer, and date-fns are installed and importable in the project
  4. A minimal upload form renders in the browser (foundation for Phase 2 work)

**Plans:** 2/2 plans complete

Plans:
- [x] 01-01-PLAN.md — Scaffold Express + React monorepo, install all libraries, create upload form and smoke test
- [x] 01-02-PLAN.md — Docker + Nginx deployment stack with 50M upload limit

---

### Phase 2: File Parsing

**Goal**: Users can upload PDF PO files and an Excel scheduling template and see confirmed extraction of all required fields with per-file status feedback

**Depends on**: Phase 1

**Requirements**: FILE-01, FILE-02, FILE-03, FILE-04, FILE-05

**Success Criteria** (what must be TRUE):
  1. User can select and upload multiple PDF PO files in a single session without error
  2. User can upload an existing Excel scheduling template and the system reads all column headers and data rows, preserving merge metadata
  3. User sees per-file processing status (e.g., parsing / done / error) during and after upload
  4. Extracted PO data displays all 11 required fields correctly from at least 2 structurally different sample PO PDFs
  5. Extracted Excel data matches the template's actual column layout with no field-position drift

**Plans:** 3/3 plans complete

Plans:
- [ ] 02-01-PLAN.md — Type definitions, normalize utility, and PDF PO extractor with tests
- [ ] 02-02-PLAN.md — Excel schedule parser with header-based column mapping and tests
- [ ] 02-03-PLAN.md — Wire extractors into upload route, frontend per-file status display

---

### Phase 3: Reconciliation and Date Codes

**Goal**: Users can see which fields differ between POs and the schedule, with mismatches highlighted red in the output Excel and date codes auto-generated correctly for all edge cases

**Depends on**: Phase 2

**Requirements**: COMP-01, COMP-02, COMP-03, COMP-04, COMP-05, COMP-06, COMP-07, COMP-08, COMP-09, COMP-10, COMP-11, COMP-12, COMP-13, COMP-14, DATE-01, DATE-02, DATE-03, DATE-04, DATE-05

**Success Criteria** (what must be TRUE):
  1. Every PO is matched to a schedule row by TOMY PO number; POs with no matching row are flagged as unmatched (not silently skipped)
  2. All 11 comparison fields (接单期国家, 第三客户名称, 客跟单, TOMY PO, CUSTOMER PO, 货号, 数量, 外箱, 总箱数, PO走货期, 箱唛资料) are compared and mismatches produce a red background cell in the output Excel
  3. Visually identical values that differ only in whitespace, full-width digits, or Unicode normalization do not produce false-positive mismatches
  4. Date code is generated correctly in format month-letter + day + 2-digit year + factory code (e.g., D1526RR02) for a PO走货期 input
  5. Date code falls on the correct working day when the calculated date (走货期 minus 1 month) is a weekend or Chinese public holiday — verified against Spring Festival and National Day edge cases

**Plans:** 3/3 plans complete

Plans:
- [ ] 03-01-PLAN.md — Date code generator with TDD (month letters, subMonths, workday rollback)
- [ ] 03-02-PLAN.md — Reconciliation engine with TDD (composite key matching, field comparison, rules)
- [ ] 03-03-PLAN.md — Excel writer with styling, route wiring, frontend display, and end-to-end verification

---

### Phase 4: Output, Download, and Integration

**Goal**: Users can download a ZIP file containing factory-split output Excel files with all mismatches highlighted and date codes filled in, plus a summary report of all discrepancies

**Depends on**: Phase 3

**Requirements**: OUT-01, OUT-02, OUT-03, OUT-04

**Success Criteria** (what must be TRUE):
  1. Output Excel files are classified correctly: RR01 POs go to the Dongguan folder, RR02 POs go to the Indonesia folder, with no cross-contamination
  2. User can click a download button and receive a ZIP file containing both factory folders with their respective annotated Excel files
  3. Downloaded Excel files open without corruption in Excel and show red-highlighted mismatched cells in the correct positions
  4. A summary report lists all discrepancies across the batch with PO number, factory, mismatched field names, and the differing values from both sides

**Plans:** 2/2 plans complete

Plans:
- [ ] 04-01-PLAN.md — ZIP builder and summary report library modules with TDD
- [ ] 04-02-PLAN.md — Dual schedule route wiring, frontend dual upload slots, end-to-end verification

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/2 | Complete    | 2026-03-20 |
| 2. File Parsing | 3/3 | Complete    | 2026-03-21 |
| 3. Reconciliation and Date Codes | 3/3 | Complete   | 2026-03-21 |
| 4. Output, Download, and Integration | 2/2 | Complete   | 2026-03-23 |

---

## Coverage Map

| Requirement | Phase |
|-------------|-------|
| PLAT-01 | Phase 1 |
| PLAT-02 | Phase 1 |
| FILE-01 | Phase 2 |
| FILE-02 | Phase 2 |
| FILE-03 | Phase 2 |
| FILE-04 | Phase 2 |
| FILE-05 | Phase 2 |
| COMP-01 | Phase 3 |
| COMP-02 | Phase 3 |
| COMP-03 | Phase 3 |
| COMP-04 | Phase 3 |
| COMP-05 | Phase 3 |
| COMP-06 | Phase 3 |
| COMP-07 | Phase 3 |
| COMP-08 | Phase 3 |
| COMP-09 | Phase 3 |
| COMP-10 | Phase 3 |
| COMP-11 | Phase 3 |
| COMP-12 | Phase 3 |
| COMP-13 | Phase 3 |
| COMP-14 | Phase 3 |
| DATE-01 | Phase 3 |
| DATE-02 | Phase 3 |
| DATE-03 | Phase 3 |
| DATE-04 | Phase 3 |
| DATE-05 | Phase 3 |
| OUT-01 | Phase 4 |
| OUT-02 | Phase 4 |
| OUT-03 | Phase 4 |
| OUT-04 | Phase 4 |

**Coverage: 30/30 v1 requirements mapped. No orphans.**

---

*Roadmap created: 2026-03-20*
*Phases: 4 | Granularity: Standard*
