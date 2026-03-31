# Coding Conventions

**Analysis Date:** 2026-03-17

## Naming Patterns

**Files:**
- Route files: lowercase with hyphens, named after the resource (`audit-logs.js`, `import-export.js`)
- Module files: lowercase, flat names (`calc.js`, `config.js`)
- Utility files: lowercase with hyphens (`async-handler.js`)
- Test files: `<module>.test.js` co-located in `tests/` directory

**Functions:**
- camelCase for all functions: `calculateRecord`, `getAllInputFields`, `logAction`, `checkDataLock`
- Middleware factories use camelCase: `modulePermission(moduleName)`, `asyncHandler(fn)`
- Async route handlers are always async arrow functions wrapped in `asyncHandler`

**Variables:**
- camelCase for local variables: `expenseFields`, `dailyOutput`, `validFields`
- UPPER_SNAKE_CASE for module-level constants: `DEPT_CONFIG`, `SHARED_INPUT_FIELDS`, `SHARED_EXPENSE_FIELDS`, `ALL_DEPARTMENTS`
- Frontend field group constants follow the pattern `SHARED_<GROUP>`: `SHARED_PEOPLE`, `SHARED_WAGE`, `SHARED_EXPENSE`, `SHARED_BALANCE`

**Database fields:**
- snake_case for all DB column names: `record_date`, `workshop_id`, `daily_output`, `balance_ratio`
- Frontend `prop` and `v-model` field names must exactly match DB column names and SQL AS aliases

**Config object keys:**
- Dept keys are lowercase abbreviations: `beer`, `print`, `assembly`
- Field objects use snake_case keys: `field`, `label`, `shortLabel`, `type`, `input`, `expense`, `calc`

## Code Style

**Formatting:**
- No `.eslintrc` or `.prettierrc` — no automated formatter enforced
- 2-space indentation observed throughout backend JS files
- Single quotes for strings in backend; template literals for SQL strings
- Semicolons used consistently

**Linting:**
- No ESLint or Biome config present; no automated linting

## Import Organization

**Backend (CommonJS `require`):**

1. External packages (`express`, `bcryptjs`, `jsonwebtoken`)
2. Internal DB helpers (`../db/postgres`)
3. Internal middleware (`../middleware/auth`, `../middleware/audit`)
4. Internal modules/config (`../modules`, `../modules/balance/calc`)
5. Internal utils (`../utils/async-handler`)

Example from `routes/records.js`:
```javascript
const express = require('express');
const router = express.Router();
const { getAll, getOne, query } = require('../db/postgres');
const { authenticate, modulePermission, checkDataLock } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const { DEPT_CONFIG, getAllInputFields } = require('../modules');
const { calculateRecord } = require('../modules/balance/calc');
const asyncHandler = require('../utils/async-handler');
```

**Path Aliases:**
- None. All requires use relative paths (`../db/postgres`, `../modules`).

**Frontend (CDN globals):**
- `Vue 3`, `ElementPlus`, `axios` are globals loaded via CDN — not imported
- All API calls go through the singleton `API` object defined in `public/js/api.js`

## Error Handling

**Standard pattern — use `asyncHandler` wrapper:**
All async routes use the `asyncHandler` utility from `utils/async-handler.js`. It catches uncaught async errors and returns `{ success: false, message: err.message }` with HTTP 500.

```javascript
// Standard route — uses asyncHandler
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const record = await getOne('SELECT * FROM table WHERE id = ?', [req.params.id]);
  if (!record) return res.status(404).json({ success: false, message: '记录不存在' });
  res.json({ success: true, data: record });
}));
```

**Exception — manual try/catch for unique constraint errors:**
Routes that must handle PostgreSQL error code `23505` (unique violation) skip `asyncHandler` and use manual try/catch. This is documented with a comment:

