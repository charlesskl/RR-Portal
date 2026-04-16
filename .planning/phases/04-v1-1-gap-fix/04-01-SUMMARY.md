---
plan: 04-01
phase: 04-v1-1-gap-fix
status: complete
completed: 2026-04-16
commit: 91a62ac
---

## What Was Built

Fixed the version duplicate endpoint (`POST /:id/duplicate`) in `server/routes/versions.js` to preserve `format_type` when copying a version.

## Changes

**server/routes/versions.js** (lines 141-148)
- Added `format_type` to the QuoteVersion INSERT column list
- Added `version.format_type` to the `.run()` binding values

## Self-Check: PASSED

- `grep -n "format_type" server/routes/versions.js` → lines 143 and 148 ✓
- `node -e "require('./server/routes/versions.js')"` → no errors ✓
- Commit `91a62ac` verified in git log ✓

## Key Files

- **Modified:** `server/routes/versions.js`

## Notes

Previously, duplicating a plush (`format_type = 'plush'`) or SPIN version caused the copy to silently get `format_type = NULL` (SQLite default), which would later cause export logic to treat it as `'injection'`. Now the copy inherits the original's `format_type` correctly.
