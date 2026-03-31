---
phase: 02-entry-experience
plan: "01"
subsystem: frontend-input
tags: [tdd, tab-navigation, keyboard-ux, test-infrastructure]
dependency_graph:
  requires: []
  provides: [ENTRY-01, ENTRY-02]
  affects: [public/js/app.js, tests/entry-experience.test.js]
tech_stack:
  added: []
  patterns: [tdd-red-green, inline-editing, keyboard-navigation]
key_files:
  created:
    - tests/entry-experience.test.js
  modified:
    - public/js/app.js
decisions:
  - "handleTabKey saves current cell first (saveCell resets editingCell), then $nextTick opens next — prevents double-edit state"
  - "Use @keydown.tab.prevent (not @keyup) so browser doesn't move focus before our handler runs"
  - "ENTRY-01 integration test gracefully skips when beer workshop unavailable in CI — marked as integration test"
metrics:
  duration: "3 minutes"
  completed: "2026-03-19"
  tasks_completed: 2
  files_changed: 2
---

# Phase 02 Plan 01: Entry Experience Wave 1 — Test Skeleton + Tab Navigation Summary

**One-liner:** Tab key inline navigation across editable fields with precise focus targeting after new-row creation.

## What Was Built

### Task 1: Test Skeleton (TDD RED → GREEN)

Created `tests/entry-experience.test.js` with 7 tests covering:

- **ENTRY-01** (integration): POST `/beer/records` with only `record_date + workshop_id` — verifies backend defaults numerics to 0/null, gracefully skips when no beer workshop in DB
- **ENTRY-02** (unit, 4 tests): Field filter logic — `filter(c => c.editable)` produces no `calculated:true` fields; `balance`, `balance_ratio`, `machine_rate` excluded; `findNextEditableField` returns null at last field; `findPrevEditableField` returns null at first field
- **ENTRY-03** (unit): Copy-row field extraction — editable fields extracted, `balance`/`balance_ratio`/`machine_rate` excluded from POST body

All 7 tests GREEN.

### Task 2: ENTRY-01 Fix + ENTRY-02 Tab Navigation

**ENTRY-01 querySelector fix** (`handleAdd` method, line ~675):
- Before: `'.data-table-wrapper input'` — could match any input in the table including wrong rows
- After: `'.editing-cell-wrapper input'` — matches only the newly opened cell (editingCell already set before $nextTick runs)

**ENTRY-02 Tab key navigation** (2 changes):

1. Added `handleTabKey(row, currentField, event)` method to `DeptRecordsPage`:
   - Calls `saveCell` first (resets `editingCell` to null)
   - Finds `currentField` index in `this.editableColumns` computed
   - Tab → opens `editableCols[currentIdx + 1]` via `startEdit`
   - Shift+Tab → opens `editableCols[currentIdx - 1]` via `startEdit`
   - At boundaries: `saveCell` already cancelled edit state, no additional action

2. Added `@keydown.tab.prevent` binding to row-inline `<input>`:
   - Must be `keydown` (not keyup) — browser moves focus at keydown phase
   - `.prevent` stops browser's native Tab focus movement

## Decisions Made

| Decision | Reasoning |
|----------|-----------|
| `@keydown.tab.prevent` vs `@keyup.tab` | Browser already moved focus by keyup time — must intercept at keydown |
| `saveCell` called before `startEdit` in handleTabKey | saveCell resets editingCell; $nextTick then runs startEdit cleanly with no conflict |
| `.editing-cell-wrapper input` selector | When editingCell is set, only one input renders in that wrapper — selector is precise |

## Deviations from Plan

None - plan executed exactly as written.

## Pre-existing Issues (Out of Scope)

`tests/bug-fixes.test.js` has 18 pre-existing failures unrelated to this plan's changes. Logged to `deferred-items.md` for Phase 1 work.

## Self-Check: PASSED

- `tests/entry-experience.test.js` exists and 7/7 tests pass
- Commits `cfdaf0a` (test skeleton) and `7f4e01a` (app.js changes) exist
- `handleTabKey` appears 2x in app.js (definition + call)
- `keydown.tab.prevent` appears 1x in app.js (input template)
- `editing-cell-wrapper input` appears 2x in app.js (startEdit + handleAdd)
