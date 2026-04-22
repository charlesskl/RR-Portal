# Phase 2: File Parsing - Research

**Researched:** 2026-03-20
**Domain:** PDF text extraction (pdfjs-dist), Excel parsing (ExcelJS), file upload (multer), per-file status feedback
**Confidence:** HIGH — all findings from direct inspection of the 8 real PO PDFs and 2 real Excel schedule files

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FILE-01 | User can upload multiple PDF PO files in one session | multer already configured with `upload.fields([{ name: 'pos', maxCount: 20 }])` in Phase 1 stub |
| FILE-02 | System extracts text data from PDF POs (text-selectable PDFs) | pdfjs-dist legacy build confirmed working; label-anchored regex strategy derived from actual PDF text layout |
| FILE-03 | User can upload existing Excel scheduling template | multer `schedule` field slot already defined; ExcelJS `xlsx.readFile` path confirmed |
| FILE-04 | System reads and parses Excel template preserving structure | ExcelJS confirmed reading all sheets; column positions mapped from real files; date cells require `.value` conversion from Date objects |
| FILE-05 | User sees processing progress and status feedback during parsing | SSE or per-file response JSON; React state for parsing/done/error per filename |
</phase_requirements>

---

## Summary

All 8 PO PDFs are multi-page text-selectable documents. They share an identical layout: a standard header block on every page followed by line-item rows. The critical fields for extraction are all in the header block on page 1 and in the per-item rows. The PDF text stream, as returned by pdfjs-dist, concatenates label and value with a blank line between them (e.g., `"Purchase Order No\n \n: 10114426"`). Label-anchored regex against this raw string is the correct strategy.

The Excel schedules have two relevant sheet types. The `总排期` (main schedule) sheet is the sheet to parse for comparison in Phase 3 — its header is row 1 with no merged cells, and column positions are fixed but differ slightly between the Dongguan and Indonesia files. ExcelJS date cells return JavaScript Date objects serialised as ISO strings when `.value` is stringified; the parser must handle this. Several many-to-one `[object Object]` values in the output indicate ExcelJS formula result caching; these columns (金额USD, 金额HKD, 外箱, 总箱数, 数量 in some rows) store formula cells whose `.value` is a `{ formula, result }` object — the parser must extract `.value.result`.

**Primary recommendation:** Use pdfjs-dist legacy build with label-anchored regex for PDF extraction. Use ExcelJS reading `总排期` sheet, row 1 as header, handling formula cells and Date objects. Wire per-file status via a JSON array in the POST response (processing each file sequentially, reporting status per filename).

---

## Actual File Structures (CRITICAL)

### PDF Layout — Verified from All 8 PO Files

All 8 PDFs follow an identical layout. Two PDF sub-types exist:

**Sub-type A: "PURCHASE ORDER"** (files: 10114426, 10114976, 10115937, 10122737, 10122742)
**Sub-type B: "SUBSEQUENT ORDER"** (files: 10122817, 10122821, 10122824)

Both sub-types have the same header block and field labels. The only structural difference is the document title string.

**Header block fields (page 1, every page repeats the header):**

```
Purchase Order No   : 10114426
Purchase Order Date : 04 Nov 2025
Customer ID         : TIUK
Handle By           : Yan, Nancy
Customer PO No      : 4500031933
```

**Per-item block (one block per SKU line):**
```
47280A        ← Part No. (货号)
00-RR
18 Mar 2026   ← Due Date (PO走货期)
525           ← Quantity (数量)
EA

Cust Part No.: 47280A
RR01          ← Purchase Point / factory code (RR01=东莞, RR02=印尼)
JD JOHNNY TRACTOR RIDE ON
Port of Loading: YANTIAN, CHINA / SEMARANG
1 EA / MASTER CARTON  ← packing (外箱)
```

**Purchase Point table (last page, gives factory name and code):**
```
RR01  DONGGUAN HANSON PLASTIC PRODUCT LTD  [address]
RR02  PT ROYAL REGENT INDONESIA            [address]
```

