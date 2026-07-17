'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { expandEngineeringMolds } = require('../backend/services/engineeringMolds');
const { changeUserFactories, changeUserRole } = require('../backend/services/userFactory');

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

function createUserAccessDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      factory_code TEXT NOT NULL
    );
    CREATE TABLE user_factories (
      user_id INTEGER NOT NULL,
      factory_code TEXT NOT NULL,
      PRIMARY KEY (user_id, factory_code)
    );
    CREATE TABLE user_customers (
      user_id INTEGER NOT NULL,
      customer TEXT NOT NULL,
      PRIMARY KEY (user_id, customer)
    );
    CREATE TABLE user_perms (
      user_id INTEGER NOT NULL,
      menu TEXT NOT NULL,
      PRIMARY KEY (user_id, menu)
    );
    INSERT INTO users (id, username, role, factory_code) VALUES (1, 'staff', 'staff', 'qingxi');
    INSERT INTO user_factories (user_id, factory_code) VALUES (1, 'qingxi');
    INSERT INTO user_customers (user_id, customer) VALUES (1, 'Shared Customer'), (1, 'Qingxi Only');
  `);
  return db;
}

test('changing user factories replaces scope and clears customers only when scope changes', () => {
  const db = createUserAccessDb();

  try {
    const changed = changeUserFactories(db, 1, ['heyuan']);
    assert.deepEqual(changed, { changed: true, clearedCustomers: 2 });
    assert.equal(db.prepare('SELECT factory_code FROM users WHERE id = 1').get().factory_code, 'heyuan');
    assert.deepEqual(
      db.prepare('SELECT factory_code FROM user_factories WHERE user_id = 1').all().map(row => row.factory_code),
      ['heyuan']
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_customers WHERE user_id = 1').get().n, 0);

    db.prepare('INSERT INTO user_customers (user_id, customer) VALUES (?, ?)').run(1, 'Heyuan Customer');
    const unchanged = changeUserFactories(db, 1, ['heyuan']);
    assert.deepEqual(unchanged, { changed: false, clearedCustomers: 0 });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_customers WHERE user_id = 1').get().n, 1);
  } finally {
    db.close();
  }
});

test('promoting a user to admin preserves its configured factory scope', () => {
  const db = createUserAccessDb();

  try {
    const result = changeUserRole(db, 1, 'admin', ['qingxi'], (userId) => {
      db.prepare('DELETE FROM user_perms WHERE user_id = ?').run(userId);
      db.prepare('INSERT INTO user_perms (user_id, menu) VALUES (?, ?)').run(userId, 'admin-template');
    });

    assert.deepEqual(result, { factoriesChanged: false, clearedCustomers: 2 });
    assert.equal(db.prepare('SELECT role FROM users WHERE id = 1').get().role, 'admin');
    assert.deepEqual(
      db.prepare('SELECT factory_code FROM user_factories WHERE user_id = 1 ORDER BY factory_code').all().map(row => row.factory_code),
      ['qingxi']
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_customers WHERE user_id = 1').get().n, 0);
    assert.equal(db.prepare('SELECT menu FROM user_perms WHERE user_id = 1').get().menu, 'admin-template');
  } finally {
    db.close();
  }
});

test('role update rolls back role, factories, customers, and permissions together', () => {
  const db = createUserAccessDb();
  db.prepare('INSERT INTO user_perms (user_id, menu) VALUES (?, ?)').run(1, 'staff-template');

  try {
    assert.throws(() => changeUserRole(db, 1, 'admin', ['qingxi', 'heyuan'], () => {
      db.prepare('DELETE FROM user_perms WHERE user_id = ?').run(1);
      throw new Error('template failure');
    }), /template failure/);

    assert.equal(db.prepare('SELECT role FROM users WHERE id = 1').get().role, 'staff');
    assert.deepEqual(
      db.prepare('SELECT factory_code FROM user_factories WHERE user_id = 1').all().map(row => row.factory_code),
      ['qingxi']
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_customers WHERE user_id = 1').get().n, 2);
    assert.equal(db.prepare('SELECT menu FROM user_perms WHERE user_id = 1').get().menu, 'staff-template');
  } finally {
    db.close();
  }
});

test('demoting an admin clears customer scope even when factory scope stays unchanged', () => {
  const db = createUserAccessDb();
  db.exec(`
    UPDATE users SET role = 'admin';
    INSERT INTO user_factories (user_id, factory_code) VALUES (1, 'heyuan');
  `);

  try {
    const result = changeUserRole(db, 1, 'staff', ['qingxi', 'heyuan'], () => {});
    assert.deepEqual(result, { factoriesChanged: false, clearedCustomers: 2 });
    assert.equal(db.prepare('SELECT role FROM users WHERE id = 1').get().role, 'staff');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_customers WHERE user_id = 1').get().n, 0);
  } finally {
    db.close();
  }
});
