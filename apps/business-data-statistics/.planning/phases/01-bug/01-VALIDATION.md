---
phase: 1
slug: bug
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-17
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest（已安装，package.json scripts.test = "jest --verbose"） |
| **Config file** | package.json（无独立 jest.config.js） |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 00-01 | 00 | 0 | BUG-01~07,11,12 | scaffold | `npm test -- --testPathPattern=bug-fixes` | Created in W0 | ⬜ pending |
| 01-01 | 01 | 1 | BUG-01 | integration | `npm test -- --testPathPattern=bug-fixes` | ✅ W0 | ⬜ pending |
| 01-02 | 01 | 1 | BUG-03 | integration | `npm test -- --testPathPattern=bug-fixes` | ✅ W0 | ⬜ pending |
| 01-03 | 01 | 1 | BUG-05 | unit/SQL | `npm test -- --testPathPattern=bug-fixes` | ✅ W0 | ⬜ pending |
| 01-04 | 01 | 1 | BUG-06 | unit | `npm test -- --testPathPattern=bug-fixes` | ✅ W0 | ⬜ pending |
| 02-01 | 02 | 1 | BUG-02 | integration | `npm test -- --testPathPattern=bug-fixes` | ✅ W0 | ⬜ pending |
| 02-02 | 02 | 1 | BUG-04 | integration | `npm test -- --testPathPattern=bug-fixes` | ✅ W0 | ⬜ pending |
| 02-03 | 02 | 1 | BUG-07 | integration | `npm test -- --testPathPattern=bug-fixes` | ✅ W0 | ⬜ pending |
| 02-04 | 02 | 1 | BUG-08 | manual-only | N/A | N/A | ⬜ pending |
| 02-05 | 02 | 1 | BUG-09 | manual-only | N/A | N/A | ⬜ pending |
| 02-06 | 02 | 1 | BUG-10 | manual-only | N/A | N/A | ⬜ pending |
| 03-01 | 03 | 2 | BUG-11 | unit/DB | `npm test -- --testPathPattern=bug-fixes` | ✅ W0 | ⬜ pending |
| 03-02 | 03 | 2 | BUG-12 | integration | `npm test -- --testPathPattern=bug-fixes` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/bug-fixes.test.js` — Plan 01-00 creates test scaffolds with failing assertions for BUG-01~07, BUG-11, BUG-12
- [x] 测试数据库连接：直接用 `db/postgres.js`（localhost:5432/production_system）
- [x] 三部门基础 CRUD 测试骨架（Plan 01-00 创建）

*Wave 0 plan: 01-00-PLAN.md — creates test file before any fixes run*
*Existing infrastructure: Jest 已安装，24 tests passing（modules.test.js + calc.test.js）*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 数据锁定部门下拉动态生成 | BUG-08 | 纯前端 Vue template，Jest 无法测试 DOM | 打开数据锁定页面，确认下拉框显示三个部门 |
| 用户管理部门下拉动态生成 | BUG-09 | 纯前端 Vue template，Jest 无法测试 DOM | 打开用户管理页面，新增/编辑用户时确认下拉框动态生成 |
| 编辑框边框使用 CSS 变量 | BUG-10 | 纯前端样式检查 | 打开明细表，进入编辑模式，确认边框使用 CSS 变量颜色 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
