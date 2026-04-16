# Stack Research

**Domain:** Web app — PDF parsing, Excel read/write, data reconciliation
**Researched:** 2026-03-20
**Confidence:** MEDIUM (core libraries verified; some version details from npm search results rather than direct registry access)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22.x LTS | Server runtime | LTS with native fetch, long-term support until 2027; matches where the ecosystem has converged |
| Express | 4.21.x | HTTP server, file upload routing | Battle-tested, massive middleware ecosystem, trivially simple for this domain; Fastify is faster but the performance gap is irrelevant for a file-processing app used by a few concurrent users |
| React | 18.x | Frontend UI | Better ecosystem for data table rendering and mismatch highlighting than Vue; Ant Design and React Table both target React specifically |
| TypeScript | 5.x | Type safety across front and back | Both ExcelJS and pdf-parse have complete type definitions; catching field-name mismatches at compile time pays off early in a reconciliation app |
| Vite | 6.x | Frontend build tool | Replaced Create React App as the de-facto standard; 20-30x faster TS transpilation, sub-50ms HMR |

### File Processing Libraries

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| pdf-parse | 1.1.1 | Extract text from PDF POs | Simplest API for text-selectable PDFs (one function call); 2M weekly downloads; no native binaries; no known vulnerabilities (March 2026); wraps pdfjs-dist internally |
| exceljs | 4.4.0 | Read existing Excel scheduling templates and write results with cell-level styling | Only major library that supports reading an existing .xlsx file AND writing back rich formatting (cell background color for red-highlight mismatches) to the same file structure; SheetJS/xlsx is disqualified |

### Date and Calendar Libraries

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| chinese-days | 1.5.4 | Chinese public holiday lookup and workday calculation | Covers 2004–2026 holiday data; specifically designed for "is this date a workday?" queries in the Chinese calendar; actively maintained with 2026 data included; the date-holidays package covers China but is a heavier general-purpose library |
| date-fns | 3.x | Date arithmetic (subtract 1 month, weekend detection) | Tree-shakeable, immutable, TypeScript-native; use for the month-subtraction step before passing the result to chinese-days for workday validation |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| multer | 2.1.1 | Multipart file upload middleware for Express | Handling PDF and Excel file uploads from browser to server; use MemoryStorage to keep files in-memory and pass directly to pdf-parse / exceljs without hitting disk |
| cors | 2.8.5 | CORS headers for Express | Required when frontend (Vite dev server on :5173) calls backend (Express on :3000) during development |
| Ant Design (antd) | 5.x | UI component library | Ships a Table component with per-cell rendering (needed for conditional red-cell highlight), Upload component, and a professional Chinese-language-compatible design system |
| axios | 1.x | HTTP client in frontend | Handles multipart form upload and response streaming better than raw fetch for large files |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vite | Frontend bundler and dev server | `npm create vite@latest -- --template react-ts` |
| tsx | TypeScript execution for Node.js backend dev | Faster than ts-node for running Express server during development |
| ESLint + Prettier | Code quality | Use `@typescript-eslint/parser`; configure once at project root covering both `src/` and `server/` |
| Vitest | Unit testing | Same config as Vite; use for date-code generation logic and field-comparison functions — high-value tests before manual QA |

---

## Installation

