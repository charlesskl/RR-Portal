# Pitfalls Research

**Domain:** PDF parsing + Excel data reconciliation web application
**Researched:** 2026-03-20
**Confidence:** HIGH (critical pitfalls verified via official library docs and GitHub issues; domain patterns verified via multiple sources)

---

## Critical Pitfalls

### Pitfall 1: PDF Text Extraction Destroys Table Structure

**What goes wrong:**
Simple PDF text extraction (pdf-parse, naive pdfjs usage) reads PDF content in document stream order, not visual row/column order. A table with columns [TOMY PO | CUSTOMER PO | QTY | 货号] may come out as all column 1 values, then all column 2 values — or as a single flat string with no column boundaries. Field values get silently mapped to the wrong fields with no error thrown.

**Why it happens:**
PDF format stores text as positioned glyphs, not as a semantic table. The "table" is a visual illusion created by x/y coordinates. Text extractors that iterate the content stream top-to-bottom within a page do not reconstruct rows. Multi-column PO layouts are especially prone: the parser reads the left column of page 1 entirely before starting the right column.

**How to avoid:**
Use pdfjs-dist (not pdf-parse) and extract text items with their x/y coordinates. Group items into rows by y-coordinate proximity (within a tolerance of ±3–5pt), then sort each row's items by x-coordinate to reconstruct column order. Build field extraction on coordinate-aware row reconstruction, not on raw text string parsing. Validate extraction against known-good PO samples before shipping.

**Warning signs:**
- Extracted "TOMY PO" value matches what should be the "货号" value
- Field values are correct individually but consistently off by one column
- Parsing works on one PO template but fails on another
- Numeric quantities appear in text fields

**Phase to address:** Phase 1 — PDF Parsing Foundation. Must be solved before any reconciliation logic is written on top of it.

---

### Pitfall 2: SheetJS Community Edition Strips Excel Styles on Write

**What goes wrong:**
Reading the排期Excel template with SheetJS then writing it back destroys all cell formatting: column widths, font colors, borders, number formats, merged cells styling, and background colors. The "标红高亮" (red highlight) functionality requires writing style information back into Excel cells. If using SheetJS Community Edition, `.s` (style) properties are read but silently dropped on write. The output file looks like a blank-format CSV in xlsx clothing.

