# Learned Failure Patterns

Auto-discovered patterns from deployment fixes. Max 50 entries (FIFO eviction when full).

This file is maintained by `trigger.sh` — do NOT edit manually. When the agent fixes a
novel failure (not in the FP-01 through FP-10 registry in CLAUDE.md), it records the fix
in the state JSON's `fixes[]` array with `pattern_known: false`. After the deployment
completes, trigger.sh appends the novel pattern here.

Core patterns (FP-01 through FP-18) live in `devops/agent/CLAUDE.md` and are never evicted.

---

### LP-01: better-sqlite3 fails on Alpine with "Error: /lib/x86_64-linux-gnu/libm.so.6"
**Date:** 2026-03-29
**App:** paiji
**Symptom:** `npm ci` fails building better-sqlite3 on node:20-alpine
**Cause:** better-sqlite3 uses prebuild binaries compiled against glibc; Alpine uses musl
**Fix:** Switch to `node:20-slim` (Debian-based) AND install `python3 make g++ curl`
**Automated:** QC-20 (check-native-deps.sh)

### LP-02: Flask app returns 404 for all routes behind nginx sub-path
**Date:** 2026-03-29
**App:** jiangping
**Symptom:** Direct port access works, nginx sub-path returns 404
**Cause:** Flask doesn't strip `/<app-name>/` prefix from PATH_INFO
**Fix:** App needs `PrefixMiddleware` + `BASE_PATH` env var. Set `BASE_PATH=/<app-name>` in .env
**Automated:** QC-12 generates BASE_PATH, but middleware must exist in app code (cannot auto-generate)

### LP-03: Uploaded images 404 because volume mount path is wrong
**Date:** 2026-03-29
**App:** figure-mold-cost-system, rr-production
**Symptom:** POST upload succeeds but GET image returns 404
**Cause:** App stores images in `public/uploads/` but compose mounts `uploads:/app/uploads`
**Fix:** Mount `public/uploads:/app/public/uploads` instead. QC-21 detects the correct path.
**Automated:** QC-21 (check-volumes.sh)

### LP-04: App crashes on startup because seed data file missing
**Date:** 2026-03-29
**App:** rr-production
**Symptom:** `ENOENT: no such file or directory, open '/app/data/default-material-prices.json'`
**Cause:** Volume mount creates empty directory; app expects pre-existing data files
**Fix:** deploy.sh transfers seed files from local repo to server volume (only on first deploy)
**Automated:** deploy.sh Step 4c seed data transfer + QC-21 seed file detection

### LP-05: Monorepo CMD runs seed script before app start
**Date:** 2026-03-29
**App:** zouhuo
**Symptom:** Default users not created; login fails with empty credentials
**Cause:** Dockerfile CMD is `sh -c "node scripts/seed-users.js && node app.js"` — agent templates use `CMD ["node", "app.js"]` which skips the seed step
**Fix:** detect-stack.sh now detects startup scripts from Dockerfile CMD chains. Dockerfile generation preserves these.
**Automated:** detect-stack.sh STARTUP_SCRIPTS detection

### LP-06: Gunicorn used for FastAPI app (should be uvicorn)
**Date:** 2026-03-29
**App:** (general pattern)
**Symptom:** FastAPI endpoints return 500 or don't work with gunicorn
**Cause:** Dockerfile template defaults to gunicorn for Python; FastAPI needs ASGI (uvicorn)
**Fix:** check-dockerfile.sh detects `FastAPI()` in source and switches to uvicorn. For Flask with wsgi.py, use gunicorn.
**Automated:** QC-04 + QC-20

### LP-07: App in plugins/ directory not found by deploy.sh
**Date:** 2026-03-29
**App:** rr-production, new-product-schedule, figure-mold-cost-system, paiji
**Symptom:** deploy.sh fails with "App directory not found"
**Cause:** deploy.sh hardcoded `apps/${APP_NAME}` path; some apps are in `plugins/`
**Fix:** deploy.sh now checks both `apps/` and `plugins/` directories
**Automated:** deploy.sh APP_SOURCE_DIR detection

### LP-08: Health check passes but app silently broken (no data persistence)
**Date:** 2026-03-29
**App:** (general — all JSON/SQLite apps)
**Symptom:** /health returns 200, but creating data fails silently or data disappears on restart
**Cause:** Volume mount exists but has wrong permissions (100:101 needed), or mount points to wrong path, or seed data was never transferred
**Fix:** verify-deploy.sh Phase 4 now runs deep checks: container log scan, write test to /app/data, SQLite WAL verification, seed file presence check
**Automated:** verify-deploy.sh verify_container_health()

