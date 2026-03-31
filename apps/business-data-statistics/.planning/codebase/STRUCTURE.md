# Codebase Structure

**Analysis Date:** 2026-03-17

## Directory Layout

```
project-root/
├── server.js                  # Express entry point, route registration, SPA fallback
├── ecosystem.config.js        # PM2 process config (port 6001, single instance)
├── package.json               # Dependencies manifest
├── CLAUDE.md                  # Project-specific dev rules (committed)
│
├── db/
│   ├── postgres.js            # pg.Pool connection + query/getOne/getAll wrappers
│   └── init.sql               # Full CREATE TABLE definitions (source of truth for schema)
│
├── middleware/
│   ├── auth.js                # JWT verify, role check, module permission, data lock check
│   └── audit.js               # logAction() — writes to audit_logs table
│
├── modules/
│   ├── index.js               # Module registry, DEPT_CONFIG builder, getColumnMap(), validateConfig()
│   └── balance/
│       ├── config.js          # Field definitions for all 3 departments (single source of truth)
│       └── calc.js            # calculateRecord(dept, record) — pure calculation function
│
├── routes/
│   ├── records.js             # /:dept/records CRUD + batch delete + dept summary
│   ├── import-export.js       # /:dept/import (Excel upload) + /:dept/export (Excel download)
│   ├── summary.js             # /summary/overview — cross-department aggregation
│   ├── auth.js                # /auth/login + /auth/me
│   ├── users.js               # /users CRUD
│   ├── workshops.js           # /workshops CRUD
│   ├── settings.js            # /settings — system settings + data lock management
│   ├── audit-logs.js          # /audit-logs — read audit trail
│   └── backup.js              # /backup — data backup/restore
│
├── utils/
│   └── async-handler.js       # Express async route wrapper (catch → 500 JSON)
│
├── public/
│   ├── index.html             # SPA shell — loads CDN libs + api.js + app.js
│   ├── js/
│   │   ├── app.js             # All Vue 3 components, client router, field constants (~1801 lines)
│   │   └── api.js             # Axios wrapper (API object with get/post/put/del/upload/download)
│   └── css/
│       └── theme.css          # CSS variables, Element Plus overrides, global styles
│
├── tests/
│   └── modules.test.js        # Jest tests for modules/balance/config.js and calc.js
│
├── docs/
│   ├── design/                # Architecture and feature design documents
│   ├── brainstorm/            # Exploratory notes
│   └── superpowers/
│       └── plans/             # Implementation phase plans
│
├── backups/                   # Database backup files (not committed)
├── .planning/
│   └── codebase/              # GSD codebase analysis documents (this file)
│
├── fix-workshop-order.js      # One-off migration script (not part of main app)
└── migrate-workshops.js       # One-off migration script (not part of main app)
```

## Directory Purposes

**`db/`:**
- Purpose: Database connectivity and schema definition
- Contains: Connection pool (`postgres.js`), full table DDL (`init.sql`)
- Key files: `db/postgres.js` exports `query`, `getOne`, `getAll`; `db/init.sql` is the authoritative schema — must be updated whenever `ALTER TABLE` is run

**`middleware/`:**
- Purpose: Reusable Express middleware for cross-cutting concerns
- Contains: `auth.js` (JWT + roles + locks), `audit.js` (change logging)
- Key files: `middleware/auth.js` exports `authenticate`, `requireStats`, `modulePermission`, `checkDataLock`, `signToken`

**`modules/`:**
- Purpose: Business domain logic and configuration. Currently contains one module (`balance` = 三工结余)
- Contains: The single source of truth for all department field definitions and Excel column mappings
- Key files: `modules/balance/config.js` (field schema), `modules/index.js` (derived structures + functions), `modules/balance/calc.js` (formulas)
- Note: Designed for future expansion — add new modules as `modules/<name>/` with matching `config.js`

**`routes/`:**
- Purpose: Express route handlers (thin controllers — orchestrate middleware, modules, DB)
- Contains: One file per API resource group
- Key files: `routes/records.js` is the most critical — handles all three departments via `:dept` param

**`utils/`:**
- Purpose: Shared Node.js utility helpers not specific to any domain
- Contains: `async-handler.js`

**`public/`:**
- Purpose: All static assets served directly by Express
- Contains: SPA HTML shell, all frontend JS/CSS
- Generated: No (hand-authored)
- Key constraint: No build step — files are edited directly. `app.js` is ~1801 lines; read it fully before any edit

