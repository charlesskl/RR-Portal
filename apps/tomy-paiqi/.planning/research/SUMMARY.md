# Project Research Summary

**Project:** PO核对与排期管理系统 (TOMY PO Reconciliation and Scheduling)
**Domain:** Internal manufacturing operations tool — PDF parsing, Excel read/write, data reconciliation
**Researched:** 2026-03-20
**Confidence:** MEDIUM-HIGH

## Executive Summary

This is a purpose-built internal tool for TOMY's production scheduling team that automates what is currently a fully manual, error-prone process: comparing PDF purchase orders from buyers against an internal Excel scheduling template, flagging discrepancies field-by-field, generating date codes, and routing outputs by factory. The system has no market competitors — its value is measured against the existing manual workflow in hours saved and error rate reduction. The recommended approach is a Node.js/Express backend with React/Ant Design frontend, using pdf-parse (or pdfjs-dist for coordinate-aware extraction) and ExcelJS as the two critical file-processing libraries. The architecture is stateless, session-scoped, and synchronous — appropriate for 1–5 concurrent internal users uploading small files.

The primary technical risk is PDF field extraction accuracy. TOMY's PO PDFs store data as positioned glyphs, not semantic tables, meaning naive text extraction can silently map field values to the wrong fields with no error. The extraction layer must use label-anchored parsing (find the field label first, then read the adjacent value) and validate extracted fields against known patterns before passing them downstream. Every other component depends on correct PDF extraction, so this must be the first thing built and the first thing tested against all real PO samples.

The secondary cluster of risks — ExcelJS merged-cell handling, Chinese holiday calendar currency, and string normalization before comparison — are all solvable with the right library choices made at the start. The research is clear: ExcelJS (not SheetJS) for Excel write with red-cell styling, `chinese-days` (not a static list) for workday calculation, and a shared `normalize()` utility applied to both sides before every field comparison. These decisions must be locked in during Phase 1 because switching any of them mid-project is a costly rewrite.

## Key Findings

### Recommended Stack

The stack is a conventional Node.js/React monorepo with TypeScript across both layers. The key differentiators from a generic web app stack are two domain-specific library choices: **ExcelJS** (not SheetJS/xlsx, which has a known CVE and cannot write cell styles) for Excel processing, and **chinese-days** (not a static hardcoded list) for Chinese public holiday lookup including adjusted working Saturdays. Both choices are non-negotiable given the core feature requirements. The rest of the stack is standard: Express 4 for the API server, Vite 6 for the frontend build, Ant Design 5 for the UI component library (its Table component handles per-cell red highlighting natively), and date-fns 3 for date arithmetic before passing results to chinese-days.

**Core technologies:**
- Node.js 22.x LTS: server runtime — LTS with support through 2027; ecosystem standard
- Express 4.21.x: HTTP server and file upload routing — battle-tested; trivially simple for this file-processing use case
- React 18.x + Ant Design 5.x: frontend UI — Ant Design Table supports per-cell render (required for red highlighting); antd v5 requires React 18
- TypeScript 5.x: type safety — ExcelJS and pdf-parse have complete types; catches field-name mismatches at compile time
- Vite 6.x: build tool — de-facto standard replacing CRA; fast HMR
- pdf-parse 1.1.1 / pdfjs-dist: PDF extraction — see Gap below for which to use
- ExcelJS 4.4.0: Excel read/write with style preservation — only library that supports red-cell fill on roundtrip
- chinese-days 1.5.4: workday calculation — covers 2026 holiday data; specifically designed for Chinese statutory calendar
- date-fns 3.x: date arithmetic — tree-shakeable, TypeScript-native; use for month subtraction before workday check
- multer 2.1.1: multipart file upload middleware — use MemoryStorage to avoid disk I/O

**Do not use:** SheetJS/xlsx (CVE-2023-30533; 0.19.3 was never published to npm public registry), Create React App (deprecated 2023), Python stack (team context is JavaScript/browser).

### Expected Features

The MVP replaces the manual workflow end-to-end. All P1 features are required for the tool to be useful — none can be deferred without breaking the workflow.

**Must have (v1 — table stakes and core differentiators):**
- PDF upload (multi-file) and text extraction — the primary input
- Excel scheduling template upload and parse — the target to reconcile against
- PO-to-schedule row matching by TOMY PO number — the linking step everything else depends on
- Field-by-field comparison for all 11 specified fields — the core value
- Red cell highlight on mismatched fields in output Excel — the deliverable users will actually use
- Factory classification (RR01=Dongguan, RR02=Indonesia) with separate output files — required by current process
- Date code auto-generation with Chinese holiday calendar — saves manual calculation; currently error-prone
- Unmatched PO detection — nothing silently skipped if a PO has no schedule row
- ZIP download of both factory output files — how users retrieve results

