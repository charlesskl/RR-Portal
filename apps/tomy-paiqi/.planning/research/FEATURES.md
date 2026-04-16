# Feature Research

**Domain:** PO reconciliation and production scheduling verification tool (manufacturing / toy industry)
**Researched:** 2026-03-20
**Confidence:** HIGH (requirements specified by operator; domain is internal tooling, not a market product)

---

## Context Note

This is not a commercial product competing in a market. It is an internal business tool for TOMY's production scheduling team. The "users" are internal staff who will use it daily for a specific workflow. Feature decisions are driven by operational accuracy and time savings, not by competitive positioning.

The workflow is: upload PDF POs + Excel scheduling template → automated field-by-field comparison → discrepancies flagged red → output corrected/annotated Excel files sorted by factory.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels broken for the workflow.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| PDF upload (multi-file) | Core input — no tool without it | MEDIUM | Must handle multiple POs in one session; PDFs are text-extractable (not scanned) |
| Excel upload (scheduling template) | Core input — the thing being reconciled against | LOW | Single template with fixed column structure; user provides their own template file |
| PDF text extraction | Without extraction there is no data | MEDIUM | pdfjs-dist or pdf-parse on Node.js; text-based PDFs only (scanned = out of scope) |
| Excel read/parse | Must read existing template structure and data | MEDIUM | xlsx (SheetJS) library; must preserve template formatting and existing data |
| Field-by-field comparison | The entire point of the tool | HIGH | 11 fields: 接单期国家, 第三客户名称, 客跟单, TOMY PO, CUSTOMER PO, 货号, 数量, 外箱, 总箱数, PO走货期, 箱唛资料 |
| Red highlight on mismatch | Standard visual output for discrepancy tools; users expect it | MEDIUM | Apply red fill to mismatched cells in the output Excel; xlsx supports cell styling |
| Factory classification (RR01/RR02) | Fundamental to how TOMY organizes work | LOW | Parse factory code from PO number string; RR01=Dongguan, RR02=Indonesia |
| Separate output folders | Dongguan and Indonesia orders handled separately | LOW | Generate two output file sets, one per factory |
| Download output files | Users must be able to get the result | LOW | Browser download trigger; or ZIP containing both folders |
| Processing status feedback | Users need to know the tool is working (PDFs can be slow) | LOW | Progress indicator while parsing; file list with status per PO |

### Differentiators (Competitive Advantage)

For an internal tool, "differentiating" means what makes this meaningfully better than the current manual process or a generic comparison tool.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Date code auto-generation | Saves manual calculation; error-prone today | HIGH | Format: [month letter][day][2-digit year][factory code], e.g. D1526RR02. Month letters A–L. Calculated as PO走货期 minus 1 month, then rolled back to nearest prior working day |
| China public holiday calendar | Date code must land on a working day | MEDIUM | Hardcode 2026 holidays (and optionally fetch future years). Rolling back past weekends and public holidays is business-critical; wrong date = production delay |
| Match-on-PO-number linking | Automatically finds which row in the schedule corresponds to each PO | HIGH | Core matching logic: link PO data to schedule row by TOMY PO number. If no match found, flag as new/unscheduled PO |
| Summary report of all discrepancies | Users want a quick scan before diving into per-file details | MEDIUM | A summary table listing: PO number, factory, field(s) that mismatched, and the values |
| Batch processing (multiple POs at once) | Processing one at a time is slow | MEDIUM | Upload 8+ PDFs simultaneously; process all against the schedule in one pass |
| Unmatched PO detection | If a PO in the PDF has no corresponding row in the schedule, this needs to be flagged explicitly — not silently ignored | LOW | Add a separate section in output for unmatched POs |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| OCR for scanned PDFs | "What if a PDF is scanned?" | Out of scope per PROJECT.md; adds massive complexity (cloud API cost, accuracy issues, layout parsing); current POs are all text-extractable | Document that tool only works with text PDFs; display clear error if PDF yields no extractable text |
| ERP / system integration | "Could this push to SAP/our ERP?" | Scope creep; TOMY's ERP integration is a separate project; adds auth, API maintenance, deployment coupling | Output standard XLSX files that any ERP can import manually |
| Real-time collaboration | "Can multiple people use it at once?" | This is a file-processing tool, not a collaborative editor; sessions are stateless by nature; adds WebSocket/session complexity | Stateless design: each user uploads and processes independently in their own browser session |
| User accounts / login | "We need to track who ran what" | Unnecessary for this use case; adds auth infrastructure, password management, session handling | Access control at network level (deploy to internal LAN or VPN); no app-level auth needed |
| Automatic schedule update (write-back) | "Can it fix the schedule automatically?" | Dangerous: auto-correcting the authoritative schedule without human review risks silently overwriting correct data with wrong PO data | Output an annotated copy of the schedule with highlights; human reviews and decides what to update |
| Historical run storage / audit log | "Save all past reconciliation runs" | Requires persistent storage, database, retention policy; significant infrastructure for marginal value | Users download and store outputs in their own file system per the existing factory folder structure |
| Mobile / tablet support | "I want to use this on my phone" | Out of scope per PROJECT.md; Excel output manipulation on mobile is poor UX; desktop workflow | Responsive enough that it's usable on a tablet if needed, but not optimized for mobile |

---

## Feature Dependencies

