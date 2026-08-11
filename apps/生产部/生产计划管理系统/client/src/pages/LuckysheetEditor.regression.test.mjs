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

// ===== 2026-08 车间反馈六项修复的回归测试 =====

const rangesStart = source.indexOf('function toRanges');
const rangesEnd = source.indexOf('// 一次性列宽迁移');
const rangesCtx = {};
vm.createContext(rangesCtx);
vm.runInContext(`${source.slice(rangesStart, rangesEnd)}\nthis.toRanges = toRanges;`, rangesCtx);

test('hook ranges normalize array / single-object / bare operate shapes', () => {
  const { toRanges } = rangesCtx;
  const seg = { row: [1, 2], column: [3, 4] };
  // 注意：toRanges 在 vm realm 里跑，返回数组的 prototype 与主 realm 不同，
  // deepEqual 会因原型不等而误判 —— 用长度 + 引用/键值断言
  const check = (result, expectSeg) => {
    assert.equal(result.length, 1);
    if (expectSeg) { assert.equal(result[0], seg); assert.deepEqual([...result[0].row], [1, 2]); }
  };
  // 标准：{range:[seg]}
  check(toRanges({ range: [seg] }), true);
  // 工具栏改字体：{range: seg}（单对象，旧代码 for..of 直接抛 TypeError → 字体保存不了）
  check(toRanges({ range: seg }), true);
  // operate 本身就是 range 数组
  check(toRanges([seg]), true);
  // 空 / 垃圾输入不抛异常、不产生记录
  assert.equal(toRanges(null).length, 0);
  assert.equal(toRanges({}).length, 0);
  assert.equal(toRanges({ range: [{ row: [1] }] }).length, 0);
});

test('high-frequency cell hook logs are gated behind DEV mode', () => {
  assert.match(source, /const DEBUG = import\.meta\.env\.DEV/);
  assert.match(source, /const dbg = \(\.\.\.args\) => \{ if \(DEBUG\) console\.log\(\.\.\.args\); \}/);
  // 热路径不允许再直接 console.log（日志洪泛是「页面没有响应」的主因）
  assert.doesNotMatch(source, /console\.log\('\[钩子\]/);
  assert.doesNotMatch(source, /console\.log\('\[Luckysheet\]/);
});

test('Delete/Backspace interception ignores visible inputs (search & find dialogs)', () => {
  // 旧逻辑要求 input 有 id 才放行，无 id 的搜索框退格被拦截 —— 必须已移除
  assert.doesNotMatch(source, /target\?\.id !== ''/);
  // 新逻辑：可见输入控件（offsetParent / 尺寸判断）一律放行
  assert.match(source, /target\.offsetParent !== null/);
  assert.match(source, /isContentEditable/);
});

test('hook suppression is released even when days batch exits early', () => {
  // 早退不释放会让所有编辑永远记录不到（「保存不了」根因之一）。
  // main 上是回调式实现：两个批量任务共享计数，都结束才释放 suppress
  assert.match(source, /batchesPending === 0\) suppressHookRef\.current = false/);
  // 每个早退/失败路径都必须回调 onDone
  assert.match(source, /if \(!ls\?\.setCellValue\) \{ onDone\?\.\(\); return; \}/);
  assert.match(source, /if \(!sheet\?\.data\) \{ onDone\?\.\(\); return; \}/);
  assert.match(source, /\[天数自动算\] 失败:', e\?\.message\); onDone\?\.\(\); \}/);
});

test('batch cell writes are chunked to avoid blocking the main thread', () => {
  const chunks = source.match(/const CHUNK = 30/g) || [];
  assert.ok(chunks.length >= 2, 'days batch and formula batch should both chunk');
});

test('sheet uses taller default rows and resizes with the container', () => {
  assert.match(source, /defaultRowHeight: 24/);
  assert.match(source, /ls\.resize\(\)/);
});

const migStart = source.indexOf('const WIDTH_MIGRATION');
const migEnd = source.indexOf('function ordersToCelldata');
const migCtx = {};
vm.createContext(migCtx);
vm.runInContext(`${source.slice(migStart, migEnd)}\nthis.migrateSavedWidths = migrateSavedWidths;`, migCtx);

test('saved column widths at old defaults migrate; user-customized widths stay', () => {
  const cols = [
    { data: 'contract', width: 105 },      // 旧默认 120 → 新 105
    { data: 'item_no', width: 115 },       // 旧默认 130 → 新 115
    { data: 'product_name', width: 115 },
  ];
  const migrated = migCtx.migrateSavedWidths({ 0: 120, 1: 130, 2: 200 }, cols);
  assert.equal(migrated[0], 105, '停在旧默认值 120 → 换成新默认 105');
  assert.equal(migrated[1], 115, '停在旧默认值 130 → 换成新默认 115');
  assert.equal(migrated[2], 200, '用户手调过 200 → 不动');
});

// ===== 2026-08-11 「设置日期格式要点两次」修复 =====

const dueStart = source.indexOf('function normalizeDueText');
const dueEnd = source.indexOf('function formatDateShort');
const dueCtx = {};
vm.createContext(dueCtx);
vm.runInContext(`${source.slice(dueStart, dueEnd)}\nthis.normalizeDueText = normalizeDueText;`, dueCtx);

test('due-column text normalizes ISO dates and serials to a consistent display', () => {
  const { normalizeDueText } = dueCtx;
  assert.equal(normalizeDueText('2026-04-22'), '4月22日', 'ISO 格式统一成中文显示');
  assert.equal(normalizeDueText('2026/4/22'), '4月22日');
  assert.equal(normalizeDueText('45885'), '8月16日', '序列号转日期文本');
  assert.equal(normalizeDueText('8月11日'), '8月11日', '已是中文格式不动');
  assert.equal(normalizeDueText('无'), '无', '普通文字不动');
});

test('due-column auto-correction only fires on real serial conversion', () => {
  // 用户手动设「日期」格式时 v 不变、只变 ct/fa —— 纠正逻辑不得回写，
  // 否则把刚设的格式顶掉（点两次才生效的根因）
  assert.match(source, /vIsSerial = typeof cell\?\.v === 'number' && cell\.v > 40000 && cell\.v < 60000/);
  assert.match(source, /if \(cell && vIsSerial && cell\.v !== text\)/);
});
