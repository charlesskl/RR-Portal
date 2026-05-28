const express = require('express');
const router = express.Router();
const db = require('../db/connection');

router.get('/', (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === '1';
    const sql = includeInactive
      ? 'SELECT * FROM suppliers ORDER BY name'
      : 'SELECT * FROM suppliers WHERE active = 1 ORDER BY name';
    const rows = db.prepare(sql).all().map((r) => ({
      ...r,
      data: r.data_json ? safeJSON(r.data_json) : null,
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: '查询失败：' + err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ message: '加工厂不存在' });
    res.json({ ...r, data: r.data_json ? safeJSON(r.data_json) : null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const s = req.body;
    if (!s.name) return res.status(400).json({ message: 'name 必填' });
    const result = db.prepare(`
      INSERT INTO suppliers (name, total_machines, running_rate, machines_for, data_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      s.name,
      s.total_machines || 0,
      s.running_rate || 0,
      s.machines_for || null,
      s.data ? JSON.stringify(s.data) : null
    );
    res.json({ id: result.lastInsertRowid, ...s });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ message: '加工厂名称已存在' });
    }
    res.status(500).json({ message: '新增失败：' + err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const s = req.body;
    const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ message: '加工厂不存在' });
    db.prepare(`
      UPDATE suppliers SET
        name = ?, total_machines = ?, running_rate = ?, machines_for = ?,
        data_json = ?, active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      s.name ?? existing.name,
      s.total_machines ?? existing.total_machines,
      s.running_rate ?? existing.running_rate,
      s.machines_for ?? existing.machines_for,
      s.data ? JSON.stringify(s.data) : existing.data_json,
      s.active ?? existing.active,
      req.params.id
    );
    res.json({ id: Number(req.params.id), ...s });
  } catch (err) {
    res.status(500).json({ message: '更新失败：' + err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    db.prepare('UPDATE suppliers SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    res.json({ message: '已停用（软删除）' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 聚合视图：每个加工厂当前手上有多少订单 / 总啤数
router.get('/_/summary', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        s.id, s.name, s.total_machines, s.running_rate, s.machines_for,
        COALESCE(o.order_count, 0) AS order_count,
        COALESCE(o.total_pcs, 0)   AS total_pcs,
        COALESCE(o.total_shots, 0) AS total_shots
      FROM suppliers s
      LEFT JOIN (
        SELECT supplier,
               COUNT(*) AS order_count,
               SUM(quantity_needed) AS total_pcs,
               SUM(quantity_needed) AS total_shots
        FROM orders
        WHERE destination = 'outsource' AND supplier IS NOT NULL
        GROUP BY supplier
      ) o ON o.supplier = s.name
      WHERE s.active = 1
      ORDER BY s.name
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

function safeJSON(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

module.exports = router;
