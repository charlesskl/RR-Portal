const express = require('express');
const db = require('../db');
const { requireAuth, quoteAccess } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// PUT /api/sections/:id  填写本部门 section
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const sec = await db.prepare('SELECT * FROM quote_sections WHERE id = ?').get(id);
  if (!sec) return res.status(404).json({ error: '不存在' });
  // 客户可见范围校验（防跨客户越权写）
  const acc = await quoteAccess(req.user, sec.quote_id);
  if (acc.status !== 200) return res.status(acc.status).json({ error: acc.status === 404 ? '不存在' : '无权操作该客户的报价单' });
  // 业务 / 工程 可操作所有 section；其他部门只能操作自己
  if (sec.dept !== req.user.dept && !['sales', 'engineering'].includes(req.user.dept)) {
    return res.status(403).json({ error: '只能填写本部门部分' });
  }
  if (sec.status === 'approved') return res.status(409).json({ error: '已审核通过，无法修改' });

  let payload = req.body && typeof req.body.payload === 'object' ? req.body.payload : {};
  const submit = !!(req.body && req.body.submit);
  if (sec.dept === 'painting') {
    try { require('../services/paintingFormula').normalize(payload); }
    catch (error) { return res.status(400).json({error:error.message}); }
  }

  if (sec.dept === 'sales') {
    const previous = JSON.parse(sec.payload_json || '{}');
    if (JSON.stringify(previous.mixed_quote || null) !== JSON.stringify(payload?.mixed_quote || null)) {
      return res.status(409).json({ error: '请使用混装配置面板保存小产品和混装比例，避免影响已审核费用' });
    }
  }
  const allSections = await db.prepare('SELECT * FROM quote_sections WHERE quote_id = ?').all(sec.quote_id);
  const mixedService = require('../services/mixedQuotation');
  const config = mixedService.getConfig(allSections);
  if (config?.enabled) {
    const ids = new Set(config.products.map(p => p.id));
    if (Object.keys(payload.mixed_products || {}).some(key => !ids.has(key))) {
      return res.status(409).json({ error: '小产品配置已改变，请刷新报价页后再保存' });
    }
    if (sec.dept === 'molding') {
      try {
        const quote = await db.prepare('SELECT * FROM quotes WHERE id = ?').get(sec.quote_id);
        require('../../frontend/mixed-molds').calculate(config, payload.mixed_molds || [], quote.qty);
        payload = require('../../frontend/mixed-molds').engineeringCatalog(payload, JSON.parse(allSections.find(s => s.dept === 'engineering')?.payload_json || '{}'));
        if (payload.parts_catalog) payload = require('../../frontend/mixed-molds').applyCatalog(payload, config, quote.qty);
      } catch (e) {
        // Incomplete calculation parameters must not prevent saving entered draft data.
        if (submit) return res.status(400).json({ error: e.message });
      }
    }
    if (sec.dept === 'engineering' && payload.mixed_part_selections) {
      try {
        const quote = await db.prepare('SELECT * FROM quotes WHERE id = ?').get(sec.quote_id);
        const molding = require('../../frontend/mixed-molds').engineeringCatalog(JSON.parse(allSections.find(s => s.dept === 'molding')?.payload_json || '{}'), payload);
        if (!molding.parts_catalog) throw new Error('请先启用统一零件明细');
        molding.parts_catalog.selections = payload.mixed_part_selections;
        // 工程只校验零件归属和用量；机台费用、啤次由啤机部负责。
        const parts = new Set(molding.parts_catalog.parts.map(p => p.id));
        for (const [productId, refs] of Object.entries(payload.mixed_part_selections)) {
          if (productId !== '__shared__' && !ids.has(productId)) throw new Error('零件选用引用了已删除的小产品');
          if (!Array.isArray(refs)) throw new Error('零件选用资料无效');
          const selected = new Set();
          for (const ref of refs) {
            if (!parts.has(ref.part_id)) throw new Error('选用的零件不存在');
            if (selected.has(ref.part_id)) throw new Error('同一产品不能重复选用同一零件');
            selected.add(ref.part_id);
            require('../../frontend/mixed-molds').number(ref.usage, '零件用量', true);
          }
        }
      } catch (e) { return res.status(400).json({ error: e.message }); }
    }
    if (submit && sec.dept === 'sales') {
      try {
        const quote = await db.prepare('SELECT * FROM quotes WHERE id = ?').get(sec.quote_id);
        mixedService.calculateMixedQuote(quote, allSections.map(s => s.id === sec.id ? { ...s, payload_json: JSON.stringify(payload) } : s), { strict: true });
      } catch (e) { return res.status(400).json({ error: e.message }); }
    }
  }

  // Reject stale edits, including another tab logged in as the same person.
  const hasBase = Object.hasOwn(req.body || {}, 'base_filled_at');
  const baseFilledAt = req.body?.base_filled_at ?? null;
  if (hasBase && baseFilledAt !== (sec.filled_at ?? null)) {
    return res.status(409).json({ error: '该部门资料已更新，本次未覆盖。请保留当前输入，刷新核对后再保存。' });
  }
  const previousTime = Date.parse(sec.filled_at || '') || 0;
  const nextFilledAt = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
  const saved = await db.prepare(`
    UPDATE quote_sections
    SET payload_json = ?, status = CASE WHEN ? = 1 THEN 'filled' ELSE status END,
        filled_by = ?, filled_at = ?
    WHERE id = ? AND filled_at IS NOT DISTINCT FROM ? AND payload_json = ? AND status = ?
  `).run(JSON.stringify(payload), submit ? 1 : 0, req.user.name, nextFilledAt, id,
    sec.filled_at || null, sec.payload_json, sec.status);
  if (!saved.changes) return res.status(409).json({ error: '保存期间资料或审核状态已更新，本次未覆盖，请刷新核对。' });
  const conflict = false;

  // 仅记录"提交审核"，保存草稿不写入修改记录
  if (submit) {
    const actor = `[${req.user.dept}] ${req.user.name}`;
    await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, ?, ?, 'submit', ?)`)
      .run(sec.quote_id, sec.dept, actor, null);
  }

  const after = await db.prepare('SELECT filled_at FROM quote_sections WHERE id = ?').get(id);
  res.json({ ok: true, filled_at: after && after.filled_at, conflict, last_by: conflict ? sec.filled_by : null, last_at: conflict ? sec.filled_at : null });
});

module.exports = router;
