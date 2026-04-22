---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-03-23T02:07:21.423Z"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 10
  completed_plans: 10
  percent: 90
---

# Project State: TOMY排期核对系统

*Single source of truth for project memory across sessions.*

---

## Project Reference

**Core Value:** 准确核对PO与排期表数据，快速发现不一致项并标红提示，减少人工核对的时间和出错率

**In one sentence:** Upload PDF POs and an Excel schedule, get back a highlighted Excel showing every mismatch, with date codes filled in and outputs split by factory.

**Current Focus:** Phase 2 — File Parsing

---

## Current Position

**Phase:** 4 - Output, Download, and Integration
**Plan:** 04-02 automated tasks complete (awaiting human-verify checkpoint Task 3)
**Status:** In progress

```
Progress: [██████████] 100% complete (plans)
Phase 1 [DONE] → Phase 2 [DONE] → Phase 3 [DONE (checkpoint pending)] → Phase 4 [2/3 done, checkpoint pending]
```

---

## Phase Summary

| Phase | Goal | Status |
|-------|------|--------|
| 1. Foundation | Web app accessible via browser, libraries locked in | Done |
| 2. File Parsing | PDF and Excel extraction pipeline working | In progress (02-03 checkpoint pending) |
| 3. Reconciliation and Date Codes | Comparison engine + date code generation | In progress (03-03 checkpoint pending) |
| 4. Output, Download, and Integration | Factory-split ZIP download + summary report | In progress (04-02 Tasks 1+2 done; human-verify checkpoint pending) |

---

## Accumulated Context

### Key Decisions (locked in)

| Decision | Rationale |
|----------|-----------|
| ExcelJS (not SheetJS) | SheetJS CE cannot write cell styles (red highlight); also has CVE-2023-30533 |
| chinese-days package | Covers Chinese statutory holidays including adjusted working Saturdays; not a static list |
| Label-anchored PDF extraction | PDF content stream order != visual row order; naive extraction silently maps fields to wrong positions |
| Stateless architecture | No database, no auth; session-scoped temp files; appropriate for 1-5 concurrent internal users |
| Node.js + Express + React | Team context; ExcelJS and pdf-parse have complete TypeScript types |
| Nginx client_max_body_size 50M | Default 1MB blocks real batches (~8 PDFs x 230KB = ~1.9MB); must be set before deployment |
| normalize() utility applied to both sides | PDF extractors pad strings; full-width digits; non-breaking spaces — all cause false-positive mismatches |
| pdfjs-dist legacy build on Node.js | Standard build requires DOMMatrix browser global; legacy build avoids this |
| Part number regex [A-Z0-9][A-Z0-9]+ | Real part numbers like 47280A start with digit; [A-Z] prefix would miss these |
| pathToFileURL for workerSrc | Windows Node.js ESM loader rejects raw D:\ paths; file:// URL required |
| Header-name column lookup (not indices) | Dongguan and Indonesia 总排期 sheets have different column positions; alias map resolves "Tomy PO"/"TOMY PO" etc. |
| unwrapCellValue for formula cells | ExcelJS returns { formula, result } objects for 外箱/总箱数/数量; must extract .result to get numbers |
| app.listen(0) with Node fetch for integration tests | supertest not installed; Node 24 has native fetch; random port avoids conflicts |
| Frontend-local type definitions | Frontend does not share server types directly; duplication acceptable without a shared package |
| Feb 28 2026 is a makeup Saturday workday | chinese-days treats Spring Festival makeup Saturdays as workdays — Mar 31 - 1 month stays on Feb 28, no rollback |
| findWorkday(-1, x) is exclusive | Always call isWorkday(x) first; only call findWorkday if result is not a workday to avoid off-by-one rollback |
| Chinese identifiers in const declarations cause ReferenceError | V8 on this platform fails to parse `const货号Counts` — use ASCII variable names in const/let declarations |
| 总箱数 always skipped in reconciler | COMP-10: field not present in PDF, comparison would always mismatch |
| Composite key for reconciler index | normalize(tomyPO) + ":" + normalize(货号) — colon separator prevents false merges |
| Status column added before row styling loop | statusColIdx = ws.columnCount + 1 computed once before any row iteration — stable throughout |
| One-time download for session buffer | Buffer cleared from Map on GET /api/download/:sessionId to prevent memory growth |
| Reconciliation failure is non-fatal | API returns 200 with parse results even if writeAnnotatedSchedule() throws |
| archiver piped to PassThrough stream | archiver requires writable stream; PassThrough collects chunks for in-memory Buffer output without filesystem |
| jszip in tests only | jszip decompresses ZIP output for round-trip assertions; archiver handles production ZIP creation |
| Null/undefined ReconciliationResult fallback | summaryReport uses ?? emptyResult to handle optional single-factory submissions gracefully |
| Factory PO filtering before reconciliation | items[0]?.factoryCode === 'RR01' for DG, === 'RR02' for ID — prevents spurious unmatched entries across factories |
| schedules[] array in FileStatusList | Handles 0/1/2 schedule results uniformly without conditional prop juggling in App.tsx |

