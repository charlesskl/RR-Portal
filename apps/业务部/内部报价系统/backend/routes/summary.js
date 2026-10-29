const { quoteWriteRoute } = require('../services/quoteFreeze');
const express = require('express');
const db = require('../db');
const { requireAuth, quoteAccess } = require('../middleware/auth');
const { summaryHeaderStyle, WORKSHOPS, QUOTE_COMPONENTS, SUMMARY_COLUMNS, SHARE_AMOUNTS, SHARE_UNITS, AMOUNT_SHARE_KEYS, calculateSummaryValues, buildQuoteSummary, buildSummaryWorkbook, parseJson } = require('../services/quoteSummary');

const router = express.Router();
router.use(requireAuth);

const HIDE_IMPORTED_VERIFICATIONS = `AND NOT EXISTS (
  SELECT 1 FROM quote_sections imported_section
  WHERE imported_section.quote_id = q.id
    AND imported_section.dept = 'sales'
    AND imported_section.payload_json LIKE '%"legacy_import"%'
)`;


function isAdmin(user) {
  return user.role === 'admin' || Boolean(user.perms?.['账号管理']?.can_admin);
}

async function workshopOptions(factoryCode) {
  const saved = await db.prepare("SELECT data_json FROM factory_ref_tables WHERE factory_code = ? AND key LIKE 'quote_workshop:%' ORDER BY key").all(factoryCode);
  const options = WORKSHOPS.map(([code, name]) => ({code, name}));
  for (const row of saved) {
    const item = parseJson(row.data_json, null);
    if (item?.code && item?.name) {
      const index = options.findIndex(o => o.code === item.code);
      if (index < 0) options.push(item);
      else options[index] = item;
    }
  }
  return options;
}

router.post('/workshops', async (req, res) => {
  if (req.user.dept !== 'sales' && !isAdmin(req.user)) return res.status(403).json({error:'只有业务或管理员可添加车间'});
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().normalize('NFKC') : '';
  if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) return res.status(400).json({error:'请输入1–40个字符的车间名称'});
  const options = await workshopOptions(req.user.active_factory_code);
  const existing = options.find(o => o.name.toLowerCase() === name.toLowerCase() || o.code.toLowerCase() === name.toLowerCase());
  if (existing) return res.json(existing);
  const key = 'quote_workshop:' + require('node:crypto').createHash('sha256').update(name.toLowerCase()).digest('hex');
  const item = {code:name, name};
  await db.prepare('INSERT INTO factory_ref_tables (factory_code,key,data_json,updated_by) VALUES (?,?,?,?) ON CONFLICT(factory_code,key) DO NOTHING')
    .run(req.user.active_factory_code,key,JSON.stringify(item),req.user.name);
  const saved = await db.prepare('SELECT data_json FROM factory_ref_tables WHERE factory_code = ? AND key = ?').get(req.user.active_factory_code,key);
  res.json(parseJson(saved.data_json, item));
});

router.put('/workshops', async (req, res) => {
  if (req.user.dept !== 'sales' && !isAdmin(req.user)) return res.status(403).json({error:'只有业务或管理员可编辑车间'});
  const code = req.body?.code;
  const name = typeof req.body?.name === 'string' ? req.body.name.normalize('NFKC').trim() : '';
  if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name)) return res.status(400).json({error:'请输入1–40个字符的车间名称'});
  const options = await workshopOptions(req.user.active_factory_code);
  if (!options.some(o => o.code === code)) return res.status(404).json({error:'车间不存在'});
  if (options.some(o => o.code !== code && (o.name.toLowerCase() === name.toLowerCase() || o.code.toLowerCase() === name.toLowerCase()))) return res.status(409).json({error:'车间名称已存在'});
  const key = 'quote_workshop:' + require('node:crypto').createHash('sha256').update(code.toLowerCase()).digest('hex');
  const item = {code, name};
  await db.prepare('INSERT INTO factory_ref_tables (factory_code,key,data_json,updated_by) VALUES (?,?,?,?) ON CONFLICT(factory_code,key) DO UPDATE SET data_json=excluded.data_json, updated_by=excluded.updated_by')
    .run(req.user.active_factory_code,key,JSON.stringify(item),req.user.name);
  res.json(item);
});

