const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM workshops ORDER BY sort_order').all());
});

router.get('/:id/stats', (req, res) => {
  const id = Number(req.params.id);
  const month = new Date().toISOString().slice(0, 7);

  const pending = db.prepare(`
    SELECT COUNT(*) AS n FROM production_orders po
    WHERE po.deleted=0 AND po.workshop_id=?
      AND strftime('%Y-%m', po.start_date) = ?
      AND (SELECT COUNT(*) FROM order_schedule_lines WHERE order_id=po.id AND completed_at IS NULL) > 0
  `).get(id, month).n;

  const machineCount = db.prepare(
    'SELECT COUNT(*) AS n FROM lines WHERE workshop_id=?'
  ).get(id).n;

  const monthly = db.prepare(`
    SELECT COALESCE(SUM(dr.produced_qty * p.quote_price), 0) AS v
    FROM daily_records dr
    JOIN products p ON p.id = dr.product_id
    WHERE dr.workshop_id=? AND strftime('%Y-%m', dr.record_date) = ?
  `).get(id, month).v;

  res.json({
    pending_orders: pending,
    machine_count: machineCount,
    monthly_output: Number(monthly)
  });
});

module.exports = router;
