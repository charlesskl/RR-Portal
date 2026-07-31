# Schedule Detail Text Overlap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent long text in the schedule-detail table from rendering over adjacent columns.

**Architecture:** Keep the existing Ant Design table and column widths. Add ellipsis containment to long-text columns and make the horizontal scroll width at least the sum of declared column widths.

**Tech Stack:** React 19, Ant Design 6, Vite 7, Node.js built-in test runner

## Global Constraints

- Do not change schedule data, edit/save behavior, sorting, or drag-and-drop behavior.
- Keep the left machine columns and right action column fixed.
- Preserve the compact single-line row layout.

---

### Task 1: Add the layout regression check

**Files:**
- Create: `client/tests/scheduleResultLayout.test.mjs`
- Test: `client/tests/scheduleResultLayout.test.mjs`

**Interfaces:**
- Consumes: `client/src/pages/ScheduleResult.jsx`
- Produces: a source-level guard for required Ant Design column containment and the minimum horizontal scroll width

- [ ] **Step 1: Write the failing test**

Read `ScheduleResult.jsx`, extract each required text column definition, and assert that it contains `ellipsis: true`. Assert that the table uses `scroll={{ x: 2200 }}`.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/scheduleResultLayout.test.mjs
```

Expected: FAIL because `product_code`, `color`, and other long-text columns do not set `ellipsis: true`, and the scroll width is only `2000`.

### Task 2: Contain long text inside its column

**Files:**
- Modify: `client/src/pages/ScheduleResult.jsx:395-530`
- Test: `client/tests/scheduleResultLayout.test.mjs`

**Interfaces:**
- Consumes: the existing `itemColumns` array
- Produces: column definitions whose long display values use Ant Design ellipsis containment

- [ ] **Step 1: Add `ellipsis: true` to long-text columns**

Apply it to `product_code`, `mold_name`, `color`, `color_powder_no`, `material_type`, `notes`, `robot_arm`, `clamp`, `mold_change_time`, and `adjuster`.

- [ ] **Step 2: Set the table scroll width to `2200`**

The declared column widths total `2142px`; `2200px` leaves a small safety margin.

- [ ] **Step 3: Run the focused test**

Run:

```bash
node --test tests/scheduleResultLayout.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Build the frontend**

Run:

```bash
node node_modules/vite/bin/vite.js build
```

Expected: Vite exits with code 0.

### Task 3: Verify the rendered table

**Files:**
- Verify: `client/src/pages/ScheduleResult.jsx`

**Interfaces:**
- Consumes: the production build served at `http://localhost:3000`
- Produces: browser evidence that long text no longer has visible overflow

- [ ] **Step 1: Restart the server**

Restart `server/app.js` so it serves the new `client/dist`.

- [ ] **Step 2: Open B车间 → 排机结果 → 2026-07-30 白班**

Confirm the seven detail rows render with no text crossing cell boundaries.

- [ ] **Step 3: Run the DOM overflow check**

For long-text column indexes `2, 3, 4, 5, 6, 17, 18, 19, 20, 21`, verify every overflowing cell has computed `overflow: hidden`.

- [ ] **Step 4: Capture the final screenshot**

Confirm the fixed action column, edit button, copy button, and horizontal scrolling remain intact.
