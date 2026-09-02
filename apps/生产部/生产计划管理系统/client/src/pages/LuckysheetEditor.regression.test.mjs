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

// ===== 2026-08-13 「货期列改字体保存不了」修复 =====

const fmtStart = source.indexOf('const AUTO_BG_SET');
const fmtEnd = source.indexOf('function getCellFormula');
const fmtCtx = {};
vm.createContext(fmtCtx);
vm.runInContext(`${source.slice(fmtStart, fmtEnd)}\nthis.extractCellFormat = extractCellFormat;\nthis.formatKey = formatKey;`, fmtCtx);

test('extractCellFormat captures toolbar font changes (ff/fs/fc/bl)', () => {
  const { extractCellFormat } = fmtCtx;
  // 工具栏改字体后，Luckysheet 只在单元格上写 ff —— 必须被提取进 cell_format
  const fmt = extractCellFormat({ v: '货期待复', m: '货期待复', ct: { t: 'g' }, ff: '微软雅黑' });
  assert.equal(fmt.ff, '微软雅黑');
  // 渲染时自动加的背景色不算用户格式
  assert.equal(extractCellFormat({ v: 'x', bg: '#FFFDE7' }), null);
});

test('formatKey comparison is key-order independent', () => {
  const { formatKey } = fmtCtx;
  // DB JSON 的键序与 extractCellFormat 生成的不同时，不得误判为「有变化」
  assert.equal(formatKey({ ff: '微软雅黑', bl: 1 }), formatKey({ bl: 1, ff: '微软雅黑' }));
  assert.equal(formatKey(null), formatKey(undefined));
  assert.notEqual(formatKey({ ff: '微软雅黑' }), formatKey(null));
});

test('saveAll has a format-only fallback scan for hook-less toolbar operations', () => {
  // luckysheet@2.1.13 工具栏格式操作不触发任何钩子（rangeUpdated 源码中从未调用，
  // updated 只在撤销/重做时触发）—— 保存时必须兜底扫描格式差异
  assert.match(source, /格式兜底扫描/);
  assert.match(source, /formatKey\(curFmt\) === formatKey\(base\)/);
  // 扫描只对比格式，不得回写字段值（历史值类型差异会产生幻影变化）
  assert.doesNotMatch(source, /格式兜底扫描[\s\S]{0,2000}?writeFieldValue/);
});

// ===== 2026-08-20 「生产进度固定百分比」 =====

const progStart = source.indexOf('function computeProgress');
const progEnd = source.indexOf('function ordersToCelldata');
const progCtx = {};
vm.createContext(progCtx);
vm.runInContext(`${source.slice(progStart, progEnd)}\nthis.computeProgress = computeProgress;`, progCtx);

test('production progress is a fixed percentage of production_count / quantity', () => {
  const { computeProgress } = progCtx;
  // 注意：computeProgress 在 vm realm 里跑，返回对象原型与主 realm 不同，
  // deepEqual 会误判 —— 逐字段断言
  const check = (q, c, text, ratio) => {
    const r = computeProgress(q, c);
    assert.equal(r.text, text, `computeProgress(${q}, ${c}).text`);
    assert.equal(r.ratio, ratio, `computeProgress(${q}, ${c}).ratio`);
  };
  check(51072, 5000, '9.79%', 0.097901);
  check(44320, 1000, '2.26%', 0.022563);
  check(51072, 51072, '100%', 1);
  // 生产数为空/0 → 显示 0%（和车间手填习惯一致）
  check(51072, 0, '0%', 0);
  check(51072, null, '0%', 0);
  // 数量为空/0 → 空白，不出 NaN%
  check('', 100, '', null);
  check(0, 100, '', null);
});

test('progress cell uses native percent format so Luckysheet never strips the %', () => {
  // 落地实测：celldata 初次加载时 Luckysheet 会用 v 重写 m ——
  // v=数字 + m='9.79%' 会被改回 '9.79'（%丢失）。必须用 v=比率 + fa='0.00%'
  const start = source.indexOf('const NUMERIC_SUM_FIELDS');
  const end = source.indexOf('// 从 Luckysheet 单元格对象提取格式');
  const ctx = { Date, Set };
  vm.createContext(ctx);
  vm.runInContext(`${source.slice(start, end)}\nthis.ordersToCelldata = ordersToCelldata;`, ctx);
  const cells = ctx.ordersToCelldata([
    { id: 1, quantity: 51072, production_count: 5000, production_progress: 0 },
  ], [{ data: 'production_progress', title: '生产进度' }], new Set());
  const cell = cells.find(c => c.r === 1 && c.c === 0);
  assert.equal(cell.v.v, 0.097901, 'v 是比率');
  assert.equal(cell.v.ct.fa, '0.00%', '原生百分比格式');
  assert.equal(cell.v.ct.t, 'n');
});

test('editing quantity or production_count recomputes the progress cell live', () => {
  // 钩子里 production_count 必须触发重算（原只有 quantity/daily_target）
  assert.match(source, /colData === 'quantity' \|\| colData === 'daily_target' \|\| colData === 'production_count'/);
  // 重算结果要入 pending，保存才会落库
  assert.match(source, /fields\.production_progress = progressValue/);
});

// ===== 2026-08-21 「走货期填文字保存不了」修复 =====

test('non-date text in date columns is preserved instead of silently dropped', () => {
  // 车间在走货期列填「货期待复」等文字 —— parseToISO 解析不了时必须按原文本存。
  // 旧逻辑 if (iso) entry.fields[...] = iso —— 解析失败静默丢弃，保存后全丢
  assert.match(source, /entry\.fields\[colData\] = iso \|\| String\(v\)/);
  assert.doesNotMatch(source, /if \(iso\) entry\.fields\[colData\] = iso;/);
  // writeFieldValue（公式兜底扫描用）同样不得丢文本
  assert.match(source, /\{ fields\[colData\] = String\(value\); return true; \}/);
  assert.doesNotMatch(source, /if \(!iso && value != null && value !== ''\) return false;/);
});

// ===== 2026-08-22 落地实测发现：首次创建路径不释放 suppress =====

test('first-create path releases hook suppression after both batches finish', () => {
  // 竞态：数据比 sheet-settings 先到时，重建 effect 早退、首次创建直接消费数据，
  // 而旧代码只有重建路径释放 suppressHookRef —— suppress 永远为 true，
  // 所有编辑静默丢失。首次创建路径必须同样计数释放。
  assert.match(source, /initBatchesPending === 0\) suppressHookRef\.current = false/);
  assert.match(source, /applySavedFormulasBatch\(initBatchDone\)/);
  assert.match(source, /applyDaysFormulaBatch\(initBatchDone\)/);
});

// ===== 2026-08-22 「走货期格子不能编辑文字」修复：移除 DatePicker 拦截 =====

test('date columns are free-typed: no DatePicker interception remains', () => {
  // 车间反馈：走货期要填「货期待复」「客想9/5走」等文字，但单击/双击格子被
  // cellEditBefore 弹出的 antd DatePicker 挡住，根本进不了编辑态。
  // 落地实测确认后整体移除 DatePicker 方案，日期列改为自由输入
  // （parseToISO 照旧归一化日期，非日期文字按原文保存）。
  assert.doesNotMatch(source, /cellEditBefore/);
  assert.doesNotMatch(source, /_pendingFields/);
  assert.doesNotMatch(source, /DatePicker/);
  assert.doesNotMatch(source, /from 'dayjs'/);
});
