# Phase 4: Output, Download, and Integration - Research

**Researched:** 2026-03-23
**Domain:** ZIP archive generation from in-memory buffers, factory-split Excel output, summary report generation, route wiring, frontend download flow
**Confidence:** HIGH — all findings verified against existing codebase, installed packages, and Node.js stream documentation

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OUT-01 | System classifies orders by factory code (RR01=东莞, RR02=印尼) | `POItem.factoryCode` is already extracted by pdfExtractor; `RowMatchResult` propagates it via `poData.items[i].factoryCode`. Classification is a filter pass over `ReconciliationResult.matched`. |
| OUT-02 | Output results separated into Dongguan and Indonesia folders | ZIP archive uses path prefix: `东莞/filename.xlsx` and `印尼/filename.xlsx`. Requires two separate `writeAnnotatedSchedule()` calls — one per factory buffer. |
| OUT-03 | User can download results as ZIP file containing both folders | `archiver` v5.3.2 is already installed in `node_modules`. Buffer-to-ZIP pattern uses `PassThrough` stream. `GET /api/download/:sessionId` endpoint upgraded to serve ZIP instead of single XLSX. |
| OUT-04 | System generates summary report listing all discrepancies (PO number, factory, mismatched fields, values) | New `buildSummaryReport()` function iterates `ReconciliationResult.matched` filtering `mismatches.length > 0`, plus `unmatchedPOItems`. Formats to plain text or simple XLSX. Added to ZIP as `核对汇总报告.txt` or `.xlsx`. |

</phase_requirements>

---

## Summary

Phase 4 completes the reconciliation pipeline by adding factory splitting, ZIP bundling, and a summary report. The existing code in Phase 3 produces a single annotated Excel buffer from a single uploaded schedule file. Phase 4 must change the processing model so that both schedule files (东莞 and 印尼) are uploaded and reconciled separately, then packaged together.

The core challenge is that the current upload route accepts one schedule file and produces one output buffer. Phase 4 requires: (1) accepting two schedule files as separate upload fields, (2) running reconciliation against each, (3) writing two annotated Excel buffers, (4) generating a summary report from the combined reconciliation results, and (5) packaging all three artifacts into a ZIP archive served via the existing session-based download endpoint.

Both `archiver` (v5.3.2) and `jszip` (v3.10.1) are already installed. `archiver` is the correct choice for server-side streaming ZIP creation. `jszip` has built-in TypeScript types and a simpler async API that works well when building a ZIP from in-memory buffers — either works. The session store pattern (UUID → buffer, 30-minute TTL, one-time download) from Phase 3 is reused unchanged except the stored value changes from a single Excel buffer to a ZIP buffer.

**Primary recommendation:** Upgrade `POST /api/process` to accept `scheduleDg` (东莞) and `scheduleId` (印尼) as two separate upload fields. Run `writeAnnotatedSchedule()` per factory. Build ZIP with `archiver` piped to a `PassThrough` stream collected into a Buffer. Add summary report as a text file in the ZIP root.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| archiver | 5.3.2 | ZIP archive creation from streams/buffers | Already installed; streaming API; handles folder paths natively via `name` option |
| exceljs | 4.4.0 | Write annotated Excel buffers | Already used in Phase 3; `writeAnnotatedSchedule()` exists and works |
| crypto (Node built-in) | Node built-in | Session UUID generation | Already used in upload route |
| PassThrough (Node stream) | Node built-in | Collect archiver output into Buffer | Required to get archiver output as a Buffer for in-memory storage |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jszip | 3.10.1 | Alternative ZIP creation | Simpler async API; use if archiver stream handling proves complex |
| @types/archiver | npm install needed | TypeScript types for archiver | Required — archiver has no bundled types |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| archiver (stream) | jszip (promise) | jszip has simpler async/await API and bundled TS types; archiver is more mature and handles large files better via streaming; for buffers < 10MB (two Excel files), either works |
| text summary report | XLSX summary report | Text is simpler to generate and open; XLSX is more professional; text recommended for Phase 4, XLSX as future enhancement |

**Installation needed:**
```bash
npm install --save-dev @types/archiver
```

