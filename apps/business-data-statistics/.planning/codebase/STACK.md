# Technology Stack

**Analysis Date:** 2026-03-17

## Languages

**Primary:**
- JavaScript (CommonJS) - Backend server, all route handlers, middleware, modules
- JavaScript (ES2020+) - Frontend single-file app (`public/js/app.js`, `public/js/api.js`)

**Secondary:**
- SQL (PostgreSQL dialect) - Database schema and queries (`db/init.sql`, inline in routes)
- HTML5 - Single SPA shell (`public/index.html`)
- CSS3 - Custom theme with CSS variables (`public/css/theme.css`)

## Runtime

**Environment:**
- Node.js v24.14.0

**Package Manager:**
- npm v11.9.0
- Lockfile: `package-lock.json` present

## Frameworks

**Core Backend:**
- Express 5.2.1 - HTTP server, routing, middleware pipeline (`server.js`)
  - Uses `express.json({ limit: '10mb' })` for request bodies
  - Serves SPA via `express.static` + catch-all fallback
  - Module type: `commonjs`

**Frontend (all via CDN, no build step):**
- Vue 3 (global prod build) - UI component framework, loaded from `https://unpkg.com/vue@3/dist/vue.global.prod.js`
- Element Plus - UI component library (tables, forms, dialogs), loaded from `https://unpkg.com/element-plus`
- Axios - HTTP client for API calls, loaded from `https://unpkg.com/axios/dist/axios.min.js`

**Testing:**
- Jest v30.3.0 - Unit test runner (`npm test` → `jest --verbose`)
  - Config: inline in `package.json` (no separate jest.config file detected)
  - Tests in `tests/` directory

**Build/Dev:**
- No build step - frontend is plain JS loaded directly by browser
- PM2 v6.0.14 - Process manager for production deployment (`ecosystem.config.js`)

## Key Dependencies

**Critical:**
- `pg` v8.20.0 - PostgreSQL client (`node-postgres`), connection pool in `db/postgres.js`
- `jsonwebtoken` v9.0.3 - JWT creation and verification (`middleware/auth.js`)
- `bcryptjs` v3.0.3 - Password hashing for user authentication (`routes/auth.js`)
- `xlsx` v0.18.5 - Excel file reading and writing for import/export (`routes/import-export.js`)

**Infrastructure:**
- `multer` v2.1.1 - Multipart file upload handling; uses `memoryStorage` (files held in RAM, not disk), 10MB limit
- `cors` v2.8.6 - Cross-Origin Resource Sharing headers (permissive, no origin restrictions)

**Dev Only:**
- `jest` v30.3.0 - Test framework

## Configuration

**Environment:**
- No `.env` file present in project root; all config falls back to hardcoded defaults
- Key environment variables read at runtime:
  - `PORT` → defaults to `6001`
  - `DB_HOST` → defaults to `localhost`
  - `DB_PORT` → defaults to `5432`
  - `DB_NAME` → defaults to `production_system`
  - `DB_USER` → defaults to `postgres`
  - `DB_PASSWORD` → defaults to `postgres123`
  - `JWT_SECRET` → defaults to `production-system-secret-key`
  - `NODE_ENV` → set to `production` by PM2 via `ecosystem.config.js`

**Build:**
- No build config files (no webpack, vite, tsconfig, babel, etc.)
- `ecosystem.config.js` - PM2 process definition: 1 instance, `autorestart: true`, `max_memory_restart: '500M'`

## Platform Requirements

**Development:**
- Node.js v24+
- PostgreSQL 17 (path `C:/Program Files/PostgreSQL/17/bin/` hardcoded in `routes/backup.js`)
- npm v11+
- Windows (pg_dump/psql paths are Windows-style)

**Production:**
- Windows Server (based on pg_dump path and PM2 Windows startup config)
- PM2 with `pm2-windows-startup` for auto-start on reboot
- PostgreSQL 17 installed locally at default Windows path
- Internal network only — no reverse proxy or HTTPS detected

---

*Stack analysis: 2026-03-17*
