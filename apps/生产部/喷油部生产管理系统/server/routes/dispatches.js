const express = require('express');
const db = require('../db');
const router = express.Router();

function saveDispatches(dbi, { date, product_id, items }) {
  const tx = dbi.transaction(() => {
    dbi.prepare('DELETE FROM dispatches WHERE dispatch_date=? AND product_id=?').run(date, product_id);
    const ins = dbi.prepare(
      'INSERT INTO dispatches(dispatch_date, product_id, product_process_id, line_id) VALUES (?,?,?,?)'
    );
    for (const it of items || []) ins.run(date, product_id, it.product_process_id, it.line_id);
  });
  tx();
}

function listDispatches(dbi, { date, product_id }) {
  const params = [];
  let where = '1=1';
  if (date) { where += ' AND d.dispatch_date=?'; params.push(date); }
  if (product_id) { where += ' AND d.product_id=?'; params.push(product_id); }
  return dbi.prepare(`
    SELECT d.id, d.dispatch_date, d.product_id, d.product_process_id, d.line_id,
           d.created_at, d.started_at, d.completed_at,
           pp.part_name, pp.technique, pp.target_qty, pp.unit_wage,
           l.name AS line_name,
           p.code AS product_code, p.name AS product_name
    FROM dispatches d
    JOIN product_processes pp ON pp.id = d.product_process_id
    JOIN lines l ON l.id = d.line_id
    JOIN products p ON p.id = d.product_id
    WHERE ${where}
    ORDER BY d.id
  `).all(...params);
}

function listDispatchedProductsByDate(dbi, date) {
  return dbi.prepare(`
    SELECT d.product_id, p.code, p.name, COUNT(*) AS process_count
    FROM dispatches d
    JOIN products p ON p.id = d.product_id
    WHERE d.dispatch_date = ?
    GROUP BY d.product_id, p.code, p.name
    ORDER BY MAX(d.id) DESC
  `).all(date);
}

router.get('/', (req, res) => {
  const { date, product_id } = req.query;
  res.json(listDispatches(db, { date, product_id: product_id ? Number(product_id) : null }));
});

router.get('/by-date', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  res.json(listDispatchedProductsByDate(db, date));
});

router.post('/:id/start', (req, res) => {
  const r = db.prepare(
    "UPDATE dispatches SET started_at = CURRENT_TIMESTAMP WHERE id = ? AND started_at IS NULL"
  ).run(req.params.id);
  res.json({ ok: true, updated: r.changes });
});

router.post('/:id/complete', (req, res) => {
  const r = db.prepare(
    "UPDATE dispatches SET completed_at = CURRENT_TIMESTAMP WHERE id = ? AND started_at IS NOT NULL AND completed_at IS NULL"
  ).run(req.params.id);
  res.json({ ok: true, updated: r.changes });
});

router.post('/:id/reset', (req, res) => {
  db.prepare("UPDATE dispatches SET started_at = NULL, completed_at = NULL WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post('/', (req, res) => {
  const { date, product_id, items } = req.body;
  if (!date || !product_id) return res.status(400).json({ error: 'date and product_id required' });
  saveDispatches(db, { date, product_id, items: items || [] });
  res.json({ ok: true });
});

module.exports = router;
module.exports.saveDispatches = saveDispatches;
module.exports.listDispatches = listDispatches;
