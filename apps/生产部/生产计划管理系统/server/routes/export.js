const express = require('express');
const router = express.Router();
const { exportWorkbook } = require('../services/exporter');

// GET /api/export?workshop=A
router.get('/', async (req, res) => {
  const { workshop } = req.query;
  if (!workshop) return res.status(400).json({ message: 'workshop required' });

  try {
    const wb = await exportWorkbook(workshop);
    const fileName = encodeURIComponent(`生产计划_${workshop}车间_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    await wb.xlsx.write(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
