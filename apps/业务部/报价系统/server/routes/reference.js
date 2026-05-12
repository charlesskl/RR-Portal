const router = require('express').Router();
const { getDb } = require('../services/db');

const HKD_USD = 7.75;
const LB_G    = 454;

function calcDerived(hkd_lb) {
  const lb = parseFloat(hkd_lb) || 0;
  return {
    price_rmb_g:  parseFloat((lb / LB_G).toFixed(6)),
    spin_usd_kg:  parseFloat((lb / LB_G * 1000 / HKD_USD).toFixed(4)),
  };
}

// GET /api/reference/materials
router.get('/materials', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM RefMaterialPrice ORDER BY sort_order').all();
  res.json(rows);
});

// PUT /api/reference/materials/:id  — edit price_hkd_lb or client_hkd_lb
router.put('/materials/:id', (req, res) => {
  const db = getDb();
  const { price_hkd_lb, client_hkd_lb } = req.body;

  if (price_hkd_lb !== undefined) {
    const { price_rmb_g, spin_usd_kg } = calcDerived(price_hkd_lb);
    db.prepare('UPDATE RefMaterialPrice SET price_hkd_lb=?, price_rmb_g=?, spin_usd_kg=? WHERE id=?')
      .run(parseFloat(price_hkd_lb) || 0, price_rmb_g, spin_usd_kg, req.params.id);
  }

  if (client_hkd_lb !== undefined) {
    const { spin_usd_kg } = calcDerived(client_hkd_lb);
    db.prepare('UPDATE RefMaterialPrice SET client_hkd_lb=?, client_spin_usd_kg=? WHERE id=?')
      .run(parseFloat(client_hkd_lb) || 0, spin_usd_kg, req.params.id);
  }

  res.json({ ok: true });
});

// GET /api/reference/machines
router.get('/machines', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM RefMachineRate ORDER BY sort_order').all();
  res.json(rows);
});

// PUT /api/reference/machines/:id
router.put('/machines/:id', (req, res) => {
  const db = getDb();
  const { rate_rmb_24h, rate_hkd, rate_usd, target_qty } = req.body;
  db.prepare('UPDATE RefMachineRate SET rate_rmb_24h=?, rate_hkd=?, rate_usd=?, target_qty=? WHERE id=?')
    .run(rate_rmb_24h ?? 0, rate_hkd ?? 0, rate_usd ?? 0, target_qty ?? 0, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
