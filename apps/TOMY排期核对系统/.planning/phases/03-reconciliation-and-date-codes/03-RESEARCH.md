# Phase 3: Reconciliation and Date Codes - Research

**Researched:** 2026-03-21
**Domain:** Data reconciliation engine, ExcelJS cell styling, date arithmetic, Chinese holiday workday calculation
**Confidence:** HIGH — all findings verified against existing codebase and live library testing

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**PO-to-Row Matching:**
- Match by TOMY PO number + 货号 (part number) together — each SKU line in the PO maps to a specific schedule row
- Each upload session is independent — no cumulative state across sessions
- If a PO has duplicate items (same 货号 appearing twice), flag as ambiguous and warn user for manual review
- Unmatched POs (no matching schedule row) are listed separately, not inserted into schedule
- Unmatched PO items are appended at the bottom of the schedule sheet with yellow background
- Schedule rows that were matched and verified get green background + "已核对" in a status column
- Schedule rows under the same PO number but not covered by uploaded PO items are marked "未核对" in the status column

**Mismatch Display:**
- Cell-level red highlighting — only the specific mismatched cells get red background, consistent cells remain unchanged
- Light red background (浅红) for readability — similar to Excel conditional formatting style
- Mismatched cells keep the schedule value in the cell, with an Excel comment/note showing the PO value for comparison
- Status column added at end of schedule showing "已核对" / "未核对" / "未匹配"

**Date Code Generation:**
- Fill into the existing 日期码 column in the schedule (ScheduleRow.日期码 field)
- If the 日期码 cell already has a value, preserve it — only fill empty cells
- "前1个月" means subtract one natural calendar month (e.g., Mar 15 → Feb 15), not 30 days
- If PO has no recognizable factory code (RR01/RR02), skip date code generation for that item and report error
- After subtracting one month, if the date falls on a weekend or Chinese public holiday, roll back to the nearest prior working day

**Field Comparison Rules:**
- Date fields (PO走货期): Parse both sides to date objects, compare year/month/day — ignore format differences between "18 Mar 2026" and Excel date objects
- Numeric fields (数量, 外箱, 总箱数): Strip formatting (commas etc.), parse to numbers, compare numeric values
- Text fields: Use existing normalize() utility (NFKC, trim, non-breaking spaces)
- 箱唛资料: NOT a direct text comparison — generate value from PO rules, then compare with schedule

