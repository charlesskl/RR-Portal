# Inline Schedule Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the selected schedule's detail immediately below its schedule-list row.

**Architecture:** Use Ant Design Table's controlled expandable-row API. Keep the existing detail state and controls, but move the detail card into `expandedRowRender` and allow only `selectedSchedule.id` to be expanded.

**Tech Stack:** React 19, Ant Design 6, Vite 7, browser-based DOM verification

## Global Constraints

- Only the selected schedule row may be expanded.
- The default expand icon must remain hidden; “查看明细” is the trigger.
- Existing export, delete, edit, copy, sort, drag, and filter behavior must remain unchanged.
- No schedule or item data may be modified by this layout change.

---

### Task 1: Record the failing user-visible behavior

**Files:**
- Verify: `client/src/pages/ScheduleResult.jsx`

**Interfaces:**
- Consumes: the production page at `http://localhost:3000`
- Produces: browser evidence that clicking “查看明细” currently creates no schedule-table expanded row

- [ ] **Step 1: Open a schedule list containing multiple rows**

Use the active workshop's schedule result page and click a visible “查看明细” button.

- [ ] **Step 2: Verify the current behavior fails**

Assert that the clicked schedule row has no immediately following `tr.ant-table-expanded-row` and that the detail card is rendered after the schedule-list card.

Expected: FAIL because the detail is currently outside the schedule table.

### Task 2: Move the detail panel into a controlled expanded row

**Files:**
- Modify: `client/src/pages/ScheduleResult.jsx:45-610`

**Interfaces:**
- Consumes: `selectedSchedule`, `items`, `itemColumns`, and the existing detail controls
- Produces: `renderScheduleDetail(record)` and a controlled `expandable` table configuration

- [ ] **Step 1: Extract the existing detail card**

Create `renderScheduleDetail(record)` that returns the existing detail card only when `selectedSchedule?.id === record.id`.

- [ ] **Step 2: Configure the schedule table**

Set:

```jsx
expandable={{
  expandedRowKeys: selectedSchedule ? [selectedSchedule.id] : [],
  expandedRowRender: renderScheduleDetail,
  showExpandColumn: false,
  rowExpandable: record => selectedSchedule?.id === record.id,
}}
```

- [ ] **Step 3: Remove the bottom detail block**

Delete the separate `{selectedSchedule && (...)}` block after the schedule-list card so detail is rendered once.

- [ ] **Step 4: Run the existing client regression test**

Run:

```bash
node --test tests/scheduleResultLayout.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Build the frontend**

Run:

```bash
node node_modules/vite/bin/vite.js build
```

Expected: Vite exits with code 0.

### Task 3: Verify row placement and existing actions

**Files:**
- Verify: `client/src/pages/ScheduleResult.jsx`

**Interfaces:**
- Consumes: the rebuilt production page
- Produces: DOM and screenshot evidence for inline placement

- [ ] **Step 1: Restart the server and reopen 排机结果**

Load the rebuilt frontend from `http://localhost:3000`.

- [ ] **Step 2: Click a schedule's “查看明细”**

Verify its next sibling row has class `ant-table-expanded-row` and contains the matching “排机明细” title.

- [ ] **Step 3: Verify single-row expansion**

Click another schedule and confirm there is still exactly one expanded row, now directly below the newly selected schedule.

- [ ] **Step 4: Verify detail actions**

Confirm an item row's “编辑” button still enters edit mode and can be cancelled.

- [ ] **Step 5: Capture the final screenshot**

Confirm visually that the selected schedule and its detail are adjacent.
