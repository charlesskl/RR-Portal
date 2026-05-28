const bcrypt = require('bcrypt');
const db = require('./connection');

const SEED_WORKSHOPS = [
  {
    code: 'planning',
    display_name: '生产计划科',
    role: 'planner',
    default_password: 'plan123456',
    entry_path: '/production-plan/',
    description: '看到所有车间的总览，承担排期/调度职责',
  },
  {
    code: 'paiji',
    display_name: '啤机车间',
    role: 'workshop',
    default_password: 'pj123456',
    entry_path: '/paiji/?page=outsourceOrders',
    description: '内部啤机排产 + 外发订单 + 加工厂管理',
  },
  {
    code: 'penyou',
    display_name: '喷油车间',
    role: 'workshop',
    default_password: 'py123456',
    entry_path: '/penyou/',
    description: '喷油作业排产与进度',
  },
  {
    code: 'admin',
    display_name: '系统管理员',
    role: 'admin',
    default_password: 'admin123456',
    entry_path: '/production-control/dashboard',
    description: '管理车间账号、查看全部数据',
  },
];

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workshops (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      code          TEXT    NOT NULL UNIQUE,
      display_name  TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'workshop',
      password_hash TEXT    NOT NULL,
      entry_path    TEXT    NOT NULL DEFAULT '/',
      description   TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workshop_id   INTEGER,
      workshop_code TEXT    NOT NULL,
      ip            TEXT,
      user_agent    TEXT,
      success       INTEGER NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workshop_id) REFERENCES workshops(id)
    );

    CREATE INDEX IF NOT EXISTS idx_login_logs_workshop ON login_logs(workshop_code, created_at);
  `);

  // 幂等迁移：把已有车间的 entry_path 同步到 SEED 里的最新值（description 也跟着更新）
  // 保留密码哈希 / active 等用户已修改过的字段不动
  const syncEntry = db.prepare('UPDATE workshops SET entry_path = ?, description = ? WHERE code = ? AND (entry_path != ? OR description != ?)');
  for (const w of SEED_WORKSHOPS) {
    syncEntry.run(w.entry_path, w.description, w.code, w.entry_path, w.description);
  }

  const countRow = db.prepare('SELECT COUNT(*) AS c FROM workshops').get();
  if (countRow.c > 0) return;

  const insert = db.prepare(`
    INSERT INTO workshops (code, display_name, role, password_hash, entry_path, description)
    VALUES (@code, @display_name, @role, @password_hash, @entry_path, @description)
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) insert.run(r);
  });

  const seeded = SEED_WORKSHOPS.map((w) => ({
    code: w.code,
    display_name: w.display_name,
    role: w.role,
    password_hash: bcrypt.hashSync(w.default_password, 10),
    entry_path: w.entry_path,
    description: w.description,
  }));
  tx(seeded);

  console.log('[production-control] seeded workshops:');
  for (const w of SEED_WORKSHOPS) {
    console.log(`  ${w.code.padEnd(10)} ${w.display_name.padEnd(8)} 默认密码: ${w.default_password}`);
  }
  console.log('[production-control] 请尽快通过管理员界面修改默认密码');
}

module.exports = { initDatabase, SEED_WORKSHOPS };
