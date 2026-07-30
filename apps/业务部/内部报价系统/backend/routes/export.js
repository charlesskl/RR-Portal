const express = require('express');
const db = require('../db');
const { requireAuth, quoteAccess } = require('../middleware/auth');
const { buildWorkbook } = require('../services/exportInternal');
const { exportVQ } = require('../services/exportVQ');
const { translateSectionsForVq } = require('../services/vqTranslate');

const router = express.Router();
router.use(requireAuth);

// GET /api/quotes/:id/export  — 5/5 通过才放行；返回 xlsx 文件
router.get('/:id/export', async (req, res) => {
  const id = Number(req.params.id);
  const quote = await db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!quote) return res.status(404).json({ error: '不存在' });
  // 客户可见范围校验
  const acc = await quoteAccess(req.user, id);
  if (acc.status !== 200) return res.status(acc.status).json({ error: acc.status === 404 ? '不存在' : '无权导出该客户的报价单' });

  const approvedCount = Number((await db.prepare(
    `SELECT COUNT(*) AS n FROM quote_sections WHERE quote_id = ? AND status = 'approved'`
  ).get(id)).n);
  const totalDepts = Number((await db.prepare('SELECT COUNT(*) AS n FROM departments').get()).n);
  if (approvedCount < totalDepts) {
    return res.status(409).json({ error: `尚有 ${totalDepts - approvedCount} 个部门未审核通过` });
  }

  const sections = await db.prepare(
    `SELECT s.dept, d.name_cn, s.payload_json, s.reviewed_by, s.reviewed_at
     FROM quote_sections s JOIN departments d ON d.code = s.dept
     WHERE s.quote_id = ? ORDER BY d.sort_order`
  ).all(id);

  await db.prepare(`INSERT INTO audit_log (quote_id, actor, action) VALUES (?, ?, 'export')`)
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

// GET /api/quotes/:id/export-vq — 生成 TOMY / SPIN 客户报客表。
router.get('/:id/export-vq', async (req, res) => {
  const id = Number(req.params.id);
  const quote = await db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!quote) return res.status(404).json({ error: '不存在' });

  const acc = await quoteAccess(req.user, id);
  if (acc.status !== 200) {
    return res.status(acc.status).json({ error: acc.status === 404 ? '不存在' : '无权导出该客户的报价单' });
  }

  const approvedCount = Number((await db.prepare(
    `SELECT COUNT(*) AS n FROM quote_sections WHERE quote_id = ? AND status = 'approved'`
  ).get(id)).n);
  const totalDepts = Number((await db.prepare('SELECT COUNT(*) AS n FROM departments').get()).n);
  if (approvedCount < totalDepts) {
    return res.status(409).json({ error: `尚有 ${totalDepts - approvedCount} 个部门未审核通过` });
  }

  const sections = await db.prepare(
    `SELECT s.dept, d.name_cn, s.payload_json, s.reviewed_by, s.reviewed_at
     FROM quote_sections s JOIN departments d ON d.code = s.dept
     WHERE s.quote_id = ? ORDER BY d.sort_order`
  ).all(id);

  await db.prepare(`INSERT INTO audit_log (quote_id, actor, action) VALUES (?, ?, 'export_vq')`)
    .run(id, req.user.name);

  try {
    const buf = await exportVQ({ quote, sections });
    const filename = encodeURIComponent(`VQ_${quote.quote_no || quote.id}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error('[export-vq]', e);
    res.status(500).json({ error: '报客表导出失败: ' + e.message });
  }
});

// POST /api/quotes/:id/translate-vq — 与「报价系统」一致，自动翻译报客表英文名称。
router.post('/:id/translate-vq', async (req, res) => {
  const id = Number(req.params.id);
  const quote = await db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!quote) return res.status(404).json({ error: '不存在' });

  const acc = await quoteAccess(req.user, id);
  if (acc.status !== 200) {
    return res.status(acc.status).json({ error: acc.status === 404 ? '不存在' : '无权操作该客户的报价单' });
  }
  const customer = String(quote.customer || '').trim().toUpperCase();
  if (!['SPIN', 'TOMY'].includes(customer)) {
    return res.status(400).json({ error: `客户「${quote.customer || '未设置'}」暂未配置报客表翻译` });
  }

  const sections = await db.prepare(
    'SELECT id, dept, payload_json FROM quote_sections WHERE quote_id = ? ORDER BY id'
  ).all(id);

  try {
    const result = await translateSectionsForVq({ quote, sections });
    await db.transaction(async () => {
      for (const section of result.sections) {
        await db.prepare('UPDATE quote_sections SET payload_json = ? WHERE id = ?')
          .run(section.payload_json, section.id);
      }
      await db.prepare(
        `INSERT INTO audit_log (quote_id, actor, action, detail)
         VALUES (?, ?, 'translate_vq', ?)`
      ).run(
        id,
        req.user.name,
        `translated=${result.translated}, untranslated=${result.untranslated}`
      );
    })();
    res.json({
      translated: result.translated,
      untranslated: result.untranslated,
      warning: result.warning,
    });
  } catch (error) {
    console.error('[translate-vq]', error);
    res.status(500).json({ error: '翻译失败: ' + error.message });
  }
});

module.exports = router;
