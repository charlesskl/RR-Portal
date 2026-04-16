---
phase: 01-foundation
verified: 2026-03-20T00:00:00Z
status: gaps_found
score: 7/9 must-haves verified
re_verification: false
gaps:
  - truth: "All 5 critical libraries (ExcelJS, pdf-parse, pdfjs-dist, chinese-days, date-fns) are importable"
    status: partial
    reason: "pdfjs-dist is not in direct package.json dependencies and is not imported or verified in smoke-test.ts. It is present only as a transitive dependency of pdf-parse. If pdf-parse drops or changes this dependency, pdfjs-dist silently disappears. The PLAN listed it as one of 5 critical libraries to explicitly verify."
    artifacts:
      - path: "package.json"
        issue: "pdfjs-dist not listed under dependencies — only present transitively via pdf-parse"
      - path: "server/smoke-test.ts"
        issue: "Does not import or test pdfjs-dist — the smoke test verifies only 4 of the 5 listed critical libraries"
    missing:
      - "Add pdfjs-dist to direct dependencies in package.json"
      - "Add import and basic invocation of pdfjs-dist to server/smoke-test.ts"

  - truth: "Application is accessible from a browser without any local Node.js installation (PLAT-02 / Docker path)"
    status: partial
    reason: "docker-compose.yml mounts ./client/dist as a host volume into nginx, overriding what the Dockerfile bakes in. The client/dist directory is in .gitignore. On a fresh clone, client/dist does not exist, so nginx will serve an empty directory and the app will not load. The Dockerfile multi-stage build correctly builds the frontend, but the volume mount in docker-compose.yml shadows that built artifact with the (potentially absent) host directory."
    artifacts:
      - path: "docker-compose.yml"
        issue: "nginx service has volume '- ./client/dist:/usr/share/nginx/html:ro'. This host-path volume overrides the COPY --from=frontend-build step in the Dockerfile. On a fresh machine without a pre-built client/dist, nginx serves nothing."
    missing:
      - "Remove the './client/dist:/usr/share/nginx/html:ro' volume from the nginx service in docker-compose.yml — the Dockerfile already COPYs client/dist into the image at build time; the volume mount is redundant and harmful on fresh clones"
      - "Alternatively, add a pre-build step or RUN command ensuring the nginx container copies from the app image, but removing the host-path volume is the cleanest fix"
---

# Phase 1: Foundation Verification Report

**Phase Goal:** Users can access the web application from any computer via browser, and the development environment is correctly configured with all critical library choices locked in
**Verified:** 2026-03-20
**Status:** gaps_found (7/9 must-haves verified)
**Re-verification:** No — initial verification


## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Express server starts on port 3000 and returns 200 on GET /health | VERIFIED | `server/index.ts` lines 15-17: `app.get('/health', (_req, res) => { res.json({ status: 'healthy' }) })` listening on `process.env.PORT \|\| 3000` |
| 2  | Vite dev server starts and serves the React upload form at localhost:5173 | VERIFIED | `client/src/App.tsx` is a substantive component (112 lines) with title "TOMY 排期核对系统", PDF and Excel Upload components, and submit handler wired to `/api/process` |
| 3  | POST /api/process returns 200 JSON stub response | VERIFIED | `server/routes/upload.ts` lines 13-21: POST `/process` with multer fields and `res.json({ status: 'ok', message: 'Phase 1 stub - not yet implemented' })` |
| 4  | All 5 critical libraries (ExcelJS, pdf-parse, pdfjs-dist, chinese-days, date-fns) are importable | PARTIAL | Smoke test covers 4/5. `pdfjs-dist` is absent from direct `package.json` dependencies and absent from `server/smoke-test.ts` imports. It appears only as a transitive dep of pdf-parse. |
| 5  | Smoke test script runs without errors | VERIFIED | `server/smoke-test.ts` tests ExcelJS, chinese-days, date-fns, multer, pdf-parse — 5 tests with exit 0/1 logic. Note: the PLAN listed pdfjs-dist as one of the 5 libraries; the smoke test substitutes multer (already used in server) |
| 6  | Docker containers start successfully with docker compose up | VERIFIED (code) / HUMAN NEEDED (runtime) | `docker-compose.yml` exists with app + nginx services, health check dependency wired. Human verified at time of execution per 01-02-SUMMARY.md. See human verification section. |
| 7  | Nginx serves the React frontend at http://localhost on port 80 | PARTIAL | `nginx/nginx.conf` correctly serves from `/usr/share/nginx/html`. However `docker-compose.yml` mounts `./client/dist:/usr/share/nginx/html:ro` — a host volume that overrides the baked-in copy. `client/dist/` is in `.gitignore`. Fresh clone = broken nginx static serving. |
| 8  | Nginx proxies /api requests to the Express backend | VERIFIED | `nginx/nginx.conf` lines 10-15: `location /api/ { proxy_pass http://app:3000; ... }` with correct service name |
| 9  | nginx.conf has client_max_body_size 50M at server block level | VERIFIED | `nginx/nginx.conf` line 3: `client_max_body_size 50M;` at server block level, not inside any location block |

