# Testing Patterns

**Analysis Date:** 2026-03-17

## Test Framework

**Runner:**
- Jest 30.x
- No separate `jest.config.js` — Jest uses default settings (auto-discovers `tests/*.test.js`)
- Config reference: `package.json` `"test": "jest --verbose"`

**Assertion Library:**
- Jest built-in (`expect`, `toEqual`, `toBe`, `toHaveLength`, `toContain`, `toBeCloseTo`, `toThrow`, `not.toThrow`)

**Run Commands:**
```bash
npm test              # Run all tests (jest --verbose)
```

No watch mode or coverage command is configured in `package.json`. To run with coverage manually:
```bash
npx jest --coverage
```

## Test File Organization

**Location:**
- All test files live in `tests/` at the project root (separate from source)

**Naming:**
- `<module>.test.js` — matches the module under test: `calc.test.js`, `modules.test.js`

**Structure:**
```
tests/
├── calc.test.js       # Unit tests for modules/balance/calc.js
└── modules.test.js    # Integration tests for modules/index.js (the compatibility layer)
```

## Test Structure

**Suite Organization:**
```javascript
// modules.test.js — nested describe blocks by concern
describe('modules/ 兼容层', () => {

  describe('SHARED 常量', () => {
    test('SHARED_INPUT_FIELDS 包含 14 个共享输入字段', () => { ... });
  });

  describe('DEPT_CONFIG 结构', () => {
    test('beer: 基本信息正确', () => { ... });
    test('beer: uniqueInputFields 有 13 个字段', () => { ... });
  });

  describe('函数接口', () => {
    test('getAllInputFields(beer) 以 remark 结尾', () => { ... });
  });
});
```

```javascript
// calc.test.js — flat describe, one test per dept
describe('calculateRecord', () => {
  test('beer: balance = output - all expenses', () => { ... });
  test('assembly: balance_minus_tape', () => { ... });
  test('print: pad and spray machine rates', () => { ... });
});
```

**Patterns:**
- No `beforeEach` / `afterEach` setup or teardown — all tests are stateless pure function calls
- Test names are descriptive Chinese/English descriptions of what is being verified
- Field counts are explicitly checked with `toHaveLength(N)` and annotated with comments explaining why the count changed from a previous version

## Mocking

**Framework:** None — no `jest.mock()`, no manual mocks, no spies.

**What is tested without mocks:**
- Pure computation functions (`calculateRecord` in `calc.js`) — no I/O, no DB
- Pure config derivation functions (`getAllInputFields`, `getExpenseFields`, `getColumnMap`) in `modules/index.js`
- Config validation (`validateConfig`) that runs on module load

**What is NOT tested (no mocks, no integration test harness):**
- Express routes (`routes/*.js`) — no HTTP test setup
- Database queries (`db/postgres.js`) — no test DB or query mocking
- Authentication middleware (`middleware/auth.js`)
- Audit logging (`middleware/audit.js`)
- Excel import/export (`routes/import-export.js`)
- Frontend (`public/js/app.js`, `public/js/api.js`)

## Fixtures and Factories

**Test Data:**
Inline literal objects passed directly to the function under test. No shared fixture files or factory helpers.

```javascript
// calc.test.js — inline fixture per test case
const r = calculateRecord('beer', {
  daily_output: 50000,
  worker_wage: 6000, supervisor_wage: 2000, rent: 900, utility_fee: 7000,
  tool_investment: 0, equipment: 0, renovation: 0, misc_fee: 0,
  shipping_fee: 0, social_insurance: 263, tax: 809,
  misc_worker_wage: 3960, machine_repair: 1500, mold_repair: 1500,
  gate_processing_fee: 2750, assembly_gate_parts_fee: 0,
  recoverable_gate_fee: 0, material_supplement: 0,
  total_machines: 42, running_machines: 30
});
```

**Location:** No separate fixtures directory. All test data is inline in the test files.

## Coverage

**Requirements:** None enforced. No coverage threshold in configuration.

**View Coverage:**
```bash
npx jest --coverage
```

## Test Types

**Unit Tests (`tests/calc.test.js`):**
- Scope: Single function `calculateRecord(dept, record)` from `modules/balance/calc.js`
- Tests all three department branches (`beer`, `print`, `assembly`)
- Verifies: balance formula, ratio formula, department-specific computed fields (machine rates, per-worker output, balance minus tape)
- Uses `toBeCloseTo(value, precision)` for floating-point arithmetic

**Integration Tests (`tests/modules.test.js`):**
- Scope: The full `modules/index.js` compatibility layer (reads and transforms `modules/balance/config.js`)
- Tests: exported constant shapes, field counts per department, `getAllInputFields()`, `getExpenseFields()`, `getColumnMap()`, `validateConfig()`
- Effectively tests that `config.js` → `modules/index.js` transformation produces the correct derived arrays

**E2E Tests:** Not used.
**API/Route Tests:** Not used.
**Frontend Tests:** Not used.

## Common Patterns

**Floating-point arithmetic:**
Use `toBeCloseTo(expected, decimalPlaces)` for all ratio and division results.

```javascript
expect(r.balance_ratio).toBeCloseTo(r.balance / 50000, 4);
expect(r.machine_rate).toBeCloseTo(30 / 42, 4);
```

**Exact array matching:**
Use `toEqual([...])` to assert entire array contents and order.

```javascript
expect(config.SHARED_INPUT_FIELDS).toEqual([
  'supervisor_count', 'worker_count', 'daily_output', ...
]);
```

**Field count assertions:**
Use `toHaveLength(N)` with inline comment explaining the expected count.

```javascript
test('beer: uniqueInputFields 有 13 个字段', () => {
  // output_tax_incl 从 input 改为 calc，从14变为13
  expect(config.DEPT_CONFIG.beer.uniqueInputFields).toHaveLength(13);
});
```

**Error path testing:**
Use `expect(() => fn()).toThrow('message fragment')` and `expect(() => fn()).not.toThrow()`.

```javascript
test('校验通过不抛错', () => {
  expect(() => config.validateConfig()).not.toThrow();
});

test('未知模块抛错', () => {
  expect(() => config.getColumnMap('unknown')).toThrow('未知模块');
});
```

**Negative assertions:**
Use `.not.toContain()` to verify a field was intentionally excluded.

```javascript
expect(config.DEPT_CONFIG.beer.uniqueExpenseFields).not.toContain('recoverable_gate_fee');
```

## Critical Coverage Gap

Route and middleware logic (`routes/`, `middleware/`) is entirely untested. The most high-risk untested areas are:

- `routes/records.js` — dynamic SQL field assembly (`validFields` filtering), INSERT/UPDATE logic
- `middleware/auth.js` — `checkDataLock`, `modulePermission`
- `modules/balance/calc.js` — edge cases: `daily_output = 0`, all-zero expenses, missing fields

---

*Testing analysis: 2026-03-17*