**箱唛资料 Generation Rules:**
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COMP-01 | System matches PO data to schedule rows by TOMY PO number | Composite key (tomyPO + 货号); ScheduleRow.tomyPO + ScheduleRow.货号 already parsed in Phase 2 |
| COMP-02 | System compares 接单期国家 field between PO and schedule | POData.destCountry (English) vs ScheduleRow.国家 (Chinese) — requires country name mapping table |
| COMP-03 | System compares 第三客户名称 field between PO and schedule | POData.customerName vs ScheduleRow.第三客户名称 — text with normalize() |
| COMP-04 | System compares 客跟单 field between PO and schedule | POData.handleBy vs ScheduleRow.客跟单 — text with normalize() |
| COMP-05 | System compares TOMY PO field between PO and schedule | POData.tomyPO vs ScheduleRow.tomyPO — text comparison (same value used for matching) |
| COMP-06 | System compares CUSTOMER PO field between PO and schedule | POData.customerPO vs ScheduleRow.customerPO — text with normalize() |
| COMP-07 | System compares 货号 field between PO and schedule | POItem.货号 vs ScheduleRow.货号 — text comparison (same value used for matching) |
| COMP-08 | System compares 数量 field between PO and schedule | POItem.数量 (number) vs ScheduleRow.数量 (number) — numeric equality |
| COMP-09 | System compares 外箱 field between PO and schedule | POItem.外箱 (number or null) vs ScheduleRow.外箱 (number) — numeric; null = skip comparison |
| COMP-10 | System compares 总箱数 field between PO and schedule | 总箱数 NOT in PDF — no PO value to compare against; field is schedule-only (formula-derived). Skip comparison for this field — cannot flag mismatches on data that doesn't exist in POs. |
| COMP-11 | System compares PO走货期 field between PO and schedule | POItem.PO走货期 (string "18 Mar 2026") vs ScheduleRow.PO走货期 (Date) — parse string with date-fns, compare by year/month/day |
| COMP-12 | System compares 箱唛资料 field between PO and schedule | Generate value from rules (see箱唛资料 rules above), compare with ScheduleRow.箱唛资料 |
| COMP-13 | Mismatched cells are highlighted with red background in output Excel | ExcelJS PatternFill FFFF9999 confirmed working; cell.note for PO value |
| COMP-14 | POs without matching schedule rows are flagged as unmatched | Append to bottom with yellow background; status = "未匹配" |
| DATE-01 | Date code format: month letter + day + 2-digit year + factory code | MONTH_LETTERS[month] + day + year.slice(2) + factoryCode — verified D1526RR02 for Apr 15, 2026, RR02 |
| DATE-02 | Month letters: A=Jan through L=Dec | Verified: const MONTH_LETTERS = 'ABCDEFGHIJKL' |
| DATE-03 | Date code date = PO走货期 minus 1 month | date-fns subMonths() — verified Mar 31 → Feb 28 (end-of-month clamping correct) |
| DATE-04 | If calculated date falls on weekend or Chinese public holiday, roll back to nearest prior working day | isWorkday() + findWorkday(-1, dateStr) from chinese-days — verified Spring Festival adjusted Saturdays (Feb 14, 2026 is makeup workday = IS a workday) |
| DATE-05 | Date code auto-filled into scheduling Excel output | Write to ScheduleRow.日期码 column only if cell is currently empty |
</phase_requirements>

---

## Summary

Phase 3 builds three tightly-coupled pieces on top of the Phase 2 parsers: a reconciliation engine, a date code generator, and an annotated Excel writer. All inputs (POData[], ScheduleRow[], schedule Buffer) are already available from Phase 2's parsing pipeline — this phase adds the comparison logic and the output generation.

The reconciliation engine uses a composite key (tomyPO + 货号) to match each POItem to a ScheduleRow. The matching step is straightforward but has two edge cases: duplicate items (same 货号 in one PO, flag as ambiguous) and unmatched POs (no schedule row, append with yellow background). Field comparison uses the existing normalize() utility for text fields, numeric equality for quantities, and date-fns parsed Date objects for date fields. The one structural gap is COMP-10 (总箱数): this field does not appear in the PDF at all — it is a formula-derived column in the schedule. There is no PO value to compare against, so this comparison must be skipped.

The date code generator uses date-fns subMonths() for the "subtract one calendar month" step, then chinese-days isWorkday()/findWorkday() for the workday rollback. The chinese-days package correctly handles adjusted makeup Saturdays (e.g., Feb 14, 2026 is a Saturday but marked as a workday due to Spring Festival makeup). The ExcelJS annotation pipeline (red fill + cell note for PO value, green fill for verified rows, yellow for unmatched) has been verified to work correctly with the existing workbook load/write pattern.

**Primary recommendation:** Build reconciler.ts (matching + comparison), dateCodeGenerator.ts (date arithmetic + holiday rollback), and excelWriter.ts (annotated output) as three separate modules. Wire them into the upload route after parsing. Return reconciliation results in the API response for frontend display.

---

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| exceljs | 4.4.0 | Read/write Excel with cell styling | Only library that preserves and writes cell fills and notes; chosen in Phase 1 |
| chinese-days | 1.5.7 | Chinese public holiday + adjusted workday lookup | Covers statutory holidays and makeup Saturdays through 2026; not a static list |
| date-fns | 4.1.0 | Date arithmetic (subMonths, parse, format) | Tree-shakeable; subMonths() handles end-of-month clamping correctly |
| vitest | 4.1.0 | Unit testing | Already configured; 41 tests currently passing |
| typescript | 5.x | Type safety | All existing code typed; new modules follow same pattern |

### No New Dependencies Required

