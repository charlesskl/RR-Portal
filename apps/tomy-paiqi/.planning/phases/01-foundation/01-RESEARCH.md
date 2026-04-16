# Phase 1: Foundation - Research

**Researched:** 2026-03-20
**Domain:** Node.js + Express + React + Vite monorepo scaffolding; Docker + Nginx deployment; npm library installation and validation
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLAT-01 | Application runs as a web app accessible via browser | Vite-built React frontend served as static files by Express (or Nginx in production); browser access confirmed by serving from a known IP:port on the LAN |
| PLAT-02 | Application works across different computers without installation | Docker image packages all dependencies; user accesses via browser at server IP — no local Node.js or npm required on client machines |
</phase_requirements>

---

## Summary

Phase 1 is pure infrastructure: create a working project scaffold that satisfies PLAT-01 and PLAT-02, locks in all critical library choices, and produces a minimal upload form in the browser. There is no business logic in this phase — the deliverable is a running Docker container that a user on another machine can reach in a browser.

The project root is currently empty except for sample data files (8 PDF POs and 2 Excel schedule templates). Node.js 24.14.0 and npm 11.9.0 are available on the development machine. Docker was not found in the shell PATH — this must be verified separately (Docker Desktop on Windows may need a shell restart or `docker` may only be available in PowerShell, not bash). The project's STACK.md and SUMMARY.md documents from the prior research phase are authoritative and were verified against official sources. All library choices from those documents are locked in and must not be reconsidered here.

The single most important constraint for this phase is getting the Docker + Nginx stack running correctly end-to-end, including `client_max_body_size 50M` in nginx.conf (the default 1MB blocks real upload batches). All other Phase 1 success criteria — library installation, the minimal upload form — are straightforward once the monorepo scaffold is in place.

**Primary recommendation:** Scaffold a Node.js/Express backend + Vite/React frontend monorepo, install all required libraries, wire them into a Docker + Nginx deployment, and verify cross-machine access before touching any business logic.

---

## Standard Stack

### Core (locked — do not reconsider)

| Library | Version | Purpose | Why Locked |
|---------|---------|---------|------------|
| Node.js | 24.14.0 (installed) | Server runtime | Already on dev machine; newer than 22.x LTS; compatible with all required libraries |
| Express | 4.21.x | HTTP API server and static file serving | Decided in prior research; trivial setup for this scale |
| React | 18.x | Frontend UI framework | Decided in prior research; required by antd v5 |
| TypeScript | 5.x | Type safety across front and back | Decided in prior research; ExcelJS and pdf-parse have complete TS types |
| Vite | 6.x | Frontend build tool and dev server | Decided in prior research; replaces deprecated CRA |
| ExcelJS | 4.4.0 | Excel read/write with cell-level styling | LOCKED — only library that supports red-cell fill on roundtrip; switching mid-project is a full rewrite |
| chinese-days | 1.5.4 | Chinese public holiday and workday lookup | LOCKED — covers 2026 data including adjusted Saturdays; not a static list |
| date-fns | 3.x | Date arithmetic (subMonths, weekend detection) | LOCKED — ESM-first, TypeScript-native, pairs with chinese-days |
| multer | 2.1.1 | Multipart file upload middleware | LOCKED — v2.1.1 published March 2026; use MemoryStorage |
| pdfjs-dist (or pdf-parse) | latest | PDF text extraction | Decision deferred to Phase 2 after inspecting actual PO files; install BOTH in Phase 1 so the choice can be made without re-running npm install |

### Supporting (Phase 1 installs, later phases configure)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cors | 2.8.5 | CORS headers for Express | Required during Vite dev server (port 5173) vs Express (port 3000) development |
| antd | 5.x | UI component library | Ant Design Table with per-cell rendering; used in Phase 2+ for diff viewer |
| axios | 1.x | HTTP client in frontend | Multipart form upload handling; used in Phase 2+ |

### What NOT to Install (locked exclusions)

| Package | Reason |
|---------|--------|
| xlsx / sheetjs | CVE-2023-30533; cannot write cell styles; 0.19.3 fix not on public npm |
| node-xlsx | Thin SheetJS wrapper — same problems |
| Create React App | Deprecated 2023; use Vite |
| Python/Flask/FastAPI | Team context is JavaScript; architecture is Node.js |

### Installation Commands

