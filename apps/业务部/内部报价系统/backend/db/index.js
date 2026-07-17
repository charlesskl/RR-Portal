// 使用 Node 22+ 内置的 node:sqlite，零原生编译。
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const {
  appendMissingRefDefaults,
  appendMissingRefDefaultsToSectionPayloads,
  refSeedUpgrades,
} = require('./ref-defaults');

const DB_PATH = process.env.DB_FILE || path.join(__dirname, '..', 'data.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// 打开 DB + schema 是最容易因环境（node:sqlite 版本 / WAL 文件系统不支持 / bind-mount 不可写）
// 而抛错的一段。包 try/catch 打清晰 [FATAL] 日志再退出，避免静默 crash-loop 让人无从排查。
let db;
try {
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
} catch (e) {
  console.error('[FATAL][db-init] SQLite 初始化失败 (DB_PATH=' + DB_PATH + ')。'
    + '排查方向：node:sqlite 版本、WAL 是否被该文件系统支持、bind-mount 目录是否可写。');
  console.error('[FATAL][db-init]', (e && e.stack) || e);
  process.exit(1);
}

const factorySeeds = [
  { code: 'qingxi', name_cn: '清溪', sort_order: 1 },
  { code: 'heyuan', name_cn: '河源', sort_order: 2 },
];
const insertFactory = db.prepare('INSERT OR IGNORE INTO factories (code, name_cn, sort_order) VALUES (?, ?, ?)');
for (const f of factorySeeds) insertFactory.run(f.code, f.name_cn, f.sort_order);

// 迁移：给已有库补版本和厂区字段（幂等）
const _quoteCols = db.prepare('PRAGMA table_info(quotes)').all().map(c => c.name);
if (!_quoteCols.includes('version')) {
  db.exec('ALTER TABLE quotes ADD COLUMN version TEXT');
  console.log('[migrate] quotes.version 列已添加');
}
if (!_quoteCols.includes('factory_code')) {
  db.exec("ALTER TABLE quotes ADD COLUMN factory_code TEXT NOT NULL DEFAULT 'qingxi'");
  db.prepare("UPDATE quotes SET factory_code = 'heyuan' WHERE id IN (13, 14, 15, 16)").run();
  console.log('[migrate] 报价单 13-16 已归入河源，其余归入清溪');
}
const _userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!_userCols.includes('factory_code')) {
  db.exec("ALTER TABLE users ADD COLUMN factory_code TEXT NOT NULL DEFAULT 'qingxi'");
  console.log('[migrate] 现有账号默认归入清溪；管理员可跨厂区切换');
}

