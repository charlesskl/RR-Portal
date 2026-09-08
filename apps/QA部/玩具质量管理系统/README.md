# ToyQMS

Current desktop release: **Version 0.3.9 (Build 21), Apple Silicon**.

Unified Phase 1 frontend for **Toy Quality Management System — Complaint & CAP Analytics**.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. Phase 2 parses `.xlsx` complaint files in the browser and stores confirmed records locally. No database, AI, or translation service is connected.

## Backend (optional, SQLite)

The app runs fully in the browser by default (localStorage). To share one dataset
across devices, start the bundled API server and switch the app to remote mode:

```bash
npm --prefix server install   # once
npm run server                # http://127.0.0.1:4313, DB at server/data/toyqms.db
```

Then open 系统设置 → 后端连接, choose「连接后端（SQLite 数据库）」, save.

- Zero native dependencies: Fastify + the built-in `node:sqlite` (Node ≥ 22.5)
- Password hashing matches the browser implementation (PBKDF2-SHA256, 120k
  iterations), so exported accounts stay compatible
- Bearer-token sessions; permission checks enforced server-side
- `npm run server:smoke` runs an end-to-end API test against a temp database

## Architecture

- Next.js App Router + TypeScript
- Tailwind CSS design system
- Shared responsive application shell and reusable UI components
- Route-level pages under `app/`
- Typed mock data under `lib/`
- Browser-side XLSX parsing with import preview and duplicate comparison
- Repository abstraction with a localStorage implementation (`lib/repository.ts`)

## Phase 1 business rules represented in UI

- Excel worksheet name maps to Primary Series
- `rangeName` maps to Secondary Series
- Cumulative imports run duplicate detection
- Complaint Share = series complaints / total complaints × 100%
- AI classification requires human confirmation
- English source complaint text remains preserved
- One CAP links to multiple complaints
- Complaint type edits recalculate statistics
