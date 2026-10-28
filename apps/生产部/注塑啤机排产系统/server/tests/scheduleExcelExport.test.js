const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paiji-excel-export-'));
process.env.DATA_PATH = dataDir;
const db = require('../db/connection');
const { exportScheduleExcel } = require('../services/excelExporter');

// Keep the fixture independent of startup seed data and all real workbooks.
db.exec(`
  CREATE TABLE machines (
    machine_no TEXT, workshop TEXT, arm_type TEXT, tonnage INTEGER, brand TEXT,
    UNIQUE(machine_no, workshop)
  );
  CREATE TABLE schedules (
    id INTEGER PRIMARY KEY, schedule_date TEXT, shift TEXT, workshop TEXT
  );
  CREATE TABLE schedule_items (
    id INTEGER PRIMARY KEY, schedule_id INTEGER, machine_no TEXT,
    product_code TEXT, quantity_needed INTEGER, accumulated INTEGER,
    sort_order INTEGER DEFAULT 0, notes TEXT
  );
`);

test.after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  db.exec('DELETE FROM schedule_items; DELETE FROM schedules; DELETE FROM machines;');
  const insert = db.prepare('INSERT INTO machines VALUES (?, ?, ?, ?, ?)');
  for (const workshop of ['A', 'B', 'C']) {
    insert.run('其他机台', workshop, '-', 0, '-');
    insert.run('吹气机台', workshop, '-', 0, '-');
  }
  insert.run('2#', 'B', '三轴单臂', 150, 'Fixture');
  insert.run('10#', 'B', '五轴双臂', 300, 'Fixture');
});

function schedule(id, workshop = 'B', shift = '白班', date = `2026-10-${String(id).padStart(2, '0')}`) {
  db.prepare('INSERT INTO schedules VALUES (?, ?, ?, ?)')
    .run(id, date, shift, workshop);
}