```bash
# Initialize the project (run in project root)
npm init -y

# Backend dependencies
npm install express cors multer pdf-parse pdfjs-dist exceljs chinese-days date-fns

# Frontend (inside client/ directory)
mkdir client && cd client
npm create vite@latest . -- --template react-ts
npm install antd axios

# Dev dependencies (project root)
npm install -D typescript tsx @types/node @types/express @types/multer @types/cors @types/pdf-parse
npm install -D eslint prettier @typescript-eslint/parser vitest

# Return to root
cd ..
```

---

## Architecture Patterns

### Recommended Project Structure

```
TOMY排期核对/           # project root
├── server/             # Express backend (TypeScript)
│   ├── index.ts        # Server entry point; starts Express; configures multer, cors
│   └── routes/         # Route handlers (empty in Phase 1; stubs only)
│       └── upload.ts   # POST /api/process — stub returning 200 OK
├── client/             # Vite + React frontend
│   ├── index.html      # Vite HTML entry point
│   ├── src/
│   │   ├── main.tsx    # React mount
│   │   └── App.tsx     # Minimal upload form (Phase 1 deliverable)
│   ├── vite.config.ts  # Vite config with proxy to :3000 in dev
│   └── package.json    # Frontend package.json (separate from root)
├── nginx/
│   └── nginx.conf      # Nginx config with client_max_body_size 50M
├── Dockerfile          # Multi-stage build: build frontend, run backend
├── docker-compose.yml  # Orchestrate app + nginx containers
├── package.json        # Root package.json for backend deps
├── tsconfig.json       # TypeScript config for server/
└── .planning/          # GSD planning docs (already exists)
```

### Pattern 1: Multi-Stage Docker Build (frontend + backend in one image)

**What:** A single Dockerfile builds the React frontend (Vite build), then copies the `dist/` output into a Node.js image alongside the compiled Express server. Nginx sits in front as a reverse proxy, serving the static frontend files and forwarding `/api/*` requests to Express.

**When to use:** This is the standard pattern for a Node.js + React app served via Docker + Nginx. It is the correct pattern for PLAT-02 (no installation on client machines).

```dockerfile
# Stage 1: Build frontend
FROM node:24-alpine AS frontend-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ .
RUN npm run build

# Stage 2: Backend runtime
FROM node:24-alpine AS backend
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY server/ ./server/
COPY --from=frontend-build /app/client/dist ./client/dist
EXPOSE 3000
CMD ["node", "server/index.js"]
```

### Pattern 2: Nginx Reverse Proxy with 50M Upload Limit

**What:** Nginx serves static files from `/app/client/dist` and proxies `/api/*` to the Express backend on port 3000. `client_max_body_size 50M` is set at the `server` block level (not just a single `location`) so it applies to all upload routes, including any added in later phases.

**When to use:** Always in Docker deployment. Setting it only in a `location` block is an anti-pattern — new upload routes added later will silently inherit the 1MB default.

```nginx
# nginx/nginx.conf
server {
    listen 80;
    client_max_body_size 50M;    # MUST be at server block level

    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://app:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;   # allow time for PDF batch processing
    }
}
```

### Pattern 3: Vite Dev Proxy for Frontend-Backend Development

**What:** During development, Vite runs on port 5173 and the Express backend runs on port 3000. Configuring a proxy in `vite.config.ts` routes `/api/*` calls from the frontend to Express — no CORS issues, no need to change URLs between dev and prod.

```typescript
// client/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  }
})
```

### Pattern 4: Express Serves Built Frontend as Static Files (Production)

**What:** In production (inside Docker), Express serves the Vite-built `client/dist/` as static files AND handles API routes. This means the Nginx container only needs to proxy `/api/` — or alternatively, Express itself can be the only process and Nginx is not needed for static files.

**Recommendation:** Use Nginx as the edge server (standard for Docker deployments) and have it serve static files directly. Express handles only `/api/*`. This is slightly more efficient and gives Nginx control over caching headers.

```typescript
// server/index.ts
import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))  // match Nginx limit

// API routes
app.use('/api', uploadRouter)  // stub in Phase 1

// Serve frontend in production (optional fallback if not using Nginx for static)
// app.use(express.static(path.join(__dirname, '../client/dist')))

app.listen(3000, () => console.log('Server running on :3000'))
```

### Anti-Patterns to Avoid

