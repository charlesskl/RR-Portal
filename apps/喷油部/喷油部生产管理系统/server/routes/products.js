const express = require('express');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { calcPrices } = require('../lib/pricing');
const { parsePricingSheet } = require('../services/pricing-importer');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

router.get('/', (req, res) => {
  const q = req.query.q || '';
  const rows = db.prepare(`
    SELECT p.*, (
      SELECT COUNT(*) FROM product_processes pp
      WHERE pp.product_id = p.id AND pp.deleted = 0
    ) AS process_count
    FROM products p
    WHERE p.deleted = 0 AND p.workshop_id=? AND (p.code LIKE ? OR p.name LIKE ?)
    ORDER BY p.id DESC
  `).all(req.workshopId, `%${q}%`, `%${q}%`);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id=? AND deleted=0 AND workshop_id=?')
    .get(req.params.id, req.workshopId);
  if (!product) return res.status(404).json({ error: 'not found' });
  const processes = db.prepare(
    'SELECT * FROM product_processes WHERE product_id=? AND deleted=0 ORDER BY id'
  ).all(req.params.id);
  res.json({ ...product, processes });
});

router.post('/', (req, res) => {
  const { code, name, quote_price = 0, remarks = '', processes = [] } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });
  const tx = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO products(code,name,quote_price,remarks,workshop_id) VALUES (?,?,?,?,?)'
    ).run(code, name, quote_price, remarks, req.workshopId);
    const insertProc = db.prepare(`
      INSERT INTO product_processes
      (product_id,part_name,technique,target_qty,worker_count,unit_wage,calc_price,paint_price,total_price,remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    for (const p of processes) {
      const { calc_price, paint_price, total_price } = calcPrices({ unit_wage: p.unit_wage || 0 });
      insertProc.run(
        lastInsertRowid,
        p.part_name,
        p.technique || '',
        p.target_qty || 0,
        p.worker_count || 1,
        p.unit_wage || 0,
        calc_price,
        paint_price,
        total_price,
        p.remarks || ''
      );
    }
    return lastInsertRowid;
  });
  const id = tx();
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const { code, name, quote_price, remarks, processes = [] } = req.body;
  const tx = db.transaction(() => {
    db.prepare('UPDATE products SET code=?,name=?,quote_price=?,remarks=? WHERE id=? AND workshop_id=?')
      .run(code, name, quote_price, remarks, req.params.id, req.workshopId);
    db.prepare('UPDATE product_processes SET deleted=1 WHERE product_id=?').run(req.params.id);
    const insertProc = db.prepare(`
      INSERT INTO product_processes
      (product_id,part_name,technique,target_qty,worker_count,unit_wage,calc_price,paint_price,total_price,remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    for (const p of processes) {
      const { calc_price, paint_price, total_price } = calcPrices({ unit_wage: p.unit_wage || 0 });
      insertProc.run(
        req.params.id,
        p.part_name,
        p.technique || '',
        p.target_qty || 0,
        p.worker_count || 1,
        p.unit_wage || 0,
        calc_price,
        paint_price,
        total_price,
        p.remarks || ''
      );
    }
  });
  tx();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE products SET deleted=1 WHERE id=? AND workshop_id=?')
    .run(req.params.id, req.workshopId);
  res.json({ ok: true });
});

router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  try {
    const products = await parsePricingSheet(req.file.path);
    const existsStmt = db.prepare('SELECT id FROM products WHERE code=? AND deleted=0 AND workshop_id=?');
    const tx = db.transaction(() => {
      const insertP = db.prepare('INSERT INTO products(code,name,quote_price,workshop_id) VALUES (?,?,?,?)');
      const insertProc = db.prepare(`
        INSERT INTO product_processes
        (product_id,part_name,technique,target_qty,worker_count,unit_wage,calc_price,paint_price,total_price,remarks)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `);
      let imported = 0;
      const skippedCodes = [];
      for (const p of products) {
        if (existsStmt.get(p.code, req.workshopId)) {
          skippedCodes.push(p.code);
          continue;
        }
        const { lastInsertRowid } = insertP.run(p.code, p.name, p.quote_price, req.workshopId);
        for (const proc of p.processes) {
          const { calc_price, paint_price, total_price } = calcPrices({ unit_wage: proc.unit_wage });
          insertProc.run(
            lastInsertRowid,
            proc.part_name,
            proc.technique,
            proc.target_qty,
            proc.worker_count,
            proc.unit_wage,
            calc_price,
            paint_price,
            total_price,
            proc.remarks || ''
          );
        }
        imported++;
      }
      return { imported, skippedCodes };
    });
    const result = tx();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
