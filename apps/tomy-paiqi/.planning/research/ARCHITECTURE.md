# Architecture Research

**Domain:** PO reconciliation and scheduling verification web application
**Researched:** 2026-03-20
**Confidence:** HIGH (core patterns well-established; MEDIUM for specific library integration choices)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Frontend)                        │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  File Upload │  │  Diff Viewer │  │  Download / Result   │   │
│  │   Component  │  │  Component   │  │      Component       │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│  ┌──────┴─────────────────┴──────────────────────┴───────────┐   │
│  │                  API Client (fetch / axios)                │   │
│  └──────────────────────────────┬────────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────┘
                                  │ HTTP (multipart/form-data upload,
                                  │       JSON response, file download)
┌─────────────────────────────────┼───────────────────────────────┐
│                        Backend (FastAPI)                         │
│                                                                  │
│  ┌──────────────────────────────┴────────────────────────────┐   │
│  │                       API Router Layer                    │   │
│  │  POST /upload-pos   POST /upload-schedule   GET /download │   │
│  └──────────┬───────────────────┬──────────────────┬─────────┘   │
│             │                   │                  │              │
│  ┌──────────┴────┐  ┌───────────┴────┐  ┌─────────┴──────────┐   │
│  │  PDF Parser   │  │ Excel Parser   │  │  Result Packager   │   │
│  │ (pdfplumber)  │  │  (openpyxl /   │  │  (openpyxl write + │   │
│  │               │  │   pandas)      │  │   zip per factory) │   │
│  └──────────┬────┘  └───────────┬────┘  └─────────┬──────────┘   │
│             │                   │                  │              │
│  ┌──────────┴───────────────────┴──────────────────┴──────────┐   │
│  │                    Reconciliation Engine                    │   │
│  │  - Field-level diff (PO fields vs schedule columns)        │   │
│  │  - Factory routing (RR01 = Dongguan, RR02 = Indonesia)     │   │
│  │  - Date code generation (month-letter + day + year + code) │   │
│  │  - Workday adjustment (chinese-calendar library)           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               Temp File Storage (disk / /tmp)               │   │
│  │   uploads/   processed/dongguan/   processed/indonesia/     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| File Upload UI | Accept multiple PDF uploads + one Excel template upload; show progress | HTML `<input type="file" multiple>` or drag-drop zone |
| Diff Viewer UI | Display reconciliation result inline — mismatches highlighted red | HTML table rendered from backend JSON diff result |
| Download Component | Trigger download of processed Excel files (one per factory) | `<a href="/download/session-id">` or Blob download |
| API Router | Accept multipart uploads, invoke processing pipeline, return results | FastAPI routes with `UploadFile` parameters |
| PDF Parser | Extract structured key-value fields from TOMY PO PDFs | pdfplumber; extract text then regex-parse known field labels |
| Excel Parser | Read existing schedule template; extract current schedule rows | openpyxl or pandas `read_excel` |
| Reconciliation Engine | Compare PO fields vs schedule fields; produce per-cell diff map | Python dict comparison; mark mismatches with coordinates |
| Date Code Generator | Compute date code string from PO ship date; adjust for weekends / CN holidays | chinese-calendar library + custom month-letter mapping |
| Factory Router | Split results by factory code (RR01 / RR02) | String prefix check on PO number |
| Result Packager | Write updated Excel with red-highlighted mismatched cells; package per factory | openpyxl `PatternFill` for red cells; optionally zip |
| Temp File Storage | Hold uploaded files and generated output during a session | Local disk `/tmp/sessions/{session-id}/`; cleaned after download |

## Recommended Project Structure