- **Putting client_max_body_size only in a location block:** New upload routes added in Phase 2 would silently get the 1MB default. Set it at `server` block level.
- **Using CRA (`npx create-react-app`):** Deprecated since 2023; use `npm create vite@latest`.
- **Forgetting multer file size limit:** Nginx has `client_max_body_size 50M` but multer defaults to no limit (memory exhaustion). Always set `limits: { fileSize: 20 * 1024 * 1024 }` on multer instances.
- **Installing SheetJS / xlsx:** npm has the vulnerable pre-0.19.3 version. Even if installed "just to try it," it pollutes the lockfile and creates supply chain risk.
- **Committing sample PDF/Excel files:** The 8 PO PDFs and 2 Excel templates in the project root are real business data. Add them to `.gitignore` or move to a `DATA/` directory excluded from git.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multipart file upload parsing | Custom body parser for `multipart/form-data` | multer 2.1.1 | Correct boundary parsing has many edge cases; multer is battle-tested |
| Frontend bundling | Custom webpack config | Vite 6 | Hot module replacement, tree-shaking, TS transpilation — hundreds of edge cases |
| Chinese holiday lookup | Static list of holidays in a JS object | chinese-days 1.5.4 | Adjusted working Saturdays, annual updates, correct year boundaries |
| Date arithmetic (months) | `new Date(date.getFullYear(), date.getMonth() - 1, date.getDate())` | date-fns subMonths | Month arithmetic across year boundaries (January - 1 = December previous year) has many bugs in hand-rolled code |
| CORS headers | Manual `res.setHeader('Access-Control-...')` | cors middleware | Preflight handling, wildcard vs specific origin, credentials — all complex |
| Docker health checks | Shell script polling | Docker `HEALTHCHECK` directive | Built into Docker; integrates with compose restart policies |

**Key insight:** This phase is infrastructure scaffolding. Every "build your own" temptation is a trap — the tools are mature and the edge cases are well-known. The goal is a working scaffold in minimum time so Phase 2 can start on business logic.

---

## Common Pitfalls

### Pitfall 1: Docker Not Available in bash on Windows

**What goes wrong:** `docker --version` returns "not found" in git bash but Docker Desktop is installed. Docker Desktop on Windows adds the CLI to the Windows PATH but not always to git bash's PATH.

**Why it happens:** Git bash uses its own PATH derived from Windows environment variables at launch time. Docker Desktop may need a restart or the PATH variable may need to be set in `~/.bashrc`.

**How to avoid:** Verify Docker availability via PowerShell (`docker --version`) before assuming it is unavailable. If Docker Desktop is installed, it should be accessible from PowerShell even if git bash can not find it. Alternatively, add `C:/Program Files/Docker/Docker/resources/bin` to git bash PATH in `~/.bash_profile`.

**Warning signs:** `docker: command not found` in bash but Docker Desktop is running in the system tray.

### Pitfall 2: Nginx client_max_body_size at Wrong Block Level

**What goes wrong:** `client_max_body_size 50M` is placed inside `location /api/` only. When Phase 2 adds a second upload route (`/api/upload-schedule`), that route silently inherits the 1MB default and returns 413 errors on large Excel files.

**How to avoid:** Always place `client_max_body_size` at the `server` block level in nginx.conf.

### Pitfall 3: multer MemoryStorage with No File Size Limit

**What goes wrong:** multer's default `MemoryStorage` has no size limit. A user uploading 8 PDFs (~1.9MB total) plus an Excel file is fine, but if a user accidentally uploads a video file or the wrong file type, it buffers the entire thing into Node.js heap before any validation runs.

**How to avoid:** Set `limits: { fileSize: 25 * 1024 * 1024 }` on the multer instance (25MB per file; consistent with the 50M total Nginx limit for a batch of files).

### Pitfall 4: TypeScript Config Does Not Cover Both server/ and client/

**What goes wrong:** A single `tsconfig.json` at the project root is configured for the backend, but the Vite frontend's TypeScript is configured separately in `client/tsconfig.json`. If the root tsconfig `include` glob accidentally covers `client/src/`, the TypeScript compiler complains about React JSX settings and browser-only types conflicting with Node.js types.

**How to avoid:** Use two separate tsconfig files: one in the project root for `server/` (targeting Node.js), and one in `client/` for the React frontend (targeting browser). The Vite template generates the correct `client/tsconfig.json` automatically.