(archiver and jszip are already in node_modules, but neither is in package.json dependencies — both need to be added)

**Add to package.json dependencies:**
```bash
npm install archiver
```

---

## Architecture Patterns

### Recommended Project Structure
No new directories needed. New files:
```
server/
├── lib/
│   ├── zipBuilder.ts        # buildZipBuffer() — wraps archiver, returns Promise<Buffer>
│   ├── summaryReport.ts     # buildSummaryReport() — text summary from ReconciliationResult
│   └── [existing files unchanged]
└── routes/
    └── upload.ts            # modified: dual schedule fields, ZIP output, updated ProcessResponse
```

### Pattern 1: Archiver to In-Memory Buffer
**What:** Pipe archiver output into a Node.js `PassThrough` stream, collect chunks, resolve Promise when archive finalizes.
**When to use:** Whenever you need a ZIP as a `Buffer` without writing to disk.
**Example:**
```typescript
// Source: Node.js stream API + archiver docs
import archiver from 'archiver'
import { PassThrough } from 'stream'

export async function buildZipBuffer(
  entries: Array<{ name: string; buffer: Buffer }>
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } })
    const pass = new PassThrough()
    const chunks: Buffer[] = []

    pass.on('data', (chunk: Buffer) => chunks.push(chunk))
    pass.on('end', () => resolve(Buffer.concat(chunks)))
    pass.on('error', reject)
    archive.on('error', reject)

    archive.pipe(pass)

    for (const entry of entries) {
      archive.append(entry.buffer, { name: entry.name })
    }

    archive.finalize()
  })
}
```

### Pattern 2: Factory Splitting via factoryCode
**What:** Filter `ReconciliationResult.matched` by `poData.items[i].factoryCode` to produce per-factory sub-results.
**When to use:** Before calling `writeAnnotatedSchedule()` — each call only processes rows belonging to one factory.
**Key insight:** `RowMatchResult` does not directly carry `factoryCode` — it carries `sourceFile` and the indexes. The factory code must be recovered from the original `poDataList` by looking up `tomyPO` and `货号`. Alternatively (simpler): each factory's schedule file only contains that factory's rows, so running the full `reconcile()` against each factory's schedule buffer naturally filters results — no explicit splitting of `ReconciliationResult` needed.

**Recommended approach:** Run reconciliation twice — once against the 东莞 schedule, once against the 印尼 schedule. This is the cleanest solution because:
- Each schedule file only contains rows for its factory
- The existing `reconcile()` function handles unmatched items correctly
- No post-processing filter logic needed
- Each `ReconciliationResult` is already factory-scoped

```typescript
// Pseudo-code for route handler
const dgRows = await parseScheduleExcel(dgBuffer)
const idRows = await parseScheduleExcel(idBuffer)

const dgResult = reconcile(poDataList, dgRows)
const idResult = reconcile(poDataList, idRows)

const dgExcel = await writeAnnotatedSchedule(dgBuffer, dgResult, dgRows)
const idExcel = await writeAnnotatedSchedule(idBuffer, idResult, idRows)

const summaryText = buildSummaryReport(dgResult, idResult)

const zipBuffer = await buildZipBuffer([
  { name: '东莞/2026年TOMY东莞排期_核对结果.xlsx', buffer: dgExcel },
  { name: '印尼/2026年TOMY印尼排期_核对结果.xlsx', buffer: idExcel },
  { name: '核对汇总报告.txt', buffer: Buffer.from(summaryText, 'utf-8') },
])
```

### Pattern 3: Summary Report as Plain Text
**What:** Build a UTF-8 text string listing all discrepancies, encode as Buffer, append to ZIP.
**When to use:** Summary report for OUT-04.

