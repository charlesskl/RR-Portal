const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const {
  appendMissingRefDefaultsToSectionPayloads,
  mergeMissingRefDefaults,
} = require('../backend/db/ref-defaults');

const recycledAbsModel = '\u62bd\u7c92\u6599';

test('mergeMissingRefDefaults appends missing material defaults without replacing existing rows', () => {
  const existing = [
    { name: 'ABS', model: '750SW', price: 8.8 },
    { name: 'C-ABS', model: 'TR558/920', price: 12.5 },
  ];
  const defaults = [
    { name: 'ABS', model: '750SW', price: 8.5 },
    { name: 'ABS', model: '抽粒料', price: 4.6 },
  ];

  const merged = mergeMissingRefDefaults(existing, defaults);

  assert.deepEqual(merged, [
    { name: 'ABS', model: '750SW', price: 8.8 },
    { name: 'C-ABS', model: 'TR558/920', price: 12.5 },
    { name: 'ABS', model: '抽粒料', price: 4.6 },
  ]);
});

test('mergeMissingRefDefaults reuses the first blank material row for missing defaults', () => {
  const existing = [
    { name: 'ABS', model: '750SW', price: 8.5 },
    {},
  ];
  const defaults = [
    { name: 'ABS', model: recycledAbsModel, price: 4.6 },
  ];

  const merged = mergeMissingRefDefaults(existing, defaults);

  assert.deepEqual(merged, [
    { name: 'ABS', model: '750SW', price: 8.5 },
    { name: 'ABS', model: recycledAbsModel, price: 4.6 },
  ]);
});

test('mergeMissingRefDefaults moves an appended default into an earlier blank material row', () => {
  const existing = [
    { name: 'ABS', model: '750SW', price: 8.5 },
    {},
    { name: 'ABS', model: recycledAbsModel, price: 4.6 },
  ];
  const defaults = [
    { name: 'ABS', model: recycledAbsModel, price: 4.6 },
  ];

  const merged = mergeMissingRefDefaults(existing, defaults);

  assert.deepEqual(merged, [
    { name: 'ABS', model: '750SW', price: 8.5 },
    { name: 'ABS', model: recycledAbsModel, price: 4.6 },
  ]);
});

test('mergeMissingRefDefaults is idempotent', () => {
  const existing = [
    { name: 'ABS', model: '750SW', price: 8.5 },
    { name: 'ABS', model: '抽粒料', price: 4.6 },
  ];
  const defaults = [
    { name: 'ABS', model: '750SW', price: 8.5 },
    { name: 'ABS', model: '抽粒料', price: 4.6 },
  ];

  assert.deepEqual(mergeMissingRefDefaults(existing, defaults), existing);
});

test('appendMissingRefDefaultsToSectionPayloads upgrades existing molding quote payload copies', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE quote_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dept TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    )
  `);

  const oldMoldingPayload = {
    material_prices: [
      { name: 'ABS', model: '750SW', price: 8.8 },
      { name: 'C-ABS', model: 'TR558/920', price: 12.5 },
    ],
    machine_prices: [{ model: '4A-6A', price: 940 }],
  };
  const otherDeptPayload = {
    material_prices: [
      { name: 'ABS', model: '750SW', price: 8.5 },
    ],
  };

  db.prepare('INSERT INTO quote_sections (dept, payload_json) VALUES (?, ?)').run('molding', JSON.stringify(oldMoldingPayload));
  db.prepare('INSERT INTO quote_sections (dept, payload_json) VALUES (?, ?)').run('sales', JSON.stringify(otherDeptPayload));

  const result = appendMissingRefDefaultsToSectionPayloads(db, 'molding', 'material_prices', [
    { name: 'ABS', model: '750SW', price: 8.5 },
    { name: 'ABS', model: recycledAbsModel, price: 4.6 },
  ]);

  assert.deepEqual(result, { rowsChanged: 1, itemsAdded: 1 });

  const molding = JSON.parse(db.prepare("SELECT payload_json FROM quote_sections WHERE dept = 'molding'").get().payload_json);
  assert.deepEqual(molding.material_prices, [
    { name: 'ABS', model: '750SW', price: 8.8 },
    { name: 'C-ABS', model: 'TR558/920', price: 12.5 },
    { name: 'ABS', model: recycledAbsModel, price: 4.6 },
  ]);
  assert.deepEqual(molding.machine_prices, oldMoldingPayload.machine_prices);

  const sales = JSON.parse(db.prepare("SELECT payload_json FROM quote_sections WHERE dept = 'sales'").get().payload_json);
  assert.deepEqual(sales, otherDeptPayload);
});

test('appendMissingRefDefaultsToSectionPayloads persists defaults into blank material rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE quote_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dept TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    )
  `);

  db.prepare('INSERT INTO quote_sections (dept, payload_json) VALUES (?, ?)').run('molding', JSON.stringify({
    material_prices: [
      { name: 'ABS', model: '750SW', price: 8.5 },
      {},
    ],
  }));

  const result = appendMissingRefDefaultsToSectionPayloads(db, 'molding', 'material_prices', [
    { name: 'ABS', model: recycledAbsModel, price: 4.6 },
  ]);

  assert.deepEqual(result, { rowsChanged: 1, itemsAdded: 1 });

  const molding = JSON.parse(db.prepare("SELECT payload_json FROM quote_sections WHERE dept = 'molding'").get().payload_json);
  assert.deepEqual(molding.material_prices, [
    { name: 'ABS', model: '750SW', price: 8.5 },
    { name: 'ABS', model: recycledAbsModel, price: 4.6 },
  ]);
});

test('appendMissingRefDefaultsToSectionPayloads persists moving appended defaults into earlier blank rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE quote_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dept TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    )
  `);

  db.prepare('INSERT INTO quote_sections (dept, payload_json) VALUES (?, ?)').run('molding', JSON.stringify({
    material_prices: [
      { name: 'ABS', model: '750SW', price: 8.5 },
      {},
      { name: 'ABS', model: recycledAbsModel, price: 4.6 },
    ],
  }));

  const result = appendMissingRefDefaultsToSectionPayloads(db, 'molding', 'material_prices', [
    { name: 'ABS', model: recycledAbsModel, price: 4.6 },
  ]);

  assert.deepEqual(result, { rowsChanged: 1, itemsAdded: 0 });

  const molding = JSON.parse(db.prepare("SELECT payload_json FROM quote_sections WHERE dept = 'molding'").get().payload_json);
  assert.deepEqual(molding.material_prices, [
    { name: 'ABS', model: '750SW', price: 8.5 },
    { name: 'ABS', model: recycledAbsModel, price: 4.6 },
  ]);
});