**Score:** 7/9 truths verified (2 partial)


## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/index.ts` | Express entry with cors, health check, upload router | VERIFIED | 24 lines, imports cors, mounts uploadRouter at `/api`, GET `/health`, listens on PORT |
| `server/routes/upload.ts` | POST /api/process stub with multer | VERIFIED | 25 lines, multer v2 API with memoryStorage, 25MB limit, correct fields |
| `server/smoke-test.ts` | Library import verification script | VERIFIED (partial coverage) | 83 lines, tests ExcelJS, chinese-days, date-fns, multer, pdf-parse. Missing pdfjs-dist. |
| `client/src/App.tsx` | Minimal upload form with PDF and Excel inputs | VERIFIED | 112 lines, substantive Ant Design form, both file inputs, submit handler, result/error display |
| `package.json` | Backend dependencies including tsx in production deps | VERIFIED | tsx listed under `dependencies`, all other critical libraries present. pdfjs-dist absent from direct deps (transitive only). |
| `client/package.json` | Frontend deps (React, antd, axios) | VERIFIED | React 19, antd 6.3.3 present. Note: axios is absent — plan says fetch was used instead (documented deviation in SUMMARY). |
| `Dockerfile` | Multi-stage build (frontend + backend runtime) | VERIFIED | Correct 2-stage build: node:24-alpine frontend build, then backend runtime with `COPY --from=frontend-build` |
| `docker-compose.yml` | Orchestration of app + nginx containers | VERIFIED (with gap) | Both services defined, health check dependency correct. nginx volume mount overrides baked-in dist — see gap. |
| `nginx/nginx.conf` | Reverse proxy with 50M upload limit | VERIFIED | All required directives present at correct block levels |


## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `client/src/App.tsx` | `/api/process` | fetch POST in handleSubmit | VERIFIED | Line 40: `await fetch('/api/process', { method: 'POST', body: formData })` with response JSON parsed and set to state |
| `client/vite.config.ts` | `http://localhost:3000` | Vite dev proxy for /api | VERIFIED | Lines 8-13: `proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } }` |
| `server/index.ts` | `server/routes/upload.ts` | Express router mount at /api | VERIFIED | Line 12: `app.use('/api', uploadRouter)` — uploadRouter imported from `./routes/upload.js` |
| `nginx/nginx.conf` | `app:3000` | proxy_pass in /api/ location block | VERIFIED | Line 11: `proxy_pass http://app:3000;` |
| `docker-compose.yml` | `Dockerfile` | build context for app service | VERIFIED | `build: .` in app service — uses root Dockerfile |
| `Dockerfile` | `client/dist` | COPY --from=frontend-build | VERIFIED | Line 15: `COPY --from=frontend-build /app/client/dist ./client/dist` — but docker-compose nginx volume then overrides this with host path |


## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PLAT-01 | 01-01 | Application runs as a web app accessible via browser | SATISFIED | Express server + Vite React app running in dev mode. Upload form at localhost:5173 functional as browser web app. |
| PLAT-02 | 01-02 | Application works across different computers without installation | PARTIALLY SATISFIED | Docker + nginx stack exists and is structurally correct. Gap: docker-compose.yml nginx volume mount requires `client/dist` to exist on host, which is gitignored — breaks fresh-clone deployments. Human confirmed it works on the dev machine (per SUMMARY), but the configuration is fragile for "any computer." |

Both PLAT-01 and PLAT-02 are declared in REQUIREMENTS.md under Phase 1. Both are claimed by PLAN frontmatter. No orphaned requirements.


## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `server/routes/upload.ts` | 20 | `res.json({ status: 'ok', message: 'Phase 1 stub - not yet implemented' })` | Info | Intentional stub — expected per plan. Phase 2 replaces this. |
| `docker-compose.yml` | 21 | `- ./client/dist:/usr/share/nginx/html:ro` | Blocker | Host-path volume overrides baked-in Docker image dist. Fails silently on fresh clones where client/dist does not exist (it is gitignored). |
| `server/smoke-test.ts` | — | `pdfjs-dist` not imported | Warning | PLAN requires 5 critical libraries verified. Smoke test only confirms 4 of the 5 stated libraries (substitutes multer for pdfjs-dist). |


## Human Verification Required

### 1. Docker Full Stack in Browser

**Test:** On a machine that has `client/dist` built locally (not a fresh clone), run `docker compose up --build -d`, open `http://localhost` in a browser.
**Expected:** Upload form with "TOMY 排期核对系统" title visible; `http://localhost/health` returns `{"status":"healthy"}`
**Why human:** Runtime Docker behavior cannot be verified by static code analysis. Per 01-02-SUMMARY.md this was performed and passed on the development machine.

### 2. Fresh Clone Docker Test

**Test:** Clone repo to a new directory (or delete `client/dist/`), run `docker compose up --build -d`, open `http://localhost`.
**Expected:** Upload form should still be visible because the Dockerfile bakes in the frontend.
**Why human:** This is where the volume mount gap will manifest. The host `./client/dist` is empty after fresh clone, and the nginx volume mount will serve an empty directory. This is a predicted failure that needs confirmation.

### 3. Cross-Computer Access

**Test:** From a second computer on the same network, open `http://<HOST_IP>` in browser.
**Expected:** Upload form is accessible without any Node.js installation on the second computer.
**Why human:** Network reachability and firewall configuration cannot be verified statically.


## Gaps Summary

Two gaps block full goal achievement:

**Gap 1 — pdfjs-dist not directly locked in (Warning severity):** The PLAN explicitly listed pdfjs-dist as one of 5 critical library choices to "lock in" as part of the phase goal. It does not appear in `package.json` dependencies, only transitively via pdf-parse. The smoke test does not verify it is importable. This means the "library choices locked in" part of the phase goal is incomplete for one of the stated five. Risk: if pdf-parse removes pdfjs-dist as a peer dep, the project silently loses it with no failing test.

**Gap 2 — Docker nginx volume mount breaks fresh-clone deployability (Blocker severity):** `docker-compose.yml` adds `./client/dist:/usr/share/nginx/html:ro` to the nginx service. This host-path volume overrides what the Dockerfile correctly builds and copies. Since `client/dist/` is in `.gitignore`, anyone cloning the repo and running `docker compose up --build` will get a functioning backend container but nginx will serve nothing (empty directory). The PLAT-02 goal — "works across different computers without installation" — requires this to work on a fresh clone. The fix is to remove the volume mount from docker-compose.yml; the Dockerfile already handles this correctly via the multi-stage build COPY.

---

_Verified: 2026-03-20_
_Verifier: Claude (gsd-verifier)_
