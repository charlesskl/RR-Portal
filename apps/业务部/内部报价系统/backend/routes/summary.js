const express = require('express');
const db = require('../db');
const { requireAuth, quoteAccess } = require('../middleware/auth');
const { WORKSHOPS, QUOTE_COMPONENTS, SUMMARY_COLUMNS, calculateSummaryValues, buildQuoteSummary, buildSummaryWorkbook, parseJson } = require('../services/quoteSummary');

const router = express.Router();
router.use(requireAuth);

function isAdmin(user) {
  return user.role === 'admin' || Boolean(user.perms?.['账号管理']?.can_admin);
}

async function accessibleQuoteRows(user) {
  if (isAdmin(user)) {
    return db.prepare('SELECT * FROM quotes WHERE factory_code = ? AND deleted_at IS NULL ORDER BY customer, id DESC')
      .all(user.active_factory_code);
  }
  const customers = (await db.prepare('SELECT customer FROM user_customers WHERE user_id = ?').all(user.id))
    .map(row => row.customer);
  if (!customers.length) return [];
  const placeholders = customers.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM quotes WHERE factory_code = ? AND deleted_at IS NULL AND customer IN (${placeholders}) ORDER BY customer, id DESC`)
    .all(user.active_factory_code, ...customers);
}

async function loadRows(user) {
  const quotes = await accessibleQuoteRows(user);
  const result = [];
  const allowedWorkshops = new Set(WORKSHOPS.map(([code]) => code));
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

router.get('/', async (req, res) => {
  const rows = await loadRows(req.user);
  res.json({
    rows,
    workshops: WORKSHOPS.map(([code, name]) => ({ code, name })),
    components: QUOTE_COMPONENTS.map(([code, name]) => ({ code, name })),
    summary_columns: SUMMARY_COLUMNS.map(([code, name, format]) => ({ code, name, format })),
    can_edit: req.user.dept === 'sales' || isAdmin(req.user),
  });
});

router.put('/:id/confirmation', async (req, res) => {
  if (req.user.dept !== 'sales' && !isAdmin(req.user)) {
    return res.status(403).json({ error: '只有业务或超级管理员可确认客价和分派车间' });
  }
  const id = Number(req.params.id);
  const access = await quoteAccess(req.user, id);
  if (access.status !== 200) return res.status(access.status).json({ error: access.status === 404 ? '报价单不存在' : '无权操作该报价单' });
  const body = req.body || {};
  const existing = await db.prepare('SELECT * FROM quote_customer_confirmations WHERE quote_id = ?').get(id);
  const status = Object.prototype.hasOwnProperty.call(body, 'status')
    ? (body.status === 'confirmed' ? 'confirmed' : 'pending')
    : (existing?.status === 'confirmed' ? 'confirmed' : 'pending');
  const allowed = new Set(WORKSHOPS.map(([code]) => code));
  const existingWorkshops = parseJson(existing?.workshops_json, []);
  const requestedWorkshop = typeof body.workshop === 'string' ? body.workshop
    : (Array.isArray(body.workshops) ? body.workshops[0] : (existingWorkshops[0] || ''));
  const workshops = allowed.has(requestedWorkshop) ? [requestedWorkshop] : [];
  const confirmedPrice = !Object.prototype.hasOwnProperty.call(body, 'confirmed_price') ? existing?.confirmed_price
    : (body.confirmed_price === '' || body.confirmed_price == null ? null : Number(body.confirmed_price));
  const confirmedQty = !Object.prototype.hasOwnProperty.call(body, 'confirmed_qty') ? existing?.confirmed_qty
    : (body.confirmed_qty === '' || body.confirmed_qty == null ? null : Math.round(Number(body.confirmed_qty)));
  const note = Object.prototype.hasOwnProperty.call(body, 'note') ? String(body.note || '').trim() : String(existing?.note || '');
  if (confirmedPrice != null && (!Number.isFinite(confirmedPrice) || confirmedPrice < 0)) return res.status(400).json({ error: '确认客价格式不正确' });
  if (confirmedQty != null && (!Number.isFinite(confirmedQty) || confirmedQty < 0)) return res.status(400).json({ error: '确认数量格式不正确' });
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
  await db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, 'sales', ?, 'customer_confirmation', ?)`)
    .run(id, req.user.name, JSON.stringify({ status, workshops, confirmed_price: confirmedPrice, confirmed_qty: confirmedQty }));
  res.json({ ok: true });
});

router.get('/export/xlsx', async (req, res) => {
  let rows = await loadRows(req.user);
  const customer = String(req.query.customer || '').trim();
  const status = String(req.query.status || '').trim();
  if (customer) rows = rows.filter(row => row.customer === customer);
  if (status) rows = rows.filter(row => row.confirmation.status === status);
  const workbook = buildSummaryWorkbook(rows, { customer, status });
  const buffer = await workbook.xlsx.writeBuffer();
  const customerName = customer || '全部客户';
  const filename = encodeURIComponent(`${customerName}_报价汇总_${new Date().toISOString().slice(0, 10)}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
  res.send(Buffer.from(buffer));
});

module.exports = router;
