const express = require('express');
const router = express.Router();
const { scanAllClients, confirmOrders } = require('../services/scanner');

const SCAN_DIR = process.env.SCAN_DIR || 'Z:/各客排期';

// GET /api/scan - trigger scan and return results grouped by client
router.get('/', async (req, res) => {
  try {
    const { results, errors } = await scanAllClients(SCAN_DIR);

    const grouped = {};
    for (const item of results) {
      if (!grouped[item.client]) grouped[item.client] = [];
      grouped[item.client].push(item);
    }

    res.json({
      total: results.length,
      clients: Object.keys(grouped).length,
      errors: errors.length,
      grouped,
      errorList: errors
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scan/confirm - mark selected orders as confirmed (won't appear in future scans)
// Body: { keys: ['key1', 'key2', ...] }
router.post('/confirm', (req, res) => {
  const { keys } = req.body;
  if (!Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: 'keys must be a non-empty array' });
  }
  const added = confirmOrders(keys);
  res.json({ success: true, added });
});

module.exports = router;