```typescript
export function buildSummaryReport(
  dgResult: ReconciliationResult,
  idResult: ReconciliationResult
): string {
  const lines: string[] = []
  lines.push('TOMY 排期核对汇总报告')
  lines.push(`生成时间: ${new Date().toLocaleString('zh-CN')}`)
  lines.push('='.repeat(60))

  // Matched rows with mismatches
  const allMismatched = [
    ...dgResult.matched.filter(m => m.mismatches.length > 0).map(m => ({ ...m, factory: 'RR01/东莞' })),
    ...idResult.matched.filter(m => m.mismatches.length > 0).map(m => ({ ...m, factory: 'RR02/印尼' })),
  ]
  lines.push(`\n字段不匹配项 (共 ${allMismatched.length} 条):`)
  for (const item of allMismatched) {
    lines.push(`\nPO: ${item.tomyPO} | 货号: ${item.货号} | 工厂: ${item.factory}`)
    for (const mm of item.mismatches) {
      lines.push(`  ${mm.field}: 排期值="${mm.scheduleValue}" | PO值="${mm.poValue}"`)
    }
  }

  // Unmatched PO items
  const allUnmatched = [
    ...dgResult.unmatchedPOItems.map(u => ({ ...u, factory: 'RR01/东莞' })),
    ...idResult.unmatchedPOItems.map(u => ({ ...u, factory: 'RR02/印尼' })),
  ]
  lines.push(`\n未匹配PO项 (共 ${allUnmatched.length} 条):`)
  for (const item of allUnmatched) {
    lines.push(`  PO: ${item.tomyPO} | 货号: ${item.货号} | 来源: ${item.sourceFile} | 工厂: ${item.factory}`)
  }

  return lines.join('\n')
}
```

### Pattern 4: Updated Upload Route — Dual Schedule Fields
**What:** Change `multer.fields()` to accept `scheduleDg` and `scheduleId` instead of a single `schedule` field.
**When to use:** Updated `POST /api/process`.

```typescript
upload.fields([
  { name: 'pos', maxCount: 20 },
  { name: 'scheduleDg', maxCount: 1 },   // 东莞 schedule
  { name: 'scheduleId', maxCount: 1 },   // 印尼 schedule
])
```

### Pattern 5: Updated Download Response Headers for ZIP
**What:** Change Content-Type and Content-Disposition headers in `GET /api/download/:sessionId`.
**When to use:** When stored buffer is now a ZIP, not an XLSX.

```typescript
res.setHeader('Content-Type', 'application/zip')
res.setHeader('Content-Disposition', 'attachment; filename="TOMY_核对结果.zip"')
res.send(entry.buffer)
```

### Pattern 6: Frontend Download Filename
**What:** Update `a.download` value in `handleDownload()` from `reconciliation_result.xlsx` to `TOMY_核对结果.zip`.
**When to use:** Frontend `App.tsx` `handleDownload` function.

### Anti-Patterns to Avoid
- **Splitting ReconciliationResult by factoryCode post-hoc:** Fragile — RowMatchResult doesn't carry factoryCode directly. Use dual reconcile() calls instead.
- **Writing ZIP to disk:** Not needed. In-memory PassThrough pattern avoids temp file management and filesystem permission issues.
- **Single schedule upload for both factories:** The current route only accepts one schedule. This must be changed — each factory has a different Excel file with different rows.
- **Blocking the event loop:** `archiver.finalize()` is async via streams; always wrap in a Promise. Never use sync compression.
- **Not handling the case where one schedule file is absent:** If user only uploads one factory's schedule, still generate that factory's output; skip the other. Don't fail the whole request.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ZIP creation | Custom ZIP binary writer | archiver (already installed) | ZIP format has CRC32, local file headers, central directory — dozens of edge cases |
| Folder structure in ZIP | Path manipulation hacks | archiver `name` option with path prefix | archiver handles `东莞/file.xlsx` path natively |
| Buffer collection from stream | Manual stream reading | PassThrough + chunk accumulation | Node.js stream API handles backpressure correctly |
| Chinese filename in ZIP | URL encoding tricks | UTF-8 filename in archiver `name` option | archiver supports Unicode filenames in ZIP |

**Key insight:** The entire output pipeline — annotation, splitting, ZIP creation, download — is wiring existing pieces. No novel algorithms needed. The risk area is stream lifecycle management (archiver finalize timing).

---

## Common Pitfalls

