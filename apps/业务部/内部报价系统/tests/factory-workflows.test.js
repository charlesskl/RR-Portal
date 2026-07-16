'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { expandEngineeringMolds } = require('../backend/services/engineeringMolds');
const { changeUserFactory } = require('../backend/services/userFactory');

test('engineering mold expansion preserves material and color for each part', () => {
  const rows = expandEngineeringMolds([{
    mold_no: 'M-001',
    material: 'ABS/PP',
    color: 'red/blue',
    shot_price: 120,
    parts: [
      { name: 'shell', material: 'ABS', color: 'red', cavity: '2', weight_g: 10 },
      { name: 'base', material: 'PP', color: 'blue', cavity: '1', weight_g: 20 },
    ],
  }]);

  assert.deepEqual(rows.map(row => ({
    name: row.name,
    material: row.material,
    color: row.color,
    shot_price: row.shot_price,
  })), [
    { name: 'shell', material: 'ABS', color: 'red', shot_price: 120 },
    { name: 'base', material: 'PP', color: 'blue', shot_price: 0 },
  ]);
});

test('changing a user factory clears customer scope only when the factory changes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      factory_code TEXT NOT NULL
    );
    CREATE TABLE user_customers (
      user_id INTEGER NOT NULL,
      customer TEXT NOT NULL,
      PRIMARY KEY (user_id, customer)
    );
    INSERT INTO users (id, username, factory_code) VALUES (1, 'staff', 'qingxi');
    INSERT INTO user_customers (user_id, customer) VALUES (1, 'Shared Customer'), (1, 'Qingxi Only');
  `);

  try {
    const changed = changeUserFactory(db, 1, 'heyuan');
    assert.deepEqual(changed, { changed: true, clearedCustomers: 2 });
    assert.equal(db.prepare('SELECT factory_code FROM users WHERE id = 1').get().factory_code, 'heyuan');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_customers WHERE user_id = 1').get().n, 0);

    db.prepare('INSERT INTO user_customers (user_id, customer) VALUES (?, ?)').run(1, 'Heyuan Customer');
    const unchanged = changeUserFactory(db, 1, 'heyuan');
    assert.deepEqual(unchanged, { changed: false, clearedCustomers: 0 });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_customers WHERE user_id = 1').get().n, 1);
  } finally {
    db.close();
  }
});
