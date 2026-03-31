# Features Research

**Research Date:** 2026-03-17
**Domain:** Factory production statistics system — UX improvements for data entry, validation, import/export, and formula management

---

## Table Stakes (Must-Have)

| Feature | Complexity | Dependencies | Notes |
|---------|-----------|--------------|-------|
| Inline cell editing (click-to-activate) | Medium | Element Plus el-table | Already partially built, needs refinement |
| Tab key navigation between editable fields | Low | Inline editing | Essential for keyboard-driven data entry |
| Real-time formula display on calculated columns | Medium | Config already has `formula` strings | Users need to see calculations update live |
| Basic field validation with domain-specific messages | Medium | None | 产值 > 0, 人数 is integer, 费用 ≤ 产值 etc. |
| Excel export matching screen layout | Low | Exists but broken for empty data | P2 bug — needs headers even with no data |
| Import error feedback at row level | Medium | Import exists | Not just "failed" — which row, which column, why |
| Workshop list from database, never hardcoded | Low | None | P2-8/P2-9 bugs already identified |
| Audit trail with old/new values | Medium | Audit log exists | Currently logs action but not field-level changes |
| Month lock with clear visual status | Low | Lock exists | P1-4 bug — field name mismatch blocks functionality |

## Differentiators (Competitive Advantage)

| Feature | Complexity | Dependencies | Notes |
|---------|-----------|--------------|-------|
| Copy previous row | Low | Inline editing | Saves ~60% keystrokes for recurring daily data |
| Quick-add with only date + workshop required | Medium | Inline editing | All other fields filled inline after row creation |
| Import preview before commit | High | SheetJS | Show parsed data, let user confirm before inserting |
| Template download (blank Excel with correct headers) | Low | SheetJS | Per-department formatted empty Excel |
| Field-level change history in audit log | Medium | Audit log | Store old_value → new_value per field |
| Formula configuration UI | Very High | mathjs or safe expression parser | User-defined formulas for all expense fields |
| Workshop drag-ordering (or up/down buttons) | Medium | sort_order field exists | Simpler: up/down buttons; complex: drag-and-drop |
| Anomaly detection with visual warning | Medium | Historical data | Highlight values that deviate significantly from average |
| Month-over-month data comparison | Medium | Summary queries | Same workshop this month vs last month side-by-side |

## Anti-Features (Do NOT Build)

| Feature | Reason |
|---------|--------|
| Batch fill via cell-drag (Excel-style) | Too complex for CDN single-file architecture |
| Real-time sync / optimistic locking | Not needed — each recorder owns their workshop data |
| Visual formula builder (drag-and-drop) | Text expression with field references is sufficient |
| Auto-save on every keystroke | Save on row blur instead — less error-prone |
| Charts/visualization | Management wants Excel output, not dashboards |
| Mobile responsive layout | Internal desktop-only system |

## Recommended Priority Order

1. Fix P0/P1 bugs (foundation must be solid)
2. Tab navigation + Quick-add (biggest daily efficiency gain)
3. Copy row (recurring data entry optimization)
4. Validation rules (catch errors at input time)
5. Import improvements (template + preview + error report)
6. Change history (accountability)
7. Workshop ordering (admin convenience)
8. Formula UI (highest value but highest complexity — do last)

---

*Features research: 2026-03-17*
