# Architecture Research

**Research Date:** 2026-03-17
**Domain:** How inline editing, formula engine, and data validation integrate with existing monolithic Express + Vue 3 app

---

## Component Boundaries

### Inline Editing (Frontend Only)
- **Location:** `DeptRecordsPage` in `app.js`
- **Existing:** `startEdit`/`saveCell`/`cancelEdit` already wired — enhancements build on existing infrastructure
- **New:** Tab navigation, copy-row, quick-add all happen within the same component
- **Talks to:** Backend via `api.js` PUT `/:dept/records/:id`

### Validation Layer (Frontend + Backend)
- **Frontend:** Synchronous per-field rules, blocks API call if invalid; new constant `VALIDATION_RULES` in `app.js`
- **Backend:** Full-record cross-field validation; new `modules/balance/validation.js` module
- **Hook point:** `routes/records.js` after existing `calculateRecord` call
- **Visual:** Uses existing design system colors (`#F4B7BE` background, `#C91D32` text)

### Formula Engine (Backend Primary + Frontend Display)
- **Backend:** New `modules/balance/formula-engine.js` — safe expression evaluator using `expr-eval`
- **Storage:** New `formula_rules` DB table with `expression TEXT`, `depends_on TEXT`, `sort_order INT`
- **Frontend:** Settings UI for formula CRUD; display-only formula results in table
- **Current:** `calc.js` hardcodes all formulas — new engine replaces this with DB-driven rules

### Master Data (Frontend + Backend)
- **Drag sort:** SortableJS on workshop list, updates `sort_order` via API
- **Backend:** `PUT /api/workshops/reorder` endpoint

## Data Flow

### Inline Edit Save Flow
```
User clicks cell → startEdit(row, field)
  → cell becomes <el-input>
  → User types value, presses Tab or clicks away
  → saveCell() triggered by blur
  → Frontend validation check
    → If invalid: show error style, block save
    → If valid: API.put('/:dept/records/:id', data)
      → Backend calculateRecord() with formula engine
      → Return updated row
      → Optimistic update (replace row in tableData, NO full reload)
```

### Formula Evaluation Flow
```
Record saved (POST/PUT)
  → Load formula_rules for this dept (sorted by sort_order)
  → For each rule: expr-eval.evaluate(expression, record_fields)
  → Store computed values in record
  → Return complete record with all calculated fields
```

### Validation Flow
```
Frontend (synchronous, per-field):
  field blur → check VALIDATION_RULES[field]
  → type check (integer, decimal, non-negative)
  → range check (optional: warn if > historical average)
  → visual feedback (cell border/background color)

Backend (full-record, on POST/PUT):
  → validate all required fields present
  → validate types and ranges
  → cross-field checks (e.g., total consistency)
  → Return 400 with errors[] array if invalid
```

## Build Order (Dependencies)

1. **Fix P0/P1 bugs** — prerequisite; `workshop_name` mismatch breaks inline edit display
2. **Inline editing enhancements** — pure frontend, no new DB tables; refactor `saveCell` to optimistic update (critical for Tab navigation)
3. **Client + server validation** — new `validation.js` module; depends on inline editing being stable
4. **Import/export improvements** — template export, preview, error report; independent of inline editing
5. **Master data sorting** — SortableJS integration; independent
6. **Formula settings UI** — most complex; new DB table + engine + settings page + migration of existing calc.js rules

## Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Optimistic update instead of full reload after save | Prevents Tab-navigation race conditions; critical for edit efficiency |
| Formula evaluation stays backend-only | Single source of truth; prevents frontend/backend divergence |
| Validation rules as constants, not DB-driven | Simpler; rules change rarely; avoids over-engineering |
| Formula rules in DB (not hardcoded) | User requirement — must be configurable from UI |
| expr-eval over custom parser | Battle-tested, safe, small footprint |

---

*Architecture research: 2026-03-17*