```
src/
├── api/                     # FastAPI application entry point and routes
│   ├── main.py              # App creation, CORS, router registration
│   ├── routes/
│   │   ├── upload.py        # POST /upload (PDF + Excel files)
│   │   └── download.py      # GET /download/{session_id}
│   └── models/
│       └── schemas.py       # Pydantic response models (DiffResult, FieldMismatch)
├── parsers/                 # File-format-specific extraction logic
│   ├── pdf_parser.py        # pdfplumber-based PO field extractor
│   └── excel_parser.py      # openpyxl-based schedule reader
├── engine/                  # Business logic (no I/O)
│   ├── reconciler.py        # Field-level diff; produces mismatch list
│   ├── date_code.py         # Date code generation + workday adjustment
│   └── factory_router.py    # RR01/RR02 classification logic
├── writer/                  # Output file generation
│   └── excel_writer.py      # openpyxl write: fill mismatches red, insert date codes
├── storage/                 # Temp session file management
│   └── session_store.py     # Create/clean session directories
└── frontend/                # Static frontend (served by FastAPI or Nginx)
    ├── index.html
    ├── app.js               # Upload form + fetch calls + result rendering
    └── styles.css
```

### Structure Rationale

- **parsers/ vs engine/:** Separating I/O (reading files) from logic (comparing data) makes each independently testable. parsers can be mocked in unit tests of the reconciler.
- **engine/:** Pure Python functions with no file I/O — easiest to test and reason about.
- **writer/:** Isolated so output format can change without touching reconciliation logic.
- **frontend/:** Kept simple (plain HTML + JS) to avoid build toolchain complexity for an internal tool. Can be served as static files by FastAPI's `StaticFiles` mount or Nginx.

## Architectural Patterns

### Pattern 1: Synchronous Request-Response for Small Files

**What:** Frontend uploads files in a single multipart POST; backend processes synchronously and returns JSON diff result plus a session ID for downloading the output file. No polling or WebSockets required.

**When to use:** File sizes are small (PO PDFs are ~230 KB each; Excel templates < 1 MB). Processing time is well under the HTTP timeout (typically 30 s). This is correct for this project.

**Trade-offs:** Simple to implement and debug. Fails gracefully if processing takes > 30-60 s (browser timeout), but that is not a realistic concern for this workload.

**Example:**

```python
# routes/upload.py
@router.post("/process")
async def process_files(
    pos: list[UploadFile] = File(...),
    schedule: UploadFile = File(...),
):
    session_id = create_session()
    po_data = [parse_pdf(await po.read()) for po in pos]
    schedule_data = parse_excel(await schedule.read())
    diff_result = reconcile(po_data, schedule_data)
    write_output(session_id, schedule_data, diff_result)
    return {"session_id": session_id, "diff": diff_result}
```

### Pattern 2: Session-Based Temp Files for Download

**What:** Backend generates output Excel files and stores them under a session ID directory. Frontend receives the session ID and requests a download separately. Session files are deleted after download or after a TTL (e.g., 1 hour).

**When to use:** Any time the processed output is a binary file (Excel) that cannot be embedded in the JSON response. This is the correct pattern here.

**Trade-offs:** Requires disk space management (TTL cleanup). Keeps response payload small (JSON diff for display + session ID for download, not the full file in-line).

**Example:**

```python
# routes/download.py
@router.get("/download/{session_id}/{factory}")
def download_result(session_id: str, factory: str):
    path = get_session_file(session_id, factory)
    return FileResponse(path, filename=f"{factory}_schedule_checked.xlsx")
```

### Pattern 3: Field-Mapping Configuration

**What:** The mapping between PO PDF field labels and Excel column headers is defined in a configuration dict (not hard-coded in comparison logic). When the Excel template changes, only the config dict needs updating.

**When to use:** Whenever two document formats must be reconciled by column name — this project has exactly this need.

**Trade-offs:** Slightly more indirection, but pays off the first time the schedule template format changes.

**Example:**

```python
# engine/reconciler.py
FIELD_MAP = {
    "TOMY PO":         "TOMY PO",
    "CUSTOMER PO":     "CUSTOMER PO",
    "Item No.":        "货号",
    "Quantity":        "数量",
    "Ship Date":       "PO走货期",
    # ...
}

def reconcile(po: dict, row: dict) -> list[FieldMismatch]:
    mismatches = []
    for po_key, excel_col in FIELD_MAP.items():
        if po.get(po_key) != row.get(excel_col):
            mismatches.append(FieldMismatch(field=excel_col, po_value=po[po_key], schedule_value=row[excel_col]))
    return mismatches
```

