---
phase: 3
slug: reconciliation-and-date-codes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 |
| **Config file** | vitest.config.ts (project root) |
| **Quick run command** | `npx vitest run server/lib/reconciler.test.ts server/lib/dateCodeGenerator.test.ts server/lib/excelWriter.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run server/lib/reconciler.test.ts server/lib/dateCodeGenerator.test.ts server/lib/excelWriter.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | COMP-01 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | COMP-02 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | COMP-03 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 1 | COMP-04 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-05 | 01 | 1 | COMP-05 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-06 | 01 | 1 | COMP-06 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-07 | 01 | 1 | COMP-07 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-08 | 01 | 1 | COMP-08 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-09 | 01 | 1 | COMP-09 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-10 | 01 | 1 | COMP-10 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-11 | 01 | 1 | COMP-11 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-12 | 01 | 1 | COMP-12 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | DATE-01 | unit | `npx vitest run server/lib/dateCodeGenerator.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | DATE-02 | unit | `npx vitest run server/lib/dateCodeGenerator.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 1 | DATE-03 | unit | `npx vitest run server/lib/dateCodeGenerator.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-04 | 02 | 1 | DATE-04 | unit | `npx vitest run server/lib/dateCodeGenerator.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | COMP-13 | unit | `npx vitest run server/lib/excelWriter.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | COMP-14 | unit | `npx vitest run server/lib/excelWriter.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-03 | 03 | 2 | DATE-05 | unit | `npx vitest run server/lib/excelWriter.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/lib/reconciler.test.ts` — stubs for COMP-01 through COMP-12
- [ ] `server/lib/dateCodeGenerator.test.ts` — stubs for DATE-01 through DATE-05
- [ ] `server/lib/excelWriter.test.ts` — stubs for COMP-13, COMP-14, DATE-05

*No new framework install needed — Vitest 4.1.0 already configured and running.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Red cells visible in downloaded Excel | COMP-13 | Visual verification in Excel application | Open output .xlsx in Excel, verify red-highlighted cells are visually correct |
| Excel comment shows PO value on hover | COMP-13 | Excel UI interaction | Hover over red cells, verify comment shows PO-side value |
| Yellow rows for unmatched POs at bottom | COMP-14 | Visual verification | Check bottom rows have yellow background and correct PO data |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