const quoteHasGlobalNumberUnique = db.prepare(
  'SELECT name FROM pragma_index_list(?) WHERE [unique] = 1'
).all('quotes').some(({ name }) => {
  const columns = db.prepare(
    'SELECT name FROM pragma_index_info(?) ORDER BY seqno'
  ).all(name).map(row => row.name);
  return columns.length === 1 && columns[0] === 'quote_no';
});
if (quoteHasGlobalNumberUnique) {
  const migrationBackupPath = `${DB_PATH}.pre-factory-scope-${Date.now()}.bak`;
  db.prepare('VACUUM INTO ?').run(migrationBackupPath);
  console.log(`[backup] 厂区唯一约束迁移前数据库已备份: ${migrationBackupPath}`);

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`
      CREATE TABLE quotes_factory_scope (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        quote_no         TEXT NOT NULL,
        product_name     TEXT NOT NULL,
        customer         TEXT,
        qty              INTEGER,
        created_by_dept  TEXT NOT NULL DEFAULT 'sales',
        created_by_name  TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        status           TEXT NOT NULL DEFAULT 'drafting',
        version          TEXT,
        factory_code     TEXT NOT NULL DEFAULT 'qingxi' REFERENCES factories(code),
        UNIQUE(factory_code, quote_no)
      );
      INSERT INTO quotes_factory_scope (
        id, quote_no, product_name, customer, qty, created_by_dept,
        created_by_name, created_at, status, version, factory_code
      )
      SELECT
        id, quote_no, product_name, customer, qty, created_by_dept,
        created_by_name, created_at, status, version, factory_code
      FROM quotes;
      DROP TABLE quotes;
      ALTER TABLE quotes_factory_scope RENAME TO quotes;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) {
    throw new Error(`quotes 厂区唯一约束迁移后发现 ${violations.length} 条外键异常`);
  }
  console.log('[migrate] 报价货号唯一约束已调整为按厂区生效');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_quotes_factory ON quotes(factory_code)');
db.exec('CREATE INDEX IF NOT EXISTS idx_users_factory ON users(factory_code)');

const count = db.prepare('SELECT COUNT(*) AS n FROM departments').get().n;
if (count === 0) {
  const seeds = [
    { code: 'sales',       name_cn: '业务',   sort_order: 1 },
    { code: 'engineering', name_cn: '工程',   sort_order: 2 },
    { code: 'electronic',  name_cn: '电子部', sort_order: 3 },
    { code: 'molding',     name_cn: '啤机部', sort_order: 4 },
    { code: 'painting',    name_cn: '喷油部', sort_order: 5 },
    { code: 'slush',       name_cn: '搪胶',   sort_order: 6 },
    { code: 'sewing',      name_cn: '车缝',   sort_order: 7 },
    { code: 'assembly',    name_cn: '装配部', sort_order: 8 },
  ];
  const insert = db.prepare(`
    INSERT INTO departments (code, name_cn, sort_order, pin_staff, pin_supervisor)
    VALUES (?, ?, ?, ?, ?)
  `);
  console.log('[seed] 部门初始 PIN（请抄下并修改）:');
  for (const d of seeds) {
    const staffPin = String(1000 + Math.floor(Math.random() * 9000));
    const supPin   = String(1000 + Math.floor(Math.random() * 9000));
    insert.run(d.code, d.name_cn, d.sort_order, bcrypt.hashSync(staffPin, 8), bcrypt.hashSync(supPin, 8));
    console.log(`  ${d.name_cn.padEnd(4)} 员工 PIN=${staffPin}   主管 PIN=${supPin}`);
  }
}

// 后续新增部门：补 row（不影响已 seed 部门）
const upgradeDepts = [
  { code: 'electronic', name_cn: '电子部', sort_order: 3 },
];
for (const d of upgradeDepts) {
  const exists = db.prepare('SELECT 1 FROM departments WHERE code = ?').get(d.code);
  if (!exists) {
    const dummy = bcrypt.hashSync(String(1000 + Math.floor(Math.random() * 9000)), 8);
    db.prepare('INSERT INTO departments (code, name_cn, sort_order, pin_staff, pin_supervisor) VALUES (?, ?, ?, ?, ?)')
      .run(d.code, d.name_cn, d.sort_order, dummy, dummy);
    console.log('[upgrade] 新增部门:', d.name_cn);
  }
}

// 部门显示名修正（幂等）：工程 → 工程/业务
db.prepare("UPDATE departments SET name_cn = '工程/业务' WHERE code = 'engineering' AND name_cn = '工程'").run();

// 给所有现有报价单补缺失的 section（电子部）
const allDeptCodes = db.prepare('SELECT code FROM departments').all().map(r => r.code);
const quotesAll = db.prepare('SELECT id FROM quotes').all();
for (const q of quotesAll) {
  const have = new Set(db.prepare('SELECT dept FROM quote_sections WHERE quote_id = ?').all(q.id).map(r => r.dept));
  for (const d of allDeptCodes) {
    if (!have.has(d)) {
      db.prepare('INSERT INTO quote_sections (quote_id, dept) VALUES (?, ?)').run(q.id, d);
    }
  }
}

// 全局参考表种入默认数据（仅首次/空时）
const refSeeds = {
  material_prices: [
    { name: 'ABS', model: '750SW', price: 8.50 },
    { name: 'ABS', model: '抽粒料', price: 4.60 },
    { name: 'C-ABS', model: 'TR558/920', price: 12.50 },
    { name: 'HIPS', model: 'HI425', price: 7.80 },
    { name: 'GP', model: 'MW-1', price: 7.80 },
    { name: 'PP#JM350/K8009', model: 'JM350/K8009', price: 6.80 },
    { name: 'PP#7032 E3', model: '7032 E3', price: 6.80 },
    { name: 'C-PP', model: '5090T', price: 7.80 },
    { name: 'POM', model: 'F3003/M9044', price: 16.50 },
    { name: 'POM', model: 'PM820/DM220', price: 21.50 },
    { name: 'C-PVC', model: '普通透明', price: 9.00 },
    { name: 'PVC', model: '普通本白', price: 8.00 },
    { name: 'LDPE', model: 'G812', price: 7.80 },
    { name: 'HDPE', model: 'HMA016', price: 8.00 },
    { name: 'TPR', model: '本白橡胶料', price: 15.00 },
    { name: 'C-TPR', model: '透明橡胶料', price: 17.00 },
    { name: 'K料', model: 'KR-03NW', price: 15.00 },
    { name: 'PC料', model: '2605', price: 12.50 },
  ],
  machine_prices: [
    { model: '4A-6A', normal: '80T', price: 940 },
    { model: '7A-9A', normal: '60-80T', price: 1050 },
    { model: '10A-12A', normal: '120T', price: 1160 },
    { model: '14A-16A', normal: '150T', price: 1490 },
    { model: '20A', normal: '200T', price: 1920 },
    { model: '24A', normal: '260T', price: 1920 },
    { model: '32A', normal: '320T', price: 2220 },
    { model: '44A', normal: '490T', price: 2500 },
    { model: '46A-49.9A', normal: '', price: 2800 },
    { model: '60A', normal: '500T', price: 3090 },
    { model: '80A', normal: '', price: 3590 },
    { model: '81.3A', normal: '', price: 3600 },
    { model: '105A', normal: '800T', price: 4500 },
  ],
};
for (const [key, data] of Object.entries(refSeeds)) {
  const exists = db.prepare('SELECT 1 FROM ref_tables WHERE key = ?').get(key);
  if (!exists) {
    db.prepare('INSERT INTO ref_tables (key, data_json, updated_by) VALUES (?, ?, ?)').run(key, JSON.stringify(data), '[seed]');
    console.log('[seed] 全局参考表 ' + key + ' 已种入 ' + data.length + ' 条');
  }
}
for (const [key, data] of Object.entries(refSeedUpgrades)) {
  const added = appendMissingRefDefaults(db, key, data);
  if (added > 0) {
    console.log('[seed-upgrade] global ref table ' + key + ' appended ' + added + ' default item(s)');
  }
  if (key === 'material_prices') {
    const sectionAdded = appendMissingRefDefaultsToSectionPayloads(db, 'molding', key, data);
    if (sectionAdded.itemsAdded > 0) {
      console.log('[seed-upgrade] molding quote payload ' + key + ' appended '
        + sectionAdded.itemsAdded + ' default item(s) in ' + sectionAdded.rowsChanged + ' section(s)');
    }
  }
}

const globalRefData = (key) => {
  const row = db.prepare('SELECT data_json FROM ref_tables WHERE key = ?').get(key);
  if (row) {
    try {
      const parsed = JSON.parse(row.data_json);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      console.warn(`[factory-seed] 全局参考表 ${key} JSON 无效，回退代码默认值: ${error.message}`);
    }
  }
  return refSeeds[key] || [];
};

const factoryRefSeedData = (factoryCode, key) => {
  const base = globalRefData(key);
  if (key !== 'machine_prices') return base;
  return base.map(row => row.model === '20A'
    ? { ...row, price: factoryCode === 'heyuan' ? 1720 : 1920 }
    : { ...row });
};

// 首次为两个厂区复制参考参数；尚未人工修改的种子数据跟随代码更新。
for (const f of factorySeeds) {
  for (const key of Object.keys(refSeeds)) {
    const existing = db.prepare('SELECT updated_by FROM factory_ref_tables WHERE factory_code = ? AND key = ?').get(f.code, key);
    const data = factoryRefSeedData(f.code, key);
    if (!existing) {
      db.prepare('INSERT INTO factory_ref_tables (factory_code, key, data_json, updated_by) VALUES (?, ?, ?, ?)')
        .run(f.code, key, JSON.stringify(data), '[factory-seed]');
    } else if (existing.updated_by === '[factory-seed]') {
      db.prepare("UPDATE factory_ref_tables SET data_json = ?, updated_at = datetime('now') WHERE factory_code = ? AND key = ?")
        .run(JSON.stringify(data), f.code, key);
    }
  }
}

// 旧报价保存了机型价副本；只迁移一次，按所属厂区统一本次发布的机型名称和 20A 价格。
const machinePriceMigration = 'normalize_machine_prices_20260715';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE key = ?').get(machinePriceMigration)) {
  const sections = db.prepare(`
    SELECT s.id, s.payload_json, q.factory_code
    FROM quote_sections s
    JOIN quotes q ON q.id = s.quote_id
    WHERE s.dept = 'molding'
  `).all();
  const updateSection = db.prepare('UPDATE quote_sections SET payload_json = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const section of sections) {
      let payload;
      try { payload = JSON.parse(section.payload_json || '{}'); } catch { continue; }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
      if (!Array.isArray(payload.machine_prices) || !payload.machine_prices.length) continue;
      payload.machine_prices = payload.machine_prices.map(row => {
        const next = { ...row };
        if (['30A-32A', '30-32A'].includes(next.model)) next.model = '32A';
        if (next.model === '60A-65A') next.model = '60A';
        if (next.model === '32A' && !next.normal) next.normal = '320T';
        if (next.model === '60A' && !next.normal) next.normal = '500T';
        if (next.model === '20A') next.price = section.factory_code === 'heyuan' ? 1720 : 1920;
        return next;
      });
      updateSection.run(JSON.stringify(payload), section.id);
    }
    db.prepare('INSERT INTO app_migrations (key) VALUES (?)').run(machinePriceMigration);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  console.log('[migrate] 旧报价机型价已按厂区更新');
}

const assemblyRateMigration = 'assembly_base_rate_by_factory_20260715';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE key = ?').get(assemblyRateMigration)) {
  const sections = db.prepare(`
    SELECT s.id, s.payload_json, q.factory_code
    FROM quote_sections s
    JOIN quotes q ON q.id = s.quote_id
    WHERE s.dept = 'assembly'
  `).all();
  const updateSection = db.prepare('UPDATE quote_sections SET payload_json = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const section of sections) {
      let payload;
      try { payload = JSON.parse(section.payload_json || '{}'); } catch { continue; }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
      payload.assembly_base_rate = section.factory_code === 'heyuan' ? 260 : 310;
      updateSection.run(JSON.stringify(payload), section.id);
    }
    db.prepare('INSERT INTO app_migrations (key) VALUES (?)').run(assemblyRateMigration);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  console.log('[migrate] 装配基数已按厂区更新');
}

// 旧报价的材料价副本可能早于“ABS 抽粒料”加入参考表；仅补缺失项，不覆盖原有价格。
const absRegrindMigration = 'restore_abs_regrind_material_20260715';
if (!db.prepare('SELECT 1 FROM app_migrations WHERE key = ?').get(absRegrindMigration)) {
  const sections = db.prepare("SELECT id, payload_json FROM quote_sections WHERE dept = 'molding'").all();
  const updateSection = db.prepare('UPDATE quote_sections SET payload_json = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const section of sections) {
      let payload;
      try { payload = JSON.parse(section.payload_json || '{}'); } catch { continue; }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
      const prices = payload.material_prices;
      if (!Array.isArray(prices) || prices.length === 0) continue;
      const hasRegrind = prices.some((row) =>
        String(row?.name || '').trim().toUpperCase() === 'ABS' &&
        String(row?.model || '').trim() === '抽粒料'
      );
      if (hasRegrind) continue;
      const absIndex = prices.findIndex((row) => String(row?.name || '').trim().toUpperCase() === 'ABS');
      const insertAt = absIndex >= 0 ? absIndex + 1 : prices.length;
      prices.splice(insertAt, 0, { name: 'ABS', model: '抽粒料', price: 4.6 });
      updateSection.run(JSON.stringify(payload), section.id);
    }
    db.prepare('INSERT INTO app_migrations (key) VALUES (?)').run(absRegrindMigration);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  console.log('[migrate] 已恢复旧报价的 ABS 抽粒料价格');
}

// seed 初始 admin 账号（仅 users 表为空时）
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const { templateFor } = require('../permissions/role_templates');
  const adminPass = process.env.ADMIN_INITIAL_PASSWORD || String(100000 + Math.floor(Math.random() * 900000));
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, display_name, dept, role)
    VALUES (?, ?, ?, ?, 'admin')
  `).run('admin', bcrypt.hashSync(adminPass, 8), '超级管理员', 'sales');
  const adminId = info.lastInsertRowid;
  const tpl = templateFor('sales', 'admin');
  const insertPerm = db.prepare(`
    INSERT INTO user_perms (user_id, menu, can_view, can_edit, can_review, can_admin)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const p of tpl) insertPerm.run(adminId, p.menu, p.can_view, p.can_edit, p.can_review, p.can_admin);
  db.prepare(`
    INSERT OR IGNORE INTO user_factories (user_id, factory_code)
    SELECT ?, code FROM factories WHERE active = 1
  `).run(adminId);
  console.log('\n========================================');
  console.log('[seed] 初始管理员账号已创建:');
  console.log('  用户名: admin');
  console.log('  密码:   ' + adminPass);
  console.log('  ⚠️ 请立即登录并修改密码');
  console.log('========================================\n');
}

// Existing users without an explicit scope inherit their current factory.
db.prepare(`
  INSERT OR IGNORE INTO user_factories (user_id, factory_code)
  SELECT id, factory_code FROM users
`).run();

// 包装：transaction(fn) 在 BEGIN/COMMIT/ROLLBACK 中运行 fn
db.transaction = function (fn) {
  return (...args) => {
    db.exec('BEGIN');
    try { const r = fn(...args); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
};

module.exports = db;