```bash
# Backend
npm install express multer cors pdf-parse exceljs chinese-days date-fns

# Frontend (inside client/ or src/)
npm install react react-dom antd axios

# Dev dependencies (root)
npm install -D typescript tsx vite @vitejs/plugin-react eslint prettier vitest
npm install -D @types/node @types/express @types/multer @types/cors @types/pdf-parse
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| pdf-parse | pdfjs-dist (direct) | When you need layout-aware extraction (table column positions, coordinates); this project's PDFs are text-selectable so raw text extraction is sufficient |
| pdf-parse | unpdf | When targeting edge runtimes (Cloudflare Workers, Vercel Edge); for a Node.js Express server, pdf-parse's simpler API is preferable |
| exceljs | xlsx (SheetJS CE) | Never — see "What NOT to Use" |
| Express | Fastify | If you were building a high-throughput API; for a file-processing tool with 1-5 concurrent users the performance difference is irrelevant and Express has more beginner-friendly middleware |
| chinese-days | date-holidays | date-holidays is a general-purpose multi-country library (3.26.11, actively maintained); use it if you later need non-Chinese holiday calendars; for China-only workday calculation chinese-days is more specific and lighter |
| React + Ant Design | Vue + Element Plus | If the team has strong Vue familiarity; both are valid, but React + Ant Design has better TypeScript integration and the Ant Design Table component's cell rendering API is better documented for this exact use case |
| Vite | Create React App | Never — CRA is deprecated as of 2023 |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| xlsx (SheetJS) from npm | CVE-2023-30533 (Prototype Pollution) was fixed in 0.19.3 but that version was never published to the public npm registry; installing `xlsx` via npm gives you a vulnerable version; maintainers moved distribution to their own CDN causing supply-chain confusion | exceljs |
| pdf2json / pdfreader | Aging wrappers with irregular maintenance; more complex API for no benefit on text-selectable PDFs | pdf-parse |
| node-xlsx | Thin wrapper around SheetJS/xlsx; inherits the same vulnerability and limited write/styling support | exceljs |
| Tesseract.js / OCR libraries | Out of scope per PROJECT.md — POs are text-selectable, not scanned | pdf-parse (no OCR needed) |
| Python (Flask/FastAPI) | The team is already working in a JavaScript/browser context; mixing runtimes adds operational overhead for a small-team internal tool; pdf-parse and exceljs cover the same capabilities | Node.js + Express |
| SQLite / any database | No persistence requirement in this system — files go in, processed results go out; adding a database layer is premature complexity | Stateless file processing |

---

## Stack Patterns by Variant

**If PDFs have complex table layouts where column alignment matters:**
- Replace pdf-parse with pdfjs-dist direct API
- Use `page.getTextContent()` with `normalizeWhitespace: false` to get position data
- Because pdf-parse discards x/y coordinates; structured table extraction needs coordinate-aware parsing

**If the scheduling Excel template has merged cells:**
- Ensure exceljs `worksheet.getCell()` is used (not row iteration) to handle merged-cell reads correctly
- Because merged cells return undefined on non-master cells when iterating rows

**If deployed to multiple computers (LAN/intranet):**
- Run Express on a fixed port, serve the Vite-built frontend as static files from Express
- Use `express.static('dist')` after running `vite build`
- Because a single Express process serves both API and frontend; no separate Nginx needed for a small-team internal tool (though adding Nginx later for HTTPS termination is straightforward)

**If the project grows to need authentication:**
- Add express-session + a simple JSON file of allowed users
- Because there is no sensitive external data; lightweight session management is sufficient

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| exceljs@4.4.0 | Node.js 14+ | No issues with Node 22; last published 2 years ago but 4.4M weekly downloads — stable, not abandoned |
| pdf-parse@1.1.1 | Node.js 12+ | Wraps pdfjs-dist internally; no native binary dependencies |
| chinese-days@1.5.4 | Node.js 16+ | Holiday data covers through 2026; verify yearly before deployment if project runs into 2027 |
| date-fns@3.x | ESM and CJS | Use date-fns v3 (not v2) — v3 is ESM-first and works cleanly with modern Vite and tsx tooling |
| antd@5.x | React 18.x | antd v4 targets React 16/17; must use antd v5 with React 18 |
| multer@2.1.1 | Express 4.x | multer v2 was released March 2026; compatible with Express 4 |

---

## Project-Specific Notes

**Date code generation** (`D1526RR02` format) is pure logic with no library needed beyond date-fns and chinese-days:

1. Parse PO shipping date from extracted PDF text
2. Subtract 1 month with `date-fns/subMonths`
3. Check if result is a workday with `chinese-days` `isWorkday()` function
4. If not, step backwards 1 day at a time until `isWorkday()` is true
5. Format: `MONTH_LETTER + DAY + YEAR_2DIGIT + FACTORY_CODE`

This logic belongs in a pure function tested by Vitest — it is the highest-risk business logic in the project and should have test cases covering month boundaries, holiday adjacency, and year rollover.

**Field extraction from PDFs** — pdf-parse returns a single string per page. For structured PO fields (PO number, shipping date, quantities), write regex extractors against known PDF field labels. The extraction layer should be the second-highest priority for unit testing.

---

## Sources

- [unpdf vs pdf-parse vs pdfjs-dist comparison (2026) — PkgPulse](https://www.pkgpulse.com/blog/unpdf-vs-pdf-parse-vs-pdfjs-dist-pdf-parsing-extraction-nodejs-2026) — MEDIUM confidence (third-party comparison, download stats verified against npm trends)
- [7 PDF Parsing Libraries for Node.js — Strapi Blog 2025](https://strapi.io/blog/7-best-javascript-pdf-parsing-libraries-nodejs-2025) — MEDIUM confidence
- [npm trends: exceljs vs sheetjs vs xlsx](https://npmtrends.com/exceljs-vs-sheetjs-vs-xlsx) — HIGH confidence (live download data)
- [CVE-2023-30533 — SheetJS Prototype Pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) — HIGH confidence (GitHub Security Advisory)
- [SheetJS npm distribution issue — 0.19.3 not on npm](https://git.sheetjs.com/sheetjs/sheetjs/issues/2961) — HIGH confidence (official SheetJS issue tracker)
- [chinese-days GitHub README](https://github.com/vsme/chinese-days/blob/main/README.en.md) — MEDIUM confidence (supports 2026 holiday data confirmed)
- [multer npm — v2.1.1, published March 2026](https://www.npmjs.com/package/multer) — HIGH confidence
- [Tailwind CSS v4 released January 22, 2025](https://tailwindcss.com/blog/tailwindcss-v4) — HIGH confidence (official blog; NOTE: Tailwind v4 is stable but Ant Design is preferred here because it ships a complete component set including Table with cell rendering, avoiding the need to compose low-level utility classes for a data-heavy UI)
- [Express vs Fastify 2025 — Better Stack](https://betterstack.com/community/guides/scaling-nodejs/fastify-express/) — MEDIUM confidence
- [Vite Getting Started — official docs](https://vite.dev/guide/) — HIGH confidence

---

*Stack research for: PO核对与排期管理系统 (TOMY PO Reconciliation and Scheduling)*
*Researched: 2026-03-20*