**`tests/`:**
- Purpose: Automated test suite
- Contains: Jest tests for backend modules (config validation, calculation logic)

**`docs/`:**
- Purpose: Design documentation and planning notes
- Generated: No
- Committed: Yes

**`backups/`:**
- Purpose: Database dump files created via backup route
- Generated: Yes (by app)
- Committed: No (in `.gitignore`)

## Key File Locations

**Entry Points:**
- `server.js`: HTTP server startup, all route registration
- `public/index.html`: SPA entry, loads all frontend assets

**Configuration:**
- `modules/balance/config.js`: Department field schema (THE source of truth — edit this first when adding fields)
- `modules/index.js`: Derives DEPT_CONFIG, COLUMN_MAP, and helper functions from config
- `ecosystem.config.js`: PM2 process and environment config
- `db/init.sql`: Database schema DDL

**Core Logic:**
- `modules/balance/calc.js`: Balance calculation formulas
- `routes/records.js`: Department data CRUD
- `routes/import-export.js`: Excel import/export with COLUMN_MAP
- `middleware/auth.js`: Authentication and authorization

**Frontend:**
- `public/js/app.js`: All Vue components and client-side routing (~1801 lines)
- `public/js/api.js`: Single HTTP client object used by all components
- `public/css/theme.css`: All custom styles and CSS variable overrides

**Testing:**
- `tests/modules.test.js`: Jest tests for config and calc modules

## Naming Conventions

**Files:**
- Route files: kebab-case matching the API path segment (e.g., `audit-logs.js` for `/api/audit-logs`)
- Utility files: kebab-case descriptive name (e.g., `async-handler.js`)
- Module config files: always `config.js` and `calc.js` within `modules/<name>/`

**Directories:**
- Route/middleware directories: lowercase plural nouns
- Module directories: lowercase singular noun (the module key)

**Database tables:**
- Department records: `{dept}_records` (e.g., `beer_records`, `print_records`, `assembly_records`)
- System tables: singular noun (e.g., `users`, `workshops`, `audit_logs`, `data_locks`)

**Frontend components:**
- Component variables: PascalCase + `Page` or descriptive suffix (e.g., `LoginPage`, `DeptRecordsPage`, `WorkshopSettings`)
- Registered component names: kebab-case (e.g., `'dept-records-page'`, `'audit-logs'`)

**API routes:**
- All prefixed `/api/`
- Department-scoped routes use `/:dept/` segment (e.g., `/api/beer/records`, `/api/print/import`)

## Where to Add New Code

**New department field:**
1. Add to `modules/balance/config.js` under the appropriate dept's `uniqueFields` (or `sharedFields` if shared)
2. Run `ALTER TABLE {dept}_records ADD COLUMN ...` and update `db/init.sql`
3. Verify `modules/index.js` derives it correctly (input/expense/calc flags control which arrays it appears in)
4. Add corresponding entry to `public/js/app.js` DEPT_CONFIG `uniqueFields` array
5. Add formula to `modules/balance/calc.js` if it's a calc field

**New API route:**
1. Create `routes/{name}.js` following existing pattern (router + asyncHandler + authenticate)
2. Register in `server.js` with `app.use('/api/{name}', require('./routes/{name}'))`
3. Add API method to `public/js/api.js` (or use existing `get`/`post`/`put`/`del`)
4. Place specific paths (e.g., `/batch`, `/overview`) before wildcard paths (e.g., `/:id`) in the router

**New frontend page component:**
1. Define component as `const MyPage = { template: \`...\`, data() {...}, methods: {...} }` in `public/js/app.js`
2. Register: `app.component('my-page', MyPage)` near the bottom of `app.js`
3. Add route case to `handleRouteChange()` in the root app component
4. Add navigation entry in the sidebar template

**New backend utility:**
- Shared helpers: `utils/{name}.js`
- Domain logic specific to a module: `modules/balance/{name}.js`

**New module (future expansion):**
- Create `modules/{moduleKey}/config.js` (same schema as `modules/balance/config.js`)
- Create `modules/{moduleKey}/calc.js`
- Register in `modules/index.js` MODULES object

## Special Directories

**`.planning/`:**
- Purpose: GSD planning documents (codebase analysis, phase plans, specs)
- Generated: By GSD slash commands
- Committed: Yes

**`backups/`:**
- Purpose: Database backup files written by `routes/backup.js`
- Generated: Yes (runtime)
- Committed: No

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes (`npm install`)
- Committed: No

---

*Structure analysis: 2026-03-17*