All libraries needed for Phase 3 are already installed. No `npm install` step needed.

### Chinese-days Import Pattern (VERIFIED — CJS module in ESM context)

```typescript
// chinese-days exports as CJS; must use default import in ESM context
import pkg from 'chinese-days'
const { isWorkday, findWorkday } = pkg
```

Named imports (`import { isWorkday } from 'chinese-days'`) throw `SyntaxError: Named export not found`.

---

## Architecture Patterns

### Recommended Project Structure (Phase 3 additions)

```
server/
├── lib/
│   ├── normalize.ts          (existing)
│   ├── pdfExtractor.ts       (existing)
│   ├── excelParser.ts        (existing)
│   ├── reconciler.ts         (NEW) — matching engine + field comparisons
│   ├── dateCodeGenerator.ts  (NEW) — date arithmetic + workday rollback
│   └── excelWriter.ts        (NEW) — annotated output Excel
├── routes/
│   └── upload.ts             (EXPAND) — add reconciliation step after parsing
└── types/
    └── index.ts              (EXPAND) — add ReconciliationResult, FieldMismatch types
```

### Pattern 1: Composite Key Matching

**What:** Index ScheduleRow[] by `tomyPO + ":" + 货号` into a Map for O(1) lookup per POItem.
**When to use:** For every POItem in every POData, look up its matching ScheduleRow.

```typescript
// Source: derived from existing ScheduleRow type in server/types/index.ts
function buildScheduleIndex(rows: ScheduleRow[]): Map<string, ScheduleRow[]> {
  const index = new Map<string, ScheduleRow[]>()
  for (const row of rows) {
    if (!row.tomyPO || !row.货号) continue
    const key = `${row.tomyPO}:${row.货号}`
    const existing = index.get(key) ?? []
    existing.push(row)
    index.set(key, existing)
  }
  return index
}
```

