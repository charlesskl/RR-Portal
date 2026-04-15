// SQLite-backed data layer for figure-mold-cost-system
// Replaces the legacy data.json single-file storage.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'app.db');

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ──────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS mold_orders (
  id INTEGER PRIMARY KEY,
  "group" TEXT DEFAULT '',
  customer TEXT DEFAULT '',
  mold_name TEXT DEFAULT '',
  material TEXT DEFAULT '',
  gate TEXT DEFAULT '',
  cav_up TEXT DEFAULT '',
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  image TEXT DEFAULT '',
  mold_factory TEXT DEFAULT '',
  order_date TEXT DEFAULT '',
  mold_start_date TEXT DEFAULT '',
  delivery_date TEXT DEFAULT '',
  status TEXT DEFAULT '已下单',
  payment_type TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  from_po_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mold_customer ON mold_orders(customer);
CREATE INDEX IF NOT EXISTS idx_mold_group ON mold_orders("group");
CREATE INDEX IF NOT EXISTS idx_mold_status ON mold_orders(status);
CREATE INDEX IF NOT EXISTS idx_mold_order_date ON mold_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_mold_factory ON mold_orders(mold_factory);

CREATE TABLE IF NOT EXISTS figure_orders (
  id INTEGER PRIMARY KEY,
  "group" TEXT DEFAULT '',
  customer TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  quantity INTEGER DEFAULT 0,
  figure_fee REAL DEFAULT 0,
  figure_factory TEXT DEFAULT '',
  order_date TEXT DEFAULT '',
  status TEXT DEFAULT '已下单',
  payment_type TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  from_po_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fig_customer ON figure_orders(customer);
CREATE INDEX IF NOT EXISTS idx_fig_group ON figure_orders("group");
CREATE INDEX IF NOT EXISTS idx_fig_status ON figure_orders(status);
CREATE INDEX IF NOT EXISTS idx_fig_order_date ON figure_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_fig_factory ON figure_orders(figure_factory);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY,
  po_number TEXT DEFAULT '',
  type TEXT DEFAULT 'mold',
  "group" TEXT DEFAULT '',
  supplier_name TEXT DEFAULT '',
  supplier_contact TEXT DEFAULT '',
  supplier_phone TEXT DEFAULT '',
  supplier_fax TEXT DEFAULT '',
  our_contact TEXT DEFAULT '',
  our_phone TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  customer TEXT DEFAULT '',
  items TEXT DEFAULT '[]',
  delivery_date_text TEXT DEFAULT '',
  delivery_address TEXT DEFAULT '',
  payment_terms TEXT DEFAULT '',
  payment_type TEXT DEFAULT '',
  tax_rate REAL DEFAULT 13,
  settlement_days INTEGER DEFAULT 30,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT '草稿',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_po_type ON purchase_orders(type);
CREATE INDEX IF NOT EXISTS idx_po_group ON purchase_orders("group");
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_created ON purchase_orders(created_at);

CREATE TABLE IF NOT EXISTS customers (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS mold_factories (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS figure_factories (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS eng_users (name TEXT PRIMARY KEY, pin TEXT);
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
`);

// ─── Seed defaults (only when tables empty — idempotent) ─────────────────
function seedIfEmpty() {
  const seed = db.transaction(() => {
    if (db.prepare('SELECT COUNT(*) c FROM mold_factories').get().c === 0) {
      const ins = db.prepare('INSERT OR IGNORE INTO mold_factories (name) VALUES (?)');
      ['东莞兴信模具厂', '华登模具厂'].forEach(n => ins.run(n));
    }
    if (db.prepare('SELECT COUNT(*) c FROM figure_factories').get().c === 0) {
      db.prepare('INSERT OR IGNORE INTO figure_factories (name) VALUES (?)').run('东莞兴信手办厂');
    }
    if (db.prepare('SELECT COUNT(*) c FROM customers').get().c === 0) {
      const ins = db.prepare('INSERT OR IGNORE INTO customers (name) VALUES (?)');
      ['ZURU', 'JAZWARES', 'Moose', 'TOMY'].forEach(n => ins.run(n));
    }
    if (db.prepare('SELECT COUNT(*) c FROM eng_users').get().c === 0) {
      const ins = db.prepare('INSERT OR IGNORE INTO eng_users (name, pin) VALUES (?, ?)');
      ins.run('管理员', '123456');
      ins.run('测试用户', '123456');
    }
    const ensureCounter = db.prepare('INSERT OR IGNORE INTO counters (key, value) VALUES (?, 1)');
    ensureCounter.run('nextId');
    ensureCounter.run('po_next_id');
  });
  seed();
}
seedIfEmpty();

// ─── Counters ────────────────────────────────────────────────────────────
const getCounterStmt = db.prepare('SELECT value FROM counters WHERE key = ?');
const bumpCounterStmt = db.prepare('UPDATE counters SET value = value + 1 WHERE key = ?');
function nextId(key) {
  const row = getCounterStmt.get(key);
  const current = row ? row.value : 1;
  bumpCounterStmt.run(key);
  return current;
}
// Ensure a counter is at least `val + 1` (used after bulk migration)
function ensureCounterAtLeast(key, val) {
  const row = getCounterStmt.get(key);
  if (!row) {
    db.prepare('INSERT INTO counters (key, value) VALUES (?, ?)').run(key, val + 1);
  } else if (row.value <= val) {
    db.prepare('UPDATE counters SET value = ? WHERE key = ?').run(val + 1, key);
  }
}

// ─── Mold orders ─────────────────────────────────────────────────────────
const MOLD_FIELDS = ['group', 'customer', 'mold_name', 'material', 'gate', 'cav_up',
  'unit_price', 'amount', 'image', 'mold_factory', 'order_date', 'mold_start_date',
  'delivery_date', 'status', 'payment_type', 'notes', 'created_by', 'created_at',
  'updated_at', 'from_po_id'];

function buildFilterSQL(table, filters) {
  const where = [];
  const params = [];
  if (filters.group) { where.push('"group" = ?'); params.push(filters.group); }
  if (filters.factory) {
    const col = table === 'mold_orders' ? 'mold_factory' : 'figure_factory';
    where.push(`${col} = ?`); params.push(filters.factory);
  }
  if (filters.customer) { where.push('customer = ?'); params.push(filters.customer); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.year && filters.month) {
    where.push('order_date LIKE ?');
    params.push(`${filters.year}-${String(filters.month).padStart(2, '0')}%`);
  } else if (filters.year) {
    where.push('order_date LIKE ?'); params.push(`${filters.year}-%`);
  }
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

function listMoldOrders(filters = {}) {
  const { where, params } = buildFilterSQL('mold_orders', filters);
  return db.prepare(`SELECT * FROM mold_orders ${where} ORDER BY id DESC`).all(...params);
}
function getMoldOrder(id) {
  return db.prepare('SELECT * FROM mold_orders WHERE id = ?').get(id);
}
function createMoldOrder(order) {
  const id = order.id != null ? order.id : nextId('nextId');
  const cols = ['id', ...MOLD_FIELDS];
  const placeholders = cols.map(() => '?').join(',');
  const vals = [id, ...MOLD_FIELDS.map(f => order[f] !== undefined ? order[f] : '')];
  db.prepare(`INSERT INTO mold_orders (id, ${MOLD_FIELDS.map(f => `"${f}"`).join(',')}) VALUES (${placeholders})`).run(...vals);
  return getMoldOrder(id);
}
function updateMoldOrder(id, patch) {
  const fields = Object.keys(patch).filter(k => MOLD_FIELDS.includes(k));
  if (!fields.length) return getMoldOrder(id);
  const sets = fields.map(f => `"${f}" = ?`).join(',');
  const vals = fields.map(f => patch[f]);
  db.prepare(`UPDATE mold_orders SET ${sets} WHERE id = ?`).run(...vals, id);
  return getMoldOrder(id);
}
function deleteMoldOrder(id) {
  return db.prepare('DELETE FROM mold_orders WHERE id = ?').run(id).changes > 0;
}

// ─── Figure orders ───────────────────────────────────────────────────────
const FIGURE_FIELDS = ['group', 'customer', 'product_name', 'quantity', 'figure_fee',
  'figure_factory', 'order_date', 'status', 'payment_type', 'notes',
  'created_by', 'created_at', 'updated_at', 'from_po_id'];

function listFigureOrders(filters = {}) {
  const { where, params } = buildFilterSQL('figure_orders', filters);
  return db.prepare(`SELECT * FROM figure_orders ${where} ORDER BY id DESC`).all(...params);
}
function getFigureOrder(id) {
  return db.prepare('SELECT * FROM figure_orders WHERE id = ?').get(id);
}
function createFigureOrder(order) {
  const id = order.id != null ? order.id : nextId('nextId');
  const placeholders = ['?', ...FIGURE_FIELDS.map(() => '?')].join(',');
  const vals = [id, ...FIGURE_FIELDS.map(f => order[f] !== undefined ? order[f] : '')];
  db.prepare(`INSERT INTO figure_orders (id, ${FIGURE_FIELDS.map(f => `"${f}"`).join(',')}) VALUES (${placeholders})`).run(...vals);
  return getFigureOrder(id);
}
function updateFigureOrder(id, patch) {
  const fields = Object.keys(patch).filter(k => FIGURE_FIELDS.includes(k));
  if (!fields.length) return getFigureOrder(id);
  const sets = fields.map(f => `"${f}" = ?`).join(',');
  const vals = fields.map(f => patch[f]);
  db.prepare(`UPDATE figure_orders SET ${sets} WHERE id = ?`).run(...vals, id);
  return getFigureOrder(id);
}
function deleteFigureOrder(id) {
  return db.prepare('DELETE FROM figure_orders WHERE id = ?').run(id).changes > 0;
}

// ─── Purchase orders ─────────────────────────────────────────────────────
const PO_FIELDS = ['po_number', 'type', 'group', 'supplier_name', 'supplier_contact',
  'supplier_phone', 'supplier_fax', 'our_contact', 'our_phone', 'product_name',
  'customer', 'items', 'delivery_date_text', 'delivery_address', 'payment_terms',
  'payment_type', 'tax_rate', 'settlement_days', 'notes', 'status', 'created_by',
  'created_at', 'updated_at'];

function rowToPO(row) {
  if (!row) return row;
  try { row.items = JSON.parse(row.items || '[]'); } catch (e) { row.items = []; }
  return row;
}

function listPurchaseOrders(filters = {}) {
  const where = [];
  const params = [];
  if (filters.type) { where.push('type = ?'); params.push(filters.type); }
  if (filters.group) { where.push('"group" = ?'); params.push(filters.group); }
  if (filters.status) { where.push('status = ?'); params.push(filters.status); }
  if (filters.year) { where.push('created_at LIKE ?'); params.push(`${filters.year}-%`); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT * FROM purchase_orders ${clause} ORDER BY id DESC`).all(...params);
  return rows.map(rowToPO);
}
function getPurchaseOrder(id) {
  return rowToPO(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id));
}
function createPurchaseOrder(po) {
  const id = po.id != null ? po.id : nextId('po_next_id');
  const row = { ...po };
  row.items = JSON.stringify(po.items || []);
  const placeholders = ['?', ...PO_FIELDS.map(() => '?')].join(',');
  const vals = [id, ...PO_FIELDS.map(f => row[f] !== undefined ? row[f] : '')];
  db.prepare(`INSERT INTO purchase_orders (id, ${PO_FIELDS.map(f => `"${f}"`).join(',')}) VALUES (${placeholders})`).run(...vals);
  return getPurchaseOrder(id);
}
function updatePurchaseOrder(id, patch) {
  const p = { ...patch };
  if (p.items !== undefined) p.items = JSON.stringify(p.items);
  const fields = Object.keys(p).filter(k => PO_FIELDS.includes(k));
  if (!fields.length) return getPurchaseOrder(id);
  const sets = fields.map(f => `"${f}" = ?`).join(',');
  const vals = fields.map(f => p[f]);
  db.prepare(`UPDATE purchase_orders SET ${sets} WHERE id = ?`).run(...vals, id);
  return getPurchaseOrder(id);
}
function deletePurchaseOrder(id) {
  return db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(id).changes > 0;
}

// ─── Base lists (customers / factories / users) ──────────────────────────
function getCustomers() {
  return db.prepare('SELECT name FROM customers ORDER BY name').all().map(r => r.name);
}
function addCustomer(name) {
  if (!name) return;
  db.prepare('INSERT OR IGNORE INTO customers (name) VALUES (?)').run(name);
}
function getMoldFactories() {
  return db.prepare('SELECT name FROM mold_factories ORDER BY name').all().map(r => r.name);
}
function getFigureFactories() {
  return db.prepare('SELECT name FROM figure_factories ORDER BY name').all().map(r => r.name);
}
function getUser(name) {
  return db.prepare('SELECT name, pin FROM eng_users WHERE name = ?').get(name);
}
function updateUserPin(name, pin) {
  db.prepare('UPDATE eng_users SET pin = ? WHERE name = ?').run(pin, name);
}

module.exports = {
  db,
  nextId, ensureCounterAtLeast,
  listMoldOrders, getMoldOrder, createMoldOrder, updateMoldOrder, deleteMoldOrder,
  listFigureOrders, getFigureOrder, createFigureOrder, updateFigureOrder, deleteFigureOrder,
  listPurchaseOrders, getPurchaseOrder, createPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder,
  getCustomers, addCustomer,
  getMoldFactories, getFigureFactories,
  getUser, updateUserPin,
};