async function accessibleQuoteRows(user) {
  if (isAdmin(user)) {
    return db.prepare(`SELECT q.* FROM quotes q WHERE q.factory_code = ? AND q.deleted_at IS NULL ${HIDE_IMPORTED_VERIFICATIONS} ORDER BY q.customer, q.id DESC`)
      .all(user.active_factory_code);
  }
  const customers = (await db.prepare('SELECT customer FROM user_customers WHERE user_id = ?').all(user.id))
    .map(row => row.customer);
  if (!customers.length) return [];
  const placeholders = customers.map(() => '?').join(',');
  return db.prepare(`SELECT q.* FROM quotes q WHERE q.factory_code = ? AND q.deleted_at IS NULL AND q.customer IN (${placeholders}) ${HIDE_IMPORTED_VERIFICATIONS} ORDER BY q.customer, q.id DESC`)
    .all(user.active_factory_code, ...customers);
}

async function loadRows(user) {
  const quotes = await accessibleQuoteRows(user);
  const result = [];
  const allowedWorkshops = new Set((await workshopOptions(user.active_factory_code)).map(item => item.code));
  for (const quote of quotes) {
    const sections = await db.prepare('SELECT dept, payload_json, status FROM quote_sections WHERE quote_id = ?').all(quote.id);
    const summary = buildQuoteSummary(quote, sections);
    const confirmation = await db.prepare('SELECT * FROM quote_customer_confirmations WHERE quote_id = ?').get(quote.id);
    summary.confirmation = confirmation ? {
      ...confirmation,
      workshops: parseJson(confirmation.workshops_json, []).filter(code => allowedWorkshops.has(code)).slice(0, 1),
    } : { status: 'pending', workshops: [] };
    const qty = summary.confirmation.confirmed_qty ?? summary.qty;
    const price = summary.confirmation.confirmed_price ?? summary.quoted_price;
    summary.summary_values = calculateSummaryValues(summary.components_before_tax, summary.components, Number(qty)||0, Number(price)||0, summary.abs_material_cost);
    result.push(summary);
  }
  return result;
}

// Completion reports are restricted to the super administrator role, including downloads.
async function completionReport(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.user.role !== 'admin') return res.status(403).json({error:'仅超级管理员可查看报价完成情况汇总'});
  try {
    const rows = await db.prepare(`SELECT q.customer, CASE WHEN EXISTS (SELECT 1 FROM departments)
      AND NOT EXISTS (SELECT 1 FROM departments d WHERE NOT EXISTS (
        SELECT 1 FROM quote_sections s WHERE s.quote_id=q.id AND s.dept=d.code AND s.status='approved'
      )) THEN 1 ELSE 0 END AS completed
      FROM quotes q WHERE q.factory_code=? AND q.deleted_at IS NULL ${HIDE_IMPORTED_VERIFICATIONS}`).all(req.user.active_factory_code);
    const {aggregateCompletion,buildCompletionWorkbook}=require('../services/quoteCompletionSummary');
    const report=aggregateCompletion(rows);
    if (!req.path.endsWith('/xlsx')) return res.json(report);
    const buffer=await buildCompletionWorkbook(report).xlsx.writeBuffer();
    const filename=encodeURIComponent(`AI系统内部报价汇总_${report.as_of}.xlsx`);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(Buffer.from(buffer));
  } catch(error) { next(error); }
}
router.get('/completion', completionReport);
router.get('/completion/xlsx', completionReport);

router.get('/', async (req, res) => {
  const rows = await loadRows(req.user);
  res.json({
    rows,
    can_view_completion: req.user.role === 'admin',
    workshops: await workshopOptions(req.user.active_factory_code),
    components: QUOTE_COMPONENTS.map(([code, name]) => ({ code, name })),
    summary_columns: SUMMARY_COLUMNS.map(([code, name, format]) => ({ code, name, format, header_style: summaryHeaderStyle(code), share_amounts: code === 'amount_share_total' ? AMOUNT_SHARE_KEYS.map(key => SHARE_AMOUNTS[key]) : SHARE_AMOUNTS[code] ? [SHARE_AMOUNTS[code]] : null, share_unit: SHARE_UNITS[code] })),
    can_edit: req.user.dept === 'sales' || isAdmin(req.user),
  });
});

