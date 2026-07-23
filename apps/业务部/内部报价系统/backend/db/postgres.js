const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { AsyncLocalStorage } = require('async_hooks');
const { Pool, types } = require('pg');

// PostgreSQL COUNT(*) 是 int8；本系统数量规模在 JS 安全整数范围内，保持原 API 返回 number。
types.setTypeParser(20, (value) => Number(value));

if (!process.env.DATABASE_URL) {
  throw new Error('缺少 DATABASE_URL；生产环境必须配置 PostgreSQL 连接串');
}

const dbSchema = process.env.DB_SCHEMA || 'internal_quote';
if (!/^[a-z_][a-z0-9_]*$/.test(dbSchema)) throw new Error('DB_SCHEMA 非法');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${dbSchema},public`,
  max: Number(process.env.DB_POOL_SIZE || 20),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
const transactionStore = new AsyncLocalStorage();

function placeholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`)
    .replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
}

function normalizeRows(rows) {
  return rows.map((row) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = value instanceof Date ? value.toISOString() : value;
    }
    return normalized;
  });
}

async function query(sql, params = []) {
  const client = transactionStore.getStore() || pool;
  return client.query(placeholders(sql), params);
}

function prepare(sql) {
  return {
    async all(...params) {
      const result = await query(sql, params);
      return normalizeRows(result.rows);
    },
    async get(...params) {
      const result = await query(sql, params);
      return normalizeRows(result.rows)[0];
    },
    async run(...params) {
      let statement = sql;
      if (/^\s*INSERT\s+INTO\s+(quotes|users)\b/i.test(statement) && !/\bRETURNING\b/i.test(statement)) {
        statement = `${statement.trim().replace(/;$/, '')} RETURNING id`;
      }
      const result = await query(statement, params);
      return {
        changes: result.rowCount,
        lastInsertRowid: result.rows && result.rows[0] ? result.rows[0].id : undefined,
      };
    },
  };
}

async function exec(sql) {
  return query(sql);
}

function transaction(fn) {
  return async (...args) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await transactionStore.run(client, () => fn(...args));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
}

const db = { prepare, exec, transaction, close: () => pool.end(), pool };

const migrationTables = [
  'factories', 'departments', 'users', 'quotes', 'quote_sections', 'audit_log',
  'ref_tables', 'app_migrations', 'factory_ref_tables', 'user_factories',
  'user_customers', 'user_perms',
];