## Data Flow

### Main Processing Flow

```
User selects PDF files + Excel schedule template
    |
    v
Browser POSTs multipart/form-data to POST /process
    |
    v
API Router receives UploadFile list
    |
    +---> PDF Parser (pdfplumber)
    |         reads each PDF bytes
    |         extracts key-value fields per PO
    |         returns list[PORecord]
    |
    +---> Excel Parser (openpyxl)
              reads schedule template bytes
              maps column headers to row dicts
              returns list[ScheduleRow]
    |
    v
Reconciliation Engine
    - matches PO records to schedule rows by TOMY PO number
    - compares field-by-field using FIELD_MAP
    - produces list[FieldMismatch] with row/column coordinates
    |
    v
Date Code Generator
    - for each PO: ship_date - 1 month
    - if result is weekend or CN holiday: step back to previous workday
    - format: month_letter + day + year_2digit + factory_code
    |
    v
Factory Router
    - splits results into RR01 (Dongguan) and RR02 (Indonesia) sets
    |
    v
Excel Writer (openpyxl)
    - opens schedule template
    - fills in date codes
    - applies red PatternFill to mismatched cells
    - saves one output file per factory to session dir
    |
    v
API returns JSON:
    {
      "session_id": "abc123",
      "dongguan_mismatches": [...],
      "indonesia_mismatches": [...]
    }
    |
    v
Frontend renders diff table (mismatches highlighted)
User clicks Download -> GET /download/{session_id}/{factory}
    |
    v
FileResponse streams .xlsx to browser
```

### Key Data Flows

1. **PDF -> Structured dict:** pdfplumber extracts raw text per page; regex patterns match known TOMY PO field labels (e.g., "PO No.:", "Ship Date:"); result is a flat dict keyed by field name.

2. **Excel template -> row dicts:** openpyxl reads the template; first row is treated as header; subsequent rows become dicts keyed by column header name.

3. **Diff result -> highlighted Excel:** The mismatch list carries `(row_index, col_name)` coordinates; the writer translates these to openpyxl cell addresses and applies `PatternFill(fgColor="FF0000")`.

4. **Ship date -> date code:** `ship_date - relativedelta(months=1)` gives candidate date; `chinese_calendar.is_workday(candidate)` determines if adjustment is needed; loop steps back one day at a time until a workday is found; final date formatted with month-letter table.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-5 concurrent users | Single-process FastAPI with synchronous processing; no queue needed; local disk for temp files. This is the target scale. |
| 10-50 concurrent users | Add async file I/O (aiofiles); consider uvicorn with multiple workers behind Nginx (already present in repo). |
| 50+ concurrent users | Move processing to Celery + Redis task queue; store temp files in object storage (S3 / MinIO); poll job status endpoint. |

### Scaling Priorities

1. **First bottleneck:** File processing blocks the event loop if done synchronously in an async FastAPI handler. Fix: run CPU-bound processing in `asyncio.run_in_executor` (thread pool) or use a sync route with uvicorn workers.
2. **Second bottleneck:** Temp disk fills up if sessions are never cleaned. Fix: add a background cleanup task that deletes sessions older than 1 hour.

## Anti-Patterns

### Anti-Pattern 1: Embedding Large Files in JSON Response

**What people do:** Return the processed Excel file as a base64-encoded string inside the JSON response.

**Why it's wrong:** ~230 KB PDFs × multiple files + output Excel = several MB in a single JSON payload. Wastes memory, slows response, makes the diff data harder to use.

**Do this instead:** Return JSON with diff data for display + a session ID. Serve the file via a separate `GET /download/{session_id}` route using `FileResponse`.

### Anti-Pattern 2: Hard-Coding Field Labels from the PDF

**What people do:** Write `po_data["PO No."]` directly throughout comparison code because the current PDF always uses that label.

**Why it's wrong:** TOMY may update their PDF template; any label change silently breaks parsing with no clear error.