**Should have (v1.x — after validation):**
- Summary discrepancy report — overview table of all mismatches across the batch
- Per-file processing status feedback — progress indicator when batch exceeds ~10 files
- Holiday calendar update for 2027+ — required before calendar rolls over in late 2026

**Defer (v2+):**
- Support for additional factory codes beyond RR01/RR02
- Configurable field mapping (only if Excel template structure changes significantly)
- Audit trail / run history (only if compliance team requests)

**Anti-features — explicitly out of scope:** OCR for scanned PDFs, ERP integration, user accounts/login, automatic schedule write-back (too dangerous), historical run storage.

### Architecture Approach

The architecture is a stateless, session-scoped request-response pipeline: browser uploads files via multipart POST, backend processes synchronously (files are small; no queue needed), returns JSON diff result plus a session ID, and the browser triggers a separate GET to download the output Excel. No WebSockets, no database, no authentication. This is correct for 1–5 concurrent internal users. The processing pipeline flows strictly: PDF Parser → Excel Parser → Reconciliation Engine → Date Code Generator → Factory Router → Excel Writer → session temp storage → download response.

The architecture research note: the ARCHITECTURE.md describes a FastAPI/Python backend in its diagram, but the STACK.md is explicit that Node.js/Express is the recommended implementation. The pipeline structure and component boundaries are identical regardless of language — the Python references in ARCHITECTURE.md should be read as language-agnostic component descriptions.

**Major components:**
1. File Upload UI — accept multiple PDFs and one Excel template; show parse status per file
2. PDF Parser — label-anchored extraction with field validation; returns structured dict per PO
3. Excel Parser — reads scheduling template; maps column headers to row dicts; preserves merge metadata
4. Reconciliation Engine — matches PO to schedule row by TOMY PO number; compares 11 fields with normalization
5. Date Code Generator — ship date minus 1 month (date-fns relativedelta equivalent); roll back to prior workday (chinese-days); format as MONTH_LETTER + DAY + YEAR_2DIGIT + FACTORY_CODE
6. Factory Router — RR01/RR02 string prefix check on PO number; splits result sets
7. Excel Writer — ExcelJS opens template copy; writes red PatternFill on mismatched cells; saves per-factory output
8. API Router + Session Storage — ties pipeline together; session IDs as UUIDs; TTL cleanup of temp files
9. Diff Viewer UI — renders reconciliation result as table with red-highlighted cells; Ant Design Table

**Build order (dictated by dependency graph):** PDF Parser → Excel Parser → Date Code Generator → Reconciliation Engine → Factory Router → Excel Writer → API Router → Frontend.

### Critical Pitfalls

1. **PDF table structure destroyed by naive text extraction** — pdf-parse iterates content stream order, not visual row/column order; a multi-column PO layout can silently map field values to wrong fields. Use label-anchored extraction (find "TOMY PO:" label, read adjacent value) rather than position-based coordinate parsing; validate extracted fields against regex patterns before use. This must be designed in from the start — retrofitting is expensive.

2. **SheetJS Community Edition cannot write cell styles** — `xlsx.writeFile()` silently drops all `.s` style properties; the red-highlight feature is impossible with SheetJS CE. Use ExcelJS from day one. Switching mid-project requires rewriting all Excel read/write code.

3. **Chinese holiday calendar stale after one year** — a static 2025 or even 2026 holiday list produces wrong date codes when the computed date falls on a statutory holiday or an adjusted working Saturday. Use `chinese-days` package (sourced from official government announcements); note that `chinese-days@1.5.4` covers through 2026 — must be updated before 2027 deployment.

4. **String comparison false positives from invisible character differences** — PDF extractors pad strings with alignment spaces; Chinese IME input may produce full-width digits (１２３ vs 123); non-breaking spaces differ from regular spaces. All of these make visually identical values fail string equality. Build a `normalize()` utility first (trim, Unicode NFC, full-width to half-width conversion) and apply it to both sides in every comparison.

