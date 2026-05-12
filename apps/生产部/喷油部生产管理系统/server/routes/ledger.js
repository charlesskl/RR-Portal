const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { buildLedger } = require('../lib/ledger');
const router = express.Router();

router.get('/', (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date required' });
  res.json(buildLedger(db, date, req.workshopId));
});

router.post('/edits', (req, res) => {
  const { date, line_id, product_id, column_key, value } = req.body;
  if (!date || !line_id || !product_id || !column_key)
    return res.status(400).json({ error: 'date, line_id, product_id, column_key required' });
  db.prepare(`
    INSERT INTO ledger_edits (ledger_date, line_id, product_id, column_key, value, workshop_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(ledger_date, line_id, product_id, column_key)
    DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
  `).run(date, line_id, product_id, column_key, value == null ? null : String(value), req.workshopId);
  res.json({ ok: true });
});

router.get('/monthly', (req, res) => {
  const month = req.query.month; // YYYY-MM
  if (!month) return res.status(400).json({ error: 'month required' });
  const byLine = db.prepare(`
    SELECT l.name AS line_name,
      COALESCE(SUM(dr.produced_qty * p.quote_price), 0) AS total_output,
      COALESCE(SUM(dr.produced_qty * pp.unit_wage), 0) AS total_wage,
      COUNT(DISTINCT dr.record_date) AS worker_days
    FROM daily_records dr
    JOIN lines l ON l.id = dr.line_id
    JOIN products p ON p.id = dr.product_id
    JOIN product_processes pp ON pp.id = dr.product_process_id
    WHERE strftime('%Y-%m', dr.record_date) = ? AND dr.workshop_id = ?
    GROUP BY l.id, l.name
    ORDER BY l.sort_order
  `).all(month, req.workshopId);
  const byProduct = db.prepare(`
    SELECT p.code, p.name,
      COALESCE(SUM(dr.produced_qty * p.quote_price), 0) AS total_output,
      COUNT(DISTINCT dr.record_date) AS days
    FROM daily_records dr
    JOIN products p ON p.id = dr.product_id
    WHERE strftime('%Y-%m', dr.record_date) = ? AND dr.workshop_id = ?
    GROUP BY p.id, p.code, p.name
    ORDER BY total_output DESC
  `).all(month, req.workshopId);
  const totalOutput = byLine.reduce((s, r) => s + Number(r.total_output), 0);
  res.json({ month, total_output: totalOutput, by_line: byLine, by_product: byProduct });
});

router.get('/export', async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date required' });
  const { columns, rows } = buildLedger(db, date, req.workshopId);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('收支表');

  ws.addRow(columns.map(c => c.label));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } };

  let lastCode = null;
  for (const row of rows) {
    const displayCode = row.product_code !== lastCode ? row.product_code : '';
    const values = columns.map((c, idx) => {
      if (idx === 0 && displayCode) return `${displayCode} ${row.product_name}`;
      if (idx === 0) return '';
      return row.values[c.key] ?? '';
    });
    ws.addRow(values);
    lastCode = row.product_code;
  }

  const filename = `核价分拉-${date.replace(/-/g,'')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