### Pitfall 5: Sample Data Files Committed to Git

**What goes wrong:** The 8 PDF POs and 2 Excel files in the project root are real business documents (actual TOMY purchase orders). If committed to a git repository that is later pushed to a remote, this is a data exposure risk.

**How to avoid:** Add all real data files to `.gitignore` immediately in the first commit. Move them to a `DATA/` directory if helpful for organization:
```
DATA/
*.pdf
*.xlsx
!client/**/*.xlsx  # allow Excel fixtures in tests if needed
```

---

## Code Examples

### Minimal Express Server (Phase 1 stub)

```typescript
// server/index.ts
import express from 'express'
import cors from 'cors'
import path from 'path'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Phase 1 stub: upload endpoint returns 200 OK
app.post('/api/process', (req, res) => {
  res.json({ status: 'ok', message: 'Phase 1 stub — not yet implemented' })
})

// Health check (used by Docker HEALTHCHECK)
app.get('/health', (_req, res) => res.json({ status: 'healthy' }))

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
```

### Minimal Upload Form (Phase 1 React component)

```tsx
// client/src/App.tsx
import { useState } from 'react'

export default function App() {
  const [status, setStatus] = useState<string>('')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    setStatus('上传中...')
    try {
      const res = await fetch('/api/process', { method: 'POST', body: data })
      const json = await res.json()
      setStatus(JSON.stringify(json))
    } catch (err) {
      setStatus('上传失败')
    }
  }

  return (
    <div style={{ padding: 32 }}>
      <h1>TOMY 排期核对系统</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>PO 文件 (PDF)</label>
          <input type="file" name="pos" multiple accept=".pdf" />
        </div>
        <div>
          <label>排期表 (Excel)</label>
          <input type="file" name="schedule" accept=".xlsx,.xls" />
        </div>
        <button type="submit">上传并核对</button>
      </form>
      {status && <p>{status}</p>}
    </div>
  )
}
```

### docker-compose.yml (Phase 1 structure)

```yaml
# docker-compose.yml
version: '3.9'
services:
  app:
    build: .
    expose:
      - "3000"
    environment:
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      app:
        condition: service_healthy
```

### Library Import Smoke Tests

These verify the critical libraries are installed and importable — run as part of the Phase 1 verification:

```typescript
// server/smoke-test.ts  (run with: npx tsx server/smoke-test.ts)
import ExcelJS from 'exceljs'
import { isWorkday } from 'chinese-days'
import { subMonths } from 'date-fns'
import multer from 'multer'
import pdfParse from 'pdf-parse'

// ExcelJS: create a workbook and write a red cell
async function smokeExcelJS() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('test')
  const cell = ws.getCell('A1')
  cell.value = 'TEST'
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }
  const buf = await wb.xlsx.writeBuffer()
  console.log('ExcelJS OK — buffer size:', buf.byteLength)
}

// chinese-days: verify 2026 data loaded
function smokeChinese() {
  const testDate = new Date(2026, 9, 1)  // 2026-10-01 National Day
  const result = isWorkday(testDate)
  console.log('chinese-days OK — 2026-10-01 isWorkday:', result)  // expected: false
}

// date-fns: month subtraction
function smokeDateFns() {
  const result = subMonths(new Date(2026, 0, 1), 1)
  console.log('date-fns OK — Jan 2026 minus 1 month:', result.toISOString())  // expected: 2025-12-01
}

smokeExcelJS()
smokeChinese()
smokeDateFns()
console.log('multer imported OK')
console.log('pdf-parse imported OK')
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (installed as dev dependency in project root) |
| Config file | vitest.config.ts — created in Wave 0 of Phase 1 |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAT-01 | Express server starts and returns 200 on GET /health | smoke | `npx tsx server/smoke-test.ts` | Wave 0 |
| PLAT-01 | Minimal upload form renders (React component mounts) | manual | Open browser at http://localhost:3000 | - |
| PLAT-02 | Docker container starts and is reachable on port 80 | smoke/manual | `docker compose up -d && curl http://localhost/health` | - |
| PLAT-02 | nginx.conf has client_max_body_size 50M | static | `grep -c 'client_max_body_size 50M' nginx/nginx.conf` | Wave 0 |
| SC-3 | All 5 libraries importable (ExcelJS, pdfjs-dist, chinese-days, multer, date-fns) | smoke | `npx tsx server/smoke-test.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx tsx server/smoke-test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** `docker compose up -d && curl http://localhost/health` (full Docker stack verified) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `server/smoke-test.ts` — covers PLAT-01, SC-3 (library imports + server health)
- [ ] `vitest.config.ts` — Vitest configuration pointing to `server/` and `client/src/`
- [ ] `nginx/nginx.conf` — Nginx config file with client_max_body_size 50M
- [ ] Framework install: `npm install -D vitest` — if not yet in devDependencies

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Create React App | Vite | 2023 (CRA deprecated) | Vite is 20–30x faster; do not use CRA |
| multer 1.x | multer 2.1.1 | March 2026 | v2 has API changes; use v2 documentation, not v1 tutorials |
| SheetJS / xlsx | ExcelJS | Ongoing (CVE + style write limitation) | SheetJS CE cannot write cell styles; ExcelJS required for red-highlight feature |
| Single-container deployment | Multi-stage Docker build | 2020+ standard | Smaller production image; separate build and runtime stages |

