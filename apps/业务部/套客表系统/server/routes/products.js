const router = require('express').Router();
const { getDb } = require('../services/db');

// GET / — list all products with version count
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT p.*, COUNT(v.id) as version_count
      FROM Product p
      LEFT JOIN QuoteVersion v ON v.product_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — create product
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { item_no, item_desc, vendor } = req.body;
    if (!item_no) {
      return res.status(400).json({ error: 'item_no is required' });
    }
    const now = new Date().toISOString();
    const result = db.prepare(
      'INSERT INTO Product (item_no, item_desc, vendor, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(item_no, item_desc || null, vendor || null, now, now);
    const product = db.prepare('SELECT * FROM Product WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — get product with all its versions
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const product = db.prepare('SELECT * FROM Product WHERE id = ?').get(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const versions = db.prepare(
      'SELECT * FROM QuoteVersion WHERE product_id = ? ORDER BY created_at DESC'
    ).all(req.params.id);
    res.json({ ...product, versions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — update product
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const product = db.prepare('SELECT * FROM Product WHERE id = ?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const { item_no, item_desc, vendor } = req.body;
    const sets = [];
    const vals = [];
    if (item_no !== undefined) { sets.push('item_no = ?'); vals.push(item_no); }
    if (item_desc !== undefined) { sets.push('item_desc = ?'); vals.push(item_desc); }
    if (vendor !== undefined) { sets.push('vendor = ?'); vals.push(vendor); }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

    sets.push("updated_at = datetime('now')");
    vals.push(req.params.id);
    db.prepare(`UPDATE Product SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    res.json(db.prepare('SELECT * FROM Product WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — delete product (CASCADE)
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const product = db.prepare('SELECT * FROM Product WHERE id = ?').get(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    db.prepare('DELETE FROM Product WHERE id = ?').run(req.params.id);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
