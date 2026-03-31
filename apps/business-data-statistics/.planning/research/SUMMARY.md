# Project Research Summary

**Project:** 三工结余系统 — 录入体验与公式管理升级
**Domain:** Factory production statistics — data entry UX, formula engine, validation, import/export
**Researched:** 2026-03-17
**Confidence:** HIGH

## Executive Summary

This project enhances an existing Express + Vue 3 CDN-based production statistics system. The system already has a working inline editing infrastructure (`startEdit`/`saveCell`/`cancelEdit`) and an audit log, but key daily workflows are broken or inefficient: Tab-key navigation causes data loss via concurrent reload races, the month-lock feature has a field-name mismatch that silently fails, and Excel export sends empty files when there are no records. The recommended approach is to treat bug fixes as a hard prerequisite before building any new capability — adding Tab navigation on top of a broken `saveCell` race condition would make the new features unreliable from day one.

The technical direction is deliberately conservative: all enhancements stay within the existing CDN architecture. No build step is introduced. The highest-complexity feature — a user-configurable formula engine — should be deferred to the final phase because it requires a new database table, a new backend module (`formula-engine.js`), and a settings UI, and it will eventually replace the current hardcoded `calc.js` logic. Simpler wins (copy-row, Tab navigation, validation, import improvements, workshop ordering) should ship first and deliver immediate daily efficiency gains for entry operators.

The primary risk is the `loadData` full-reload pattern currently used after every cell save. This pattern must be replaced with optimistic update (modify `tableData` in place, rollback on error) before any Tab-navigation work begins — otherwise fast sequential edits will silently discard user-entered values. Secondary risks are formula injection (use `expr-eval`, never `eval()`), over-aggressive validation rules that block legitimate negative-balance entries, and `DEPT_CONFIG` mutations that silently corrupt all three departments at once.

---

## Key Findings

### Recommended Stack

The existing CDN architecture is sufficient for all planned features. No build step or bundler is needed. The two new libraries to add are `expr-eval` (~20KB via unpkg) for safe formula evaluation, and `SortableJS` (~30KB via unpkg) for workshop drag-sort. For styled Excel export, `xlsx-js-style` (a SheetJS fork) replaces the current free-build SheetJS which cannot apply cell styles.

**Core technologies:**
- **Element Plus `el-table` scoped-slot editing** — inline cell editing — already loaded, no new dependency; `v-if`/`v-else` in `#default` slot is the established pattern
- **`expr-eval` 2.x** — formula evaluation — sandboxed `evaluate(expr, scope)`, no `eval()`, 40x smaller than mathjs, CDN available
- **`SortableJS` 1.15.x** — workshop drag-sort — `vuedraggable` has no Vue 3 CDN build, so direct SortableJS + Vue `ref` is the workaround
- **`xlsx-js-style` 1.2.x** — styled Excel export — API-compatible with SheetJS, adds `style` property on cells; current free SheetJS build cannot style cells
- **Native Vue 3 reactivity + CSS** — field validation — `vee-validate`/`yup` require a build step; design system already defines error colors (`#F4B7BE` / `#C91D32`)

**What not to use:** `mathjs` (700KB+), `vuedraggable` (no Vue 3 CDN build), `handsontable`/`ag-grid` (conflict with Element Plus), `eval()`/`new Function()` (security, explicitly prohibited in project rules).

### Expected Features

Research identifies a clear priority stack: bugs first, then entry-flow improvements, then data quality, then import/export, then admin conveniences, then the formula engine.

**Must have (table stakes):**
- Inline cell editing with Tab navigation — entry operators are keyboard-driven; mouse-only is a daily friction source
- Real-time formula display on calculated columns — users need to see balance update as they type
- Basic field validation with domain-specific messages — catch errors at input time, not after export
- Excel export with headers even when data is empty — currently broken (P2 bug)
- Import error feedback at row level — "import failed" is not actionable; must say which row/column and why
- Workshop list sourced from database, never hardcoded — P2-8/P2-9 bugs already identified
- Month lock with correct field name — P1-4 bug blocks lock functionality entirely

**Should have (differentiators):**
- Copy previous row — saves ~60% keystrokes for recurring daily data
- Quick-add with only date + workshop required — all other fields editable inline after row creation
- Import preview before commit — show parsed rows, let user confirm before inserting
- Template download (blank Excel with correct headers per department)
- Field-level change history in audit log — store old_value → new_value per field
- Workshop drag-ordering (or up/down buttons) — admin convenience
- Formula configuration UI — user-defined formulas replace hardcoded `calc.js`

**Defer (v2+):**
- Anomaly detection with visual warnings — useful but not critical for launch
- Month-over-month data comparison — nice to have
- Batch cell-drag fill (Excel-style) — too complex for CDN single-file architecture
- Charts/visualization — management wants Excel output, not dashboards
- Mobile responsive layout — internal desktop-only system

### Architecture Approach

