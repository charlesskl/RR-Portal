import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./SchedulingSheet.jsx', import.meta.url), 'utf8');
const start = source.indexOf('const SCHEDULE_HINT_COLORS');
const end = source.indexOf('export default function SchedulingSheet');
assert.ok(start >= 0 && end > start, 'schedule helper source is available');

const context = { Date, Map };
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nthis.buildScheduleSuggestions = buildScheduleSuggestions;`, context);

test('fully produced orders are not suggested for scheduling again', () => {
  const [suggestion] = context.buildScheduleSuggestions([{
    id: 1,
    quantity: 100,
    production_count: 100,
    daily_target: 20,
    complete_date: '2026-08-01',
    line_name: 'A1',
  }]);

  assert.equal(suggestion.remaining, 0);
  assert.equal(suggestion.canApply, false);
  assert.equal(suggestion.riskText, '已完成');
});

test('zero-quantity orders cannot receive a suggested start date', () => {
  const [suggestion] = context.buildScheduleSuggestions([{
    id: 2,
    quantity: 0,
    production_count: 0,
    days: 5,
    complete_date: '2026-08-01',
    line_name: 'A1',
  }]);

  assert.equal(suggestion.canApply, false);
  assert.equal(suggestion.riskText, '缺数量');
});

test('search filtering checks for pending edits before changing the dataset', () => {
  assert.match(source, /hasPendingChanges/);
  assert.match(source, /onSearch=/);
});

test('applying schedule updates triggers an explicit editor refresh', () => {
  assert.match(source, /setEditorRefreshKey/);
  assert.match(source, /refreshKey=\{editorRefreshKey\}/);
});

// ===== 2026-08 车间反馈六项修复的回归测试 =====

test('cut/paste rows persist manual order through sort_order batch update', () => {
  assert.match(source, /handleCutRows/);
  assert.match(source, /handlePasteRows/);
  assert.match(source, /剪切选中行/);
  assert.match(source, /粘贴行/);
  // 整页新顺序写 sort_order（1..N），刷新后不乱
  assert.match(source, /fields: \{ sort_order: i \+ 1 \}/);
  assert.match(source, /batch-update/);
});

test('paste rows refuses to run with unsaved edits', () => {
  const start = source.indexOf('const handlePasteRows');
  const end = source.indexOf('const handleAutoAssign');
  const body = source.slice(start, end);
  assert.match(body, /hasPendingChanges/);
});

test('sheet height follows the window instead of fixed 600px', () => {
  assert.match(source, /window\.innerHeight - 210/);
  assert.match(source, /height=\{sheetHeight\}/);
  assert.match(source, /addEventListener\('resize', onResize\)/);
  assert.doesNotMatch(source, /height=\{600\}/);
});