```javascript
// 保留手动 try/catch：需要特殊处理唯一约束冲突 (err.code === '23505')
router.post('/', authenticate, requireStats, async (req, res) => {
  try {
    // ...
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: '用户名已存在' });
    res.status(500).json({ success: false, message: err.message });
  }
});
```

**Response envelope:**
All API responses use `{ success: true, data: ... }` on success, and `{ success: false, message: '...' }` on error. HTTP status codes reflect the error type: 400 (bad input), 401 (unauthenticated), 403 (forbidden), 404 (not found), 500 (server error).

**Frontend error handling:**
- Component methods use `try/catch` around `await API.*()` calls
- Errors displayed via `ElementPlus.ElMessage.error(err.message || '操作失败')`
- 401 responses are intercepted globally in `api.js`, which clears auth and redirects to login

## Logging

**Framework:** `console.log` only (no logging library)

**Patterns:**
- Server startup: `console.log(\`Server running on http://localhost:${PORT}\`)`
- Config validation: `console.log('[配置校验] 所有部门费用字段配置校验通过')`
- No request-level logging middleware

**Audit trail:**
- All data mutations (create/update/delete) call `logAction()` from `middleware/audit.js`
- `logAction(userId, userName, action, tableName, recordId, oldValue, newValue)` writes to `audit_logs` table with JSON snapshots
- Action strings: `'create'`, `'update'`, `'delete'`, `'batch_delete'`, `'create_user'`, `'update_user'`

## Comments

**When to Comment:**
- Every non-obvious block of logic has a Chinese comment explaining "what" and "why"
- Route files include the HTTP method + path at the top of each handler as a comment: `// GET /api/:dept/records`
- Config changes that affect field counts are annotated with the reason: `// output_tax_incl 从 input 改为 calc，从14变为13`
- Exceptions to the standard pattern are explicitly flagged: `// 保留手动 try/catch：需要特殊处理唯一约束冲突`

**JSDoc/TSDoc:** Not used.

## SQL Patterns

**Placeholder style:**
All SQL uses `?` placeholders (MySQL-style). The `db/postgres.js` `convertSql()` function converts them to `$1, $2, ...` for PostgreSQL at query time.

```javascript
// Always use ? — never write $1, $2 directly
const user = await getOne('SELECT * FROM users WHERE username = ? AND status = ?', [username, 'active']);
```

**Dynamic SQL construction:**
Build SQL with `WHERE 1=1` and conditional appends. Never concatenate user input directly.

```javascript
let sql = `SELECT ... FROM ${config.tableName} r LEFT JOIN workshops w ON r.workshop_id = w.id WHERE 1=1`;
const params = [];
if (start_date) { sql += ` AND r.record_date >= ?`; params.push(start_date); }
```

**Specific route ordering rule:**
Specific paths (`/batch`, `/summary`, `/overview`) must be registered before wildcard paths (`/:id`) in the same router to avoid Express matching the wrong handler.

## Function Design

**Size:** Functions are small and single-purpose. Route handlers perform one resource operation. Helper functions (e.g., `getAllInputFields`, `getExpenseFields`) contain no side effects.

**Parameters:**
- Route handlers always receive `(req, res)` — no extra parameters
- Utility functions take explicit arguments, no global state
- `parseFloat(value) || 0` is the standard pattern for numeric field safety across `calc.js` and `summary.js`

**Return Values:**
- Backend functions return data directly (no error-first callbacks)
- DB helpers `getOne` returns row or `null`; `getAll` returns array (may be empty)

## Module Design

**Exports:** Each file exports a named object or named functions via `module.exports = { ... }`.

**Barrel files:** `modules/index.js` acts as the single export point for all module config. Routes and routes only import from `../modules` (not from `../modules/balance/config` directly).

**Frontend single-file pattern:** All Vue components, constants, and utility functions live in `public/js/app.js` (1801 lines). Components are plain objects registered via `app.component()`. No build step.

---

*Convention analysis: 2026-03-17*
