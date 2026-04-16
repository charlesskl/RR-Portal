---
phase: 04
slug: output-download-and-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-23
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | OUT-01 | unit | `npx vitest run server/lib/factoryClassifier.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | OUT-02 | unit | `npx vitest run server/lib/zipBuilder.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | OUT-04 | unit | `npx vitest run server/lib/summaryReport.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | OUT-03 | integration | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing vitest infrastructure covers all phase requirements
- archiver needs to be installed: `npm install archiver @types/archiver`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ZIP opens in Windows Explorer | OUT-03 | OS-level ZIP handling | Download ZIP, extract, verify folder structure |
| Excel styling survives round-trip | OUT-03 | Requires Excel application | Open .xlsx in Excel, check red/green/yellow fills |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