// Explicit undo is separate from normal confirmation saves: stale autosaves cannot unlock a quote.
router.post('/:id/revoke-confirmation', quoteWriteRoute(db, req => Number(req.params.id), async (req, res) => {
  if (req.user.dept !== 'sales' && !isAdmin(req.user)) return res.status(403).json({error:'只有业务或管理员可撤销客价确认'});
  const id = Number(req.params.id);
  const access = await quoteAccess(req.user, id);
  if (access.status !== 200) return res.status(access.status).json({error:'报价单不存在或无权操作'});
  const existing = await db.prepare('SELECT * FROM quote_customer_confirmations WHERE quote_id=?').get(id);
  const revision = Number((await db.prepare(`SELECT MAX(id) AS revision FROM audit_log WHERE quote_id=?
    AND action IN ('customer_confirmation','customer_confirmation_revoke')`).get(id)).revision || 0);
  if (!Number.isSafeInteger(req.body?.base_confirmation_revision) || req.body.base_confirmation_revision !== revision || existing?.status !== 'confirmed') {
    return res.status(409).json({error:'确认状态已更新，请刷新列表后重试'});
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason || reason.length > 300) return res.status(400).json({error:'请填写撤销原因（1–300字）'});
  if (await db.prepare('SELECT 1 FROM quote_verification_versions WHERE quote_id=? LIMIT 1').get(id)) {
    return res.status(409).json({error:'已有核价版本，不能直接撤销确认，以免影响核价资料；请先核对后续核价记录'});
  }
  const verification = await db.prepare('SELECT * FROM quote_verifications WHERE quote_id=?').get(id);
  if (verification && (verification.status !== 'not_started' || Object.keys(parseJson(verification.verified_values_json, {unknown:true})).length
      || Object.keys(parseJson(verification.verified_sections_json, {unknown:true})).length || verification.note)) {
    return res.status(409).json({error:'已有核价填写记录，不能直接撤销确认'});
  }
  // Save the complete automatic snapshot before removing only the unused case.
  // No version, department payload, original quote or attachment is removed.
  await db.prepare(`INSERT INTO audit_log(quote_id,dept,actor,action,detail)
    VALUES (?,'sales',?,'customer_confirmation_revoke',?)`).run(id,req.user.name,
      JSON.stringify({reason,previous_confirmation:existing,unused_verification:verification || null}));
  await db.prepare('DELETE FROM quote_verifications WHERE quote_id=?').run(id);
  await db.prepare(`UPDATE quote_customer_confirmations SET status='pending',confirmed_by=NULL,confirmed_at=NULL,
    updated_at=CURRENT_TIMESTAMP WHERE quote_id=?`).run(id);
  res.json({ok:true,status:'pending'});
}));

