const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// 模具 → 加工厂 / 目标产量 映射（外发场景）
// 不要和已有的 mold_machine_map（内部机台映射）混淆 —— 那个是 /api/mold-machine-map

router.get('/', (req, res) => {
  try {
    const { supplier } = req.query;
    const sql = supplier
      ? 'SELECT * FROM supplier_mold_mappings WHERE supplier = ? ORDER BY mold_code'
      : 'SELECT * FROM supplier_mold_mappings ORDER BY mold_code';
    const rows = supplier
      ? db.prepare(sql).all(supplier)
      : db.prepare(sql).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 单条查询（按 mold_code）
router.get('/:moldCode', (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM supplier_mold_mappings WHERE mold_code = ?').get(req.params.moldCode);
    if (!r) return res.status(404).json({ message: '映射不存在' });
    res.json(r);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// upsert：mold_code 已存在则更新，不存在则新增
router.post('/', (req, res) => {
  try {
    const m = req.body;
    if (!m.mold_code) return res.status(400).json({ message: 'mold_code 必填' });
    db.prepare(`
      INSERT INTO supplier_mold_mappings (mold_code, mold_name, supplier, target_qty, workshop, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(mold_code) DO UPDATE SET
        mold_name = COALESCE(excluded.mold_name, supplier_mold_mappings.mold_name),
        supplier  = COALESCE(excluded.supplier,  supplier_mold_mappings.supplier),
        target_qty = COALESCE(excluded.target_qty, supplier_mold_mappings.target_qty),
        workshop = COALESCE(excluded.workshop, supplier_mold_mappings.workshop),
        updated_at = CURRENT_TIMESTAMP
    `).run(
      m.mold_code,
      m.mold_name || null,
      m.supplier || null,
      m.target_qty || null,
      m.workshop || null
    );
    const saved = db.prepare('SELECT * FROM supplier_mold_mappings WHERE mold_code = ?').get(m.mold_code);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:moldCode', (req, res) => {
  try {
    const m = req.body;
    const existing = db.prepare('SELECT * FROM supplier_mold_mappings WHERE mold_code = ?').get(req.params.moldCode);
    if (!existing) return res.status(404).json({ message: '映射不存在' });
    db.prepare(`
      UPDATE supplier_mold_mappings SET
        mold_name = ?, supplier = ?, target_qty = ?, workshop = ?, updated_at = CURRENT_TIMESTAMP
      WHERE mold_code = ?
    `).run(
      m.mold_name ?? existing.mold_name,
      m.supplier ?? existing.supplier,
      m.target_qty ?? existing.target_qty,
      m.workshop ?? existing.workshop,
      req.params.moldCode
    );
    res.json({ ...existing, ...m });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/:moldCode', (req, res) => {
  try {
    db.prepare('DELETE FROM supplier_mold_mappings WHERE mold_code = ?').run(req.params.moldCode);
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 聚合：哪些模具去了哪些厂，含订单/啤数统计 —— 对标 pi-outsource 的 /api/mold-factory-map
router.get('/_/factory-distribution', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        m.mold_code, m.mold_name, m.supplier, m.target_qty, m.workshop,
        COALESCE(o.order_count, 0) AS active_orders,
        COALESCE(o.total_qty, 0)   AS total_qty
      FROM supplier_mold_mappings m
      LEFT JOIN (
        SELECT mold_no AS mold_code, COUNT(*) AS order_count, SUM(quantity_needed) AS total_qty
        FROM orders
        WHERE destination = 'outsource'
        GROUP BY mold_no
      ) o ON o.mold_code = m.mold_code
      ORDER BY m.supplier, m.mold_code
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