**Do this instead:** Define all expected field labels in a single `EXPECTED_FIELDS` config. Validate that all expected fields were found after parsing; raise a descriptive error if any are missing.

### Anti-Pattern 3: Mutating the User's Original Excel Template

**What people do:** Open the uploaded Excel file and write directly to it, then send it back.

**Why it's wrong:** If two users upload the same template simultaneously, writes collide. Also means the original template is lost if something goes wrong.

**Do this instead:** Copy the template bytes to a session-specific path before writing. Never modify the user-uploaded file in place.

### Anti-Pattern 4: Ignoring Workday Edge Cases

**What people do:** Subtract exactly 30 days from the ship date for the date code, without checking weekends or holidays.

**Why it's wrong:** The business rule is "1 calendar month back, then step to the nearest prior workday." Subtracting 30 days is not the same as subtracting 1 month (months have 28-31 days). Also silently produces wrong codes for February dates.

**Do this instead:** Use `dateutil.relativedelta(months=1)` for the month subtraction, then use `chinese_calendar.is_workday()` in a loop to find the correct workday.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| chinese-calendar (PyPI) | Import as Python library | Supports 2004–2026; update annually when CN government announces holiday schedule |
| pdfplumber (PyPI) | Import as Python library; pass bytes | Works on machine-generated PDFs; not for scanned images (out of scope) |
| openpyxl (PyPI) | Import as Python library; read/write .xlsx | Do not use xlrd for .xlsx; xlrd only supports .xls (older format) |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Frontend ↔ Backend | HTTP REST (multipart upload in, JSON + file download out) | CORS must be configured for dev (Vite dev server port vs FastAPI port) |
| PDF Parser ↔ Engine | Python function call; parser returns `list[dict]` | Parser owns format knowledge; engine owns comparison logic |
| Excel Parser ↔ Engine | Python function call; parser returns `list[dict]` with column-name keys | Parser must normalize header names (strip whitespace, handle merged cells) |
| Engine ↔ Writer | Engine returns `list[FieldMismatch]` with `(row_idx, col_name)` coordinates; writer translates to cell addresses | Keep coordinate system in row/col index form, not A1 notation, until the writer layer |
| Backend ↔ Temp Storage | File I/O via session directory paths | Session IDs must be UUIDs to prevent path traversal; validate before use |

## Build Order Implications

The component dependency graph dictates this build sequence:

1. **PDF Parser** — no dependencies; build and test with real PO files first to confirm field extraction accuracy.
2. **Excel Parser** — no dependencies; build and test with real schedule templates to confirm column mapping.
3. **Reconciliation Engine** — depends on parser output schemas; build after parsers are stable.
4. **Date Code Generator** — independent of other components; build and test with known ship dates.
5. **Factory Router** — trivial; one string prefix check; build alongside the engine.
6. **Excel Writer** — depends on reconciliation result schema; build after engine is stable.
7. **API Router + Session Storage** — ties everything together; build after all processing components are complete.
8. **Frontend** — build against the finalized API contract; can be started in parallel with step 7 using mock data.

## Sources

- pdfplumber GitHub: https://github.com/jsvine/pdfplumber
- FastAPI file upload docs: https://fastapi.tiangolo.com/tutorial/request-files/
- FastAPI background tasks: https://fastapi.tiangolo.com/tutorial/background-tasks/
- openpyxl conditional formatting (GeeksforGeeks): https://www.geeksforgeeks.org/python/adding-conditional-formatting-to-excel-using-python-openpyxl/
- chinese-calendar (LKI): https://github.com/LKI/chinese-calendar/blob/master/README.en.md
- Excel diff with Python (Matthew Kudija): https://matthewkudija.com/blog/2018/07/21/excel-diff/
- FastAPI file upload and background tasks (Medium): https://medium.com/@marcelo.benencase/file-uploading-and-background-tasks-on-fastapi-883d73f5ea61
- Modern web app architecture 2026 (Golden Owl): https://goldenowl.asia/blog/web-application-architecture

---
*Architecture research for: PO reconciliation and scheduling verification — TOMY排期核对*
*Researched: 2026-03-20*