All enhancements integrate into the existing monolithic `app.js` + Express structure without adding new build tools. The critical architectural change is replacing the `loadData()` full-reload pattern with optimistic updates in `DeptRecordsPage` — this is a prerequisite for Tab navigation stability. The formula engine is the only component that requires a new database table (`formula_rules`) and a new backend module; everything else is either pure frontend or adds to existing backend routes.

**Major components:**
1. **`DeptRecordsPage` (app.js)** — inline editing, Tab navigation, copy-row, quick-add, validation UI; refactored `saveCell` to optimistic update
2. **`modules/balance/validation.js` (new)** — server-side full-record validation; hooked into `routes/records.js` after `calculateRecord`
3. **`modules/balance/formula-engine.js` (new, Phase 5)** — `expr-eval`-based evaluator; reads `formula_rules` table; replaces `calc.js` hardcoded logic
4. **Import/export pipeline** — template download, preview API endpoint, row-level error reporting; extends `routes/import-export.js`
5. **Workshop ordering** — SortableJS in admin UI + `PUT /api/workshops/reorder` bulk update endpoint

**Data flow — inline edit save:**
`cell click → startEdit → el-input → blur/Tab → saveCell → frontend validation → API PUT → backend calculateRecord → return updated row → optimistic update tableData (no full reload)`

**Data flow — formula evaluation:**
`POST/PUT record → load formula_rules for dept (sorted) → expr-eval.evaluate(expr, record_fields) → store computed values → return complete record`

### Critical Pitfalls

1. **saveCell + loadData concurrent race on Tab** — two concurrent PUTs + two concurrent `loadData()` calls overwrite each other; user values silently disappear. Fix: replace `loadData()` with optimistic update in `saveCell` before any Tab-navigation work.
2. **Formula eval() injection** — if a developer takes the shortcut of using `eval()` or `new Function()` on user-supplied formula strings, the system is compromised. Enforce `expr-eval` exclusively; project rules already prohibit `eval()`.
3. **DEPT_CONFIG global mutation breaking all departments** — `DEPT_CONFIG` is shared by all three department components; structural changes (not just additions) cause silent behavior failures in other departments. Always append, never restructure; always Grep all references before touching.
4. **Over-aggressive validation blocking legitimate data** — "费用不能超产值" blocks valid negative-balance entries; "产值不为0" blocks no-production days. Distinguish blocking rules (prevent submit) from warning rules (highlight but allow submit); confirm each rule with the stats team.
5. **Copy-row carrying `id` and calculated fields** — if the copied row object includes `id`, the save will overwrite the original row instead of creating a new one. Whitelist only editable input fields; exclude `id`, calculated fields, and date.

---

## Implications for Roadmap

Based on research, the dependency chain is clear and non-negotiable: the `loadData` race condition and the existing P0/P1 bugs must be resolved before new features are layered on top. After that, the roadmap flows from simplest-to-most-complex and from most-daily-impact to least.

