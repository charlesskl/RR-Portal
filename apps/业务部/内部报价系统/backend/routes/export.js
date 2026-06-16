const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { buildWorkbook } = require('../services/exportXlsx');

const router = express.Router();
router.use(requireAuth);

// GET /api/quotes/:id/export  — 5/5 通过才放行；返回 xlsx 文件
router.get('/:id/export', async (req, res) => {
  const id = Number(req.params.id);
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!quote) return res.status(404).json({ error: '不存在' });

  const approvedCount = db.prepare(
    `SELECT COUNT(*) AS n FROM quote_sections WHERE quote_id = ? AND status = 'approved'`
  ).get(id).n;
  const totalDepts = db.prepare('SELECT COUNT(*) AS n FROM departments').get().n;
  if (approvedCount < totalDepts) {
    return res.status(409).json({ error: `尚有 ${totalDepts - approvedCount} 个部门未审核通过` });
  }

  const sections = db.prepare(
    `SELECT s.dept, d.name_cn, s.payload_json, s.reviewed_by, s.reviewed_at
     FROM quote_sections s JOIN departments d ON d.code = s.dept
     WHERE s.quote_id = ? ORDER BY d.sort_order`
  ).all(id);

  db.prepare(`INSERT INTO audit_log (quote_id, actor, action) VALUES (?, ?, 'export')`)
    .run(id, req.user.name);

  try {
    const wb = await buildWorkbook({ quote, sections });
    const buf = await wb.xlsx.writeBuffer();
    const filename = encodeURIComponent(`${quote.quote_no || quote.id}_内部报价明细.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error('[export]', e);
    res.status(500).json({ error: '导出失败: ' + e.message });
  }
});

module.exports = router;