### Pitfall 1: archiver Not in package.json Despite Being in node_modules
**What goes wrong:** `archiver` and `jszip` appear in `node_modules` (installed as transitive dependencies of other packages) but are NOT listed in `package.json` `dependencies`. If `npm ci` is run in Docker, they will not be installed.
**Why it happens:** The Dockerfile uses the existing node_modules without `npm ci` currently, but this is fragile.
**How to avoid:** Run `npm install archiver` to add it to package.json. Also add `@types/archiver` as a devDependency.
**Warning signs:** `import archiver from 'archiver'` works in dev but fails in a fresh Docker build.

### Pitfall 2: archiver 'close' vs 'end' Event Timing
**What goes wrong:** Listening for `'close'` event on PassThrough instead of `'end'` — `'close'` fires on file descriptors, not in-memory streams.
**Why it happens:** archiver README shows `'close'` for file streams; PassThrough emits `'end'` when data is fully readable.
**How to avoid:** For PassThrough, listen for `pass.on('end', ...)`. For file WriteStream, listen for `output.on('close', ...)`.
**Warning signs:** Promise never resolves; chunks array is empty.

### Pitfall 3: Dual Reconciliation Creates Double Unmatched Items
**What goes wrong:** Running `reconcile(poDataList, dgRows)` and `reconcile(poDataList, idRows)` means RR01 POs will appear as `unmatchedPOItems` in the Indonesia reconciliation, and vice versa. The summary report will show spurious "unmatched" entries.
**Why it happens:** `reconcile()` has no factory filter — it tries all POs against all schedule rows.
**How to avoid:** Before reconciling, filter `poDataList` by factory code: only pass RR01 POs to the 东莞 reconcile call, only RR02 POs to the 印尼 call.
**Warning signs:** Summary report shows all Indonesia POs as unmatched in 东莞 section.

**Solution:**
```typescript
const dgPOs = poDataList.filter(po => po.items.some(i => i.factoryCode === 'RR01'))
const idPOs = poDataList.filter(po => po.items.some(i => i.factoryCode === 'RR02'))
const dgResult = reconcile(dgPOs, dgRows)
const idResult = reconcile(idPOs, idRows)
```

### Pitfall 4: Frontend Sends One Schedule File (Current Design)
**What goes wrong:** Current `App.tsx` has a single "排期表" upload slot. Sending one file to a route that now expects two separate fields will result in empty reconciliation for the other factory.
**Why it happens:** Phase 3 only needed one schedule file. Phase 4 needs both.
**How to avoid:** Update frontend to show two separate upload slots — one for 东莞 schedule, one for 印尼 schedule. Both are optional individually (handle gracefully if one is absent).
**Warning signs:** Only one factory's output appears in the downloaded ZIP.

### Pitfall 5: Chinese Filenames in ZIP on Windows
**What goes wrong:** ZIP filenames containing Chinese characters (e.g., `东莞/2026年TOMY东莞排期_核对结果.xlsx`) display as garbled text when opened in Windows Explorer's built-in ZIP handler (which expects Code Page 437).
**Why it happens:** Windows ZIP handler does not enable the UTF-8 flag in ZIP entries by default.
**How to avoid:** archiver v5 sets the UTF-8 flag automatically for non-ASCII filenames. This is a known Windows quirk — use ASCII-safe filenames OR advise users to open with 7-Zip/WinRAR if they see garbled names. For this internal tool, using ASCII folder names (`DG/` and `ID/`) is safest.
**Recommendation:** Use ASCII folder names in the ZIP: `DG/东莞排期核对结果.xlsx` and `ID/印尼排期核对结果.xlsx` — folder names are ASCII (`DG`, `ID`), file names contain Chinese.

### Pitfall 6: writeAnnotatedSchedule Receives Wrong factoryCode in dateCode
**What goes wrong:** `writeAnnotatedSchedule()` calls `generateDateCode()` internally via the reconciler — but date codes are generated during `reconcile()`, not in `writeAnnotatedSchedule()`. The date code is stored in `RowMatchResult.dateCode`. No change needed here.
**Why it happens:** Confusion about where date codes are generated. They are in `reconciler.ts` → `generateDateCode(item.PO走货期, item.factoryCode)`.
**How to avoid:** No action needed — factoryCode flows correctly through the existing pipeline.

