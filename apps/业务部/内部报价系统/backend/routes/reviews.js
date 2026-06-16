const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST /api/reviews/:section_id   { action: 'approve'|'reject', comment? }
router.post('/:section_id', (req, res) => {
  if (!['supervisor', 'admin'].includes(req.user.role)) return res.status(403).json({ error: '仅主管可审核' });
  const id = Number(req.params.section_id);
  const { action, comment } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action 非法' });

  const sec = db.prepare('SELECT * FROM quote_sections WHERE id = ?').get(id);
  if (!sec) return res.status(404).json({ error: '不存在' });
  if (sec.dept !== req.user.dept && !['sales', 'engineering'].includes(req.user.dept)) {
    return res.status(403).json({ error: '只能审核本部门' });
  }
  if (sec.status !== 'filled' && action === 'approve') {
    return res.status(409).json({ error: '该 section 尚未填写完毕' });
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  db.prepare(`
    UPDATE quote_sections
    SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_comment = ?
    WHERE id = ?
  `).run(newStatus, req.user.name, comment || null, id);

  // 若 5/5 通过 → 报价单整体状态升级
  const approvedAll = db.prepare(
    `SELECT COUNT(*) AS n FROM quote_sections WHERE quote_id = ? AND status = 'approved'`
  ).get(sec.quote_id).n >= db.prepare('SELECT COUNT(*) AS n FROM departments').get().n;
  if (approvedAll) {
    db.prepare(`UPDATE quotes SET status = 'fully_approved' WHERE id = ? AND status = 'drafting'`)
      .run(sec.quote_id);
  }

  const actor = `[${req.user.dept}] ${req.user.name}`;
  db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, ?, ?, ?, ?)`)
    .run(sec.quote_id, sec.dept, actor, action, comment || null);

  res.json({ ok: true, all_approved: approvedAll });
});

// POST /api/reviews/:section_id/reopen  { reason? }
// 主管把已审 section 退回到"已填"以便修改；同时若报价单已 fully_approved 则回退到 drafting
router.post('/:section_id/reopen', (req, res) => {
  const id = Number(req.params.section_id);
  const reason = (req.body && req.body.reason) || null;

  const sec = db.prepare('SELECT * FROM quote_sections WHERE id = ?').get(id);
  if (!sec) return res.status(404).json({ error: '不存在' });
  if (sec.dept !== req.user.dept && !['sales', 'engineering'].includes(req.user.dept)) {
    return res.status(403).json({ error: '只能操作本部门' });
  }
  if (sec.status !== 'approved') return res.status(409).json({ error: '只能解除已审核通过的 section' });

  db.prepare(`
    UPDATE quote_sections
    SET status = 'filled', review_comment = ?
    WHERE id = ?
  `).run(reason ? '【解除审核】' + reason : '【解除审核】', id);

  // 整张报价单若已 fully_approved → 回退 drafting
  db.prepare(`UPDATE quotes SET status = 'drafting' WHERE id = ? AND status = 'fully_approved'`)
    .run(sec.quote_id);

  const reopenActor = `[${req.user.dept}] ${req.user.name}`;
  db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, ?, ?, 'reopen', ?)`)
    .run(sec.quote_id, sec.dept, reopenActor, reason || null);

  res.json({ ok: true });
});

module.exports = router;
