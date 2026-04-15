// Migrate legacy data.json → SQLite app.db
// Idempotent: detects if migration already done (by MIGRATION_MARKER_FILE).
// Runs automatically at server startup when data.json exists and app.db has no data.
const fs = require('fs');
const path = require('path');
const d = require('./db');

const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const MARKER_FILE = path.join(DATA_DIR, '.migrated-to-sqlite');

function needsMigration() {
  if (fs.existsSync(MARKER_FILE)) return false;
  if (!fs.existsSync(DATA_FILE)) return false;
  // If any table already has rows, treat as migrated
  const counts = [
    d.db.prepare('SELECT COUNT(*) c FROM mold_orders').get().c,
    d.db.prepare('SELECT COUNT(*) c FROM figure_orders').get().c,
    d.db.prepare('SELECT COUNT(*) c FROM purchase_orders').get().c,
  ];
  if (counts.some(c => c > 0)) return false;
  return true;
}

function migrate() {
  console.log('[migrate] 开始从 data.json 迁移到 SQLite...');
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);

  // Backup
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = DATA_FILE + '.bak-' + ts;
  fs.copyFileSync(DATA_FILE, backup);
  console.log('[migrate] 已备份 → ' + path.basename(backup));

  const tx = d.db.transaction(() => {
    // Factories & customers: clear seeds, load from data.json if present
    if (Array.isArray(data.mold_factories) && data.mold_factories.length) {
      d.db.prepare('DELETE FROM mold_factories').run();
      const ins = d.db.prepare('INSERT OR IGNORE INTO mold_factories (name) VALUES (?)');
      data.mold_factories.forEach(n => n && ins.run(n));
    }
    if (Array.isArray(data.figure_factories) && data.figure_factories.length) {
      d.db.prepare('DELETE FROM figure_factories').run();
      const ins = d.db.prepare('INSERT OR IGNORE INTO figure_factories (name) VALUES (?)');
      data.figure_factories.forEach(n => n && ins.run(n));
    }
    if (Array.isArray(data.customers) && data.customers.length) {
      d.db.prepare('DELETE FROM customers').run();
      const ins = d.db.prepare('INSERT OR IGNORE INTO customers (name) VALUES (?)');
      data.customers.forEach(n => n && ins.run(n));
    }
    if (Array.isArray(data.eng_users) && data.eng_users.length) {
      d.db.prepare('DELETE FROM eng_users').run();
      const ins = d.db.prepare('INSERT OR IGNORE INTO eng_users (name, pin) VALUES (?, ?)');
      data.eng_users.forEach(u => u && u.name && ins.run(u.name, u.pin || ''));
    }

    let maxMoldFigId = 0, maxPoId = 0;

    (data.mold_orders || []).forEach(o => {
      d.createMoldOrder(o);
      if (o.id > maxMoldFigId) maxMoldFigId = o.id;
    });
    (data.figure_orders || []).forEach(o => {
      d.createFigureOrder(o);
      if (o.id > maxMoldFigId) maxMoldFigId = o.id;
    });
    (data.purchase_orders || []).forEach(po => {
      d.createPurchaseOrder(po);
      if (po.id > maxPoId) maxPoId = po.id;
    });

    // Counters: max(existing data, stored value) ensures no collisions
    const storedNextId = Number(data.nextId) || 1;
    const storedPoNext = Number(data.po_next_id) || 1;
    d.ensureCounterAtLeast('nextId', Math.max(storedNextId - 1, maxMoldFigId));
    d.ensureCounterAtLeast('po_next_id', Math.max(storedPoNext - 1, maxPoId));
  });

  tx();

  fs.writeFileSync(MARKER_FILE, new Date().toISOString() + '\n');
  console.log('[migrate] 迁移完成，标记文件已写入');
  console.log('[migrate] mold_orders: ' + (data.mold_orders || []).length
    + ', figure_orders: ' + (data.figure_orders || []).length
    + ', purchase_orders: ' + (data.purchase_orders || []).length);
}

function migrateIfNeeded() {
  try {
    if (needsMigration()) migrate();
  } catch (e) {
    console.error('[migrate] 迁移失败:', e);
    throw e;
  }
}

if (require.main === module) {
  migrateIfNeeded();
  console.log('[migrate] 手动迁移完成');
}

module.exports = { migrateIfNeeded, migrate };
