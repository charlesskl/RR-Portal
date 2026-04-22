# Phase 3: Reconciliation and Date Codes - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Field-by-field comparison engine that matches uploaded PO data to schedule rows, highlights mismatches with red cells, generates date codes, and flags unmatched POs. Factory classification (RR01/RR02 folder split) and ZIP download are Phase 4.

</domain>

<decisions>
## Implementation Decisions

### PO-to-Row Matching
- Match by TOMY PO number + 货号 (part number) together — each SKU line in the PO maps to a specific schedule row
- Each upload session is independent — no cumulative state across sessions
- If a PO has duplicate items (same 货号 appearing twice), flag as ambiguous and warn user for manual review
- Unmatched POs (no matching schedule row) are listed separately, not inserted into schedule
- Unmatched PO items are appended at the bottom of the schedule sheet with yellow background
- Schedule rows that were matched and verified get green background + "已核对" in a status column
- Schedule rows under the same PO number but not covered by uploaded PO items are marked "未核对" in the status column

### Mismatch Display
- Cell-level red highlighting — only the specific mismatched cells get red background, consistent cells remain unchanged
- Light red background (浅红) for readability — similar to Excel conditional formatting style
- Mismatched cells keep the schedule value in the cell, with an Excel comment/note showing the PO value for comparison
- Status column added at end of schedule showing "已核对" / "未核对" / "未匹配"

### Date Code Generation
- Fill into the existing 日期码 column in the schedule (ScheduleRow.日期码 field)
- If the 日期码 cell already has a value, preserve it — only fill empty cells
- "前1个月" means subtract one natural calendar month (e.g., Mar 15 → Feb 15), not 30 days
- If PO has no recognizable factory code (RR01/RR02), skip date code generation for that item and report error
- After subtracting one month, if the date falls on a weekend or Chinese public holiday, roll back to the nearest prior working day

### Field Comparison Rules
- Date fields (PO走货期): Parse both sides to date objects, compare year/month/day — ignore format differences between "18 Mar 2026" and Excel date objects
- Numeric fields (数量, 外箱, 总箱数): Strip formatting (commas etc.), parse to numbers, compare numeric values
- Text fields: Use existing normalize() utility (NFKC, trim, non-breaking spaces)
- 箱唛资料: NOT a direct text comparison — generate value from PO rules, then compare with schedule

### 箱唛资料 Generation Rules
- If 第三客户名称 = "TOMY" → base value is "标准唛"
- If 第三客户名称 is anything else → base value is "待定"
- If PO's QC Instructions contains "TTT" → append "+TTT"
- If PO contains "For EU shipments, please print the contact details below on top & bottom of each master carton" → append "+欧盟联盟"
- Generated value is compared against the schedule's existing 箱唛资料 value; mismatch → red highlight

### Claude's Discretion
- Exact Excel comment formatting for PO values
- Green shade for verified rows
- Yellow shade for unmatched PO rows
- Error reporting format for ambiguous/unrecognized items
- How to handle edge cases in date parsing (invalid dates, missing values)

</decisions>

<specifics>
## Specific Ideas

- 箱唛资料 is a rule-based generated field, not a simple copy from PO text. The rules are business logic that must be implemented as code.
- Example date code: D1526RR02 = April (D) 15th, 2026, Indonesia factory
- Month letters: A=Jan, B=Feb, C=Mar, D=Apr, E=May, F=Jun, G=Jul, H=Aug, I=Sep, J=Oct, K=Nov, L=Dec

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `normalize()` in `server/lib/normalize.ts`: NFKC normalization, non-breaking space handling, trim — use for all text field comparisons
- `POData` / `POItem` / `ScheduleRow` types in `server/types/index.ts`: Already define all 11 comparison fields
- `excelParser.ts`: Header-based column lookup with aliases, `unwrapCellValue()` for formula cells — reuse for output Excel writing
- `pdfExtractor.ts`: Already extracts factoryCode from PO number

### Established Patterns
- ExcelJS for both reading and writing Excel (chosen specifically for cell styling capability)
- `chinese-days` package installed for holiday detection
- Label-anchored regex extraction for PDF fields
- Header alias map for Dongguan vs Indonesia template differences

### Integration Points
- `server/routes/upload.ts`: Currently returns parsed data — reconciliation logic plugs in after parsing
- `server/types/index.ts`: May need new types for reconciliation results
- `client/src/App.tsx` + `FileStatusList.tsx`: Frontend will need to display reconciliation status

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-reconciliation-and-date-codes*
*Context gathered: 2026-03-21*
