const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// GET /api/summary?workshop=A
router.get('/', (req, res) => {
  const { workshop } = req.query;
  if (!workshop) return res.status(400).json({ message: 'workshop required' });
  const rows = db.prepare('SELECT * FROM summary WHERE workshop = ?').all(workshop);
  res.json(rows);
});

// PUT /api/summary
router.put('/', (req, res) => {
  const data = req.body;
  if (!data.workshop) return res.status(400).json({ message: 'workshop required' });

  const existing = db.prepare('SELECT id FROM summary WHERE workshop = ? AND client = ? AND month = ? AND year = ?')
    .get(data.workshop, data.client, data.month, data.year);

  if (existing) {
    db.prepare('UPDATE summary SET value = ?, weekly_orders = ?, weekly_remaining = ?, weekly_cancelled = ?, remark = ? WHERE id = ?')
      .run(data.value, data.weekly_orders, data.weekly_remaining, data.weekly_cancelled, data.remark, existing.id);
  } else {
    db.prepare('INSERT INTO summary (workshop, line_name, worker_count, client, month, year, value, weekly_orders, weekly_remaining, weekly_cancelled, remark) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(data.workshop, data.line_name, data.worker_count, data.client, data.month, data.year, data.value, data.weekly_orders, data.weekly_remaining, data.weekly_cancelled, data.remark);
  }
  res.json({ success: true });
});

module.exports = router;
