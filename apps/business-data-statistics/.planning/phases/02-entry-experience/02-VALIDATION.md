---
phase: 2
slug: entry-experience
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.x |
| **Config file** | `package.json` — `"test": "jest --verbose"` |
| **Quick run command** | `npm test -- --testPathPattern=entry` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=entry`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | ENTRY-01 | unit (backend) | `npm test -- --testPathPattern=entry` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | ENTRY-02 | unit (pure fn) | `npm test -- --testPathPattern=entry` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 0 | ENTRY-03 | unit (backend) | `npm test -- --testPathPattern=entry` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/entry-experience.test.js` — stubs for ENTRY-01 (POST with minimal fields defaults), ENTRY-02 (editable column filter logic), ENTRY-03 (copy row POST with all editable fields)

*Existing Jest infrastructure covers framework needs. Only test file creation required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tab key navigates between editable cells in browser | ENTRY-02 | Requires browser DOM + keyboard events | 1. Open detail table 2. Click any editable cell 3. Press Tab 4. Verify focus moves to next editable field, skipping calculated columns |
| New row auto-focus after add | ENTRY-01 | Requires browser DOM | 1. Click "新增" 2. Fill date + workshop 3. Submit 4. Verify new row appears and first editable cell is focused |
| Copy row button creates identical row | ENTRY-03 | Visual verification of data integrity | 1. Click copy icon on existing row 2. Verify new row has same editable field values 3. Verify original row unchanged |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
