const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const router = express.Router();

function upsertRecord(dbi, r, workshop_id) {
  dbi.prepare(`
    INSERT INTO daily_records(record_date, line_id, product_id, product_process_id, produced_qty, worker_count, remarks, workshop_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(record_date, line_id, product_process_id)
    DO UPDATE SET produced_qty=excluded.produced_qty, worker_count=excluded.worker_count, remarks=excluded.remarks
  `).run(r.record_date, r.line_id, r.product_id, r.product_process_id, r.produced_qty, r.worker_count, r.remarks || '', workshop_id);
}

function listByDate(dbi, date, workshop_id) {
  return dbi.prepare(`
    SELECT dr.*, l.name AS line_name, p.code AS product_code, p.name AS product_name,
           pp.part_name, pp.technique, pp.unit_wage, p.quote_price
    FROM daily_records dr
    JOIN lines l ON l.id = dr.line_id
    JOIN products p ON p.id = dr.product_id
    JOIN product_processes pp ON pp.id = dr.product_process_id
    WHERE dr.record_date = ? AND dr.workshop_id = ?
    ORDER BY dr.id
  `).all(date, workshop_id);
}

router.get('/', (req, res) => {
  if (!req.query.date) return res.status(400).json({ error: 'date required' });
  res.json(listByDate(db, req.query.date, req.workshopId));
});

router.post('/', (req, res) => {
  const { record_date, line_id, product_id, product_process_id, produced_qty, worker_count } = req.body;
  if (!record_date || !line_id || !product_id || !product_process_id || produced_qty == null || worker_count == null)
    return res.status(400).json({ error: 'all fields required' });
  upsertRecord(db, req.body, req.workshopId);
  res.json({ ok: true });
});

// 导出当日生产记录为 Excel(给班长/老板发的那个表)
router.get('/export', async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date required' });
  const rows = db.prepare(`
    SELECT dr.record_date, l.name AS line_name,
           p.code AS product_code, p.name AS product_name,
           pp.part_name, pp.technique, pp.unit_wage, p.quote_price,
           dr.produced_qty, dr.worker_count, dr.remarks
    FROM daily_records dr
    JOIN lines l ON l.id = dr.line_id
    JOIN products p ON p.id = dr.product_id
    JOIN product_processes pp ON pp.id = dr.product_process_id
    WHERE dr.record_date = ? AND dr.workshop_id = ?
    ORDER BY p.code, pp.technique, l.name
  `).all(date, req.workshopId);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${date} 生产记录`);
  ws.columns = [
    { header: '日期', key: 'record_date', width: 12 },
    { header: '货号', key: 'product_code', width: 12 },
    { header: '货名', key: 'product_name', width: 22 },
    { header: '部位', key: 'part_name', width: 16 },
    { header: '工艺', key: 'technique', width: 10 },
    { header: '拉', key: 'line_name', width: 10 },
    { header: '生产数', key: 'produced_qty', width: 10 },
    { header: '工人数', key: 'worker_count', width: 8 },
    { header: '工价', key: 'unit_wage', width: 10 },
    { header: '工资', key: 'wage', width: 12 },
    { header: '报价', key: 'quote_price', width: 10 },
    { header: '产值', key: 'output', width: 12 },
    { header: '备注', key: 'remarks', width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  let totalOutput = 0, totalWage = 0;
  for (const r of rows) {
    const wage = Number(r.unit_wage || 0) * Number(r.produced_qty || 0);
    const output = Number(r.quote_price || 0) * Number(r.produced_qty || 0);
    totalOutput += output;
    totalWage += wage;
    ws.addRow({ ...r, wage: Number(wage.toFixed(2)), output: Number(output.toFixed(2)) });
  }
  if (rows.length) {
    ws.addRow({});
    const sumRow = ws.addRow({
      part_name: '合计',
      produced_qty: rows.reduce((s, r) => s + Number(r.produced_qty || 0), 0),
      wage: Number(totalWage.toFixed(2)),
      output: Number(totalOutput.toFixed(2)),
    });
    sumRow.font = { bold: true };
  }
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',
    `attachment; filename="daily_${date}.xlsx"`);
  res.send(Buffer.from(buf));
});

// 查某条工序的逐日生产历史(可选按 line_id 过滤)
router.get('/history', (req, res) => {
  const { product_process_id, line_id } = req.query;
  if (!product_process_id) return res.status(400).json({ error: 'product_process_id required' });
  const params = [Number(product_process_id), req.workshopId];
  let where = 'dr.product_process_id=? AND dr.workshop_id=?';
  if (line_id) { where += ' AND dr.line_id=?'; params.push(Number(line_id)); }
  const rows = db.prepare(`
    SELECT dr.id, dr.record_date, dr.line_id, l.name AS line_name,
           dr.produced_qty, dr.worker_count, dr.remarks
    FROM daily_records dr
    LEFT JOIN lines l ON l.id = dr.line_id
    WHERE ${where}
    ORDER BY dr.record_date DESC
  `).all(...params);
  res.json(rows);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM daily_records WHERE id=? AND workshop_id=?').run(req.params.id, req.workshopId);
  res.json({ ok: true });
});

module.exports = router;
Object.assign(module.exports, { upsertRecord, listByDate });