**Why it happens:**
SheetJS Community Edition intentionally omits style write support. This is documented and a longstanding architectural decision. The `.s` property exists in the cell object model but `xlsx.writeFile()` does not serialize it. This has been the case since at least 2014 (GitHub issue #128) and remains true as of 2026.

**How to avoid:**
Use ExcelJS instead of SheetJS for this project. ExcelJS preserves themes, styles, merged cells, and formulas on roundtrip, and supports writing cell fill colors (required for the red-highlight feature). Install with `npm install exceljs`. ExcelJS has an explicit `.fill` property on cells: `cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }`.

**Warning signs:**
- Output Excel file has no formatting when opened in Excel
- Merged header cells have collapsed
- Conditional red highlights are not visible
- Original column widths reset to default

**Phase to address:** Phase 1 — Excel Template Handling. The library choice must be locked in at the start; switching from SheetJS to ExcelJS mid-project requires rewriting all read/write code.

---

### Pitfall 3: Chinese Holiday Calendar Not Maintained — Date Codes Go Wrong

**What goes wrong:**
The date code calculation (走货期 minus 1 month, rolled back to nearest working day) requires knowing Chinese public holidays, including adjusted Saturday working days (补班). A naive implementation that only skips weekends produces wrong date codes when the computed date falls on a Chinese statutory holiday. Worse, China announces adjusted working Saturdays (normally weekends that become workdays) each year — a static holiday list from 2024 gives wrong answers in 2026.

**Why it happens:**
Chinese holidays include: National Day Golden Week (7 days), Spring Festival Golden Week (7 days), Labor Day (3–5 days), and several single-day holidays. Additionally, the government adjusts adjacent Saturdays to compensate — these Saturdays become working days. Any static list embedded in code is outdated by next year. International holiday libraries (date-holidays) cover China incompletely and miss adjusted working Saturdays.

**How to avoid:**
Use the `holiday-calendar` npm package (specifically designed for China statutory holidays and adjusted working Saturdays, sourced from official government announcements). Alternatively, use the `@holiday-cn/core` package or a dedicated Chinese holiday API (e.g., jiejiariapi.com). Never hardcode holiday lists. Add a clear comment noting the package must be updated or the API key renewed annually. Test date code calculation against known shipping dates that fall near Chinese New Year and National Day.

**Warning signs:**
- Date code calculation does not account for Spring Festival (usually January–February)
- Tests only use weekend cases, not holiday cases
- Date code tests pass in January but produce wrong codes when run against October shipping dates
- No mechanism to update the holiday list after deployment

**Phase to address:** Phase 2 — Date Code Generation. Resolve the holiday data source before implementing the rollback algorithm.

---

### Pitfall 4: PO Field Extraction Breaks When Template Version Changes

**What goes wrong:**
The extraction logic hardcodes field positions: "PO Number is always in row 3, column 2" or "CUSTOMER PO label is always at y=145pt." When TOMY's PDF generator changes layout (even slightly — different margin, font size, added row), the extractor silently maps all fields incorrectly. All reconciliation results are wrong, but no error is thrown. This is the hardest failure mode to detect in production.

**Why it happens:**
PDF content layout is controlled by the generating application (ERP/SAP on TOMY's side). Any system update on their end can shift content positions by a few points. Coordinate-based extraction with hardcoded thresholds breaks silently on layout drift.

**How to avoid:**
Use label-anchored extraction: find the text label first ("TOMY PO:", "CUSTOMER PO:", "货号:"), then extract the value adjacent to it (right of, or below, the label). This tolerates position drift as long as the labels remain consistent. Additionally, validate extracted fields against known patterns: TOMY PO should match `\d{8}`, factory code should be `RR01` or `RR02`, quantities should be numeric. Validation failures should surface as warnings, not silently corrupt data.

**Warning signs:**
- PO numbers appear to be 8-digit numbers but reconciliation finds no match in the排期表
- Factory code extracted as empty or garbled
- One PO file works correctly but another from the same batch fails
- Quantities are zero or extremely large numbers

**Phase to address:** Phase 1 — PDF Parsing Foundation. Label-anchored extraction with validation must be designed in from the start.

---

### Pitfall 5: String Comparison Fails on Invisible Character Differences

**What goes wrong:**
The reconciliation marks a field as "不一致" (mismatch) when it is visually identical in both PDF and Excel. The user sees "RR01-10114426" in both cells, but the system flags a mismatch. Root causes: trailing whitespace, non-breaking spaces (U+00A0 vs U+0020), full-width vs half-width characters (Chinese input method artifacts), or invisible zero-width characters embedded by the PDF renderer.

**Why it happens:**
PDF text extraction may pad strings with spaces for visual alignment. Chinese Excel templates often contain full-width digits (１２３ vs 123). Staff may have entered values using a Chinese IME that inserted full-width punctuation. The comparison `"RR01" === "RR０１"` fails silently.

**How to avoid:**
Normalize all field values before comparison: trim whitespace, normalize Unicode (NFC), convert full-width characters to half-width (`String.fromCharCode(char.charCodeAt(0) - 0xFEE0)` for full-width ASCII range), and strip zero-width characters. Apply normalization to both sides (PDF-extracted and Excel-read values) in a shared normalize() utility function used in every comparison. Log both raw and normalized values during development for debugging.

**Warning signs:**
- Fields that look identical in the UI are flagged as mismatches
- `.trim()` applied in one place but not the other
- Numbers compare correctly but text fields frequently false-positive
- Mismatch disappears when you copy-paste the value from one side to the other

**Phase to address:** Phase 2 — Reconciliation Engine. Build the normalize() utility first, before any field comparison logic.

---

### Pitfall 6: Nginx Default 1MB Upload Limit Blocks Real Files

**What goes wrong:**
The Docker deployment uses Nginx as a reverse proxy. Nginx's default `client_max_body_size` is 1MB. Each PDF in this project is ~230KB, and users will upload 8+ PDFs simultaneously plus one Excel file (~230KB). A batch of 8 PDFs = ~1.9MB, which exceeds the default limit. Nginx returns a 413 error. From the browser's perspective, the upload silently fails or shows a confusing network error — not a clear "file too large" message.

**Why it happens:**
Nginx's default is intentionally conservative. The Docker setup has a custom nginx.conf (tracked in git), so the limit must be configured there explicitly. It is easy to test locally without Nginx (no limit hits) and only discover the issue after Docker deployment.

**How to avoid:**
Set `client_max_body_size 50M;` in nginx.conf from the start. Also configure the Node.js/Express body size limit to match: `express.json({ limit: '50mb' })` and multer with appropriate limits. Validate that the configured limit matches in both Nginx and the application layer. Test the upload flow through the full Docker stack (not just `node server.js` directly) before considering the upload feature complete.

**Warning signs:**
- File upload works in local development but fails after Docker deployment
- Browser console shows 413 HTTP status
- The error does not mention file size
- Only fails when uploading multiple files at once

**Phase to address:** Phase 3 — Deployment / Infrastructure. Must be verified as part of Docker deployment validation, not as an afterthought.

---

### Pitfall 7: ExcelJS Merged Cell Writing Corrupts Adjacent Cells

**What goes wrong:**
The排期Excel template uses merged cells for headers and section labels. When writing new data into rows below a merged header with ExcelJS, improperly setting a value on a cell that is inside a merge range throws no error but corrupts the merge — splitting it, or placing the value in the wrong location. The output file opens in Excel with warnings about corrupted content.

**Why it happens:**
In Excel's internal model, a merged cell range stores its value only in the top-left cell. All other cells in the merge are "phantom" cells that must not be written to. ExcelJS represents merges via `worksheet.mergeCells()`, and the merge metadata must be preserved when reading the template. If data-writing code iterates rows and writes to cells by column index without checking whether that cell is inside a merge, it overwrites a phantom cell.

**How to avoid:**
When loading the排期Excel template, preserve merge information (`worksheet.model.merges`). Before writing any value, check if the target cell is inside an active merge. Only ever write to the top-left cell of a merge. Prefer ExcelJS's row/cell API over raw address-based writes when the template has complex merge structures. After initial template-write implementation, open the output in Excel and visually inspect every merged header.

**Warning signs:**
- Excel opens the output file with a repair prompt
- Header rows are visually split or duplicated
- Writing works for the first few rows but corrupts later rows
- The !merges array in SheetJS (or ExcelJS equivalent) is empty when it shouldn't be

**Phase to address:** Phase 2 — Reconciliation Output / Excel Writing. Must be tested with the actual排期 template, not a synthetic test file.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode y-coordinate thresholds for PDF field extraction | Fast initial extraction | Breaks on any PO layout change; silent wrong data | Never — use label-anchored extraction |
| Use SheetJS Community Edition for simplicity | Familiar API, one library | Cannot write cell styles; red-highlight feature is impossible | Never for this project |
| Embed a static 2025 Chinese holiday list | No external dependency | Wrong date codes in 2026 and beyond; no warning | Only for a proof-of-concept demo |
| Store uploaded files in-memory (Buffer) only | Simpler server code | Fails on large batches; no retry on parse error | Acceptable for MVP if file sizes stay under 5MB total |
| Skip field-level validation on extracted PDF data | Faster parsing code | Silent wrong reconciliation results with no indication | Never — validation is the core safety net |
| Compare raw strings without normalization | One fewer utility function | Full-width/half-width and whitespace false-positives | Never — normalization must be foundational |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| pdfjs-dist in browser/Node.js | Import `pdfjs-dist` without setting `workerSrc` or `GlobalWorkerOptions.workerPort` | Always configure the worker: `pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'` for browser; use `pdfjs-dist/build/pdf.worker.entry` for bundlers |
| ExcelJS template load | Use `new Workbook().xlsx.readFile()` on a user-uploaded file (server path) instead of reading from Buffer | For uploaded files in memory, use `workbook.xlsx.load(buffer)` not readFile |
| Chinese holiday APIs | Call a third-party holiday API on every date-code calculation request | Pre-fetch and cache the full year's holiday data at startup; fail gracefully if API is unreachable by falling back to cached data |
| Nginx + Docker file upload | Configure `client_max_body_size` only in the `location /api` block | Set it at the `server` block level to avoid missing new upload routes |
| Multer (Node.js multipart) | Leave default `memoryStorage` with no size limit | Set explicit `limits: { fileSize: 20 * 1024 * 1024 }` to prevent memory exhaustion |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Parsing all PDFs synchronously on the server | Server hangs during upload; browser shows no progress; timeout on 8+ files | Parse PDFs in parallel with `Promise.all()` or a concurrency-limited queue (p-limit) | At 3+ simultaneous PDF uploads (~700KB each) |
| Loading entire Excel workbook into memory for every reconciliation | Memory usage grows with each request; Node.js heap OOM on concurrent users | Reuse workbook instance or stream-write output; release references after response | At 2+ concurrent users with large排期 files |
| Re-parsing the same PDF multiple times in one reconciliation run | CPU spikes; slow response times | Parse each PDF once, cache the extracted fields object in memory for the request lifecycle | Immediately — even one re-parse doubles processing time |
| Blocking the event loop with synchronous ExcelJS operations | Server unresponsive during Excel write | Always use async ExcelJS methods (`await workbook.xlsx.writeBuffer()`) | Under any concurrent load |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Accepting any file type as "PDF" or "Excel" | Malicious file disguised as PDF/Excel processed by parser; path traversal if stored to disk | Validate MIME type AND file magic bytes (PDF starts with `%PDF-`; xlsx is a ZIP with specific structure). Reject anything that fails validation |
| Storing uploaded files to disk using the original filename | Directory traversal attack via crafted filename (`../../etc/passwd`) | Never use user-supplied filename for disk storage; generate UUID-based temp names if disk storage is needed |
| Serving generated Excel output files without `Content-Disposition: attachment` | Browser may execute or inline-render malicious content | Always set `Content-Disposition: attachment; filename="output.xlsx"` on download responses |
| No file size limit on upload endpoint | Denial of service via giant file upload exhausting server memory | Enforce size limits at Nginx (`client_max_body_size`) AND at the application layer (multer `limits.fileSize`) |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No progress feedback during PDF batch upload and parsing | User sees a frozen screen for 5–10 seconds; retries the upload thinking it failed | Show a per-file progress indicator or spinner with status ("正在解析 PO_10114426...") |
| Showing raw field names from the PDF/Excel in error messages | User reads "field CUST_PO mismatch at row 14, col E" — incomprehensible | Map technical field names to Chinese business labels in all UI messages |
| Red-highlighting every minor formatting difference | Every row appears red; user cannot distinguish real mismatches from cosmetic ones | Normalize before comparison (see Pitfall 5); only highlight semantic value differences |
| Downloading both factory outputs as separate files without naming them clearly | User confuses东莞 and印尼 output files | Auto-name output files with factory and date: `东莞排期_核对_20260320.xlsx`, `印尼排期_核对_20260320.xlsx` |
| No indication of which PO files were successfully parsed vs. failed | A failed PDF parse silently drops all its POs from reconciliation | Show a parse status summary before the reconciliation results (e.g., "已成功解析 7/8 个PO文件，1 个解析失败") |

---

## "Looks Done But Isn't" Checklist

- [ ] **PDF Parsing:** Works on 3 sample PDFs — verify it works on ALL 8 actual PO files in the project, including edge cases like the two different file size groups (~163KB vs ~238KB) which may indicate different page counts or layouts
- [ ] **Red Highlighting:** Cells appear red in browser preview — verify the downloaded Excel file also shows red highlighting when opened in Microsoft Excel (not just in a browser Excel viewer)
- [ ] **Date Code Generation:** Calculation is correct for a shipping date in July — verify it is also correct for dates in January/February (Spring Festival) and September/October (National Day)
- [ ] **Factory Routing:** RR02 POs go to Indonesia folder — verify that a mixed batch (some RR01, some RR02) correctly separates without cross-contamination
- [ ] **Excel Template Preservation:** Data is written correctly — verify the template's merged cells, column widths, and existing formatting are NOT modified in the output
- [ ] **Batch Upload:** Works with 1 PDF — verify it works when uploading 8 PDFs simultaneously without timeout or memory error
- [ ] **Normalization:** Comparison works with exact-match data — verify that fields with trailing spaces or full-width numbers are normalized correctly before comparison

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong library choice (SheetJS instead of ExcelJS) | HIGH | Rewrite all Excel read/write code; re-test every Excel operation; may take 2–3 days mid-project |
| Hardcoded position-based PDF extraction breaks on layout change | MEDIUM | Re-examine all 8+ PO PDFs for coordinate variance; rewrite extraction as label-anchored; re-test all field mappings |
| Holiday data goes stale (wrong date codes in production) | LOW–MEDIUM | Update holiday data package or API credentials; redeploy; recalculate affected date codes manually for impacted POs |
| Nginx upload limit too low (discovered after deployment) | LOW | Add `client_max_body_size 50M;` to nginx.conf; rebuild Docker image; redeploy |
| Excel output corrupts merged cells | MEDIUM | Read ExcelJS merge documentation; add pre-write merge check; test against template specifically |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| PDF table structure destroyed | Phase 1 — PDF Parsing | Extract all 8 sample POs; manually verify every field against the PDF visual content |
| SheetJS strips styles on write | Phase 1 — Library Selection | Write a cell with red fill using ExcelJS and open in Excel to confirm color is present |
| Chinese holiday calendar outdated | Phase 2 — Date Code Generation | Test date codes for Spring Festival week and National Day week inputs |
| PDF field positions drift on layout change | Phase 1 — PDF Parsing | Test extraction using label-anchored approach; run against all 8 provided PDFs |
| String comparison false positives | Phase 2 — Reconciliation Engine | Unit test normalize() with full-width characters, trailing spaces, and non-breaking spaces |
| Nginx 1MB upload limit | Phase 3 — Docker Deployment | Upload 8 PDFs simultaneously through the Docker stack; confirm 200 response |
| ExcelJS merge cell corruption | Phase 2 — Excel Output | Open generated output in Microsoft Excel; verify zero repair prompts |

---

## Sources

- [SheetJS GitHub issue #128 — Styling not written back (2014, still relevant)](https://github.com/SheetJS/sheetjs/issues/128)
- [SheetJS GitHub issue #1926 — Maintain Styling format from existing file](https://github.com/SheetJS/sheetjs/issues/1926)
- [SheetJS GitHub issue #152 — Formulae not retained on export](https://github.com/SheetJS/sheetjs/issues/152)
- [ExcelJS GitHub — Excel Workbook Manager with style support](https://github.com/exceljs/exceljs)
- [pdfplumber issue #912 — Incorrect extraction in tables with overlapping columns](https://github.com/jsvine/pdfplumber/issues/912)
- [docling issue #2067 — Multi-column layout extraction fails](https://github.com/docling-project/docling/issues/2067)
- [PDF.js GitHub issue #20489 — Chinese fonts displaying as garbled characters](https://github.com/mozilla/pdf.js/issues/20489)
- [7 PDF Parsing Libraries for Node.js 2025 — Strapi Blog](https://strapi.io/blog/7-best-javascript-pdf-parsing-libraries-nodejs-2025)
- [unpdf vs pdf-parse vs pdfjs-dist comparison 2026 — PkgPulse](https://www.pkgpulse.com/blog/unpdf-vs-pdf-parse-vs-pdfjs-dist-pdf-parsing-extraction-nodejs-2026)
- [Nginx client_max_body_size configuration — BetterStack](https://betterstack.com/community/questions/default-nginx-client-max-body-size-value/)
- [Chinese holiday calendar API — jiejiariapi.com](https://www.jiejiariapi.com/en)
- [节假日数据接口API 2025 — 知乎](https://zhuanlan.zhihu.com/p/18986419101)
- [Calculating Business Days in JavaScript — DEV Community](https://dev.to/robert_pringle_ee42391db0/calculating-business-days-in-javascript-skip-the-calendar-math-ibe)

---
*Pitfalls research for: PDF parsing + Excel data reconciliation (TOMY PO核对与排期管理系统)*
*Researched: 2026-03-20*
