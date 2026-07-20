# Indonesia Shipping Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move PR 268 into a new `印尼小组` department and deploy the ASP.NET Core/React application with a server-private historical snapshot on an internal SQL Server container, without committing real business data to Git.

**Architecture:** Two long-running services (`indo-sqlserver` and `indo-shipping`) share only `platform-net`; a one-shot `indo-shipping-init` job creates the schema, application login, admin password, and seed data. Nginx strips `/indo-shipping/`, while the SPA is built with that public base path and ASP.NET Core serves the compiled assets.

**Tech Stack:** .NET 8, ASP.NET Core, EF Core, Dapper, SQL Server 2022, React 19, TypeScript, Vite 8, Docker Compose, Nginx, GitHub Actions.

## Global Constraints

- Source path is `apps/印尼小组/印尼走货明细/`.
- Stable service names are `indo-sqlserver`, `indo-shipping-init`, and `indo-shipping`.
- Stable public URL is `/indo-shipping/`; health is `/indo-shipping/health`.
- SQL Server port 1433 must not be published on the host.
- Runtime application must connect as `indoshipping_app`, never as `sa`.
- Existing non-empty databases must never be rebuilt or reseeded automatically.
- SQL data is persisted with a bind mount and is never deleted during rollback.
- Deployment must not run an unscoped `docker compose up` for this first release.
- Secrets must not appear in committed files, command output, or application logs.

---

### Task 1: Move the application into the Indonesia department

**Files:**
- Move: `apps/业务部/印尼走货明细/` -> `apps/印尼小组/印尼走货明细/`
- Modify: `AGENTS.md`
- Test: `scripts/tests/test-indo-shipping-layout.ps1`

**Interfaces:**
- Consumes: PR 268 application tree.
- Produces: canonical application path used by Docker and deploy mappings.

- [ ] **Step 1: Write the failing layout test**

Create `scripts/tests/test-indo-shipping-layout.ps1`:

```powershell
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/../.."
$newPath = Join-Path $root 'apps/印尼小组/印尼走货明细'
$oldPath = Join-Path $root 'apps/业务部/印尼走货明细'
if (-not (Test-Path (Join-Path $newPath 'IndoShipping.sln'))) { throw 'new Indonesia app path missing' }
if (Test-Path $oldPath) { throw 'old Business department path still exists' }
Write-Host 'Indonesia app layout OK'
```

- [ ] **Step 2: Run the test and verify RED**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/test-indo-shipping-layout.ps1`

Expected: FAIL with `new Indonesia app path missing`.

- [ ] **Step 3: Move the directory and update the registry**

Run:

```powershell
git mv "apps/业务部/印尼走货明细" "apps/印尼小组/印尼走货明细"
```

Update `AGENTS.md` with an `印尼小组` tree entry and an App registry row using service `indo-shipping` and path `/indo-shipping/`.

- [ ] **Step 4: Run the layout test and verify GREEN**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/test-indo-shipping-layout.ps1`

Expected: `Indonesia app layout OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/tests/test-indo-shipping-layout.ps1 AGENTS.md apps/印尼小组/印尼走货明细 apps/业务部/印尼走货明细
git commit -m "refactor: move Indonesia shipping app to its department"
```

---

### Task 2: Add an idempotent SQL Server bootstrap job

**Files:**
- Create: `apps/印尼小组/印尼走货明细/src/IndoShipping.Bootstrap/IndoShipping.Bootstrap.csproj`
- Create: `apps/印尼小组/印尼走货明细/src/IndoShipping.Bootstrap/Program.cs`
- Create: `apps/印尼小组/印尼走货明细/src/IndoShipping.Bootstrap/SqlBatchSplitter.cs`
- Create: `apps/印尼小组/印尼走货明细/src/IndoShipping.Bootstrap/SeedSnapshot.cs`
- Create: `apps/印尼小组/印尼走货明细/tests/IndoShipping.Bootstrap.Tests/IndoShipping.Bootstrap.Tests.csproj`
- Create: `apps/印尼小组/印尼走货明细/tests/IndoShipping.Bootstrap.Tests/BootstrapTests.cs`
- Modify: `apps/印尼小组/印尼走货明细/IndoShipping.sln`
- Modify: `apps/印尼小组/印尼走货明细/db/rebuild_schema.sql`

