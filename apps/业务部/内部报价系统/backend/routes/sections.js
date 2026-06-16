const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// PUT /api/sections/:id  填写本部门 section
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const sec = db.prepare('SELECT * FROM quote_sections WHERE id = ?').get(id);
  if (!sec) return res.status(404).json({ error: '不存在' });
  // 业务 / 工程 可操作所有 section；其他部门只能操作自己
  if (sec.dept !== req.user.dept && !['sales', 'engineering'].includes(req.user.dept)) {
    return res.status(403).json({ error: '只能填写本部门部分' });
  }
  if (sec.status === 'approved') return res.status(409).json({ error: '已审核通过，无法修改' });

  const payload = req.body && typeof req.body.payload === 'object' ? req.body.payload : {};
  const submit = !!(req.body && req.body.submit);

  const nextStatus = submit ? 'filled' : (sec.status === 'rejected' ? 'rejected' : 'empty');

  db.prepare(`
    UPDATE quote_sections
    SET payload_json = ?, status = CASE WHEN ? = 1 THEN 'filled' ELSE status END,
        filled_by = ?, filled_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(payload), submit ? 1 : 0, req.user.name, id);

  // 仅记录"提交审核"，保存草稿不写入修改记录
  if (submit) {
    const actor = `[${req.user.dept}] ${req.user.name}`;
    db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, ?, ?, 'submit', ?)`)
      .run(sec.quote_id, sec.dept, actor, null);
  }

  res.json({ ok: true });
});

module.exports = router;