### Pitfall 7: Session Store Stores a Single Buffer — Must Now Store ZIP Buffer
**What goes wrong:** `storeOutput()` currently stores a single `Buffer`. The session store type and all usages are already generic (`Buffer`) — no type change needed. Just pass the ZIP buffer instead of the Excel buffer.
**How to avoid:** No type change needed. Update the `Content-Type` and `Content-Disposition` headers in the download route.

---

## Code Examples

Verified patterns from project codebase and Node.js docs:

### Archiver to PassThrough Buffer (PRIMARY PATTERN)
```typescript
// Source: archiver README + Node.js stream.PassThrough docs
import archiver from 'archiver'
import { PassThrough } from 'stream'

export async function buildZipBuffer(
  entries: Array<{ name: string; buffer: Buffer }>
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } })
    const pass = new PassThrough()
    const chunks: Buffer[] = []

    pass.on('data', (chunk: Buffer) => chunks.push(chunk))
    pass.on('end', () => resolve(Buffer.concat(chunks)))
    pass.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err)
    })

    archive.pipe(pass)

    for (const { name, buffer } of entries) {
      archive.append(buffer, { name })
    }

    archive.finalize()
  })
}
```

### Updated multer.fields for Dual Schedule Upload
```typescript
// Source: existing upload.ts + multer docs
upload.fields([
  { name: 'pos', maxCount: 20 },
  { name: 'scheduleDg', maxCount: 1 },
  { name: 'scheduleId', maxCount: 1 },
])
```

### Factory-Filtered poDataList
```typescript
// Ensures only RR01 POs reconcile against 东莞, only RR02 against 印尼
const dgPOs = poDataList.filter(po =>
  po.items.every(i => i.factoryCode === 'RR01') ||
  po.items.some(i => i.factoryCode === 'RR01')
)
const idPOs = poDataList.filter(po =>
  po.items.some(i => i.factoryCode === 'RR02')
)
```

Note: A PO's factory code is determined by its items' `factoryCode`. All items in a real PO will have the same factory code — the PO file name contains `RR01` or `RR02`. Use `po.items[0]?.factoryCode` as the PO-level factory code.

### Updated Download Headers
```typescript
// Source: existing upload.ts, updated Content-Type
res.setHeader('Content-Type', 'application/zip')
res.setHeader('Content-Disposition', 'attachment; filename="TOMY_reconciliation.zip"')
res.send(entry.buffer)
```