router.put('/:id/confirmation', quoteWriteRoute(db, req => Number(req.params.id), async (req, res) => {
  if (req.user.dept !== 'sales' && !isAdmin(req.user)) {
    return res.status(403).json({ error: '只有业务或超级管理员可确认客价和分派车间' });
  }
  const id = Number(req.params.id);
  const access = await quoteAccess(req.user, id);
  if (access.status !== 200) return res.status(access.status).json({ error: access.status === 404 ? '报价单不存在' : '无权操作该报价单' });
  const body = req.body || {};
  const existing = await db.prepare('SELECT * FROM quote_customer_confirmations WHERE quote_id = ?').get(id);
  if (existing?.status === 'confirmed' || await db.prepare('SELECT 1 FROM quote_verifications WHERE quote_id=?').get(id)) {
    return res.status(409).json({ error: '客价已经确认并锁定，不能再次修改；后续价格请在核价中心填写' });
  }
  const status = Object.prototype.hasOwnProperty.call(body, 'status')
    ? (body.status === 'confirmed' ? 'confirmed' : 'pending')
    : (existing?.status === 'confirmed' ? 'confirmed' : 'pending');
  const allowed = new Set((await workshopOptions(req.user.active_factory_code)).map(item => item.code));
  const existingWorkshops = parseJson(existing?.workshops_json, []);
  const requestedWorkshop = typeof body.workshop === 'string' ? body.workshop
    : (Array.isArray(body.workshops) ? body.workshops[0] : (existingWorkshops[0] || ''));
  const workshops = allowed.has(requestedWorkshop) ? [requestedWorkshop] : [];
  const confirmedPrice = !Object.prototype.hasOwnProperty.call(body, 'confirmed_price') ? (existing?.confirmed_price ?? null)
    : (body.confirmed_price === '' || body.confirmed_price == null ? null : Number(body.confirmed_price));
  const confirmedQty = !Object.prototype.hasOwnProperty.call(body, 'confirmed_qty') ? (existing?.confirmed_qty ?? null)
    : (body.confirmed_qty === '' || body.confirmed_qty == null ? null : Math.round(Number(body.confirmed_qty)));
  const note = Object.prototype.hasOwnProperty.call(body, 'note') ? String(body.note || '').trim() : String(existing?.note || '');
  if (confirmedPrice != null && (!Number.isFinite(confirmedPrice) || confirmedPrice < 0)) return res.status(400).json({ error: '确认客价格式不正确' });
  if (confirmedQty != null && (!Number.isFinite(confirmedQty) || confirmedQty < 0)) return res.status(400).json({ error: '确认数量格式不正确' });
  if (status === 'confirmed') {
    const mixedSections = await db.prepare('SELECT * FROM quote_sections WHERE quote_id = ?').all(id);
    try {
      const mixedQuote = await db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
      require('../services/mixedQuotation').calculateMixedQuote(mixedQuote, mixedSections, { strict: true });
    } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  await db.prepare(`
    INSERT INTO quote_customer_confirmations
      (quote_id, status, workshops_json, confirmed_price, confirmed_qty, note, confirmed_by, confirmed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP)
    ON CONFLICT (quote_id) DO UPDATE SET
      status = excluded.status, workshops_json = excluded.workshops_json,
      confirmed_price = excluded.confirmed_price, confirmed_qty = excluded.confirmed_qty,
      note = excluded.note, confirmed_by = excluded.confirmed_by,
      confirmed_at = CASE WHEN excluded.status = 'confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP
  `).run(id, status, JSON.stringify(workshops), confirmedPrice, confirmedQty, note, req.user.name, status);
  if (status === 'confirmed') {
    const quote = await db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
    const sections = await db.prepare(`SELECT s.dept, d.name_cn AS dept_name, s.status, s.payload_json
      FROM quote_sections s JOIN departments d ON d.code=s.dept WHERE s.quote_id=? ORDER BY d.sort_order`).all(id);
    const baseline = {
      quote: { ...quote, confirmed_price: confirmedPrice, confirmed_qty: confirmedQty },
      sections: sections.map(section => ({
        dept: section.dept, dept_name: section.dept_name, status: section.status,
        payload: parseJson(section.payload_json, {}),
      })),
      frozen_at: new Date().toISOString(),
    };
    await db.prepare(`INSERT INTO quote_verifications
      (quote_id, baseline_json, verified_values_json, status, created_by, updated_by)
      VALUES (?, ?, '{}', 'not_started', ?, ?) ON CONFLICT (quote_id) DO NOTHING`)
      .run(id, JSON.stringify(baseline), req.user.name, req.user.name);
  }
  await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, 'sales', ?, 'customer_confirmation', ?)`)
    .run(id, req.user.name, JSON.stringify({ status, workshops, confirmed_price: confirmedPrice, confirmed_qty: confirmedQty }));
  res.json({ ok: true });
}));

router.get('/export/xlsx', async (req, res) => {
  let rows = await loadRows(req.user);
  const customer = String(req.query.customer || '').trim();
  const status = String(req.query.status || '').trim();
  if (customer) rows = rows.filter(row => row.customer === customer);
  if (status) rows = rows.filter(row => row.confirmation.status === status);
  const workshops = await workshopOptions(req.user.active_factory_code);
  rows.forEach(row => { row.workshop_names = Object.fromEntries(workshops.map(w => [w.code, w.name])); });
  const workbook = buildSummaryWorkbook(rows, { customer, status });
  const buffer = await workbook.xlsx.writeBuffer();
  const customerName = customer || '全部客户';
  const filename = encodeURIComponent(`${customerName}_报价汇总_${new Date().toISOString().slice(0, 10)}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
  res.send(Buffer.from(buffer));
});

module.exports = router;
