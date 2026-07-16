'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const appRoot = path.join(__dirname, '..');

function removeDatabaseFiles(dbPath) {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  const dir = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.pre-factory-scope-`;
  for (const file of fs.readdirSync(dir)) {
    if (file.startsWith(prefix) && file.endsWith('.bak')) {
      fs.unlinkSync(path.join(dir, file));
    }
  }
}

test('factory migration preserves refs, tolerates null payloads, and scopes quote numbers', () => {
  const dbPath = path.join(os.tmpdir(), `internal-quote-factory-${process.pid}.sqlite`);
  removeDatabaseFiles(dbPath);

  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_no TEXT UNIQUE NOT NULL,
      product_name TEXT NOT NULL,
      customer TEXT,
      qty INTEGER,
      created_by_dept TEXT NOT NULL DEFAULT 'sales',
      created_by_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'drafting',
      version TEXT
    );
    CREATE TABLE quote_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      dept TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'empty',
      filled_by TEXT,
      filled_at TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      review_comment TEXT,
      UNIQUE(quote_id, dept)
    );
    CREATE TABLE ref_tables (
      key TEXT PRIMARY KEY,
      data_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    );
  `);
  legacy.prepare('INSERT INTO quotes (quote_no, product_name) VALUES (?, ?)').run('SHARED-001', '旧报价');
  legacy.prepare('INSERT INTO quote_sections (quote_id, dept, payload_json) VALUES (1, ?, ?)').run('molding', 'null');
  const customMaterials = [{ name: 'CUSTOM', model: 'USER-PRICE', price: 99 }];
  legacy.prepare('INSERT INTO ref_tables (key, data_json, updated_by) VALUES (?, ?, ?)')
    .run('material_prices', JSON.stringify(customMaterials), 'manual-user');
  legacy.close();

  try {
    const child = spawnSync(process.execPath, ['-e', `
      const db = require('./backend/db');
      const refs = {};
      for (const factoryCode of ['qingxi', 'heyuan']) {
        refs[factoryCode] = JSON.parse(db.prepare(
          'SELECT data_json FROM factory_ref_tables WHERE factory_code = ? AND key = ?'
        ).get(factoryCode, 'material_prices').data_json);
      }
      db.prepare(
        'INSERT INTO quotes (quote_no, product_name, factory_code) VALUES (?, ?, ?)'
      ).run('SHARED-001', '河源同货号', 'heyuan');
      let sameFactoryRejected = false;
      try {
        db.prepare(
          'INSERT INTO quotes (quote_no, product_name, factory_code) VALUES (?, ?, ?)'
        ).run('SHARED-001', '清溪重复货号', 'qingxi');
      } catch (error) {
        sameFactoryRejected = /UNIQUE/.test(String(error && error.message));
      }
      const quoteCount = db.prepare(
        'SELECT COUNT(*) AS n FROM quotes WHERE quote_no = ?'
      ).get('SHARED-001').n;
      const preservedSectionCount = db.prepare(
        'SELECT COUNT(*) AS n FROM quote_sections WHERE quote_id = ? AND dept = ? AND payload_json = ?'
      ).get(1, 'molding', 'null').n;
      const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all().length;
      console.log('__FACTORY_RESULT__' + JSON.stringify({
        refs,
        quoteCount,
        preservedSectionCount,
        foreignKeyViolations,
        sameFactoryRejected,
      }));
      db.close();
    `], {
      cwd: appRoot,
      env: {
        ...process.env,
        DB_FILE: dbPath,
        ADMIN_INITIAL_PASSWORD: 'TestOnly-123456',
      },
      encoding: 'utf8',
    });

    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
    const resultLine = child.stdout.split(/\r?\n/)
      .find(line => line.startsWith('__FACTORY_RESULT__'));
    assert.ok(resultLine, child.stdout);
    const result = JSON.parse(resultLine.slice('__FACTORY_RESULT__'.length));
    for (const factoryCode of ['qingxi', 'heyuan']) {
      assert.ok(result.refs[factoryCode].some(row =>
        row.name === 'CUSTOM' && row.model === 'USER-PRICE' && row.price === 99
      ));
    }
    assert.equal(result.quoteCount, 2);
    assert.equal(result.preservedSectionCount, 1);
    assert.equal(result.foreignKeyViolations, 0);
    assert.equal(result.sameFactoryRejected, true);
    const backupPrefix = `${path.basename(dbPath)}.pre-factory-scope-`;
    const backups = fs.readdirSync(path.dirname(dbPath))
      .filter(file => file.startsWith(backupPrefix) && file.endsWith('.bak'));
    assert.equal(backups.length, 1);
    assert.ok(fs.statSync(path.join(path.dirname(dbPath), backups[0])).size > 0);
  } finally {
    removeDatabaseFiles(dbPath);
  }
});