**Deprecated/outdated:**
- `ts-node`: Still works but `tsx` is faster for local backend development.
- `webpack` + manual React config: Replaced by Vite for all new projects.
- `npm install -g create-react-app`: The global CRA package is deprecated; remove it if installed.

---

## Open Questions

1. **Docker availability on the development machine**
   - What we know: `docker` command not found in bash PATH; Docker Desktop may be installed separately
   - What's unclear: Whether Docker is available at all, or just not in bash PATH
   - Recommendation: Check in PowerShell/cmd first; if Docker Desktop is installed, it should be available there. If not installed, Docker Desktop must be installed before Phase 1 can be completed.

2. **Project structure: monorepo (one package.json) vs two (root + client/)**
   - What we know: STACK.md recommends separate installs for backend and frontend
   - What's unclear: Whether the team prefers a workspace setup (npm workspaces) or two independent package.json files
   - Recommendation: Use two separate `package.json` files (root for backend, `client/` for frontend). npm workspaces add complexity without significant benefit at this scale. The Vite template generates `client/package.json` automatically.

3. **Dockerfile TypeScript compilation strategy**
   - What we know: Express backend is TypeScript; production Docker image must run compiled JS
   - What's unclear: Whether to compile TypeScript at Docker build time (`tsc`) or run with `tsx` in production
   - Recommendation: Compile with `tsc` to `dist/` during Docker build (`RUN npm run build`). Running `tsx` in production is acceptable for an internal tool but compiled JS is faster and avoids dev dependency on `tsx` in the runtime image.

---

## Sources

### Primary (HIGH confidence)

- STACK.md (`.planning/research/STACK.md`) — library versions, installation commands, "what not to use" section verified against npm and official GitHub
- PITFALLS.md (`.planning/research/PITFALLS.md`) — Nginx upload limit pitfall, multer MemoryStorage pitfall, ExcelJS merge pitfall — all verified against official library documentation and GitHub issues
- SUMMARY.md (`.planning/research/SUMMARY.md`) — executive summary and phase implications from prior research cycle
- Vite official documentation: https://vite.dev/guide/ — project scaffolding with `npm create vite@latest`
- ExcelJS GitHub: https://github.com/exceljs/exceljs — PatternFill API confirmed
- multer npm: https://www.npmjs.com/package/multer — v2.1.1, published March 2026

### Secondary (MEDIUM confidence)

- Nginx client_max_body_size — BetterStack: https://betterstack.com/community/questions/default-nginx-client-max-body-size-value/ — 1MB default confirmed
- Node.js 24.x compatibility with Express 4 and ExcelJS 4.4.0 — from npm version compatibility tables in STACK.md

### Tertiary (LOW confidence — flag for validation)

- Docker Desktop PATH behavior on Windows with git bash — based on common Windows Docker setup patterns; validate on the actual development machine

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — libraries verified in prior research phase against npm and official GitHub
- Architecture: HIGH — Docker + Nginx + Node.js + Vite is a well-established pattern with extensive official documentation
- Pitfalls: HIGH — Nginx upload limit and multer limits are verified against official Nginx docs and real project behavior
- Docker availability: LOW — environment check returned "not found"; must verify in PowerShell before assuming Docker is unavailable

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (stable libraries; Nginx and Docker patterns are long-lived; multer v2 API is new as of March 2026 so use v2 documentation specifically)
