# Stack Research

**Research Date:** 2026-03-17
**Domain:** Adding inline editing, formula engine, data validation, drag-sort, and template export to existing Express + Vue 3 CDN app

---

## Recommendations

| Feature | Library | Version | CDN | Why |
|---------|---------|---------|-----|-----|
| Inline table editing | Native Element Plus scoped-slot | N/A | Already loaded | el-table already supports click-to-edit via `v-if`/`v-else` in `#default` slots; no new dependency needed |
| Formula engine | `expr-eval` | 2.x | ~20KB via unpkg | Safe sandboxed `evaluate(expr, scope)` — no eval, no Function(); supports arithmetic + ratio formulas; 40x smaller than mathjs |
| Data validation + visual feedback | Native Vue 3 reactivity + CSS | N/A | Already loaded | Uses existing `#F4B7BE`/`#C91D32` error colors from design system; vee-validate/yup require build step |
| Drag-drop sorting | `SortableJS` | 1.15.x | ~30KB via unpkg | Vue wrapper (vuedraggable) has no Vue 3 CDN build; direct SortableJS + Vue ref is the standard workaround |
| Excel template export | `xlsx-js-style` | 1.2.x | CDN available | SheetJS v0.18 (current) doesn't support cell styling in free build; this fork is API-compatible and adds style property |

## What NOT to Use

| Library | Why Not |
|---------|---------|
| `mathjs` | 700KB+ via CDN, overkill for simple arithmetic expressions |
| `vuedraggable` | No Vue 3 CDN build available; requires build step |
| `vee-validate` / `yup` | Require build step; native Vue reactivity sufficient for this use case |
| `handsontable` / `ag-grid` | Heavy spreadsheet libraries that conflict with Element Plus table styling |
| `eval()` / `new Function()` | Security risk — PROJECT.md explicitly prohibits |

## Confidence Assessment

| Recommendation | Confidence | Notes |
|----------------|-----------|-------|
| Element Plus inline editing | HIGH | Well-documented pattern, already partially implemented |
| expr-eval | HIGH | Established library, CDN available, safe by design |
| SortableJS direct | MEDIUM | Works but requires manual Vue integration |
| xlsx-js-style | MEDIUM | Community fork, less maintained than core SheetJS |
| Native validation | HIGH | Simplest approach for this scale |

---

*Stack research: 2026-03-17*
