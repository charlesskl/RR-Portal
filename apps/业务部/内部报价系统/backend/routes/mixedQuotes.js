const express = require('express');
const db = require('../db');
const { quoteAccess } = require('../middleware/auth');
const { validateConfig } = require('../../frontend/mixed-molds');
const { getConfig, calculateMixedQuote } = require('../services/mixedQuotation');
const router = express.Router();
router.use('/:id/mixed', async (req, res, next) => {
  const acc = await quoteAccess(req.user, Number(req.params.id));
  if (acc.status !== 200) return res.status(acc.status).json({ error: '无权访问该报价单' });
  if (!['sales', 'engineering'].includes(req.user.dept)) return res.status(403).json({ error: '混装整体配置和汇总仅限业务或工程查看' });
  next();
});
router.get('/:id/mixed', async (req, res) => {
  const id = Number(req.params.id);
  const quote = await db.prepare('SELECT * FROM quotes WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!quote) return res.status(404).json({ error: '报价单不存在' });
  const sections = await db.prepare('SELECT * FROM quote_sections WHERE quote_id = ?').all(id);
  res.json(calculateMixedQuote(quote, sections) || { enabled: false });
});
router.put('/:id/mixed', async (req, res) => {
  const id = Number(req.params.id), config = req.body.config;
  try {
    if (!config?.enabled) throw new Error('此入口用于启用和设置混装报价');
    validateConfig(config);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    await db.transaction(async () => {
      const locked = await db.prepare(`SELECT 1 FROM quote_customer_confirmations WHERE quote_id = ? AND status = 'confirmed'
        UNION SELECT 1 FROM quote_verifications WHERE quote_id = ? LIMIT 1`).get(id, id);
      if (locked) throw new Error('客价已确认，混装配置已锁定');
      const sections = await db.prepare('SELECT * FROM quote_sections WHERE quote_id = ? ORDER BY id').all(id);
      if (!sections.length) throw new Error('报价单不存在');
      if (sections.some(s => s.status === 'approved')) throw new Error('修改混装产品或比例前，请先解除各部门审核');
      const previous = getConfig(sections);
      if (JSON.stringify(previous) !== JSON.stringify(req.body.expected_config ?? null)) throw new Error('混装配置已被其他人更新，请刷新后重试');
      const nextIds = new Set(config.products.map(p => p.id));
      for (const section of sections) {
        const payload = JSON.parse(section.payload_json || '{}');
        for (const product of previous?.products || []) {
          if (!nextIds.has(product.id) && (Object.keys(payload.mixed_products?.[product.id] || {}).length
            || (payload.mixed_molds || []).some(m => m.parts?.some(p => p.product_id === product.id)))) {
            throw new Error(`${product.code} 已有部门明细或共模零件，不能移除`);
          }
        }
        if (section.dept === 'sales') payload.mixed_quote = config;
        else if (!previous?.enabled) {
          // 既有单品完整归入首款，原始根数据留存，但混装计算只读取新结构。
          payload.mixed_products = { [config.products[0].id]: JSON.parse(section.payload_json || '{}') };
          payload.mixed_shared = {};
        }
        await db.prepare("UPDATE quote_sections SET payload_json = ?, status = 'empty', filled_at = datetime('now'), filled_by = ? WHERE id = ?")
          .run(JSON.stringify(payload), req.user.name, section.id);
      }
      await db.prepare("UPDATE quotes SET status = 'drafting' WHERE id = ?").run(id);
      await db.prepare("INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, ?, ?, 'mixed_config', ?)")
        .run(id, req.user.dept, req.user.name, JSON.stringify(config));
    })();
    res.json({ ok: true });
  } catch (e) { res.status(409).json({ error: e.message }); }
});
module.exports = router;