**Shipment Info block (page 2 typically):**
```
Customer Name:      TOMY UK CO LTD    ← 第三客户名称
```

**Key mapping — PDF fields to the 11 required extraction targets:**

| Required Field | Source in PDF | Example |
|----------------|---------------|---------|
| 接单期国家 | Not directly present; derived from "Port of Discharge / Destination Country" or mapped from Customer ID | BELGIUM, USA, CHINA, INDONESIA |
| 第三客户名称 | `Customer Name:` in Shipment Info block | TOMY UK CO LTD |
| 客跟单 | `Handle By :` | Yan, Nancy |
| TOMY PO | `Purchase Order No : ` | 10114426 |
| CUSTOMER PO | `Customer PO No : ` | 4500031933 |
| 货号 | First token in Part No. line (before `00-RR`) | 47280A, T72465ML3, E73856 |
| 数量 | Number on line after Part No. and date | 525 |
| 外箱 | `N EA / MASTER CARTON` or `N SET / MASTER CARTON` | 1, 4, 6 |
| 总箱数 | NOT present in PDF — must be calculated or matched from schedule | (see note below) |
| PO走货期 | Due Date in item block | 18 Mar 2026 |
| 箱唛资料 | NOT present in PDF — present only in schedule | (see note below) |

**IMPORTANT NOTE — fields not in PDF:** `总箱数` (total carton count) and `箱唛资料` (shipping mark data) do not appear in the PO PDF text. These fields exist only in the Excel schedule. For Phase 2, the extractor should mark these as `null` from the PDF side; comparison will be one-sided (schedule value vs. null from PDF).

**IMPORTANT NOTE — 接单期国家:** The PDF does not contain a "接单期国家" field label. What it contains is `Port of Discharge / Destination Country: BELGIUM`. The Excel schedule's column 3 is `国家` with Chinese country names (比利时, 美国, 澳大利亚, etc). This will require a country-name normalisation mapping (English→Chinese or comparison by code) in Phase 3. For Phase 2, extract the destination country string from the PDF as-is.

**IMPORTANT NOTE — multi-item POs:** PO 10114976 has 2 SKUs, PO 10122821 has at least 2 SKUs. The PO file may contain multiple line items with different due dates and quantities. Each line item is a separate row in the schedule. The extractor must return an array of items, not a single flat object.

**PDF text stream quirks (confirmed from actual output):**
- Labels and values are separated by a blank line containing only a space: `"Purchase Order No\n \n: 10114426"`
- The colon is on the value line with a leading space: `": 10114426"`
- Multi-line values (addresses) will appear as separate lines
- Part No. and its revision code (`00-RR`, `02-RR`) are on separate lines
- Factory code (RR01/RR02) appears on its own line inside the item block

### Excel Layout — Verified from Both Schedule Files

Both files have the same sheet names: `名称`, `总接单`, `总排期`, `已走货`, `取消单` (Dongguan also has a `JD` sheet).

**The target sheet is `总排期` (main schedule).**

**Dongguan file (`2026年TOMY东莞排期3-18.xlsx`) — `总排期` sheet:**
- Row count: 42 rows, 39 columns (col A through AM)
- **Merged cells: `A1:G1`** — the first 7 columns share a merged title row? — wait, inspection shows Row 1 has individual column headers starting at col 1. The merge is just a title above the headers.

Actual Row 1 header columns (Dongguan 总排期):
```
Col 1:  接单期
Col 2:  提交化学测试
Col 3:  国家
Col 4:  第三客户名称
Col 5:  客跟单
Col 6:  Tomy PO           ← note lowercase 'o' in Tomy
Col 7:  Cust. PO NO.
Col 8:  货号
Col 9:  产品名称
Col 10: 数量
Col 11: 外箱
Col 12: 总箱数
Col 13: PO走货期
Col 14: 验货期
Col 15: 实际验货期
Col 16: Spot check
Col 17: 年报测试
Col 18: 客贴纸
Col 19: 日期码
Col 20: 箱唛资料
Col 21: 箱唛状态
Col 22: 备注
Col 23: 单价USD
Col 24: 金额USD
Col 25: 金额HKD
Col 26: 发票号
Col 27: 出货日期
Col 28: 是否入系统
Col 29: 车间
Col 30: 生产车间
Col 31-37: 下单明细, 送回数量, 欠数, 客箱唛纸箱, 贴纸, SY回复, JD贴纸是否给车间
```

