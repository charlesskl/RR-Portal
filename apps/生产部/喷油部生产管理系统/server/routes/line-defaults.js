const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT td.workshop_id, td.technique, td.line_id, l.name AS line_name
    FROM technique_line_defaults td
    LEFT JOIN lines l ON l.id = td.line_id
    WHERE td.workshop_id = ?
    ORDER BY td.technique
  `).all(req.workshopId));
});

router.put('/:technique', (req, res) => {
  const { line_id } = req.body;
  db.prepare(`
    INSERT INTO technique_line_defaults(workshop_id, technique, line_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(workshop_id, technique)
    DO UPDATE SET line_id=excluded.line_id, updated_at=CURRENT_TIMESTAMP
  `).run(req.workshopId, req.params.technique, line_id || null);
  res.json({ ok: true });
});

module.exports = router;