### LP-09: Docker compose update breaks YAML then deploy fails
**Date:** 2026-03-29
**App:** (general)
**Symptom:** `docker compose up` fails with parse error after compose file modification
**Cause:** Python yaml.dump produces invalid YAML if service definition has unexpected types
**Fix:** deploy.sh now backs up compose file before modification and runs `docker compose config --quiet` validation after. On failure, restores backup automatically.
**Automated:** deploy.sh Step 4 backup + validation

### LP-10: Dockerfile named Dockerfile.node (not Dockerfile) — deploy.sh can't find it
**Date:** 2026-03-29
**App:** rr-production (plugins/工程啤办单)
**Symptom:** deploy.sh aborts with "No Dockerfile found"
**Cause:** Developer named it `Dockerfile.node` instead of standard `Dockerfile`. Agent only looks for `Dockerfile`.
**Fix:** QC-04 check-dockerfile.sh should detect `Dockerfile.*` variants and rename or symlink to `Dockerfile`. deploy.sh should also look for common variants as fallback.
**Automated:** NOT YET — needs QC-04 and deploy.sh update

### LP-11: Chinese characters in app folder name cause shell quoting failures
**Date:** 2026-03-29
**App:** rr-production (plugins/工程啤办单)
**Symptom:** SSH commands fail with "No such file" or broken path expansion
**Cause:** Folder name `工程啤办单` contains multibyte characters. Shell variable expansion, `scp`, and `ssh` commands may break if not properly quoted.
**Fix:** deploy.sh already quotes paths in most places, but must ensure ALL `deploy_ssh`, `scp`, and file operations use double-quoted variables. The docker-compose service name uses the ASCII alias `rr-production`, not the Chinese folder name.
**Automated:** PARTIAL — deploy.sh uses $APP_NAME (ASCII) not the folder name for service operations, but file operations need audit

### LP-12: Port conflict — multiple apps default to port 3000
**Date:** 2026-03-29
**App:** rr-production (3000), paiji (3000), new-product-schedule (3000)
**Symptom:** Only one container starts; others fail with "port already in use" or health check hits wrong app
**Cause:** Internal container ports don't conflict (each container is isolated), but HOST_PORT mapping in docker-compose must be unique. The agent allocates host ports via `devops/config/ports.json`, but if INTERNAL_PORT detection defaults to 3000 and gets used as HOST_PORT, conflicts arise.
**Fix:** HOST_PORT must ALWAYS come from `ports.json` registry (unique per app), never from INTERNAL_PORT. deploy.sh already reads HOST_PORT from registry — verify it's used consistently.
**Automated:** registry.sh allocates unique ports; deploy.sh reads from registry

### LP-13: zouhuo serves client dist from ../client/dist, not /app/client-dist
**Date:** 2026-03-29
**App:** zouhuo
**Symptom:** Frontend loads blank page (no JS/CSS) after deploy
**Cause:** zouhuo's server.js references `path.join(__dirname, '..', 'client', 'dist')` which resolves to `/app/client/dist` inside container. But the monorepo template copies dist to `/app/client-dist`.
**Fix:** check-dockerfile.sh now detects the serving path from source code and adjusts the COPY destination. For zouhuo specifically, must be `/app/client/dist` not `/app/client-dist`.
**Automated:** check-dockerfile.sh cycle 4 — detects `../client/dist` pattern

### LP-14: Puppeteer in rr-production needs Chromium — won't work on Alpine
**Date:** 2026-03-29
**App:** rr-production
**Symptom:** PDF/PPT export features crash with "Could not find Chromium"
**Cause:** `puppeteer` downloads Chromium during `npm install`, but Alpine doesn't have the required glibc libraries. Even with Chromium installed via `apk`, font rendering fails.
**Fix options:**
1. Switch to `node:20-slim` (Debian) and install `chromium` + `fonts-noto-cjk` via apt
2. Use `puppeteer-core` + preinstalled Chromium
3. Set `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and install system Chromium
QC-20 already detects puppeteer and switches to slim. But Chromium + CJK fonts must also be installed.
**Automated:** PARTIAL — QC-20 detects puppeteer but doesn't install Chromium/fonts yet

### LP-15: Flask static files (CSS/JS from CDN) fail if server has no internet
**Date:** 2026-03-29
**App:** jiangping
**Symptom:** Dashboard page loads but looks unstyled, Chart.js doesn't render
**Cause:** jiangping's templates reference CDN URLs (cdn.jsdelivr.net for Bootstrap, jQuery, DataTables, Chart.js). If the cloud server can't reach CDNs, all styling/charting breaks.
**Fix:** Non-blocking — CDN access usually works from cloud servers. But for air-gapped deployments, would need to vendor all frontend assets. Agent should verify CDN reachability in verify-deploy.sh.
**Automated:** NOT YET — verify-deploy.sh should test CDN URLs from container