### ProcessResponse Type Extension
```typescript
// Add to existing ProcessResponse interface in server/types/index.ts
reconciliationDg?: {
  matchedCount: number
  unmatchedCount: number
  ambiguousCount: number
  mismatchedFieldCount: number
  errors: string[]
}
reconciliationId?: {
  matchedCount: number
  unmatchedCount: number
  ambiguousCount: number
  mismatchedFieldCount: number
  errors: string[]
}
// Keep existing 'reconciliation' field for backward compat OR replace it
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single schedule upload | Dual schedule upload (东莞 + 印尼) | Phase 4 | Route field names change; frontend gets two upload slots |
| Single XLSX download | ZIP download containing 2 XLSX + 1 TXT | Phase 4 | Content-Type changes; frontend filename changes |
| No summary report | Plain text summary in ZIP | Phase 4 | New `buildSummaryReport()` function |
| `reconciliation` in ProcessResponse | `reconciliationDg` + `reconciliationId` | Phase 4 | Frontend stats card shows per-factory counts |

**No deprecated packages:** All installed packages are current. `archiver` 5.x is the latest stable series.

---

## Open Questions

1. **Should both schedule files be required, or optional individually?**
   - What we know: The system has two known factory files; users will typically upload both
   - What's unclear: What if a user only has one factory's POs in a batch?
   - Recommendation: Make both optional. If only one is provided, generate output for that factory only. If neither is provided, skip reconciliation (existing behavior).

2. **Should the summary report be a `.txt` or `.xlsx` file?**
   - What we know: `.txt` is simpler to generate; `.xlsx` is more professional
   - What's unclear: User preference
   - Recommendation: Use `.txt` for Phase 4. Out-of-scope for v1 to generate a formatted XLSX summary (ENH-02 territory).

3. **ZIP folder names: Chinese or ASCII?**
   - What we know: Windows built-in ZIP handler struggles with non-ASCII folder names; archiver sets UTF-8 flag
   - What's unclear: Whether target Windows versions handle this correctly
   - Recommendation: Use ASCII folder names `DG/` and `ID/` for the ZIP paths, with descriptive Chinese in the filenames themselves.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.0 |
| Config file | `/vitest.config.ts` — `include: ['server/**/*.test.ts']`, `environment: 'node'` |
| Quick run command | `npx vitest run server/lib/zipBuilder.test.ts server/lib/summaryReport.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OUT-01 | RR01 POs only reconcile against 东莞 rows; RR02 only against 印尼 rows | unit | `npx vitest run server/lib/zipBuilder.test.ts` | Wave 0 |
| OUT-02 | ZIP contains `DG/` and `ID/` folder entries with respective XLSX files | unit | `npx vitest run server/lib/zipBuilder.test.ts` | Wave 0 |
| OUT-03 | `GET /api/download/:sessionId` returns Content-Type `application/zip` with valid ZIP | integration | `npx vitest run server/routes/upload.test.ts` | Exists (needs new test cases) |
| OUT-04 | Summary report contains all mismatch entries with PO number, factory, field names, and differing values | unit | `npx vitest run server/lib/summaryReport.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run server/lib/zipBuilder.test.ts server/lib/summaryReport.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `server/lib/zipBuilder.test.ts` — covers OUT-01, OUT-02
- [ ] `server/lib/summaryReport.test.ts` — covers OUT-04
- [ ] `server/lib/zipBuilder.ts` — new module (no tests until created)
- [ ] `server/lib/summaryReport.ts` — new module (no tests until created)
- [ ] `@types/archiver` devDependency — needed for TypeScript compilation: `npm install --save-dev @types/archiver`
- [ ] `archiver` added to package.json dependencies: `npm install archiver`

*(Existing `server/routes/upload.test.ts` covers OUT-03 integration behavior with new test cases for ZIP Content-Type and dual schedule fields)*

---

## Sources

### Primary (HIGH confidence)
- Existing `server/routes/upload.ts` — session store pattern, multer fields, download endpoint
- Existing `server/lib/excelWriter.ts` — `writeAnnotatedSchedule()` signature and return type
- Existing `server/lib/reconciler.ts` — `reconcile()` signature, `ReconciliationResult` structure, `RowMatchResult.dateCode` location
- Existing `server/types/index.ts` — `POItem.factoryCode`, `ReconciliationResult`, `ProcessResponse`
- `node_modules/archiver/README.md` — buffer append API, `archive.append(buffer, { name })`, finalize pattern
- `node_modules/archiver/package.json` — version 5.3.2 confirmed installed
- `node_modules/jszip/package.json` — version 3.10.1, has bundled TypeScript types
- `vitest.config.ts` — test include glob, environment

### Secondary (MEDIUM confidence)
- Node.js stream.PassThrough documentation — `'end'` event fires when all data consumed
- archiver GitHub issues — Windows ZIP UTF-8 filename behavior confirmed

### Tertiary (LOW confidence)
- Windows ZIP handler UTF-8 flag behavior — known community issue; recommendation to use ASCII folder names is conservative

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — archiver and jszip are physically in node_modules; versions confirmed; archiver README read
- Architecture: HIGH — dual reconcile pattern is a direct extension of existing reconciler; factory code already in POItem; PassThrough buffer pattern is standard Node.js
- Pitfalls: HIGH — Pitfall 3 (double unmatched) and Pitfall 4 (frontend single slot) are architectural facts derived from reading the codebase; Pitfall 1 (package.json missing) confirmed by reading package.json

**Research date:** 2026-03-23
**Valid until:** 2026-06-23 (archiver 5.x is stable; no breaking changes expected)
