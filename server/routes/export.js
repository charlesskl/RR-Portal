const router = require('express').Router();
const { exportVersion } = require('../services/excel-exporter');
const { getDb } = require('../services/db');

// GET /:versionId — export version as Excel workbook
router.get('/:versionId', async (req, res) => {
  try {
    const db = getDb();
    const version = db.prepare('SELECT * FROM QuoteVersion WHERE id = ?').get(req.params.versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    const product = db.prepare('SELECT * FROM Product WHERE id = ?').get(version.product_id);
    const itemNo = (product?.item_no || 'VQ').replace(/[^\w-]/g, '_');
    const dateCode = (version.date_code || version.quote_date || '').replace(/[^\w-]/g, '');
    const filename = `VQ_${itemNo}_${dateCode || req.params.versionId}.xlsx`;

    const buffer = await exportVersion(req.params.versionId);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