### Phase 1: Bug Fixes and Foundation Stabilization
**Rationale:** P0/P1 bugs (month-lock field mismatch, workshop_name display errors, Excel export empty-file bug) corrupt the foundation. Building Tab navigation or validation on top of these bugs would create unstable behavior that is hard to diagnose later. The `loadData` → optimistic update refactor also belongs here because it is a prerequisite for Tab navigation.
**Delivers:** A stable, correctly functioning baseline system. All existing features work as documented. `saveCell` refactored to optimistic update.
**Addresses:** Month lock (P1-4), workshop display bugs (P2-8/P2-9), Excel export with no data (P2), `saveCell` race condition (PITFALLS #1/#3).
**Avoids:** Building any new feature on a broken `loadData` pattern.

### Phase 2: Entry Experience Upgrade
**Rationale:** Tab navigation, copy-row, and quick-add are the highest daily-impact improvements for entry operators. They all depend on a stable `saveCell` with optimistic update (delivered in Phase 1). They are also purely frontend — no new DB tables — making them lower risk.
**Delivers:** Keyboard-driven data entry flow. Tab moves between editable fields only (skips calculated columns). Copy-row duplicates editable fields only (excludes `id`). Quick-add creates a row with date + workshop, edits inline.
**Uses:** Element Plus `el-table` scoped-slot; `DEPT_CONFIG.editableColumns` to drive Tab order and copy whitelist.
**Avoids:** PITFALLS #6 (Tab jumping into calculated columns), #9 (copy-row carrying `id`), #11 (bulk operations bypassing lock check).

### Phase 3: Validation and Data Quality
**Rationale:** Validation rules must be designed after the entry flow is stable, because valid rule thresholds depend on how data is entered. Over-aggressive rules on an unstable entry flow would be impossible to diagnose. Rules must be confirmed with the stats team before implementation.
**Delivers:** Frontend per-field validation (block on type/format errors, warn on range anomalies) + backend cross-field validation (400 with `errors[]` array). New `modules/balance/validation.js`.
**Implements:** Dual-mode rules — blocking (prevent submit) vs. warning (highlight but allow). Uses design system error colors (`#F4B7BE` / `#C91D32`).
**Avoids:** PITFALL #4 (rules that block legitimate negative-balance or zero-production entries); PITFALL #10 (historical average queries blocking main table render — load async).

### Phase 4: Import/Export Improvements
**Rationale:** Import/export is independent of the editing and validation phases — it can be developed in parallel conceptually, but is placed here because Phase 2/3 stabilize the data model that import must conform to. Template download is low-risk and high-value.
**Delivers:** Blank per-department Excel template download; import preview (parsed rows returned via API before commit); row-level error reporting (row N, column X, reason Y); `cleanColumnName()` handling full-width spaces and zero-width characters.
**Avoids:** PITFALL #7 (frontend SheetJS parsing blocking UI — keep parsing backend-only); PITFALL #8 (Chinese column names with full-width/zero-width characters silently dropping data).

### Phase 5: Admin Conveniences and Formula Engine
**Rationale:** Workshop ordering is low-risk admin convenience — placed last because it has no user-facing daily impact. The formula engine is the highest-complexity feature: new DB table, new backend module, migration of existing `calc.js` hardcoded rules, settings UI. It is placed last so it cannot destabilize any earlier phases.
**Delivers:** Workshop drag-sort (SortableJS + `PUT /api/workshops/reorder` bulk update); formula CRUD settings UI; `modules/balance/formula-engine.js` using `expr-eval`; `formula_rules` DB table; migration of existing hardcoded formulas.
**Uses:** `SortableJS` 1.15.x (CDN); `expr-eval` 2.x (CDN); new `formula_rules` DB table.
**Avoids:** PITFALL #2 (eval() injection — use expr-eval exclusively); PITFALL #13 (drag-sort updating only the dragged row — must bulk-update all affected `sort_order` values).

### Phase Ordering Rationale

- Phase 1 before everything: the `saveCell` race condition is a data-loss bug; all new entry features depend on it being fixed.
- Phase 2 before Phase 3: you cannot design accurate validation rules until the entry flow is stable and operators have tested it.
- Phase 4 is largely independent but benefits from Phase 3's validated data model being finalized.
- Phase 5 last: the formula engine touches the most existing code (`calc.js`, `records.js`, `app.js`) and carries the highest rewrite risk; deferring it means all other phases are unaffected if it takes longer than expected.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3:** Validation rules need business logic confirmation from the stats team — which thresholds block vs. warn is a domain decision, not a technical one. Cannot be coded without that confirmation.
- **Phase 5 (formula engine):** Migration of existing `calc.js` hardcoded formulas to DB-driven rules needs a mapping exercise; field naming conventions between expression language and DB column names need a defined convention.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Bug fixes follow standard debug/patch pattern; no new patterns needed.
- **Phase 2:** Element Plus scoped-slot inline editing is well-documented; SortableJS Tab-order logic is a standard pattern.
- **Phase 4:** SheetJS backend parsing is already in use; extending it is low-research-cost.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations are either already in use (Element Plus, SheetJS) or small well-established libraries (expr-eval, SortableJS) with clear CDN availability. xlsx-js-style is a community fork — MEDIUM risk but no better alternative for styled export without a build step. |
| Features | HIGH | Features are grounded in actual reported bugs (P1-4, P2-8/P2-9) and direct operator workflow analysis. Priority order is well-reasoned with clear dependency chain. |
| Architecture | HIGH | Build order is fully dependency-driven and consistent with existing codebase structure. Optimistic update pattern is standard and well-understood. |
| Pitfalls | HIGH | All critical pitfalls are grounded in the specific codebase patterns (DEPT_CONFIG sharing, loadData race) rather than generic warnings. Prevention strategies are concrete and actionable. |

**Overall confidence:** HIGH

### Gaps to Address

- **Validation rule thresholds:** The exact numeric rules (e.g., what constitutes an "anomaly" for 产值 or 人数) are a business decision. Must be confirmed with the stats team before Phase 3 implementation begins.
- **Formula expression syntax for existing calc.js rules:** The current `calc.js` uses JavaScript arithmetic directly. Translating these to `expr-eval` expression strings needs a mapping pass during Phase 5 planning to ensure no formula is dropped or subtly changed.
- **xlsx-js-style maintenance status:** This is a community fork of SheetJS. If it falls behind SheetJS API changes, the styled export could break on future Node.js upgrades. Worth monitoring; if it becomes a problem, the fallback is unstyled export with the current SheetJS free build.

---

## Sources

### Primary (HIGH confidence)
- Existing codebase files (`app.js`, `modules/balance/calc.js`, `modules/balance/config.js`, `routes/records.js`, `routes/import-export.js`) — direct code analysis
- Element Plus documentation — `el-table` scoped-slot inline editing pattern
- `expr-eval` npm/unpkg — API verification, CDN availability, safety model

### Secondary (MEDIUM confidence)
- SortableJS GitHub — Vue 3 CDN integration pattern (no official Vue 3 CDN wrapper exists for vuedraggable)
- `xlsx-js-style` npm — API compatibility with SheetJS, style property support

### Tertiary (LOW confidence)
- General Vue 3 CDN + SortableJS integration examples — community workarounds; needs testing against actual app.js structure during Phase 5

---

*Research completed: 2026-03-17*
*Ready for roadmap: yes*