async function migrateLegacySqlite() {
  const legacyFile = process.env.LEGACY_SQLITE_FILE;
  if (!legacyFile || !fs.existsSync(legacyFile)) return false;
  const targetQuotes = Number((await prepare('SELECT COUNT(*) AS n FROM quotes').get()).n);
  const targetUsers = Number((await prepare('SELECT COUNT(*) AS n FROM users').get()).n);
  if (targetQuotes || targetUsers) return false;

  const { DatabaseSync } = require('node:sqlite');
  const source = new DatabaseSync(legacyFile, { readOnly: true });
  const sourceQuotes = Number(source.prepare('SELECT COUNT(*) AS n FROM quotes').get().n);
  const sourceUsers = Number(source.prepare('SELECT COUNT(*) AS n FROM users').get().n);
  if (!sourceQuotes && !sourceUsers) {
    source.close();
    return false;
  }

  const tx = transaction(async () => {
    // 仅在目标没有用户和报价时进入；清除可能由中断的首次启动留下的半成品种子数据。
    await query(`TRUNCATE TABLE ${migrationTables.join(', ')} RESTART IDENTITY CASCADE`);
    for (const table of migrationTables) {
      const exists = source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) continue;
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const columns = Object.keys(row);
        const columnSql = columns.map((column) => `"${column}"`).join(', ');
        const valueSql = columns.map(() => '?').join(', ');
        await prepare(`INSERT INTO ${table} (${columnSql}) VALUES (${valueSql}) ON CONFLICT DO NOTHING`)
          .run(...columns.map((column) => row[column]));
      }
    }
    for (const table of ['quotes', 'quote_sections', 'audit_log', 'users']) {
      await query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`);
    }
  });
  try {
    await tx();
  } finally {
    source.close();
  }
  console.log(`[migrate] SQLite 数据已迁入 PostgreSQL schema ${dbSchema}: ${legacyFile}`);
  return true;
}

const factories = [
  { code: 'qingxi', name: '清溪', order: 1 },
  { code: 'heyuan', name: '河源', order: 2 },
];
const departments = [
  ['sales', '业务', 1], ['engineering', '工程/业务', 2], ['electronic', '电子部', 3],
  ['molding', '啤机部', 4], ['painting', '喷油部', 5], ['slush', '搪胶', 6],
  ['sewing', '车缝', 7], ['assembly', '装配部', 8],
];
const materialPrices = [
  ['ABS', '750SW', 8.5], ['ABS', '抽粒料', 4.6], ['C-ABS', 'TR558/920', 12.5],
  ['HIPS', 'HI425', 7.8], ['GP', 'MW-1', 7.8], ['PP#JM350/K8009', 'JM350/K8009', 6.8],
  ['PP#7032 E3', '7032 E3', 6.8], ['C-PP', '5090T', 7.8], ['POM', 'F3003/M9044', 16.5],
  ['POM', 'PM820/DM220', 21.5], ['C-PVC', '普通透明', 9], ['PVC', '普通本白', 8],
  ['LDPE', 'G812', 7.8], ['HDPE', 'HMA016', 8], ['TPR', '本白橡胶料', 15],
  ['C-TPR', '透明橡胶料', 17], ['K料', 'KR-03NW', 15], ['PC料', '2605', 12.5],
].map(([name, model, price]) => ({ name, model, price }));
const machinePrices = [
  ['4A-6A', '80T', 940], ['7A-9A', '60-80T', 1050], ['10A-12A', '120T', 1160],
  ['14A-16A', '150T', 1490], ['20A', '200T', 1920], ['24A', '260T', 1920],
  ['32A', '320T', 2220], ['44A', '490T', 2500], ['46A-49.9A', '', 2800],
  ['60A', '500T', 3090], ['80A', '', 3590], ['81.3A', '', 3600], ['105A', '800T', 4500],
].map(([model, normal, price]) => ({ model, normal, price }));

async function initialize() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${dbSchema}`);
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.postgres.sql'), 'utf8'));
  await migrateLegacySqlite();
  for (const factory of factories) {
    await prepare(`INSERT INTO factories (code, name_cn, sort_order) VALUES (?, ?, ?)
      ON CONFLICT (code) DO UPDATE SET name_cn = EXCLUDED.name_cn, sort_order = EXCLUDED.sort_order`)
      .run(factory.code, factory.name, factory.order);
  }
  for (const [code, name, order] of departments) {
    const hash = bcrypt.hashSync(String(1000 + Math.floor(Math.random() * 9000)), 8);
    await prepare(`INSERT INTO departments (code, name_cn, sort_order, pin_staff, pin_supervisor)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT (code) DO UPDATE SET name_cn = EXCLUDED.name_cn, sort_order = EXCLUDED.sort_order`)
      .run(code, name, order, hash, hash);
  }
  await prepare(`INSERT INTO quote_sections (quote_id, dept)
    SELECT q.id, d.code FROM quotes q CROSS JOIN departments d
    ON CONFLICT (quote_id, dept) DO NOTHING`).run();

  const refs = { material_prices: materialPrices, machine_prices: machinePrices };
  for (const [key, data] of Object.entries(refs)) {
    await prepare(`INSERT INTO ref_tables (key, data_json, updated_by) VALUES (?, ?, '[seed]')
      ON CONFLICT (key) DO NOTHING`).run(key, JSON.stringify(data));
    for (const factory of factories) {
      const factoryData = key === 'machine_prices'
        ? data.map((row) => row.model === '20A' ? { ...row, price: factory.code === 'heyuan' ? 1720 : 1920 } : row)
        : data;
      await prepare(`INSERT INTO factory_ref_tables (factory_code, key, data_json, updated_by)
        VALUES (?, ?, ?, '[factory-seed]') ON CONFLICT (factory_code, key) DO NOTHING`)
        .run(factory.code, key, JSON.stringify(factoryData));
    }
  }

  const userCount = Number((await prepare('SELECT COUNT(*) AS n FROM users').get()).n);
  if (userCount === 0) {
    const { templateFor } = require('../permissions/role_templates');
    const adminPass = process.env.ADMIN_INITIAL_PASSWORD || String(100000 + Math.floor(Math.random() * 900000));
    const info = await prepare(`INSERT INTO users (username, password_hash, display_name, dept, role)
      VALUES (?, ?, ?, ?, 'admin') ON CONFLICT (username) DO NOTHING`)
      .run('admin', bcrypt.hashSync(adminPass, 8), '超级管理员', 'sales');
    const adminId = info.lastInsertRowid || (await prepare('SELECT id FROM users WHERE username = ?').get('admin')).id;
    const tpl = templateFor('sales', 'admin');
    for (const p of tpl) {
      await prepare(`INSERT INTO user_perms (user_id, menu, can_view, can_edit, can_review, can_admin)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
        .run(adminId, p.menu, p.can_view, p.can_edit, p.can_review, p.can_admin);
    }
    await prepare(`INSERT INTO user_factories (user_id, factory_code)
      SELECT ?, code FROM factories WHERE active = 1 ON CONFLICT DO NOTHING`).run(adminId);
    console.log(`[seed] 初始管理员 admin 已创建，临时密码: ${adminPass}（请立即修改）`);
  }
  await prepare(`INSERT INTO user_factories (user_id, factory_code)
    SELECT id, factory_code FROM users ON CONFLICT DO NOTHING`).run();
}

db.ready = initialize().catch((error) => {
  console.error('[FATAL][postgres-init]', error);
  throw error;
});

module.exports = db;
