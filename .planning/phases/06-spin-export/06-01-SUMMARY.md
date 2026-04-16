---
phase: 06-spin-export
plan: "01"
subsystem: export
tags: [spin, excel, export, template]
dependency_graph:
  requires: []
  provides: [spin-excel-export]
  affects: []
tech_stack:
  added: []
  patterns: [exceljs-template-fill, setVal-formula-guard, clearRows-helper]
key_files:
  created:
    - server/templates/VQ-template-spin.xlsx
    - server/services/spin-exporter.js
  modified: []
decisions:
  - Exchange rate formula: RMB→USD = rmb / (rmb_hkd * hkd_usd), consistent with plan spec
  - Master carton price from ProductDimension.carton_price (not PackagingItem)
  - Labor rows matched by fabric_name keyword (缝/sew→R126, 包/pack→R128, 剪/cut→R129, 塞/stuff→R130)
metrics:
  duration: 10m
  completed: 2026-04-16T03:50:00Z
  tasks: 1
  files: 2
---

# Phase 06 Plan 01: SPIN Vendor Quote Form Export Service Summary

**One-liner:** SPIN Vendor Quote Form export using ExcelJS template-fill with RMB→USD conversion via rmb_hkd/hkd_usd params.

## What Was Done

Copied the SPIN Master Vendor Quote Form template from the desktop to `server/templates/VQ-template-spin.xlsx` and created `server/services/spin-exporter.js` implementing the full SPIN export pipeline.

## Implementation Details

`spin-exporter.js` follows the exact same helper pattern as `excel-exporter.js`:
- `loadData(versionId)` — queries QuoteVersion, Product, QuoteParams, SewingDetail (fabric/labor split), PackagingItem, ProductDimension
- `setVal(ws, row, col, value)` — guards formula cells, guards NaN
- `r2(v)` — rounds to 2 decimals
- `clearRows(ws, startRow, endRow, dataCols)` — clears non-formula cells
- `fixSharedFormulas(wb)` — resolves shared formula references before writing

`fillCharacterSheet(ws, d)` fills:
- Header (rows 3-7): vendor name, customer, item_no, date, description
- Fabric Cost (R23-R35, cols 3/4/10/11): fabric_name as English+Chinese desc, USD price converted from material_price_rmb, usage_amount as qty
- Others Cost (R60-R70): cleared/left blank
- Packaging (R86=H-tag, R87=CDU, R92=Master carton): matched from PackagingItems by name keyword; R92 price from ProductDimension.carton_price
- Labor (R126/128/129/130, cols 10/11): matched from laborItems by fabric_name keyword
- Markup (R135/137/138, col 11): markup_body, markup_packaging, 0.15 hardcoded

`fillSummary(ws, d)` fills Summary sheet header rows 4-12.

## Verification

```
SKIP(no test data): function exists, template loadable
```

Module loads cleanly; `exportSpinVersion` is exported as a function; template file is readable by ExcelJS.

## Deviations from Plan

None — plan executed exactly as written.

## Commits

- `a2e3777`: feat(06-01): add SPIN Vendor Quote Form export service

## Self-Check: PASSED

- `server/templates/VQ-template-spin.xlsx` — FOUND
- `server/services/spin-exporter.js` — FOUND
- Commit `a2e3777` — FOUND