5. **Nginx 1MB upload limit blocks real batches** — 8 PDFs × ~230KB = ~1.9MB exceeds Nginx's default `client_max_body_size`. This works in local dev (no Nginx) and fails silently after Docker deployment with a 413 error. Set `client_max_body_size 50M;` in nginx.conf from the start and match the limit in multer configuration.

6. **ExcelJS merged cell writes corrupt adjacent cells** — the scheduling template uses merged headers; writing to a phantom cell inside a merge range throws no error but corrupts the file. Preserve merge metadata when loading the template; only write to the top-left cell of any merge.

## Implications for Roadmap

Based on the component dependency graph from ARCHITECTURE.md and pitfall phase mapping from PITFALLS.md, the natural build sequence is three phases:

### Phase 1: File Parsing Foundation

**Rationale:** Everything downstream depends on correct extraction from both PDF and Excel. The reconciliation engine, date code generator, and writer cannot be built on unstable parser output. Both critical library choices (ExcelJS over SheetJS, pdfjs-dist or pdf-parse with label-anchored strategy) must be locked in here.

**Delivers:** Verified extraction of all 11 PO fields from all 8 sample PO PDFs; verified read of the排期 Excel template including column mapping and merge metadata preservation; factory code classification.

**Addresses:** PDF upload, text extraction, Excel upload and parse, factory classification (from FEATURES.md MVP list).

**Avoids:**
- Pitfall 1: PDF table structure destruction — implement label-anchored extraction with field validation
- Pitfall 2: SheetJS style stripping — lock in ExcelJS from day one
- Pitfall 4: PDF field position drift — label-anchored design is the prevention

**Research flag:** NEEDS RESEARCH during planning. The PDF extraction strategy (pdf-parse vs pdfjs-dist with coordinate grouping) depends on the actual structure of TOMY's PO PDFs. If the PDFs have a simple key-value layout (one field per line), pdf-parse with regex is sufficient. If fields appear in a multi-column table layout, coordinate-aware extraction with pdfjs-dist is required. Validate against a real PO PDF before committing to the extraction approach.

### Phase 2: Reconciliation Engine and Output Generation

**Rationale:** With stable parser outputs in hand, the comparison and output layer can be built on solid ground. This phase contains the highest-value business logic (date code generation, field comparison) and the most subtle bugs (string normalization, workday calculation, merged cell writing).

**Delivers:** Working reconciliation against all 11 fields with correct red-cell highlighting in output Excel; date code generation accurate through National Day and Spring Festival edge cases; unmatched PO detection; factory-split output files.

**Uses:** ExcelJS PatternFill for red cells; chinese-days for workday calculation; date-fns subMonths for date arithmetic; Ant Design Table for diff viewer UI.

**Implements:** Reconciliation Engine, Date Code Generator, Factory Router, Excel Writer, Diff Viewer UI.

**Addresses:** PO-to-schedule row matching, 11-field comparison, red highlight, date code auto-generation, unmatched PO detection, separate output folders (from FEATURES.md MVP list).

**Avoids:**
- Pitfall 3: Stale holiday calendar — use chinese-days; test with Spring Festival and National Day inputs
- Pitfall 5: String comparison false positives — build normalize() before any comparison logic
- Pitfall 6 (ExcelJS merges): — preserve merge metadata from Phase 1; check before every write

**Research flag:** Standard patterns. Date code logic and ExcelJS cell styling are well-documented. The STACK.md provides the exact implementation steps for date code generation. No additional research phase needed.

### Phase 3: API Integration, Download, and Deployment

**Rationale:** Wire all components through the Express API layer, implement session-based temp file management and ZIP download, then validate the complete flow through the Docker/Nginx stack.

**Delivers:** Full end-to-end workflow — upload PDFs + Excel in browser, process, view diff results, download ZIP with factory-split output files. Verified working through Docker deployment.

**Addresses:** Download output as ZIP, processing status feedback, batch processing (from FEATURES.md MVP list).

**Avoids:**
- Pitfall 6 (Nginx upload limit): set `client_max_body_size 50M;` in nginx.conf; match in multer config
- Anti-pattern: embedding large files in JSON response — use session ID + separate GET /download route
- Anti-pattern: mutating the original uploaded template — always write to a session-specific copy

**Research flag:** Standard patterns. Express multipart upload with multer, session-scoped temp file management, and FileResponse patterns are all well-documented. No additional research needed.

### Phase Ordering Rationale