### Open Questions

| Question | Impact | Resolution |
|----------|--------|------------|
| PDF extraction strategy: pdf-parse vs pdfjs-dist | Determines Phase 2 implementation approach | Inspect actual PO files in /DATA/ before writing extraction code. Simple key-value layout → pdf-parse + regex. Multi-column table layout → pdfjs-dist with coordinate grouping. |
| chinese-days 2027 coverage | Date codes will be wrong after 2026 if package not updated | Add startup calendar-year check; update package when government announces 2027 schedule (typically Nov 2026) |
| Excel template actual structure | Column mapping must match real template headers | Inspect actual template file before building Excel parser |

### Todos (carry forward between sessions)

- [x] Inspect /DATA/ directory for sample PO PDFs before starting Phase 2 — done in research, 8 real PDFs inspected
- [x] Confirm Excel template column layout matches the 11 fields in REQUIREMENTS.md — done in research
- [ ] Verify existing nginx.conf has client_max_body_size set (research found it was missing)
- [x] Execute plan 02-02 (Excel parser) — done, all 17 tests pass
- [x] Execute plan 02-03 Tasks 1+2 (route wiring + frontend) — 41/41 tests passing
- [ ] Complete plan 02-03 Task 3 (human-verify end-to-end in browser)
- [x] Execute plan 03-03 Tasks 1+2 (excelWriter TDD + route wiring) — 90/90 tests passing
- [ ] Complete plan 03-03 Task 3 (human-verify reconciliation end-to-end in browser)
- [x] Execute plan 04-01 (ZIP builder + summary report library) — done, 99/99 tests passing
- [x] Execute plan 04-02 Tasks 1+2 (upload route integration + frontend dual schedule) — done, 99/99 tests passing
- [ ] Complete plan 04-02 Task 3 (human-verify end-to-end ZIP download in browser)

### Blockers

None currently.

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Requirements defined | 30 |
| Requirements mapped | 30 |
| Phases complete | 0/4 |
| Plans complete | 0/? |

---
| Phase 02-file-parsing P01 | 5 | 2 tasks | 5 files |
| Phase 02-file-parsing P02 | 110 | 1 tasks | 2 files |
| Phase 02-file-parsing P03 | 5 | 2 tasks | 4 files |
| Phase 03-reconciliation-and-date-codes P01 | 2 | 1 tasks | 2 files |
| Phase 03-reconciliation-and-date-codes P02 | 3 | 2 tasks | 4 files |
| Phase 03-reconciliation-and-date-codes P03 | 3 | 2 tasks | 5 files |
| Phase 04-output-download-and-integration P01 | 3 | 2 tasks | 6 files |
| Phase 04-output-download-and-integration P02 | 13 | 2 tasks | 5 files |

## Session Continuity

### How to pick up this project

1. Read this file (STATE.md) for current position and context
2. Read `.planning/ROADMAP.md` for phase structure and success criteria
3. Run `/gsd:plan-phase 1` to start planning Phase 1

### File Index

| File | Purpose |
|------|---------|
| `.planning/PROJECT.md` | Core value, constraints, key decisions |
| `.planning/REQUIREMENTS.md` | All 30 v1 requirements with traceability |
| `.planning/ROADMAP.md` | Phase structure, success criteria, coverage map |
| `.planning/STATE.md` | This file — current position and session memory |
| `.planning/research/SUMMARY.md` | Stack recommendations, pitfalls, architecture |

---

*State initialized: 2026-03-20*
*Last updated: 2026-03-23 after completing 04-02 Tasks 1+2 (upload route integration + frontend dual schedule); 99/99 total tests passing; awaiting 04-02 human-verify checkpoint*
