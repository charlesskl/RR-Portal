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
      const removed = (previous?.products || []).filter(p => !nextIds.has(p.id));
      if (removed.length) {
        const confirmed = new Set(req.body.confirmed_removed_ids || []);
        if (removed.some(p => !confirmed.has(p.id))) throw new Error('请确认删除小产品及其部门明细后重试');
        for (const section of sections.filter(s => s.dept !== 'sales')) {
          if (!req.body.expected_sections || req.body.expected_sections[section.id] !== (section.filled_at || ''))
            throw new Error('部门资料已更新，请刷新核对后再删除');
        }
        await db.prepare("INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, ?, ?, 'mixed_product_delete_backup', ?)")
          .run(id, req.user.dept, req.user.name, JSON.stringify({removed, sections}));
      }
      for (const section of sections) {
        const payload = require('../services/removeMixedProducts').removeMixedProducts(JSON.parse(section.payload_json || '{}'), removed.map(p => p.id));
        if (section.dept === 'sales') payload.mixed_quote = config;
        else if (!previous?.enabled) {
          // 既有单品完整归入首款，原始根数据留存，但混装计算只读取新结构。
          payload.mixed_products = { [config.products[0].id]: JSON.parse(section.payload_json || '{}') };
          payload.mixed_shared = {};
        }
        const now = new Date(Math.max(Date.now(), (Date.parse(section.filled_at || '') || 0) + 1)).toISOString();
        const updated = await db.prepare("UPDATE quote_sections SET payload_json = ?, status = 'empty', filled_at = ?, filled_by = ? WHERE id = ? AND payload_json = ? AND status = ? AND filled_at IS NOT DISTINCT FROM ?")
          .run(JSON.stringify(payload), now, req.user.name, section.id, section.payload_json, section.status, section.filled_at || null);
        if (!updated.changes) throw new Error('部门资料已更新，本次未覆盖，请刷新后重试');
      }
      await db.prepare("UPDATE quotes SET status = 'drafting' WHERE id = ?").run(id);
      await db.prepare("INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, ?, ?, 'mixed_config', ?)")
        .run(id, req.user.dept, req.user.name, JSON.stringify(config));
    })();
    res.json({ ok: true });
  } catch (e) { res.status(409).json({ error: e.message }); }
});
// Save inferred products and their engineering references together.
router.post('/:id/mixed/import-molds', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const result = await db.transaction(async () => {
      const locked = await db.prepare(`SELECT 1 FROM quote_customer_confirmations WHERE quote_id = ? AND status = 'confirmed'
        UNION SELECT 1 FROM quote_verifications WHERE quote_id = ? LIMIT 1`).get(id,id);
      if (locked) throw new Error('客价已确认，混装配置已锁定');
      const sections = await db.prepare('SELECT * FROM quote_sections WHERE quote_id = ?').all(id);
      if (sections.some(s => s.status === 'approved')) throw new Error('导入小产品前，请先解除各部门审核');
      const config = getConfig(sections);
      if (!config?.enabled) throw new Error('请先创建混装报价');
      if (JSON.stringify(config) !== JSON.stringify(req.body.expected_config)) throw new Error('混装配置已更新，请刷新后重试');
      const engineering = sections.find(s => s.dept === 'engineering'), sales = sections.find(s => s.dept === 'sales');
      if (!engineering || !sales) throw new Error('报价部门资料不完整');
      if ((engineering.filled_at || '') !== (req.body.base_filled_at || '')) throw new Error('工程资料已更新，请刷新后重试');
      const root = req.body.engineering;
      if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('工程资料无效');
      const empty = value => value == null || (Array.isArray(value) ? value.length === 0 : typeof value === 'object' ? Object.values(value).every(empty) : value === '');
      const defaults = config.products.length === 2 && config.products.every((p,i) => p.id === `p${i+1}` && p.code === `P${i+1}` && p.name === `小产品 ${i+1}`);
      const payloads = sections.map(s => JSON.parse(s.payload_json || '{}'));
      const pristine = defaults && payloads.every(p => empty(p.mixed_products) && empty(p.mixed_molds) && empty(p.mixed_part_selections) && empty(p.mixed_imported_parts) && !p.parts_catalog);
      const unsavedProductRows = Object.values(root.mixed_products || {}).some(p => Object.values(p).some(v => Array.isArray(v) && v.length));
      if (pristine && unsavedProductRows) throw new Error('请先保存已有小产品明细，再执行导入');
      const molding = require('../../frontend/mixed-molds').engineeringCatalog(payloads[sections.findIndex(s=>s.dept==='molding')] || {}, root);
      const prepared = {...root, mixed_part_selections:root.mixed_part_selections || molding.parts_catalog?.selections || {}};
      const imported = require('../services/mixedPartImport').importParts(config, prepared, req.body.molds, {
        placeholderIds:require('../services/mixedPartImport').unusedPlaceholders(config, [...payloads, root]), replacePlaceholders:pristine, sourceFile:String(req.body.source_file || ''), existingParts:molding.parts_catalog?.parts || [],
      });
      const salesPayload = JSON.parse(sales.payload_json || '{}'); salesPayload.mixed_quote = imported.config;
      for (const [section,payload] of [[engineering,imported.engineering],[sales,salesPayload]]) {
        const now = new Date(Math.max(Date.now(), (Date.parse(section.filled_at || '') || 0)+1)).toISOString();
        const saved = await db.prepare(`UPDATE quote_sections SET payload_json = ?, status = 'empty', filled_by = ?, filled_at = ?
          WHERE id = ? AND payload_json = ? AND status = ? AND filled_at IS NOT DISTINCT FROM ?`)
          .run(JSON.stringify(payload),req.user.name,now,section.id,section.payload_json,section.status,section.filled_at || null);
        if (!saved.changes) throw new Error('资料已被更新，本次未覆盖，请刷新重试');
      }
      await db.prepare("UPDATE quotes SET status = 'drafting' WHERE id = ?").run(id);
      await db.prepare("INSERT INTO audit_log (quote_id,dept,actor,action,detail) VALUES (?,?,?,'mixed_part_import',?)")
        .run(id,req.user.dept,req.user.name,JSON.stringify(imported.summary));
      return imported.summary;
    })();
    res.json({ok:true,...result});
  } catch (e) { res.status(409).json({error:e.message}); }
});

module.exports = router;