**Indonesia file (`2026年TOMY印尼排期3-18.xlsx`) — `总排期` sheet:**
- Row count: 243 rows, 45 columns
- No merged cells on Row 1

Indonesia Row 1 header columns:
```
Col 1:  接单期
Col 2:  提交化学测试
Col 3:  国家
Col 4:  第三客户名称
Col 5:  客跟单
Col 6:  TOMY PO           ← ALL CAPS in Indonesia file
Col 7:  CUSTOMER PO       ← ALL CAPS in Indonesia file
Col 8:  货号
Col 9:  产品名称
Col 10: 数量
Col 11: 外箱
Col 12: 总箱数
Col 13: PO走货期
Col 14: 验货期
Col 15: 实际验货期
Col 16: 日期码
Col 17: 箱唛资料
Col 18: Spot check
Col 19: 年报测试
Col 20: 客贴纸
Col 21-42: Indonesian-specific columns
```

**CRITICAL DIFFERENCE:** Column positions shift between the two files:
- Dongguan col 19 = 日期码, col 20 = 箱唛资料
- Indonesia col 16 = 日期码, col 17 = 箱唛资料
- Dongguan col 6 = "Tomy PO", col 7 = "Cust. PO NO."
- Indonesia col 6 = "TOMY PO", col 7 = "CUSTOMER PO"

The parser MUST use header-name lookup, not column-index constants. Read row 1 to build a `columnMap: Map<string, number>` then access cells by the mapped index.

**Excel cell type issues (confirmed):**
- Date cells return JavaScript Date serialised as string `"Wed Jan 21 2026 08:00:00 GMT+0800 (中国标准时间)"` when `.toString()` is called. Use `cell.value instanceof Date` check or `cell.type === ExcelJS.ValueType.Date`.
- Formula cells return `{ formula: '...', result: value }` objects. Check `typeof cell.value === 'object' && cell.value !== null && 'result' in cell.value` and extract `.result`.
- Columns 外箱 and 总箱数 frequently appear as `[object Object]` — they are formula cells with numeric results. Must extract `.result`.

---

## Standard Stack

### Core (all already installed per Phase 1)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| pdfjs-dist | 5.5.207 | PDF text extraction | Installed, requires legacy build path on Node.js |
| exceljs | 4.4.0 | Excel read with merge/formula support | Installed |
| multer | 2.1.1 | Multipart file upload handling | Installed, stub already in server/routes/upload.ts |
| express | 5.2.1 | HTTP server | Installed |
| tsx | 4.21.0 | TypeScript execution | Installed |

### pdfjs-dist v5 Node.js Import Pattern (VERIFIED)

pdfjs-dist v5 is ESM-only. The standard build uses `DOMMatrix` which does not exist in Node.js. You must use the legacy build:

```typescript
// server/lib/pdfExtractor.ts
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pathToFileURL } from 'url'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const workerPath = resolve(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
// Windows requires file:// URL — do NOT use raw path strings
```

### pdf-parse v2 Incompatibility (DISCOVERED)

pdf-parse@2.4.5 is installed but its API changed incompatibly from v1:
- No longer exports a default function
- Exports `{ PDFParse }` class
- `new PDFParse({ verbosity: 0 })` constructor exists but `parser.load(buffer)` requires a URL, not a Buffer

**Do not use pdf-parse v2 for this project.** Use pdfjs-dist directly (already installed) with the legacy build pattern above.

---

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)

```
server/
├── index.ts                  # (existing)
├── routes/
│   └── upload.ts             # Expand stub to real handler
├── lib/
│   ├── pdfExtractor.ts       # pdfjs-dist wrapper; returns POData[]
│   ├── excelParser.ts        # ExcelJS wrapper; returns ScheduleRow[]
│   └── normalize.ts          # String normalization utilities
└── types/
    └── index.ts              # POData, ScheduleRow, ExtractionResult interfaces

client/src/
├── components/
│   ├── UploadForm.tsx         # (expand from Phase 1 stub)
│   └── FileStatusList.tsx    # Per-file status badges
└── types/
    └── index.ts              # Frontend types
```