function item(id, scheduleId, machine, code, needed = 100, accumulated = 0, notes = '') {
  db.prepare('INSERT INTO schedule_items VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
    .run(id, scheduleId, machine, code, needed, accumulated, notes);
}

async function workbook(id) {
  // The actual export must succeed on a read-only SQLite connection too.
  db.pragma('query_only = ON');
  try {
    const { buffer, filename } = await exportScheduleExcel(id);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
    assert.match(filename, /\.xlsx$/);
    return book;
  } finally {
    db.pragma('query_only = OFF');
  }
}

function productRows(sheet) {
  const rows = [];
  sheet.eachRow((row, number) => {
    const code = row.getCell(2).value;
    if (typeof code === 'string' && code.startsWith('FIXTURE-')) rows.push({ code, number });
  });
  return rows;
}

function rowContaining(sheet, value) {
  let found;
  sheet.eachRow((row, number) => {
    if (row.getCell(1).value === value) found = number;
  });
  assert.ok(found, `missing worksheet row: ${value}`);
  return found;
}

test('exports each special-machine item once and omits completed items in both shifts', async () => {
  schedule(1);
  schedule(2, 'C'); // Another workshop must not become the history sheet.
  schedule(3, 'B', '夜班');
  item(1, 1, '其他机台', 'FIXTURE-PREV-OTHER');
  item(2, 1, '吹气机台', 'FIXTURE-PREV-BLOW');
  item(3, 1, '2#', 'FIXTURE-PREV-REGULAR');
  item(4, 1, '10#', 'FIXTURE-PREV-DONE', 100, 100);
  item(5, 2, '其他机台', 'FIXTURE-WRONG-WORKSHOP');
  item(6, 3, '10#', 'FIXTURE-REGULAR-10');
  item(7, 3, '2#', 'FIXTURE-REGULAR-2', 100, 20);
  item(8, 3, '吹气机台', 'FIXTURE-BLOW-1');
  item(9, 3, '吹气机台', 'FIXTURE-BLOW-2');
  item(10, 3, '其他机台', 'FIXTURE-OTHER');
  item(11, 3, '2#', 'FIXTURE-DONE', 100, 100);
  item(12, 3, '其他机台', 'FIXTURE-OVERDONE', 100, 101);

  const book = await workbook(3);
  assert.equal(book.worksheets.length, 2);
  const current = book.worksheets[0];
  const previous = book.worksheets[1];
  assert.deepEqual(productRows(current).map(({ code }) => code), [
    'FIXTURE-REGULAR-2', 'FIXTURE-REGULAR-10', 'FIXTURE-BLOW-1', 'FIXTURE-BLOW-2', 'FIXTURE-OTHER',
  ]);
  assert.deepEqual(productRows(previous).map(({ code }) => code), [
    'FIXTURE-PREV-REGULAR', 'FIXTURE-PREV-OTHER', 'FIXTURE-PREV-BLOW',
  ]);
  const footer = rowContaining(current, '制表人：');
  assert.ok(productRows(current).filter(({ code }) => /BLOW|OTHER/.test(code))
    .every(({ number }) => number > footer));
  rowContaining(current, '合计: 2 条排机记录');
  rowContaining(previous, '合计: 3 条排机记录');
  assert.equal(current.getColumn(25).width, 6);
  assert.equal(current.getCell('B3').value, '产品货号');
  assert.equal(current.getCell('K4').fill.fgColor.argb, 'FFFFC000');
  assert.equal(current.getCell('Y4').value, 150);
  assert.equal(current.views[0].ySplit, 3);
  assert.ok(current.model.merges.includes('A8:A9'));
});

test('keeps zero or absent targets while filtering completed positive targets', async () => {
  schedule(4, 'A');
  item(1, 4, '其他机台', 'FIXTURE-ZERO-TARGET', 0, 0);
  item(2, 4, '吹气机台', 'FIXTURE-NULL-TARGET', null, 0);
  item(3, 4, 'MISSING-MACHINE', 'FIXTURE-MISSING-METADATA', 10, 9);
  item(4, 4, '其他机台', 'FIXTURE-COMPLETE', 1, 1);
  const book = await workbook(4);
  assert.equal(book.worksheets.length, 1);
  assert.deepEqual(productRows(book.worksheets[0]).map(({ code }) => code), [
    'FIXTURE-MISSING-METADATA', 'FIXTURE-ZERO-TARGET', 'FIXTURE-NULL-TARGET',
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_items').get().n, 4);
});

test('produces an empty current sheet and omits a fully completed history sheet', async () => {
  schedule(5, 'C');
  schedule(6, 'C', '夜班');
  item(1, 5, '其他机台', 'FIXTURE-HISTORY-DONE', 20, 20);
  item(2, 6, '吹气机台', 'FIXTURE-CURRENT-DONE', 20, 21);
  const book = await workbook(6);
  assert.equal(book.worksheets.length, 1);
  assert.deepEqual(productRows(book.worksheets[0]), []);
  rowContaining(book.worksheets[0], '合计: 0 条排机记录');
  rowContaining(book.worksheets[0], '制表人：');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_items').get().n, 2);
});


test('round-trips white data rows in both sheets without losing highlights or red notes', async () => {
  schedule(1);
  schedule(2, 'B', '夜班');
  for (const scheduleId of [1, 2]) {
    const firstId = scheduleId * 10;
    item(firstId, scheduleId, '2#', `FIXTURE-${scheduleId}-ZERO`, 100, 0, 'Fixture note');
    item(firstId + 1, scheduleId, '2#', `FIXTURE-${scheduleId}-PROGRESS`, 100, 12, 'Fixture note');
    item(firstId + 2, scheduleId, '吹气机台', `FIXTURE-${scheduleId}-SPECIAL-ZERO`);
    item(firstId + 3, scheduleId, '吹气机台', `FIXTURE-${scheduleId}-SPECIAL-PROGRESS`, 100, 9);
  }
  const before = db.prepare('SELECT * FROM schedule_items ORDER BY id').all();
  const book = await workbook(2);
  assert.equal(book.worksheets.length, 2);
  for (const sheet of book.worksheets) {
    const rows = productRows(sheet);
    assert.equal(rows.length, 4);
    assert.ok(rows.some(({ number }) => number % 2 === 0));
    assert.ok(rows.some(({ number }) => number % 2 === 1));
    for (let c = 1; c <= 25; c++) {
      assert.equal(sheet.getRow(3).getCell(c).fill.fgColor.argb, 'FFD9E1F2');
    }
    for (const { code, number } of rows) {
      const row = sheet.getRow(number);
      for (let c = 1; c <= 25; c++) {
        const expected = c === 11 && code.endsWith('PROGRESS') ? 'FFFFC000' : 'FFFFFFFF';
        assert.equal(row.getCell(c).fill.type, 'pattern');
        assert.equal(row.getCell(c).fill.pattern, 'solid');
        assert.equal(row.getCell(c).fill.fgColor.argb, expected, `${sheet.name}!${row.getCell(c).address}`);
      }
      if (!code.includes('SPECIAL')) {
        assert.equal(row.getCell(19).value, 'Fixture note');
        assert.equal(row.getCell(19).font.color.argb, 'FFFF0000');
        assert.equal(row.getCell(19).font.bold, true);
      }
    }
  }
  assert.deepEqual(db.prepare('SELECT * FROM schedule_items ORDER BY id').all(), before);
});

test('keeps exactly the original previous schedule, not a month of history or later-created schedules', async () => {
  schedule(7, 'B', '白班', '2026-10-20');
  schedule(8, 'B', '夜班', '2026-10-29');
  schedule(9, 'B', '白班', '2026-10-30');
  schedule(10, 'B', '夜班', '2026-10-31');
  schedule(11, 'B', '白班', '2026-10-31');
  schedule(12, 'C', '夜班', '2026-10-31');
  for (const id of [7, 8, 9, 10, 11, 12]) item(id, id, '其他机台', `FIXTURE-HISTORY-${id}`);
  const book = await workbook(10);
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['排机单', '2026-10-30 白班']);
  assert.deepEqual(productRows(book.worksheets[0]).map(({ code }) => code), ['FIXTURE-HISTORY-10']);
  assert.deepEqual(productRows(book.worksheets[1]).map(({ code }) => code), ['FIXTURE-HISTORY-9']);
});

test('retains the previous schedule even when it is more than a month old', async () => {
  schedule(8, 'B', '夜班', '2026-08-31');
  schedule(10, 'B', '白班', '2026-10-31');
  item(1, 8, '其他机台', 'FIXTURE-OLD-PREVIOUS');
  item(2, 10, '其他机台', 'FIXTURE-CURRENT');
  const book = await workbook(10);
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['排机单', '2026-08-31 夜班']);
  assert.deepEqual(productRows(book.worksheets[1]).map(({ code }) => code), ['FIXTURE-OLD-PREVIOUS']);
});