**Interfaces:**
- Consumes environment variables `INDO_SQL_SA_CONNECTION`, `INDO_SQL_APP_PASSWORD`, and `INDO_SHIPPING_ADMIN_PASSWORD`.
- Produces database `IndoShipping`, login `indoshipping_app`, marker table `dbo.__rr_seed_history`, and imported snapshot version `2026-07-15`.

- [ ] **Step 1: Write failing unit tests**

Tests must assert:

```csharp
[Fact]
public void Split_Batches_Only_On_Go_Lines()
{
    var batches = SqlBatchSplitter.Split("SELECT 'GO';\nGO\nSELECT 2;");
    Assert.Equal(2, batches.Count);
}

[Fact]
public void Snapshot_Reports_Expected_Core_Counts()
{
    var snapshot = SeedSnapshot.Load(TestPaths.SeedJson);
    Assert.Equal(2, snapshot.Count("customers"));
    Assert.Equal(3, snapshot.Count("products"));
    Assert.Equal(107, snapshot.Count("materials"));
    Assert.Equal(783, snapshot.Count("images"));
    Assert.Equal(21, snapshot.Count("purchase_orders"));
    Assert.Equal(92, snapshot.Count("po_items"));
}
```

- [ ] **Step 2: Run tests and verify RED**

Run: `dotnet test tests/IndoShipping.Bootstrap.Tests/IndoShipping.Bootstrap.Tests.csproj`

Expected: compile failure because bootstrap classes do not exist.

- [ ] **Step 3: Implement SQL batch parsing and snapshot loading**

`SqlBatchSplitter.Split(string sql)` must split only lines matching `^\s*GO\s*$` case-insensitively. `SeedSnapshot.Load(string path)` must parse `tables` with `JsonDocument`, expose `Count(string table)`, and retain each table's `JsonElement` rows without loading image strings into logs.

- [ ] **Step 4: Implement idempotent bootstrap**

`Program.cs` must:

```csharp
var saConnection = Required("INDO_SQL_SA_CONNECTION");
var appPassword = Required("INDO_SQL_APP_PASSWORD");
var adminPassword = Required("INDO_SHIPPING_ADMIN_PASSWORD");
await WaitForSqlServer(saConnection, TimeSpan.FromMinutes(5));
await EnsureSchemaOnlyWhenDatabaseIsEmpty(saConnection, schemaPath);
await EnsureApplicationLogin(saConnection, appPassword);
await ImportSeedOnlyWhenMarkerMissing(saConnection, seedPath, "2026-07-15");
await SetAdminPassword(saConnection, BCrypt.Net.BCrypt.HashPassword(adminPassword, 11));
await VerifyCounts(saConnection, snapshot.ExpectedCounts);
```

The seed importer must preserve explicit identity IDs using `SET IDENTITY_INSERT`, insert tables in foreign-key order, skip snapshot password hashes, wrap each first-time import in a transaction, and write `dbo.__rr_seed_history` only after count verification succeeds. If any business table has rows without a matching marker, it must fail with a non-zero exit code instead of rebuilding.

- [ ] **Step 5: Remove the production default password from schema**

Change `rebuild_schema.sql` so it creates the admin row with a bootstrap-only disabled hash; the bootstrap job immediately replaces it from `INDO_SHIPPING_ADMIN_PASSWORD`. Keep schema creation compatible with SQL Server 2022.

- [ ] **Step 6: Run unit tests and build**

Run:

```bash
dotnet test tests/IndoShipping.Bootstrap.Tests/IndoShipping.Bootstrap.Tests.csproj
dotnet build IndoShipping.sln -c Release
```