### Pattern 1: Label-Anchored Regex for PDF Extraction

```typescript
// server/lib/pdfExtractor.ts
// Source: derived from direct inspection of 8 real PO PDFs

function extractField(text: string, label: string): string | null {
  // Pattern: "LabelText\n \n: value" or "LabelText\n \n: value\nNextLine"
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`${escaped}\\s*:\\s*([^\\n]+)`)
  const match = text.match(regex)
  return match ? match[1].trim() : null
}

// Usage:
const tomyPO = extractField(text, 'Purchase Order No')        // "10114426"
const customerPO = extractField(text, 'Customer PO No')       // "4500031933"
const handleBy = extractField(text, 'Handle By')              // "Yan, Nancy"
const customerName = extractField(text, 'Customer Name')      // "TOMY UK CO LTD"
```

### Pattern 2: Multi-Item Extraction from PDF

Each PO may have multiple line items. Each item block starts with a Part No. line.
The item structure in the text stream:

```
47280A\n \n00-RR\n \n18 Mar 2026\n \n525\n \nEA\n \n11.2760\n \n5,919.90
```

Regex to find all item blocks:

```typescript
// Extract all items from a PO
function extractItems(text: string): POItem[] {
  // Part numbers follow the column header block
  // Item line pattern: PART_NO \n 00-RR or 02-RR \n DATE \n QUANTITY
  const itemPattern = /^([A-Z][A-Z0-9]+[A-Z0-9]*)\s*\n\s*\d{2}-RR\s*\n\s*(\d+ \w+ \d{4})\s*\n\s*([\d,]+)\s*\nEA/gm
  const items: POItem[] = []
  let match
  while ((match = itemPattern.exec(text)) !== null) {
    items.push({
      货号: match[1],
      PO走货期: match[2],
      数量: parseInt(match[3].replace(/,/g, ''), 10),
    })
  }
  return items
}
```

### Pattern 3: Per-Item Factory Code Extraction

Factory code (RR01/RR02) appears in the item block on its own line after the product description:

```typescript
// Find factory code adjacent to each item block
// RR01 is followed by product name (东莞), RR02 is followed by product name (印尼)
const factoryCodePattern = /\n(RR0[12])\n/g
```

### Pattern 4: ExcelJS Header-Based Column Mapping

```typescript
// server/lib/excelParser.ts
import ExcelJS from 'exceljs'

interface ScheduleRow {
  接单期: Date | null
  国家: string | null
  第三客户名称: string | null
  客跟单: string | null
  tomyPO: string | null       // "Tomy PO" or "TOMY PO"
  customerPO: string | null   // "Cust. PO NO." or "CUSTOMER PO"
  货号: string | null
  数量: number | null
  外箱: number | null
  总箱数: number | null
  PO走货期: Date | null
  日期码: string | null
  箱唛资料: string | null
  rowIndex: number
}

function buildColumnMap(headerRow: ExcelJS.Row): Map<string, number> {
  const map = new Map<string, number>()
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = String(cell.value ?? '').trim()
    if (key) map.set(key, colNumber)
  })
  return map
}

function getCellValue(row: ExcelJS.Row, colIndex: number | undefined): unknown {
  if (colIndex === undefined) return null
  const cell = row.getCell(colIndex)
  const v = cell.value
  // Formula cell: { formula, result }
  if (v !== null && typeof v === 'object' && 'result' in (v as object)) {
    return (v as { result: unknown }).result
  }
  return v
}

// Column name aliases for cross-file compatibility
const COLUMN_ALIASES: Record<string, string[]> = {
  tomyPO: ['Tomy PO', 'TOMY PO'],
  customerPO: ['Cust. PO NO.', 'CUSTOMER PO'],
}
```

