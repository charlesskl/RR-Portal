const express = require('express');
const db = require('../db');
const router = express.Router();

function median(arr) {
  const s = [...arr].sort((a,b) => a-b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n-1)/2] : (s[n/2-1] + s[n/2]) / 2;
}

function upsertStandard(dbi, { technique, worker_count, unit_wage, workshop_id }) {
  dbi.prepare(`
    INSERT INTO wage_standards(workshop_id, technique, worker_count, unit_wage, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(workshop_id, technique, worker_count)
    DO UPDATE SET unit_wage=excluded.unit_wage, updated_at=CURRENT_TIMESTAMP
  `).run(workshop_id, technique, worker_count, unit_wage);
}

function listStandards(dbi, workshop_id) {
  return dbi.prepare('SELECT * FROM wage_standards WHERE workshop_id=? ORDER BY technique, worker_count')
    .all(workshop_id);
}

function suggestFromHistory(dbi, workshop_id) {
  const rows = dbi.prepare(`
    SELECT pp.technique, pp.worker_count, pp.unit_wage
    FROM product_processes pp
    JOIN products p ON p.id = pp.product_id
    WHERE pp.deleted=0 AND p.deleted=0 AND p.workshop_id=?
      AND pp.technique IS NOT NULL AND pp.technique != ''
      AND pp.worker_count > 0 AND pp.unit_wage > 0
  `).all(workshop_id);
  const bucket = new Map();
  for (const g of rows) {
    const k = `${g.technique}|${g.worker_count}`;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(g.unit_wage);
  }
  const existsStmt = dbi.prepare('SELECT 1 FROM wage_standards WHERE workshop_id=? AND technique=? AND worker_count=?');
  const insertStmt = dbi.prepare('INSERT INTO wage_standards(workshop_id, technique, worker_count, unit_wage) VALUES (?,?,?,?)');
  let added = 0;
  for (const [k, wages] of bucket) {
    const [technique, wc] = k.split('|');
    const worker_count = Number(wc);
    if (existsStmt.get(workshop_id, technique, worker_count)) continue;
    const med = Math.round(median(wages) * 10000) / 10000;
    insertStmt.run(workshop_id, technique, worker_count, med);
    added++;
  }
  return added;
}

router.get('/', (req, res) => res.json(listStandards(db, req.workshopId)));

router.post('/', (req, res) => {
  const { technique, worker_count, unit_wage } = req.body;
  if (!technique || !worker_count || unit_wage == null)
    return res.status(400).json({ error: 'technique, worker_count, unit_wage required' });
  upsertStandard(db, { technique, worker_count: Number(worker_count), unit_wage: Number(unit_wage), workshop_id: req.workshopId });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM wage_standards WHERE id=? AND workshop_id=?').run(req.params.id, req.workshopId);
  res.json({ ok: true });
});

router.post('/suggest-from-history', (req, res) => {
  const added = suggestFromHistory(db, req.workshopId);
  res.json({ ok: true, added });
});

module.exports = router;
Object.assign(module.exports, { upsertStandard, listStandards, suggestFromHistory });
