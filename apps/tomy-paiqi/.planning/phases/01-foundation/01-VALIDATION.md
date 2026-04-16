---
phase: 1
slug: foundation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-20
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (installed as dev dependency in project root) |
| **Config file** | vitest.config.ts — created in Plan 01 Task 1 |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsx server/smoke-test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01 | 1 | PLAT-01 | smoke | `npx tsx server/smoke-test.ts` | Created in Plan 01 Task 2 | pending |
| 01-01-T2 | 01 | 1 | PLAT-01 | smoke | `npx tsx server/smoke-test.ts` | Created in this task | pending |
| 01-02-T1 | 02 | 2 | PLAT-02 | static | `grep -c 'client_max_body_size 50M' nginx/nginx.conf` | Created in this task | pending |
| 01-02-T2 | 02 | 2 | PLAT-02 | manual | Human verifies Docker deployment in browser | - | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `server/smoke-test.ts` — covers PLAT-01 (library imports + server health) — created in Plan 01 Task 2
- [x] `vitest.config.ts` — Vitest configuration pointing to `server/` — created in Plan 01 Task 1
- [x] `nginx/nginx.conf` — Nginx config file with client_max_body_size 50M — created in Plan 02 Task 1
- [x] Framework install: `vitest` installed as devDependency — done in Plan 01 Task 1

*All Wave 0 artifacts are created inline within plan tasks. No separate Wave 0 plan needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Upload form renders in browser | PLAT-01 | Visual UI verification | Open http://localhost:5173 (dev) or http://localhost (Docker), confirm upload form visible |
| Docker container reachable | PLAT-02 | Requires Docker runtime | Run `docker compose up -d`, then `curl http://localhost/health` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