### Pattern 5: Per-File Status Response

Since multer processes all files before the handler runs, implement per-file status as a JSON response:

```typescript
// POST /api/process response shape
interface ProcessResponse {
  files: FileResult[]
  schedule: ScheduleResult
}

interface FileResult {
  filename: string
  status: 'done' | 'error'
  items: POItem[]         // empty on error
  error?: string
}
```

Frontend updates status badges as each `files[n]` entry is read from the response. For real-time feedback during processing, an SSE endpoint is an option but adds complexity — a single JSON response at completion is simpler and sufficient for the ~1-5 file batch sizes expected.

### Anti-Patterns to Avoid

- **Using column index constants:** Both Excel files have different column positions. Never hardcode `worksheet.getCell('F2')` — always derive column from header name lookup.
- **Calling `cell.toString()`:** Returns `"[object Object]"` for formula cells and `"Wed Jan 21..."` for dates. Use `cell.value` and handle each type explicitly.
- **Parsing all PDF pages for header fields:** The header block repeats on every page (it's the page header). Extract from page 1 only, or deduplicate by checking if Purchase Order No is already extracted.
- **Assuming one item per PO:** Several POs have 2+ SKUs with different due dates. Always return an array.
- **Using `pdf-parse` v2:** Its API is broken for Buffer inputs in this environment. Use pdfjs-dist directly.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF text extraction | Custom PDF binary parser | pdfjs-dist (already installed) | PDF spec is complex; pdfjs-dist handles encoding, CMap, ToUnicode tables |
| Excel read with formulas | Manual xlsx binary parse | ExcelJS | Shared string table, formula result caching, date serial number conversion |
| Multipart upload | Raw body parsing | multer (already installed) | Handles `multipart/form-data` boundaries, memory vs disk storage, per-field size limits |
| String normalization | Ad-hoc `.trim()` | Dedicated `normalize()` utility (see STATE.md decision) | Full-width digits, non-breaking spaces, trailing whitespace cause false mismatches |

---

## Common Pitfalls

### Pitfall 1: pdfjs-dist v5 DOMMatrix Error
**What goes wrong:** `ReferenceError: DOMMatrix is not defined` at startup
**Why it happens:** The standard `pdfjs-dist/build/pdf.mjs` requires browser globals
**How to avoid:** Always import from `pdfjs-dist/legacy/build/pdf.mjs`
**Warning signs:** Error occurs at import time, not at parse time

### Pitfall 2: GlobalWorkerOptions.workerSrc on Windows
**What goes wrong:** `"Only URLs with a scheme in: file, data, and node are supported"`
**Why it happens:** Node.js ESM loader rejects Windows absolute paths like `D:\...`
**How to avoid:** Always use `pathToFileURL(workerPath).href` to convert the path to `file:///D:/...`
**Warning signs:** Error message mentions "protocol 'd:'"

### Pitfall 3: ExcelJS Formula Cells Return Objects
**What goes wrong:** 外箱, 总箱数, 数量 display as `"[object Object]"` or are `NaN` after `parseInt`
**Why it happens:** ExcelJS returns `{ formula: '=SUM(...)', result: 750 }` for formula cells
**How to avoid:** Unwrap result: `if (typeof v === 'object' && v !== null && 'result' in v) return v.result`
**Warning signs:** Column values that should be numbers appearing as objects in console

### Pitfall 4: ExcelJS Date Cells Serialise Badly
**What goes wrong:** Dates appear as `"Wed Jan 21 2026 08:00:00 GMT+0800 (中国标准时间)"` string
**Why it happens:** `cell.value` is a Date object; calling `.toString()` gives the locale string
**How to avoid:** Check `cell.value instanceof Date` and use `date-fns` for formatting; or use `cell.value.toISOString().split('T')[0]`
**Warning signs:** Date strings in the timezone format rather than `YYYY-MM-DD`

### Pitfall 5: PDF Header Block Repeats on Every Page
**What goes wrong:** Extracting Purchase Order No from all pages gives duplicate results
**Why it happens:** The header (with PO number, customer, etc.) prints on every page
**How to avoid:** Only extract header fields from page 1, or extract once and stop when the field is found
**Warning signs:** Duplicate PO numbers or `Handle By` values in extracted output

### Pitfall 6: Multi-Item POs and the Due Date Problem
**What goes wrong:** A PO with 3 items and 3 different due dates — which due date is the 走货期?
**Why it happens:** PO 10114426 has items with due dates 28 Jan, 18 Mar, 21 Jan, 4 Mar
**How to avoid:** Return all items as an array. Phase 3 matches by both TOMY PO + 货号 + due date tuple, not by PO alone.
**Warning signs:** Schedule has one row per item/date combination (confirmed: schedule has multiple rows per PO number)

### Pitfall 7: Column Header Spelling Differs Between Files
**What goes wrong:** Column lookup for `TOMY PO` fails on Dongguan file which uses `Tomy PO`
**Why it happens:** Indonesia file uses ALL CAPS, Dongguan uses mixed case
**How to avoid:** Build an alias map; try all known spellings. Or normalise both the header cell value and the lookup key to lowercase.
**Warning signs:** `columnMap.get('TOMY PO')` returns undefined for Dongguan file

### Pitfall 8: 接单期国家 Country Name Mismatch
**What goes wrong:** PDF says "BELGIUM", schedule says "比利时"
**Why it happens:** PDF has English destination country; schedule has Chinese country name
**How to avoid:** In Phase 2, extract raw destination country from PDF. Do NOT attempt translation in Phase 2. Document this as a Phase 3 concern.
**Warning signs:** All country comparisons fail when comparing PDF value vs schedule value

---

## Code Examples

### pdfjs-dist Setup (Verified Working)

```typescript
// server/lib/pdfExtractor.ts
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pathToFileURL, fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const workerSrc = pathToFileURL(
  resolve(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
).href
GlobalWorkerOptions.workerSrc = workerSrc

export async function extractPDFText(buffer: Buffer): Promise<string> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    // Suppress missing standardFontDataUrl warnings:
    standardFontDataUrl: resolve(
      __dirname, '../../node_modules/pdfjs-dist/standard_fonts/'
    ) + '/',
  })
  const pdf = await loadingTask.promise
  let text = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    text += content.items
      .map(item => ('str' in item ? item.str : ''))
      .join('\n') + '\n'
  }
  return text
}
```

### ExcelJS Sheet Parser (Verified Working)

```typescript
// server/lib/excelParser.ts
import ExcelJS from 'exceljs'

function unwrapCellValue(raw: ExcelJS.CellValue): unknown {
  if (raw === null || raw === undefined) return null
  // Formula cell
  if (typeof raw === 'object' && 'result' in (raw as object)) {
    return (raw as { result: unknown }).result
  }
  return raw
}

export async function parseScheduleExcel(buffer: Buffer): Promise<ScheduleRow[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const ws = workbook.getWorksheet('总排期')
  if (!ws) throw new Error('Sheet 总排期 not found')

  // Build column map from row 1
  const headerRow = ws.getRow(1)
  const colMap = new Map<string, number>()
  headerRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
    colMap.set(String(cell.value ?? '').trim(), colNum)
  })

  // Resolve column with aliases
  function col(names: string[]): number | undefined {
    for (const name of names) {
      const idx = colMap.get(name)
      if (idx !== undefined) return idx
    }
    return undefined
  }

  const rows: ScheduleRow[] = []
  ws.eachRow({ includeEmpty: false }, (row, rowIdx) => {
    if (rowIdx === 1) return // skip header
    const get = (names: string[]) => unwrapCellValue(row.getCell(col(names) ?? 0).value)
    rows.push({
      rowIndex: rowIdx,
      接单期: get(['接单期']) instanceof Date ? get(['接单期']) as Date : null,
      国家: get(['国家']) as string | null,
      第三客户名称: get(['第三客户名称']) as string | null,
      客跟单: get(['客跟单']) as string | null,
      tomyPO: String(get(['Tomy PO', 'TOMY PO']) ?? '').trim() || null,
      customerPO: String(get(['Cust. PO NO.', 'CUSTOMER PO']) ?? '').trim() || null,
      货号: String(get(['货号']) ?? '').trim() || null,
      数量: Number(get(['数量'])) || null,
      外箱: Number(get(['外箱'])) || null,
      总箱数: Number(get(['总箱数'])) || null,
      PO走货期: get(['PO走货期']) instanceof Date ? get(['PO走货期']) as Date : null,
      日期码: String(get(['日期码']) ?? '').trim() || null,
      箱唛资料: String(get(['箱唛资料']) ?? '').trim() || null,
    })
  })
  return rows
}
```

### Regex Patterns for PDF Field Extraction

Based on the actual text stream format `"FieldLabel\n \n: value"`:

```typescript
// server/lib/pdfExtractor.ts — field extraction patterns

// Header fields (page 1, repeats every page — only read page 1)
const FIELD_PATTERNS = {
  tomyPO:       /Purchase Order No\s*:\s*(\d+)/,
  customerPO:   /Customer PO No\s*:\s*(\S+)/,
  handleBy:     /Handle By\s*:\s*([^\n(]+)/,
  customerName: /Customer Name:\s*\n?\s*([^\n]+)/,
  destCountry:  /Port of Discharge \/ Destination Country:\s*\n?\s*([^\n]+)/,
}

// Item pattern — Part No. appears before "00-RR" or "02-RR"
// Format: "PARTNO\n \n00-RR\n \nDD Mon YYYY\n \nNNNN\n \nEA"
const ITEM_PATTERN =
  /^([A-Z][A-Z0-9]+(?:[A-Z0-9])*)\s*\n\s*\d{2}-RR\s*\n\s*(\d{1,2} \w+ \d{4})\s*\n\s*([\d,]+)\s*\nEA/gm

// Factory code — appears alone on a line, inside or after the item block
const FACTORY_CODE_PATTERN = /\n(RR0[12])\n/

// Carton qty: "N EA / MASTER CARTON" or "N SET / MASTER CARTON"
const CARTON_PATTERN = /(\d+) (?:EA|SET|PC) \/ MASTER CARTON/
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| pdf-parse v1 (default function) | pdf-parse v2 changed API; use pdfjs-dist directly | pdf-parse v2 is installed but unusable for Buffer input; pdfjs-dist is the real engine anyway |
| pdfjs-dist standard build on Node | pdfjs-dist legacy build on Node | Standard build requires DOMMatrix browser global — always use legacy |
| ExcelJS column access by letter `ws.getCell('F2')` | Header-name map + `row.getCell(colIndex)` | Column positions differ between Dongguan and Indonesia files |

---

## Open Questions

1. **外箱 (carton packing) extraction reliability**
   - What we know: `"1 EA / MASTER CARTON"` appears in the PDF item block
   - What's unclear: Is this always the correct 外箱 value, or does the schedule sometimes override it?
   - Recommendation: Extract from PDF as the per-unit carton count. Flag if the schedule value differs. Phase 3 handles the comparison.

2. **接单期国家 translation strategy**
   - What we know: PDF has English country name; schedule has Chinese
   - What's unclear: Is a static English→Chinese mapping sufficient, or are there edge cases (e.g., "UK" vs "UNITED KINGDOM")?
   - Recommendation: Defer to Phase 3. For Phase 2, extract and store both as strings. Build the translation map in Phase 3 based on all country values seen in the real files.

3. **Multi-item PO matching key**
   - What we know: PO 10114426 appears 3+ times in the Dongguan 总排期 with different quantities and dates
   - What's unclear: Is the match key TOMY PO + 货号 + PO走货期 (three-part key), or just TOMY PO + 货号?
   - Recommendation: Phase 3 concern. For Phase 2, extract all (TOMY PO, 货号, 走货期, qty) tuples from PDF. Schedule parser already returns one row per (PO, 货号, 走货期) combination.

4. **standardFontDataUrl warning suppression**
   - What we know: pdfjs-dist emits `"Ensure that the standardFontDataUrl API parameter is provided"` warnings during extraction
   - What's unclear: Whether this affects text quality for CJK characters in PDF comments
   - Recommendation: Pass `standardFontDataUrl` pointing to the installed fonts directory to suppress warnings. The sample PDFs are English-only in their structured fields so font quality is not critical for extraction.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `vitest.config.ts` (exists at project root) |
| Quick run command | `npx vitest run server/lib` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FILE-02 | Extract TOMY PO "10114426" from real PDF buffer | unit | `npx vitest run server/lib/pdfExtractor.test.ts -x` | Wave 0 |
| FILE-02 | Extract all 11 fields from at least 2 structurally different PDFs | unit | `npx vitest run server/lib/pdfExtractor.test.ts -x` | Wave 0 |
| FILE-02 | Multi-item PO returns array with correct item count | unit | `npx vitest run server/lib/pdfExtractor.test.ts -x` | Wave 0 |
| FILE-04 | Parse Dongguan schedule: header map builds with correct column indices | unit | `npx vitest run server/lib/excelParser.test.ts -x` | Wave 0 |
| FILE-04 | Parse Indonesia schedule: header map builds (different column positions) | unit | `npx vitest run server/lib/excelParser.test.ts -x` | Wave 0 |
| FILE-04 | Formula cell values extracted as numbers, not objects | unit | `npx vitest run server/lib/excelParser.test.ts -x` | Wave 0 |
| FILE-04 | Date cells extracted as Date objects or ISO strings, not locale strings | unit | `npx vitest run server/lib/excelParser.test.ts -x` | Wave 0 |
| FILE-01 | Upload endpoint accepts multiple PDF files without error | integration | `npx vitest run server/routes/upload.test.ts -x` | Wave 0 |
| FILE-03 | Upload endpoint accepts Excel file without error | integration | `npx vitest run server/routes/upload.test.ts -x` | Wave 0 |
| FILE-05 | Response JSON includes status field per file | integration | `npx vitest run server/routes/upload.test.ts -x` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run server/lib`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `server/lib/pdfExtractor.test.ts` — covers FILE-02 (use real PDF fixtures from project root)
- [ ] `server/lib/excelParser.test.ts` — covers FILE-04 (use real Excel fixtures from project root)
- [ ] `server/routes/upload.test.ts` — covers FILE-01, FILE-03, FILE-05 (integration test with multer)
- [ ] `server/lib/pdfExtractor.ts` — new file, does not exist yet
- [ ] `server/lib/excelParser.ts` — new file, does not exist yet
- [ ] `server/types/index.ts` — POData, ScheduleRow, etc. type definitions

---

## Sources

### Primary (HIGH confidence)

- Direct text extraction from 8 real PO PDF files using pdfjs-dist — inspected 2026-03-20
- Direct ExcelJS parsing of `2026年TOMY东莞排期3-18.xlsx` and `2026年TOMY印尼排期3-18.xlsx` — inspected 2026-03-20
- `node_modules/pdfjs-dist/legacy/build/` — confirmed directory structure and worker file location
- `node_modules/pdfjs-dist/package.json` — version 5.5.207, ESM-only build confirmed
- `server/routes/upload.ts` — existing multer configuration inspected
- `package.json` — all library versions confirmed as installed

### Secondary (MEDIUM confidence)

- pdfjs-dist Node.js usage patterns — inferred from error messages and working test script

### Tertiary (LOW confidence)

- None

---

## Metadata

**Confidence breakdown:**
- PDF structure: HIGH — confirmed by running pdfjs-dist against all 8 real files
- Excel structure: HIGH — confirmed by running ExcelJS against both real files
- pdfjs-dist API: HIGH — confirmed by working script (legacy build + pathToFileURL)
- pdf-parse v2 API: HIGH (confirmed broken for Buffer use case)
- Regex patterns: MEDIUM — derived from observed text layout; edge cases possible

**Research date:** 2026-03-20
**Valid until:** These findings are tied to the specific PDF and Excel files in the project root. If the PO template changes, re-inspect. The library API findings are valid until pdfjs-dist v6 or ExcelJS v5 release.