```
[Excel Upload + Parse]
    └──requires──> [Field Comparison Engine]
                       └──requires──> [PDF Text Extraction]
                       └──requires──> [PO-to-Schedule Row Matching]

[PDF Text Extraction]
    └──requires──> [Factory Classification (RR01/RR02)]

[Field Comparison Engine]
    └──produces──> [Red Highlight Output]
    └──produces──> [Summary Discrepancy Report]
    └──produces──> [Unmatched PO Detection]

[PO走货期 field extraction]
    └──requires──> [Date Code Auto-Generation]
                       └──requires──> [China Holiday Calendar]

[Factory Classification]
    └──drives──> [Separate Output Folders]

[Summary Report] ──enhances──> [Red Highlight Output]
    (report gives overview; per-file highlight gives detail)

[Auto-write-back] ──conflicts──> [Red Highlight Output]
    (auto-correct undermines human review of highlighted discrepancies)
```

### Dependency Notes

- **Field Comparison requires PO-to-Schedule Row Matching:** Before any field can be compared, the system must correctly identify which schedule row corresponds to each PO. This matching step is the foundation; if it fails, all downstream comparison is wrong.
- **Date Code Generation requires China Holiday Calendar:** The business rule (roll back to nearest working day) is meaningless without the calendar. These must be implemented together.
- **Factory Classification drives output folder split:** All output generation (Excel files, folder naming) depends on knowing the factory. This must resolve early in the pipeline.
- **Summary Report enhances Red Highlight:** The summary is a second presentation layer over the same comparison data. Implement comparison first; summary is additive.

---

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to replace the current manual workflow.

- [ ] PDF upload (multi-file) and text extraction — without this nothing works
- [ ] Excel template upload and parse — read existing schedule structure
- [ ] PO-to-schedule row matching by TOMY PO number — core linking logic
- [ ] Field-by-field comparison for all 11 specified fields — the core value
- [ ] Red highlight (red cell fill) on mismatched fields in output Excel — the visual deliverable
- [ ] Factory classification (RR01 / RR02) with separate output files — required by current process
- [ ] Date code auto-generation with China holiday calendar — saves manual calculation, high value
- [ ] Unmatched PO detection — flag rows with no schedule match so nothing is silently skipped
- [ ] Download output as ZIP (two folders: Dongguan + Indonesia) — users need to retrieve results

### Add After Validation (v1.x)

Features to add once core is working and users have given feedback.

- [ ] Summary discrepancy report — add when users express that per-file review is too slow
- [ ] Processing progress feedback (per-file status) — add when batch size grows past ~10 files
- [ ] Holiday calendar for 2027+ — add in late 2026 before calendar rolls over

### Future Consideration (v2+)

Features to defer until the tool has proven its value over several months of use.

- [ ] Support for additional factory codes beyond RR01/RR02 — only if TOMY adds new facilities
- [ ] Configurable field mapping — only if the Excel template structure changes significantly
- [ ] Audit trail / run history — only if compliance team requests it

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| PDF text extraction | HIGH | MEDIUM | P1 |
| Excel upload and parse | HIGH | MEDIUM | P1 |
| PO-to-schedule row matching | HIGH | HIGH | P1 |
| 11-field comparison engine | HIGH | HIGH | P1 |
| Red highlight in output Excel | HIGH | MEDIUM | P1 |
| Factory classification (RR01/RR02) | HIGH | LOW | P1 |
| Separate output folders (ZIP download) | HIGH | LOW | P1 |
| Date code auto-generation | HIGH | HIGH | P1 |
| China holiday calendar | HIGH | MEDIUM | P1 |
| Unmatched PO detection | MEDIUM | LOW | P1 |
| Summary discrepancy report | MEDIUM | MEDIUM | P2 |
| Per-file processing status UI | LOW | LOW | P2 |
| Future year holiday calendar updates | MEDIUM | LOW | P2 |
| Configurable field mapping | LOW | HIGH | P3 |
| Audit trail / run history | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch — the tool is not useful without these
- P2: Should have, add when possible — improves usability but workflow survives without them
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

This tool has no direct market competitors — it is purpose-built for TOMY's specific workflow. The closest analogues are:

| Feature | Generic Excel Diff Tools (xlCompare, Draftable) | Manual Process (Current) | This Tool |
|---------|--------------------------------------------------|--------------------------|-----------|
| PDF PO parsing | No | Manual copy-paste | Yes — core feature |
| Cross-document comparison | Excel-to-Excel only | Human eye + Excel | Yes — PDF-to-Excel |
| Field-specific comparison (11 fields) | All cells, no semantic context | Field-by-field manual | Yes — semantic matching |
| Factory routing | No | Manual folder sorting | Yes — automatic |
| Date code generation | No | Manual calculation + calendar | Yes — with holiday logic |
| China holiday awareness | No | Depends on user knowledge | Yes — built-in calendar |
| Batch processing | Limited | Very slow (1 PO at a time) | Yes — all POs in one run |

The manual process is the real baseline. The tool's value is measured in hours saved per batch and error rate reduction.

---

## Sources

- Project requirements: `D:/Projects/TOMY排期核对/.planning/PROJECT.md`
- PO reconciliation tool features: [Mastering Purchase Order Reconciliation](https://www.solvexia.com/blog/purchase-order-reconciliation)
- PDF data extraction market: [Best PDF Data Extraction Tools 2026](https://www.klippa.com/en/blog/information/pdf-data-extraction-tools/)
- Document comparison tools: [xlCompare](https://xlcompare.com/), [Draftable](https://www.draftable.com/compare)
- Production scheduling features: [Manufacturing Production Scheduling Software](https://www.machinemetrics.com/blog/manufacturing-production-scheduling-software)
- Data reconciliation tools: [5 Best Data Reconciliation Tools for 2026](https://www.solvexia.com/blog/data-reconciliation-tools)

---
*Feature research for: PO核对与排期管理系统 (TOMY toy manufacturer internal tool)*
*Researched: 2026-03-20*
