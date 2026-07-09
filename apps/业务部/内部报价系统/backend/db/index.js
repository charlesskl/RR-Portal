// 使用 Node 22+ 内置的 node:sqlite，零原生编译。
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { refSeedUpgrades, appendMissingRefDefaults } = require('./ref-defaults');

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

// 迁移：给已有库的 quotes 补 version 列（幂等）
const _quoteCols = db.prepare('PRAGMA table_info(quotes)').all().map(c => c.name);
if (!_quoteCols.includes('version')) {
  db.exec('ALTER TABLE quotes ADD COLUMN version TEXT');
  console.log('[migrate] quotes.version 列已添加');
}

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
    { model: '32A', normal: '', price: 2220 },
    { model: '44A', normal: '490T', price: 2500 },
    { model: '46A-49.9A', normal: '', price: 2800 },
    { model: '60A', normal: '', price: 3090 },
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
  console.log('\n========================================');
  console.log('[seed] 初始管理员账号已创建:');
  console.log('  用户名: admin');
  console.log('  密码:   ' + adminPass);
  console.log('  ⚠️ 请立即登录并修改密码');
  console.log('========================================\n');
}

// 包装：transaction(fn) 在 BEGIN/COMMIT/ROLLBACK 中运行 fn
db.transaction = function (fn) {
  return (...args) => {
    db.exec('BEGIN');
    try { const r = fn(...args); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
};

module.exports = db;
