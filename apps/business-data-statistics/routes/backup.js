const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authenticate, requireStats, requireStatsOrManagement } = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');

const BACKUP_DIR = process.env.BACKUP_PATH || path.join(__dirname, '..', 'backups');
const PG_DUMP = process.env.PG_DUMP_PATH || (process.platform === 'win32' ? '"C:/Program Files/PostgreSQL/17/bin/pg_dump.exe"' : 'pg_dump');
const PSQL = process.env.PSQL_PATH || (process.platform === 'win32' ? '"C:/Program Files/PostgreSQL/17/bin/psql.exe"' : 'psql');

// 创建备份：仅统计组
router.post('/', authenticate, requireStats, asyncHandler(async (req, res) => {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const filename = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);
  const dbName = process.env.DB_NAME || 'production_system';
  const dbUser = process.env.DB_USER || 'postgres';
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPassword = process.env.DB_PASSWORD || 'postgres123';
  execSync(`${PG_DUMP} -h ${dbHost} -U ${dbUser} ${dbName} > "${filepath}"`, { env: { ...process.env, PGPASSWORD: dbPassword } });
  res.json({ success: true, filename, size: fs.statSync(filepath).size });
}));

// 查看备份列表：统计组+管理层
router.get('/list', authenticate, requireStatsOrManagement, asyncHandler(async (req, res) => {
  if (!fs.existsSync(BACKUP_DIR)) return res.json({ success: true, data: [] });
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.sql'))
    .map(f => { const s = fs.statSync(path.join(BACKUP_DIR, f)); return { filename: f, size: s.size, created: s.mtime }; })
    .sort((a, b) => b.created - a.created);
  res.json({ success: true, data: files });
}));

router.post('/restore', authenticate, requireStats, asyncHandler(async (req, res) => {
  const { filename } = req.body;
  const filepath = path.join(BACKUP_DIR, path.basename(filename));
  if (!fs.existsSync(filepath)) return res.status(404).json({ success: false, message: '备份文件不存在' });
  const dbName = process.env.DB_NAME || 'production_system';
  const dbUser = process.env.DB_USER || 'postgres';
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPassword = process.env.DB_PASSWORD || 'postgres123';
  execSync(`${PSQL} -h ${dbHost} -U ${dbUser} ${dbName} < "${filepath}"`, { env: { ...process.env, PGPASSWORD: dbPassword } });
  res.json({ success: true });
}));

module.exports = router;
