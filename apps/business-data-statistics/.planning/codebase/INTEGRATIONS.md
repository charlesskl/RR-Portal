# External Integrations

**Analysis Date:** 2026-03-17

## APIs & External Services

**CDN Dependencies (frontend assets served externally):**
- `unpkg.com` - Delivers Vue 3, Element Plus, Axios, and SheetJS/xlsx at page load
  - Vue 3: `https://unpkg.com/vue@3/dist/vue.global.prod.js`
  - Element Plus CSS: `https://unpkg.com/element-plus/dist/index.css`
  - Element Plus JS: `https://unpkg.com/element-plus`
  - Axios: `https://unpkg.com/axios/dist/axios.min.js`
  - SheetJS: `https://unpkg.com/xlsx/dist/xlsx.full.min.js`
  - Risk: Application frontend is unavailable if unpkg.com is unreachable (intranet environments may block this)

**No third-party API integrations detected.** No Stripe, SMS, email, cloud storage, analytics, or SaaS service calls exist in the codebase.

## Data Storage

**Primary Database:**
- PostgreSQL 17 (local installation)
  - Connection: `db/postgres.js` via `node-postgres` Pool
  - Host: `DB_HOST` env var, defaults to `localhost`
  - Port: `DB_PORT` env var, defaults to `5432`
  - Database name: `DB_NAME` env var, defaults to `production_system`
  - User: `DB_USER` env var, defaults to `postgres`
  - Password: `DB_PASSWORD` env var, defaults to `postgres123`
  - Schema: defined in `db/init.sql`
  - SQL placeholder style: `?` auto-converted to `$N` by `convertSql()` in `db/postgres.js`

**File Storage:**
- Local filesystem only
  - Upload handling: `multer` with `memoryStorage` — files are kept in RAM during request processing, not written to disk
  - Backup files: written to `backups/` directory at project root by `routes/backup.js`
  - No cloud file storage (no S3, GCS, Azure Blob, etc.)

**Caching:**
- None. Every request queries PostgreSQL directly; no Redis, Memcached, or in-memory cache layer.

## Authentication & Identity

**Auth Provider:**
- Custom, self-hosted JWT authentication
  - Implementation: `middleware/auth.js` + `routes/auth.js`
  - Login: `POST /api/auth/login` — validates username/password against `users` table, returns JWT
  - Token storage: client stores JWT in `localStorage`, sends as `Authorization: Bearer <token>` header
  - Token expiry: 24 hours (`JWT_EXPIRES = '24h'`)
  - Secret: `JWT_SECRET` env var, defaults to `production-system-secret-key`
  - Password hashing: `bcryptjs` (bcrypt algorithm)
  - Roles: `stats` (统计组, full access) and `entry` (录入员, module-restricted)
  - Module permissions: stored in `user_modules` table, checked per-request by `modulePermission()` middleware
  - Data lock: `checkDataLock()` middleware blocks `entry` role writes to locked months (stored in `data_locks` table)
  - Default admin: username `RRxing`, password `admin123`

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry, Datadog, Rollbar, or similar service integrated.

**Audit Logging:**
- Custom audit log: `middleware/audit.js` writes to `audit_logs` PostgreSQL table
  - Captures: `user_id`, `user_name`, `action`, `table_name`, `record_id`, `old_value` (JSONB), `new_value` (JSONB)
  - Accessible via `GET /api/audit-logs` (stats role only)

**Application Logs:**
- `console.log` to stdout only (e.g., server start message, import row counts)
- PM2 captures stdout/stderr to its log files

## CI/CD & Deployment

**Hosting:**
- Windows machine on company intranet
- PM2 manages the Node.js process (`ecosystem.config.js`)
  - App name: `production-system`
  - Port: 6001
  - Auto-restart on crash: yes
  - Memory limit restart: 500MB
- `pm2-windows-startup` registers PM2 as a Windows service for reboot persistence

**CI Pipeline:**
- None detected. No GitHub Actions, Jenkins, or other CI configuration files present.

## Database Backup & Restore

**Mechanism:**
- Manual trigger via `POST /api/backup` (stats role only)
- Uses `pg_dump` CLI at hardcoded path: `C:/Program Files/PostgreSQL/17/bin/pg_dump.exe`
- Backup files stored in `backups/` at project root as `.sql` plain-text dumps
- Restore via `POST /api/backup/restore` using `psql` CLI at `C:/Program Files/PostgreSQL/17/bin/psql.exe`
- No scheduled/automated backup — purely on-demand

## Excel Import/Export

**Library:** SheetJS (`xlsx` v0.18.5) — used both server-side (Node.js) and client-side (CDN)
- Import: `POST /api/:dept/import` — receives multipart file upload via `multer`, parsed in memory with `XLSX.read()`
- Export: `GET /api/:dept/export` — generates `.xlsx` buffer server-side, streamed as download
- Column mapping: driven by `modules/balance/config.js` field definitions via `getColumnMap()`

## Webhooks & Callbacks

**Incoming:** None detected.

**Outgoing:** None detected.

## Environment Configuration

**Required environment variables (all have fallback defaults):**
- `PORT` - HTTP listen port (default: `6001`)
- `DB_HOST` - PostgreSQL host (default: `localhost`)
- `DB_PORT` - PostgreSQL port (default: `5432`)
- `DB_NAME` - Database name (default: `production_system`)
- `DB_USER` - Database user (default: `postgres`)
- `DB_PASSWORD` - Database password (default: `postgres123`)
- `JWT_SECRET` - JWT signing secret (default: `production-system-secret-key`)

**Secrets location:**
- No `.env` file present; all secrets fall back to hardcoded defaults in source code
- `DB_PASSWORD` also passed via `PGPASSWORD` env var to `pg_dump`/`psql` subprocess in `routes/backup.js`

---

*Integration audit: 2026-03-17*
