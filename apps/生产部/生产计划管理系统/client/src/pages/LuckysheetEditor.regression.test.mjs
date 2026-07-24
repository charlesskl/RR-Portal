import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./LuckysheetEditor.jsx', import.meta.url), 'utf8');

test('schedule hints do not recreate the editor and discard pending edits', () => {
  assert.doesNotMatch(source, /scheduleHintKey/);
  assert.doesNotMatch(source, /scheduleHints\s*=\s*\{\}/);
});

test('capturing document listeners are removed with the same capture option', () => {
  assert.match(source, /removeEventListener\('mouseup', handleLayoutMouseUp, true\)/);
  assert.match(source, /removeEventListener\('keydown', handleKeyDelete, true\)/);
});

test('every persisted cell style is restored when the sheet is rebuilt', () => {
  for (const key of ['bg', 'fc', 'bl', 'it', 'un', 'cl', 'ff', 'fs', 'ht', 'vt', 'tb', 'tr', 'rt', 'ps', 'qp']) {
    assert.match(source, new RegExp(`cellFmt\\.${key}`), `missing restoration for ${key}`);
  }
});

test('merge metadata is persisted only in sheet settings, not per-cell format', () => {
  assert.doesNotMatch(source, /fmt\.mc\s*=\s*cell\.mc/);
});

test('an empty cell with only alignment formatting is rebuilt', () => {
  const start = source.indexOf('const NUMERIC_SUM_FIELDS');
  const end = source.indexOf('// 从 Luckysheet 单元格对象提取格式');
  const context = { Date, Set };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.ordersToCelldata = ordersToCelldata;`, context);

  const cells = context.ordersToCelldata([
    { id: 1, value: '', cell_format: JSON.stringify({ value: { ht: 0 } }) },
  ], [{ data: 'value', title: '值' }], new Set());

  assert.ok(cells.some(cell => cell.r === 1 && cell.c === 0 && cell.v.ht === 0));
});

test('clearing a cell style removes its persisted format', () => {
  assert.match(source, /entry\.fmt\[colData\]\s*=\s*null/);
  assert.match(source, /if \(f == null\) delete merged\[col\]/);
});

test('the editor exposes pending-state checks and an explicit refresh key', () => {
  assert.match(source, /hasPendingChanges/);
  assert.match(source, /refreshKey/);
});