- **Parsing before comparison:** The reconciliation engine cannot be built without knowing what shape the parser output takes. Building parsers first and testing them against real files catches extraction bugs before they silently corrupt comparison results.
- **Engine before UI:** The diff viewer UI is a presentation layer over the engine's output. Building the engine first means the UI can be built against real data, not mocks that paper over bugs.
- **Business logic before API wiring:** Wiring the API last means all components are individually testable before integration. The session management and download routing are trivially simple once the processing pipeline is stable.
- **ExcelJS and label-anchored PDF extraction must be chosen in Phase 1:** Both are decisions that, if made wrong, require full rewrites of all related code. There is no safe point to defer them.

### Research Flags

Needs deeper research during planning:
- **Phase 1 (PDF extraction strategy):** Determine whether TOMY's actual PO PDFs use a simple key-value layout (pdf-parse + regex is sufficient) or a multi-column table layout (requires pdfjs-dist with coordinate-aware row reconstruction). Validate against at least 2–3 sample PDFs with different sizes (the ~163KB and ~238KB groups likely have different layouts) before committing to extraction code.

Standard patterns (skip research-phase):
- **Phase 2 (Reconciliation Engine):** Date code logic, ExcelJS cell styling, field comparison patterns are all well-documented with clear implementation steps in STACK.md and ARCHITECTURE.md.
- **Phase 3 (API + Deployment):** Express file upload, session temp storage, and Nginx configuration are standard patterns. The nginx.conf is already tracked in the repo and needs only the `client_max_body_size` addition.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core library choices (ExcelJS, chinese-days) are verified HIGH confidence. pdf-parse vs pdfjs-dist decision depends on actual PDF structure — MEDIUM until validated against real files. |
| Features | HIGH | Requirements specified by operator; 11 fields, two factory codes, and date code format are explicit. No market research uncertainty — this is internal tooling. |
| Architecture | MEDIUM-HIGH | Pipeline structure and component boundaries are well-established. The ARCHITECTURE.md describes FastAPI/Python in diagram labels but the patterns are language-agnostic and map directly to the Node.js/Express stack in STACK.md. |
| Pitfalls | HIGH | Critical pitfalls (SheetJS CVE, ExcelJS merge behavior, holiday calendar currency, string normalization) verified via official library issues and documentation. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **PDF extraction approach:** The biggest open question is whether TOMY's PO PDFs have simple key-value layout or complex multi-column table layout. This changes the extraction library and approach. Resolve by inspecting actual PO files in the `/DATA/` directory before writing extraction code. If pdfjs-dist with coordinate grouping is needed, plan for additional implementation complexity in Phase 1.
- **chinese-days 2027 coverage:** `chinese-days@1.5.4` covers through 2026. If this tool is used in 2027, the package must be updated once the Chinese government announces the 2027 holiday schedule (typically announced in November of the prior year). Add a calendar year check at startup that warns if holiday data may be stale.
- **Excel template actual structure:** The scheduling template's exact column layout, merge ranges, and whether it has data validation rules will only be known from inspecting the real file. Confirm the column mapping in FEATURES.md (11 fields) against the actual template header row before building the Excel parser.

## Sources

### Primary (HIGH confidence)
- SheetJS GitHub issues #128, #1926 — confirmed: SheetJS CE cannot write cell styles
- GitHub Security Advisory GHSA-4r6h-8v6p-xvw6 — CVE-2023-30533 SheetJS Prototype Pollution
- SheetJS issue tracker (git.sheetjs.com) — confirmed: 0.19.3 not published to npm public registry
- ExcelJS GitHub — confirmed: PatternFill API for red cell styling
- multer npm page — confirmed: v2.1.1 published March 2026, compatible with Express 4
- Vite official docs — confirmed: current standard, replaces CRA

### Secondary (MEDIUM confidence)
- PkgPulse: unpdf vs pdf-parse vs pdfjs-dist comparison (2026) — download stats, API comparison
- chinese-days GitHub README — 2026 holiday data coverage confirmed
- npm trends: exceljs vs sheetjs — download data confirming ExcelJS adoption
- Strapi Blog: 7 PDF Parsing Libraries for Node.js 2025 — library comparison
- Better Stack: Express vs Fastify 2025 — performance trade-off analysis
- BetterStack: Nginx client_max_body_size defaults — 1MB default confirmed

### Tertiary (MEDIUM-LOW confidence)
- jiejiariapi.com — Chinese holiday API alternative if chinese-days package becomes unmaintained
- goldenowl.asia: Modern web app architecture 2026 — general architecture patterns

---
*Research completed: 2026-03-20*
*Ready for roadmap: yes*