If `index.get(key)` returns an array of length > 1, the schedule has multiple rows for the same PO+SKU. This is not a duplicate-item case (that's on the PO side) — it's a legitimate multi-row schedule entry. Match to the first unmatched row.

If `index.get(key)` returns nothing, the PO item has no matching schedule row — flag as "未匹配".

### Pattern 2: Field Comparison with Per-Field Mismatch Tracking

**What:** Compare each of the 10 active comparison fields, record which fields mismatched and what the PO value was.
**When to use:** For each matched (POData, POItem, ScheduleRow) triple.

```typescript
// Source: verified against existing types in server/types/index.ts
interface FieldMismatch {
  field: string           // column name in schedule (e.g., "货号", "PO走货期")
  scheduleValue: unknown  // value that stays in the cell
  poValue: unknown        // value shown in the Excel comment/note
}

interface MatchResult {
  scheduleRowIndex: number
  status: 'matched' | 'unmatched' | 'ambiguous'
  mismatches: FieldMismatch[]
  dateCode: string | null
}
```

### Pattern 3: Field-Specific Comparison Strategies

**Text fields** (第三客户名称, 客跟单, TOMY PO, CUSTOMER PO, 货号):
```typescript
// Source: existing normalize() in server/lib/normalize.ts
function compareText(poVal: string | null, schedVal: string | null): boolean {
  return normalize(poVal) === normalize(schedVal)
}
```

**Numeric fields** (数量, 外箱 — skip 总箱数):
```typescript
function compareNumeric(poVal: number | null, schedVal: number | null): boolean {
  if (poVal === null) return true  // no PO value = skip comparison
  if (schedVal === null) return false  // schedule missing value
  return poVal === schedVal
}
```

**Date field** (PO走货期):
```typescript
// Source: date-fns parse, verified against real PO strings ("18 Mar 2026")
import { parse } from 'date-fns'

function compareDates(poDateStr: string | null, schedDate: Date | null): boolean {
  if (!poDateStr || !schedDate) return poDateStr == null && schedDate == null
  const parsed = parse(poDateStr, 'd MMM yyyy', new Date())
  return parsed.getFullYear() === schedDate.getFullYear()
    && parsed.getMonth() === schedDate.getMonth()
    && parsed.getDate() === schedDate.getDate()
}
```

**Country field** (接单期国家 / 国家):
PDF stores English: "BELGIUM", "UK", "USA". Schedule stores Chinese: "比利时", "英国", "美国". Requires a mapping table — see Country Mapping section below.

**箱唛资料** (generated, not compared directly):
```typescript
function generate箱唛资料(customerName: string, qcInstructions: string): string {
  let value = normalize(customerName).toUpperCase().includes('TOMY') ? '标准唛' : '待定'
  if (qcInstructions.includes('TTT')) value += '+TTT'
  if (qcInstructions.includes('For EU shipments, please print the contact details')) {
    value += '+欧盟联盟'
  }
  return value
}
```

NOTE: `qcInstructions` must be extracted from the PO PDF text in this phase. Currently `POData` does not include this field — it must be added to `POData` or `POItem` and extracted in `pdfExtractor.ts`. This is a required type extension.

### Pattern 4: Date Code Generation

**Verified algorithm** (confirmed D1526RR02 for May 15, 2026 PO走货期 with RR02):

```typescript
// Source: verified live with date-fns + chinese-days in this research session
import pkg from 'chinese-days'
const { isWorkday, findWorkday } = pkg
import { subMonths, parse, format } from 'date-fns'

const MONTH_LETTERS = 'ABCDEFGHIJKL'

export function generateDateCode(
  poZouHuoQiStr: string,
  factoryCode: string
): string | null {
  if (!factoryCode.match(/^RR0[12]$/)) return null  // unknown factory

  const poDate = parse(poZouHuoQiStr, 'd MMM yyyy', new Date())
  if (isNaN(poDate.getTime())) return null           // invalid date

  const minus1 = subMonths(poDate, 1)
  const dateStr = format(minus1, 'yyyy-MM-dd')

  const workdayStr = isWorkday(dateStr) ? dateStr : findWorkday(-1, dateStr)
  const workday = parse(workdayStr, 'yyyy-MM-dd', new Date())

  const letter = MONTH_LETTERS[workday.getMonth()]
  const day = workday.getDate()
  const year = String(workday.getFullYear()).slice(2)
  return `${letter}${day}${year}${factoryCode}`
}
```

Test cases (all verified):
- `generateDateCode('15 May 2026', 'RR02')` → `"D1526RR02"`
- `generateDateCode('15 Mar 2026', 'RR01')` → `"B1426RR01"` (Feb 15 = Sun; rollback to Feb 14 = makeup Saturday workday)
- `generateDateCode('01 Nov 2026', 'RR02')` → `"I3026RR02"` (Oct 1 = National Day; rollback to Sep 30)

### Pattern 5: ExcelJS Annotation

**Verified API for cell styling** (confirmed working):

```typescript
// Source: verified with ExcelJS 4.4.0 in this research session
// Red mismatch highlight + note showing PO value
cell.fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFCCCC' }  // light red
}
cell.note = `PO value: ${poValue}`  // string form works; object form also works

// Green verified row
cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF90EE90' } }

// Yellow unmatched PO row
cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF99' } }

// Status column value
cell.value = '已核对'  // or '未核对' or '未匹配'
```

**Adding a status column at the end:**
```typescript
// ws.columnCount gives the last used column index
const statusColIdx = ws.columnCount + 1
ws.getRow(1).getCell(statusColIdx).value = '状态'
```

**Write the annotated workbook to buffer:**
```typescript
const outputBuffer = await workbook.xlsx.writeBuffer()
// Return as Buffer for API response or further processing in Phase 4
```

### Anti-Patterns to Avoid

- **Matching by TOMY PO number alone:** Multiple SKUs share the same PO number. Must use composite key (tomyPO + 货号).
- **Mutating the original uploaded schedule buffer:** Always load a fresh workbook copy for annotation. The original rows (ScheduleRow[]) should stay immutable.
- **String comparison without normalize():** The PDF extractor has already normalized field values via normalize(), but ScheduleRow values from Excel may not be normalized. Apply normalize() to both sides at comparison time.
- **Using `findWorkday(-1, date)` unconditionally:** findWorkday(-1, x) returns the workday STRICTLY BEFORE x, even if x itself is a workday. Call `isWorkday(dateStr)` first; only call findWorkday if the date is not a workday.
- **Named ESM imports from chinese-days:** The package is CJS and throws on named imports in an ESM context. Always use the default import pattern.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Calendar month subtraction | Custom "subtract 30 days" logic | `date-fns subMonths()` | Handles end-of-month overflow correctly (Mar 31 → Feb 28, not Mar 3) |
| Chinese public holiday lookup | Static list of dates | `chinese-days` package | Covers adjusted makeup Saturdays; government announces changes annually; static list is wrong within months |
| Unicode normalization | Custom regex substitution | `normalize()` in server/lib/normalize.ts | Already handles NFKC, full-width digits, non-breaking spaces, trim — reuse as-is |
| Excel cell styling | Manual OOXML XML manipulation | ExcelJS `.fill`, `.note` properties | ExcelJS abstracts the XML; direct manipulation will corrupt the file |
| Date string parsing | Custom "DD Mon YYYY" parser | `date-fns parse(str, 'd MMM yyyy', ref)` | Handles locale-safe month name parsing correctly |

---

## Common Pitfalls

### Pitfall 1: 总箱数 is NOT in the PDF

**What goes wrong:** Attempting to compare COMP-10 (总箱数) between PO and schedule will always fail because `POItem.总箱数` does not exist — the PDF never contains this field.
**Why it happens:** Phase 2 research confirmed `总箱数` is a formula cell in the schedule (derived from 数量 ÷ 外箱 or similar). It is not present in the PO PDF text stream.
**How to avoid:** Do not add 总箱数 to `POItem`. For COMP-10, the comparison produces no result — treat as "field not available in PO; no comparison performed; no red highlight."
**Warning signs:** Test that tries to compare POItem.总箱数 to ScheduleRow.总箱数 will always show null vs. number.

### Pitfall 2: 接单期国家 Requires Country Name Translation

**What goes wrong:** Direct string comparison of `POData.destCountry` ("BELGIUM") against `ScheduleRow.国家` ("比利时") always fails.
**Why it happens:** The PDF stores the country in English (Port of Discharge field); the schedule stores it in Chinese.
**How to avoid:** Build a small country-name mapping table (English → Chinese) and normalize both sides before comparison. From the Phase 2 research: known countries include BELGIUM → 比利时, UK/UNITED KINGDOM → 英国, USA → 美国, AUSTRALIA → 澳大利亚, INDONESIA → 印尼. The mapping should be extensible.
**Warning signs:** All 接单期国家 comparisons showing mismatches even when the values are logically the same country.

### Pitfall 3: chinese-days Named Imports Fail in ESM

**What goes wrong:** `import { isWorkday, findWorkday } from 'chinese-days'` throws `SyntaxError: Named export 'findWorkday' not found`.
**Why it happens:** `chinese-days` is a CommonJS module. Node.js ESM can import CJS modules only via the default export.
**How to avoid:** Always use `import pkg from 'chinese-days'; const { isWorkday, findWorkday } = pkg`.
**Warning signs:** `SyntaxError: Named export not found` at startup.

### Pitfall 4: findWorkday(-1, x) is Exclusive, Not Inclusive

**What goes wrong:** Calling `findWorkday(-1, dateStr)` when the date IS already a workday returns the PREVIOUS workday, not the date itself.
**Why it happens:** `findWorkday(-1, x)` semantics are "find the workday strictly before x". There is no "find current or previous workday" overload.
**How to avoid:** Always check `isWorkday(dateStr)` first. Only call `findWorkday(-1, dateStr)` if `isWorkday` returns false.
**Warning signs:** Date codes one day earlier than expected for POs with valid workday ship dates.

### Pitfall 5: Duplicate 货号 Detection Must Happen Per-PO

**What goes wrong:** Checking for duplicate 货号 globally across all POs flags different POs that happen to share the same part number.
**Why it happens:** Two different TOMY POs can legitimately contain the same part number (e.g., an amendment PO).
**How to avoid:** Detect duplicates per-PO: within each `POData.items`, check for duplicate `货号` values before matching. Only flag ambiguous when the same `货号` appears twice in the same `POData.items` array.

### Pitfall 6: Status Column Must Be Added to Both Files

**What goes wrong:** Adding a status column only to one sheet (e.g., only Dongguan output) when both Dongguan and Indonesia schedules need annotation.
**Why it happens:** The two schedule files have different column counts (Dongguan has 37 columns; Indonesia has 42 columns), so the status column lands at a different index in each file.
**How to avoid:** Use `ws.columnCount + 1` (not a hardcoded index) to place the status column at the end of whatever sheet is being processed.

### Pitfall 7: QC Instructions Field Missing from POData

**What goes wrong:** 箱唛资料 generation rule requires checking for "TTT" and "EU shipments" text in the PO. If this text is not extracted in Phase 2, 箱唛资料 generation will always produce "标准唛" or "待定" without the +TTT or +欧盟联盟 suffixes.
**Why it happens:** `POData` as currently defined does not include a QC instructions or remarks field — the PDF extractor only extracts the fields listed in `server/types/index.ts`.
**How to avoid:** Add a `qcInstructions: string` field to `POData` and extract it in `pdfExtractor.ts`. The relevant text appears after the line items in the PO PDF. This is a **required type extension** before 箱唛资料 comparison can work.

---

## Code Examples

### Complete Date Code Generation (verified)

```typescript
// Source: verified with date-fns 4.1.0 + chinese-days 1.5.7 in this research session
import pkg from 'chinese-days'
const { isWorkday, findWorkday } = pkg
import { subMonths, parse, format } from 'date-fns'

const MONTH_LETTERS = 'ABCDEFGHIJKL'

export function generateDateCode(
  poZouHuoQiStr: string,  // "15 May 2026" format from POItem.PO走货期
  factoryCode: string      // "RR01" or "RR02"
): string | null {
  if (!factoryCode.match(/^RR0[12]$/)) return null

  const poDate = parse(poZouHuoQiStr, 'd MMM yyyy', new Date())
  if (isNaN(poDate.getTime())) return null

  const minus1 = subMonths(poDate, 1)
  const dateStr = format(minus1, 'yyyy-MM-dd')

  const workdayStr = isWorkday(dateStr) ? dateStr : findWorkday(-1, dateStr)
  const workday = parse(workdayStr, 'yyyy-MM-dd', new Date())

  return MONTH_LETTERS[workday.getMonth()]
    + workday.getDate()
    + String(workday.getFullYear()).slice(2)
    + factoryCode
}
```

### Country Name Mapping Table

```typescript
// Source: derived from Phase 2 research — actual country values from real schedule files
const COUNTRY_MAP: Record<string, string> = {
  'BELGIUM': '比利时',
  'BEL': '比利时',
  'UK': '英国',
  'UNITED KINGDOM': '英国',
  'USA': '美国',
  'UNITED STATES': '美国',
  'AUSTRALIA': '澳大利亚',
  'AUS': '澳大利亚',
  'INDONESIA': '印尼',
  'CHINA': '中国',
  // extend as new countries appear in PO batches
}

function normalizeCountry(englishName: string): string {
  const upper = normalize(englishName).toUpperCase()
  return COUNTRY_MAP[upper] ?? englishName  // fallback: keep original if not in map
}
```

### ReconciliationResult Type (new types needed)

```typescript
// Add to server/types/index.ts
export interface FieldMismatch {
  field: string
  scheduleValue: unknown
  poValue: unknown
  columnIndex: number  // for ExcelJS cell targeting
}

export interface RowMatchResult {
  scheduleRowIndex: number
  tomyPO: string
  货号: string
  status: 'matched' | 'unmatched' | 'ambiguous'
  mismatches: FieldMismatch[]
  dateCode: string | null
  sourceFile: string
}

export interface ReconciliationResult {
  matched: RowMatchResult[]
  unmatchedPOItems: Array<{ tomyPO: string; 货号: string; sourceFile: string }>
  ambiguousPOItems: Array<{ tomyPO: string; 货号: string; sourceFile: string }>
  scheduleBuffer: Buffer  // annotated Excel output
}
```

### ExcelJS Write Pattern (verified round-trip)

```typescript
// Source: verified with ExcelJS 4.4.0 in this research session
import ExcelJS from 'exceljs'

export async function writeAnnotatedSchedule(
  scheduleBuffer: Buffer,
  results: RowMatchResult[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(scheduleBuffer)
  const ws = workbook.getWorksheet('总排期')
  if (!ws) throw new Error('Sheet 总排期 not found')

  // Add status column header
  const statusCol = ws.columnCount + 1
  ws.getRow(1).getCell(statusCol).value = '状态'

  for (const result of results) {
    const row = ws.getRow(result.scheduleRowIndex)

    // Apply status
    const statusCell = row.getCell(statusCol)
    statusCell.value = result.status === 'matched' ? '已核对' : '未核对'
    statusCell.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: result.status === 'matched' ? 'FF90EE90' : 'FFFFFFFF' }
    }

    // Apply mismatch highlights
    for (const mismatch of result.mismatches) {
      const cell = row.getCell(mismatch.columnIndex)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } }
      cell.note = `PO value: ${mismatch.poValue}`
    }

    // Fill date code if cell is empty
    if (result.dateCode) {
      // dateCodeColumnIndex must be resolved from the column map
      // (different positions in Dongguan vs Indonesia files)
    }
  }

  return workbook.xlsx.writeBuffer() as Promise<Buffer>
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pdf-parse for PDF extraction | pdfjs-dist legacy build | Phase 2 decision | pdf-parse v2 API changed incompatibly; pdfjs-dist is already in use |
| SheetJS for Excel | ExcelJS | Phase 1 decision | SheetJS CE cannot write cell styles; CVE-2023-30533 |
| Static holiday list | chinese-days package | Phase 1 decision | Static lists go stale; package covers adjusted makeup Saturdays |
| 30-day month subtraction | date-fns subMonths() | Phase 1 decision | 30-day subtraction gives wrong dates for end-of-month PO走货期 values |

**Deprecated/outdated:**
- `pdf-parse` v2: installed but unusable (API changed; `.load()` requires URL not Buffer); do not use
- Column-index constants for Excel: must use header-name lookup because Dongguan and Indonesia have different column positions

---

## Open Questions

1. **QC Instructions extraction from PDF**
   - What we know: `POData` type doesn't include `qcInstructions`; the 箱唛资料 generation rule requires it
   - What's unclear: Exactly where in the PDF text stream the QC instructions appear (after line items? on a specific page?); whether it's labeled or free-form text
   - Recommendation: Add `qcInstructions: string` to `POData`, add extraction in `pdfExtractor.ts` using label-anchored regex. The Phase 2 PDF text stream inspection found the item block followed by PO remarks — inspect a real PO with QC instructions text to determine the label.

2. **Country name completeness**
   - What we know: Phase 2 found Belgium, UK, USA, Australia, Indonesia, China in the real schedule files
   - What's unclear: Whether POs from other destination countries appear in the real workload; what happens for unmapped countries
   - Recommendation: Build the mapping table with known values; fall back to returning the English name for unmapped countries; log a warning so the table can be extended.

3. **총箱数 comparison (COMP-10)**
   - What we know: 总箱数 is NOT in the PDF (confirmed by Phase 2 research); it's a formula column in the schedule
   - What's unclear: The requirements list COMP-10 as required — does the user want a visual indicator that this field was "not checked" on the output?
   - Recommendation: Skip the comparison (no red highlight possible); optionally add a note in the status column listing which fields were checked vs. skipped. Document this behavior clearly.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npx vitest run server/lib/reconciler.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMP-01 | Match POItem to ScheduleRow by tomyPO+货号 composite key | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-02 | Country name mapping EN→ZH for 接单期国家 comparison | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-03 | Text comparison 第三客户名称 with normalize() | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-04 | Text comparison 客跟单 with normalize() | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-05 | Text comparison TOMY PO | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-06 | Text comparison CUSTOMER PO | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-07 | Text comparison 货号 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-08 | Numeric comparison 数量 | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-09 | Numeric comparison 外箱 (null=skip) | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-10 | 总箱数 not in PDF — comparison skipped | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-11 | Date comparison PO走货期 by year/month/day | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-12 | 箱唛资料 generation rules + comparison | unit | `npx vitest run server/lib/reconciler.test.ts` | ❌ Wave 0 |
| COMP-13 | Red fill + note on mismatched cells in output Excel | unit | `npx vitest run server/lib/excelWriter.test.ts` | ❌ Wave 0 |
| COMP-14 | Unmatched PO items appended with yellow background | unit | `npx vitest run server/lib/excelWriter.test.ts` | ❌ Wave 0 |
| DATE-01 | Date code format monthLetter+day+2yr+factoryCode | unit | `npx vitest run server/lib/dateCodeGenerator.test.ts` | ❌ Wave 0 |
| DATE-02 | Month letters A=Jan through L=Dec | unit | `npx vitest run server/lib/dateCodeGenerator.test.ts` | ❌ Wave 0 |
| DATE-03 | subMonths(1) with end-of-month clamping | unit | `npx vitest run server/lib/dateCodeGenerator.test.ts` | ❌ Wave 0 |
| DATE-04 | Workday rollback — Spring Festival + National Day edge cases | unit | `npx vitest run server/lib/dateCodeGenerator.test.ts` | ❌ Wave 0 |
| DATE-05 | Date code written to 日期码 column only if empty | unit | `npx vitest run server/lib/excelWriter.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run server/lib/reconciler.test.ts server/lib/dateCodeGenerator.test.ts server/lib/excelWriter.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `server/lib/reconciler.test.ts` — covers COMP-01 through COMP-12
- [ ] `server/lib/dateCodeGenerator.test.ts` — covers DATE-01 through DATE-05
- [ ] `server/lib/excelWriter.test.ts` — covers COMP-13, COMP-14, DATE-05

No new framework install needed — Vitest 4.1.0 already configured and running.

---

## Sources

### Primary (HIGH confidence)

- Direct code inspection: `server/lib/normalize.ts`, `server/lib/excelParser.ts`, `server/lib/pdfExtractor.ts`, `server/types/index.ts` — confirmed existing types and patterns
- Live API testing: `chinese-days` 1.5.7 — confirmed `isWorkday()`, `findWorkday()` behavior including Spring Festival makeup Saturday (Feb 14, 2026) and National Day (Oct 1, 2026)
- Live API testing: `date-fns` 4.1.0 `subMonths()` — confirmed end-of-month clamping (Mar 31 → Feb 28)
- Live API testing: ExcelJS 4.4.0 — confirmed `cell.fill`, `cell.note`, `ws.columnCount`, round-trip buffer load/write
- Phase 2 RESEARCH.md — confirmed 总箱数 not present in PDF; confirmed country mapping requirement; confirmed field-to-type mapping

### Secondary (MEDIUM confidence)

- Phase 2 PDF layout documentation — field positions and label names verified during Phase 2 against 8 real PO files

### Tertiary (LOW confidence)

- None required — all findings verifiable from existing codebase and live testing

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and verified working
- Architecture: HIGH — reconciler/writer/generator pattern derived from existing types; ExcelJS/chinese-days APIs verified live
- Pitfalls: HIGH — 总箱数 gap confirmed from Phase 2 research; chinese-days import mode confirmed by testing; findWorkday semantics confirmed by testing
- Country mapping: MEDIUM — known values from Phase 2 real file inspection; completeness unknown

**Research date:** 2026-03-21
**Valid until:** 2026-09-21 (6 months — chinese-days covers 2026; stable libraries)
