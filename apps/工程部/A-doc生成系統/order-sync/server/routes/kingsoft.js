const express = require('express');
const router = express.Router();
const { getSheets, appendRows, orderToRow } = require('../services/kingsoft');
const { confirmOrders } = require('../services/scanner');

// GET /api/kingsoft/sheets - list sheets in target doc
router.get('/sheets', async (req, res) => {
  try {
    const data = await getSheets();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

// POST /api/kingsoft/write
// Body: { sheetId, orders: [{key, data: {...}}], columnOrder: ['字段1','字段2',...] }
router.post('/write', async (req, res) => {
  const { sheetId, orders, columnOrder } = req.body;
  if (!sheetId || !Array.isArray(orders) || !Array.isArray(columnOrder)) {
    return res.status(400).json({ error: 'sheetId, orders, columnOrder required' });
  }

  try {
    const rows = orders.map(o => orderToRow(o.data, columnOrder));
    await appendRows(sheetId, rows);

    const keys = orders.map(o => o.key);
    confirmOrders(keys);

    res.json({ success: true, written: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

module.exports = router;