Expected: all tests pass and build reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/印尼小组/印尼走货明细/src/IndoShipping.Bootstrap apps/印尼小组/印尼走货明细/tests apps/印尼小组/印尼走货明细/IndoShipping.sln apps/印尼小组/印尼走货明细/db/rebuild_schema.sql
git commit -m "feat: bootstrap Indonesia SQL Server data"
```

---

### Task 3: Package the API and SPA for `/indo-shipping/`

**Files:**
- Create: `apps/印尼小组/印尼走货明细/Dockerfile`
- Create: `apps/印尼小组/印尼走货明细/.dockerignore`
- Modify: `apps/印尼小组/印尼走货明细/src/IndoShipping.Api/Program.cs`
- Modify: `apps/印尼小组/印尼走货明细/src/IndoShipping.Api/Controllers/HealthController.cs`
- Modify: `apps/印尼小组/印尼走货明细/web/vite.config.ts`
- Modify: `apps/印尼小组/印尼走货明细/web/src/App.tsx`
- Modify: `apps/印尼小组/印尼走货明细/web/src/api/client.ts`
- Create: `apps/印尼小组/印尼走货明细/web/src/deployment.test.ts`

**Interfaces:**
- Consumes `ConnectionStrings__Default` and `Jwt__Key`.
- Produces HTTP port 5180, `/api/*`, `/api/health`, `/api/health/db`, and SPA fallback.

- [ ] **Step 1: Write failing frontend deployment tests**

Test that `import.meta.env.BASE_URL` controls BrowserRouter basename and API base URL:

```ts
expect(publicBase('/indo-shipping/')).toBe('/indo-shipping')
expect(apiBase('/indo-shipping/')).toBe('/indo-shipping/api')
```

- [ ] **Step 2: Run frontend tests/build and verify RED**

Run: `npm ci && npm run build`

Expected: deployment test helpers are missing or generated assets use root `/assets/`.

- [ ] **Step 3: Implement subpath-safe frontend**

Set Vite `base: process.env.VITE_BASE_PATH || '/'`. Use `basename={import.meta.env.BASE_URL.replace(/\/$/, '')}` in `BrowserRouter`. Configure Axios with `${import.meta.env.BASE_URL}api`, and redirect 401 responses to `${import.meta.env.BASE_URL}login`.

- [ ] **Step 4: Serve SPA assets from ASP.NET Core**

In `Program.cs`, before controller mapping:

```csharp
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapControllers();
app.MapFallbackToFile("index.html");
```

Change the primary health endpoint to query `SELECT 1`; return HTTP 503 when SQL Server is unavailable so container health reflects the full service, not only the process.

- [ ] **Step 5: Add the multi-stage Dockerfile**

Use `node:20-alpine` for `npm ci && npm run build`, `mcr.microsoft.com/dotnet/sdk:8.0` for `dotnet publish`, and `mcr.microsoft.com/dotnet/aspnet:8.0` for runtime. Copy `web/dist` into published `wwwroot`, expose 5180, run as a non-root user, and add `curl` for health checks.

- [ ] **Step 6: Verify frontend, backend, and image**

Run:

```bash
npm run lint
npm run build
dotnet build IndoShipping.sln -c Release
docker build -t rr-portal-indo-shipping:test .
```

Expected: all commands exit 0 and built `index.html` references `/indo-shipping/assets/`.

- [ ] **Step 7: Commit**

```bash
git add apps/印尼小组/印尼走货明细
git commit -m "feat: containerize Indonesia shipping portal"
```

---

### Task 4: Add Compose, secrets, and safe first-deploy orchestration

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.cloud.yml`
- Modify: `.env.example`
- Modify: `.github/workflows/deploy.yml`
- Modify: `deploy/update-server.sh`
- Test: `scripts/tests/test-indo-shipping-compose.ps1`

**Interfaces:**
- Consumes GitHub Secrets `INDO_SQL_SA_PASSWORD`, `INDO_SQL_APP_PASSWORD`, `INDO_SHIPPING_JWT_KEY`, `INDO_SHIPPING_ADMIN_PASSWORD`.
- Produces healthy Compose services and an idempotent init job.

- [ ] **Step 1: Write a failing Compose contract test**

The PowerShell test must load `docker compose config --format json` and assert:

- `indo-sqlserver` has no published ports.
- `/var/opt/mssql` uses `./data/indo-sqlserver` bind mount.
- SQL memory is bounded.
- `indo-shipping-init` has restart policy `no`.
- `indo-shipping` exposes only internal port 5180 and has a DB-aware health check.
- all four secrets are required variables rather than committed defaults.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/test-indo-shipping-compose.ps1`

Expected: FAIL because services do not exist.

- [ ] **Step 3: Add local and cloud Compose services**

Use `mcr.microsoft.com/mssql/server:2022-latest`, `ACCEPT_EULA=Y`, `MSSQL_MEMORY_LIMIT_MB=1536`, a 2304 MB container limit, `platform-net`, bind mounts for data and backups, and SQL health via `sqlcmd`. The init job receives the SA connection only; the application receives the app-user connection and JWT key.

- [ ] **Step 4: Add GitHub Secret propagation**

Following the existing QC guard, write or replace the four values in `.env.cloud.production` without printing values. Mask any diagnostic output. Set repository secrets before push using stdin, with generated strong values for SA, JWT, and Web admin, and the user-provided app password for `INDO_SQL_APP_PASSWORD`.

- [ ] **Step 5: Add targeted first-deploy logic**

Map `apps/印尼小组/印尼走货明细/` to `indo-shipping`. When the affected service is `indo-shipping`, bypass the generic unscoped Compose branch and execute:

```bash
mkdir -p data/indo-sqlserver backups/indo-sqlserver
chown 10001:0 data/indo-sqlserver backups/indo-sqlserver
chmod 770 data/indo-sqlserver backups/indo-sqlserver
docker compose ... up -d --no-deps indo-sqlserver
wait_for_healthy indo-sqlserver 180
docker compose ... run --rm --no-deps indo-shipping-init
docker compose ... up -d --build --no-deps indo-shipping
```

Before starting SQL Server, require at least 2500 MB available memory and 10 GB free disk. Failure exits before changing any existing service.

- [ ] **Step 6: Run Compose and shell checks**

Run:

```bash
docker compose -f docker-compose.cloud.yml --env-file .env.test config --quiet
bash -n deploy/update-server.sh
powershell -ExecutionPolicy Bypass -File scripts/tests/test-indo-shipping-compose.ps1
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml docker-compose.cloud.yml .env.example .github/workflows/deploy.yml deploy/update-server.sh scripts/tests/test-indo-shipping-compose.ps1
git commit -m "feat: orchestrate Indonesia shipping services"
```

---

### Task 5: Add Nginx, portal department, health checks, and backups

**Files:**
- Modify: `nginx/nginx.cloud.conf`
- Modify: `frontend/index.cloud.html`
- Modify: `.github/workflows/deploy.yml`
- Modify: `devops/scripts/backup-db.sh`
- Modify: `docs/操作手册.md`
- Test: `scripts/tests/test-indo-shipping-portal.ps1`

**Interfaces:**
- Consumes internal service `indo-shipping:5180`.
- Produces `/indo-shipping/`, portal health indicators, and SQL `.bak` files.

- [ ] **Step 1: Write the failing portal contract test**

Assert that cloud HTML contains department `印尼小组`, `indoShippingDot`, `indoShippingDetailDot`, and `/indo-shipping/`; Nginx contains an exact redirect, health route, prefix rewrite, dynamic upstream, and `auth_basic off`; GHA health checks include `/indo-shipping/health`.

- [ ] **Step 2: Run and verify RED**

Run: `powershell -ExecutionPolicy Bypass -File scripts/tests/test-indo-shipping-portal.ps1`

Expected: FAIL because department and routes are absent.

- [ ] **Step 3: Add Nginx routes**

Add:

```nginx
location = /indo-shipping { return 301 /indo-shipping/; }
location = /indo-shipping/health {
    auth_basic off;
    set $ups "indo-shipping:5180";
    proxy_pass http://$ups/api/health;
}
location /indo-shipping/ {
    auth_basic off;
    set $ups "indo-shipping:5180";
    rewrite ^/indo-shipping/(.*)$ /$1 break;
    proxy_pass http://$ups;
    proxy_set_header X-Forwarded-Prefix /indo-shipping;
}
```

- [ ] **Step 4: Add the portal department and detail card**

Add a new `印尼小组` department band and one app item named `印尼走货明细`; add a detail card describing shipment, purchasing, schedules, and customs data; register `/indo-shipping/health` in `checks`.

- [ ] **Step 5: Add SQL Server backup**

Extend `backup-db.sh` to execute `BACKUP DATABASE [IndoShipping] TO DISK=... WITH INIT, CHECKSUM`, run `RESTORE VERIFYONLY`, retain seven verified `.bak` files, and skip with a warning when `indo-sqlserver` is not running.

- [ ] **Step 6: Verify configuration**

Run:

```bash
powershell -ExecutionPolicy Bypass -File scripts/tests/test-indo-shipping-portal.ps1
docker run --rm -v "$PWD/nginx/nginx.cloud.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
bash -n devops/scripts/backup-db.sh
```

Expected: all checks pass.

- [ ] **Step 7: Commit**

```bash
git add nginx/nginx.cloud.conf frontend/index.cloud.html .github/workflows/deploy.yml devops/scripts/backup-db.sh docs/操作手册.md scripts/tests/test-indo-shipping-portal.ps1
git commit -m "feat: register Indonesia shipping portal"
```

---

### Task 6: Full verification and PR review

**Files:**
- Review all PR 268 files.
- No production edits unless a failing verification or reviewer finding requires a tested fix.

**Interfaces:**
- Consumes completed Tasks 1-5.
- Produces a merge-ready PR branch.

- [ ] **Step 1: Run stale-base regression scan**

Fetch `origin/main`, compute merge base, and run `git log $BASE..origin/main -- <each changed path>`. Resolve conflicts by keeping current main infrastructure behavior and porting only PR 268 intent.

- [ ] **Step 2: Run full local verification**

Run layout, bootstrap, frontend, .NET, Compose, Nginx, shell, and portal tests from earlier tasks. Run `git diff --check` and confirm `git status` contains only intended files.

- [ ] **Step 3: Run disposable integration stack**

Start SQL Server, run bootstrap twice, start app, verify expected row counts and admin login, create a disposable record, restart containers, verify persistence, then remove only disposable containers. Do not delete the bind-mounted test data until count and restart assertions pass.

- [ ] **Step 4: Request independent code review**

Reviewer scope: secret leakage, SQL injection, seed idempotence, destructive schema paths, subpath routing, Compose blast radius, memory/OOM risk, and missing portal registration. Fix every P0-P2 finding with a failing test first and rerun full verification.

- [ ] **Step 5: Push the PR branch**

Push `HEAD:codex/indonesia-shipping-portal`, verify PR 268 is mergeable, and confirm no secret appears in `git diff`, GitHub PR files, or logs.

---

### Task 7: Merge, deploy, migrate, and smoke-test production

**Files:**
- No new source files unless deployment reveals a reproducible defect.

**Interfaces:**
- Consumes merge-ready PR 268 and configured GitHub Secrets.
- Produces live `/indo-shipping/` with verified historical data.

- [ ] **Step 1: Merge with admin squash**

Run: `gh pr merge 268 --squash --admin --delete-branch`.

- [ ] **Step 2: Monitor GitHub Actions to completion**

Watch the run with `gh run watch <run-id> --exit-status`. Do not start a parallel manual deployment of the same services.

- [ ] **Step 3: Verify deployment logs**

Confirm resource preflight passed, SQL Server became healthy, bootstrap imported the snapshot exactly once, app container started, Nginx config passed, and all global health checks succeeded.

- [ ] **Step 4: Run production smoke tests**

Verify:

- `/indo-shipping/health` returns HTTP 200 and checks DB.
- `/indo-shipping/` loads assets under the correct prefix.
- admin login works with the generated Secret password.
- read-only APIs report 2 customers, 3 products, 107 materials, 21 purchase orders, and 92 PO items.
- images endpoint can retrieve a seeded image.
- SQL Server has no host-published 1433 port.
- both long-running containers are healthy.

- [ ] **Step 5: Verify persistence and backup**

Restart only `indo-shipping`, then `indo-sqlserver` during the controlled verification window. Confirm counts remain unchanged, bootstrap marker prevents reimport, create and verify a SQL `.bak`, and run `RESTORE VERIFYONLY`.

- [ ] **Step 6: Report outcome**

Report PR URL, merge SHA, deployment run URL, service health, snapshot counts, backup verification, and the initial Web admin username/password. Never report database or JWT secrets.
