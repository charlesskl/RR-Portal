const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const ALLOWED = new Set(['material_prices', 'machine_prices']);

// GET /api/refs/:key — 拉全局参考表
router.get('/:key', (req, res) => {
  const key = req.params.key;
  if (!ALLOWED.has(key)) return res.status(400).json({ error: 'invalid key' });
  const row = db.prepare('SELECT data_json, updated_at, updated_by FROM ref_tables WHERE key = ?').get(key);
  if (!row) return res.json({ data: [], updated_at: null, updated_by: null });
  let data = [];
  try { data = JSON.parse(row.data_json); } catch {}
  res.json({ data, updated_at: row.updated_at, updated_by: row.updated_by });
});

// PUT /api/refs/:key — 覆盖全局参考表（业务/工程可改）
router.put('/:key', (req, res) => {
  const key = req.params.key;
  if (!ALLOWED.has(key)) return res.status(400).json({ error: 'invalid key' });
  if (!['sales', 'engineering', 'molding'].includes(req.user.dept)) {
    return res.status(403).json({ error: '没有权限修改参考表' });
  }
  const data = Array.isArray(req.body && req.body.data) ? req.body.data : [];
  db.prepare(`
    INSERT INTO ref_tables (key, data_json, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(key, JSON.stringify(data), `[${req.user.dept}] ${req.user.name}`);
  res.json({ ok: true });
});

module.exports = router;
