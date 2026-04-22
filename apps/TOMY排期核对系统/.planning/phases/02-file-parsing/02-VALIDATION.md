---
phase: 2
slug: file-parsing
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-20
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 |
| **Config file** | vitest.config.ts (exists at project root) |
| **Quick run command** | `npx vitest run server/lib` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/lib`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-T1 | 01 | 1 | FILE-02 | unit | `npx vitest run server/lib/pdfExtractor.test.ts` | Created in task | pending |
| 02-T2 | 01 | 1 | FILE-04 | unit | `npx vitest run server/lib/excelParser.test.ts` | Created in task | pending |
| 02-T3 | 02 | 1 | FILE-01, FILE-03, FILE-05 | integration | `npx vitest run server/routes/upload.test.ts` | Created in task | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `server/lib/pdfExtractor.test.ts` — covers FILE-02 (real PDF fixtures from project root) — created inline
- [x] `server/lib/excelParser.test.ts` — covers FILE-04 (real Excel fixtures from project root) — created inline
- [x] `server/routes/upload.test.ts` — covers FILE-01, FILE-03, FILE-05 — created inline
- [x] `server/lib/pdfExtractor.ts` — new module — created inline
- [x] `server/lib/excelParser.ts` — new module — created inline
- [x] `server/types/index.ts` — type definitions — created inline

*All Wave 0 artifacts created inline within plan tasks.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Upload form shows per-file status | FILE-05 | Visual UI feedback | Upload PDFs in browser, verify status indicators update |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
