const express = require('express');
const db = require('../db');
const { requireAuth, quoteAccess } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DEPT_CODES = ['sales', 'engineering', 'electronic', 'molding', 'painting', 'slush', 'sewing', 'assembly'];

// GET /api/quotes  报价单列表（按 user_customers 过滤；admin 看全部）
router.get('/', (req, res) => {
  const isAdmin = req.user.perms && req.user.perms['账号管理'] && req.user.perms['账号管理'].can_admin;
  const totalDepts = db.prepare('SELECT COUNT(*) AS n FROM departments').get().n;

  let rows;
  if (isAdmin) {
    rows = db.prepare(`
      SELECT q.*,
        (SELECT COUNT(*) FROM quote_sections s WHERE s.quote_id=q.id AND s.status='approved') AS approved_count
      FROM quotes q
      ORDER BY q.id DESC
    `).all();
  } else {
    const customers = db.prepare('SELECT customer FROM user_customers WHERE user_id = ?').all(req.user.id).map(r => r.customer);
    if (customers.length === 0) {
      return res.status(403).json({ error: '请联系管理员配置可见客户' });
    }
    const placeholders = customers.map(() => '?').join(',');
    rows = db.prepare(`
      SELECT q.*,
        (SELECT COUNT(*) FROM quote_sections s WHERE s.quote_id=q.id AND s.status='approved') AS approved_count
      FROM quotes q
      WHERE q.customer IN (${placeholders})
      ORDER BY q.id DESC
    `).all(...customers);
  }
  res.json(rows.map(r => ({ ...r, total_depts: totalDepts })));
});

// POST /api/quotes  仅业务可建
router.post('/', (req, res) => {
  if (req.user.dept !== 'sales') return res.status(403).json({ error: '只有业务可以创建报价单' });
  const { quote_no, product_name, customer, qty, version } = req.body || {};
  if (!quote_no || !product_name) return res.status(400).json({ error: '缺少 quote_no 或 product_name' });

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO quotes (quote_no, product_name, customer, qty, version, created_by_dept, created_by_name)
      VALUES (?, ?, ?, ?, ?, 'sales', ?)
    `).run(quote_no, product_name, customer || null, qty || null, version || null, req.user.name);
    const id = info.lastInsertRowid;
    const ins = db.prepare(`INSERT INTO quote_sections (quote_id, dept) VALUES (?, ?)`);
    for (const d of DEPT_CODES) ins.run(id, d);
    db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action) VALUES (?, 'sales', ?, 'create')`)
      .run(id, req.user.name);
    return id;
  });

  try {
    const id = tx();
    res.json({ id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      const _exist = db.prepare('SELECT customer FROM quotes WHERE quote_no = ?').get(quote_no);
      const _cust = _exist && _exist.customer ? `客户「${_exist.customer}」` : '一张无客户的单';
      return res.status(409).json({ error: `货号「${quote_no}」已被占用（在${_cust}名下），请换一个货号` });
    }
    throw e;
  }
});

// POST /api/quotes/:id/clone  复制一张报价单（含 payload，状态全 empty）
router.post('/:id/clone', (req, res) => {
  if (req.user.dept !== 'sales' && req.user.role !== 'admin') return res.status(403).json({ error: '只有业务或超级管理员可以复制报价单' });
  const srcId = Number(req.params.id);
  const { quote_no, product_name, customer, qty, version } = req.body || {};
  if (!quote_no) return res.status(400).json({ error: '缺少 quote_no' });
  const src = db.prepare('SELECT * FROM quotes WHERE id = ?').get(srcId);
  if (!src) return res.status(404).json({ error: '源报价单不存在' });

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO quotes (quote_no, product_name, customer, qty, version, created_by_dept, created_by_name)
      VALUES (?, ?, ?, ?, ?, 'sales', ?)
    `).run(
      quote_no,
      product_name || src.product_name,
      customer != null ? customer : src.customer,
      qty != null ? qty : src.qty,
      version != null ? version : src.version,
      req.user.name,
    );
    const newId = info.lastInsertRowid;
    // 复制 7 个 section 的 payload_json，状态 empty
    const srcSecs = db.prepare('SELECT dept, payload_json FROM quote_sections WHERE quote_id = ?').all(srcId);
    const ins = db.prepare(`INSERT INTO quote_sections (quote_id, dept, payload_json, status) VALUES (?, ?, ?, 'empty')`);
    for (const s of srcSecs) ins.run(newId, s.dept, s.payload_json || '{}');
    db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, 'sales', ?, 'clone', ?)`)
      .run(newId, req.user.name, `from #${srcId} (${src.quote_no})`);
    return newId;
  });

  try {
    const id = tx();
    res.json({ id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      const _exist = db.prepare('SELECT customer FROM quotes WHERE quote_no = ?').get(quote_no);
      const _cust = _exist && _exist.customer ? `客户「${_exist.customer}」` : '一张无客户的单';
      return res.status(409).json({ error: `货号「${quote_no}」已被占用（在${_cust}名下），请换一个货号` });
    }
    throw e;
  }
});

// DELETE /api/quotes/:id  删除报价单（连带 section 级联删除）— 仅业务/超级管理员
router.delete('/:id', (req, res) => {
  if (req.user.dept !== 'sales' && req.user.role !== 'admin') {
    return res.status(403).json({ error: '只有业务或超级管理员可以删除报价单' });
  }
  const id = Number(req.params.id);
  const acc = quoteAccess(req.user, id);
  if (acc.status !== 200) return res.status(acc.status).json({ error: acc.status === 404 ? '报价单不存在' : '无权删除该客户的报价单' });
  const q = db.prepare('SELECT quote_no FROM quotes WHERE id = ?').get(id);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM audit_log WHERE quote_id = ?').run(id);
    db.prepare('DELETE FROM quotes WHERE id = ?').run(id);  // quote_sections 经 ON DELETE CASCADE 一并删除
  });
  tx();
  res.json({ ok: true, deleted: id, quote_no: q ? q.quote_no : null });
});

// PUT /api/quotes/:id/header  修改表头（产品名/客户/数量）— 业务+工程可改
router.put('/:id/header', (req, res) => {
  if (!['sales', 'engineering'].includes(req.user.dept)) {
    return res.status(403).json({ error: '只有业务或工程可改表头' });
  }
  const id = Number(req.params.id);
  const acc = quoteAccess(req.user, id);
  if (acc.status !== 200) return res.status(acc.status).json({ error: acc.status === 404 ? '不存在' : '无权修改该客户的报价单' });
  const { product_name, customer, qty, version } = req.body || {};
  const fields = []; const vals = [];
  if (product_name !== undefined) { fields.push('product_name = ?'); vals.push(product_name); }
  if (customer !== undefined)     { fields.push('customer = ?');     vals.push(customer); }
  if (qty !== undefined)          { fields.push('qty = ?');          vals.push(qty); }
  if (version !== undefined)      { fields.push('version = ?');      vals.push(version); }
  if (!fields.length) return res.json({ ok: true });
  vals.push(id);
  db.prepare(`UPDATE quotes SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, ?, ?, 'edit_header', ?)`)
    .run(id, req.user.dept, req.user.name, JSON.stringify(req.body || {}));
  res.json({ ok: true });
});

// GET /api/quotes/:id  报价单详情 + 所有 section（按可见性过滤）
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!quote) return res.status(404).json({ error: '不存在' });
  // 客户范围检查（admin 跳过；无客户单仅 admin）
  const acc = quoteAccess(req.user, id);
  if (acc.status !== 200) return res.status(acc.status).json({ error: acc.status === 404 ? '不存在' : '无权查看该客户的报价单' });

  // 浏览记录：同一用户 5 分钟内重复打开 不重复记
  const last = db.prepare(`
    SELECT at FROM audit_log
    WHERE quote_id = ? AND action = 'view' AND actor = ?
    ORDER BY id DESC LIMIT 1
  `).get(id, req.user.username || req.user.name);
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  if (!last || (last.at && last.at < fiveMinAgo)) {
    db.prepare(`INSERT INTO audit_log (quote_id, dept, actor, action, detail) VALUES (?, ?, ?, 'view', ?)`)
      .run(id, req.user.dept, req.user.username || req.user.name, req.user.display_name || null);
  }

  const sections = db.prepare(`
    SELECT s.*, d.name_cn AS dept_name, d.sort_order
    FROM quote_sections s JOIN departments d ON d.code = s.dept
    WHERE s.quote_id = ?
    ORDER BY d.sort_order
  `).all(id);

  // 业务/工程：可看所有部门 section（包括未审核的），因为他们可以操作所有
  // 其他部门：只能看自己 section
  const canSeeAll = req.user.dept === 'sales' || req.user.dept === 'engineering';
  const filtered = sections.map(s => {
    const own = s.dept === req.user.dept;
    const visible = own || canSeeAll;
    if (visible) return s;
    // 其他部门未授予查看 → 仅暴露状态字段
    return {
      id: s.id, quote_id: s.quote_id, dept: s.dept, dept_name: s.dept_name, sort_order: s.sort_order,
      status: s.status, reviewed_at: s.reviewed_at, filled_at: s.filled_at,
      payload_json: null,
    };
  });

  // 工程模具摘要：露给所有部门（用于啤机/喷油/装配等做参考行，即使工程尚未审核）
  let engineering_molds = [];
  const engSection = sections.find(s => s.dept === 'engineering');
  if (engSection && engSection.payload_json) {
    try {
      const p = JSON.parse(engSection.payload_json);
      engineering_molds = (p.molds || []).map(m => ({
        mold_no: m.mold_no || '', name: m.name || '', cavity: m.cavity || '',
        sets: m.sets ?? 1, material: m.material || '', color: m.color || '',
        weight_g: m.weight_g ?? null, cycle_sec: m.cycle_sec ?? null,
      }));
    } catch {}
  }

  res.json({ quote, sections: filtered, engineering_molds });
});

// GET /api/quotes/:id/audit-log  返回该报价单全部动作时间线（最新在前）
router.get('/:id/audit-log', (req, res) => {
  const id = Number(req.params.id);
  const acc = quoteAccess(req.user, id);
  if (acc.status !== 200) return res.status(acc.status).json({ error: acc.status === 404 ? '不存在' : '无权查看该客户的报价单' });
  const rows = db.prepare(`
    SELECT al.*, d.name_cn AS dept_name
    FROM audit_log al
    LEFT JOIN departments d ON d.code = al.dept
    WHERE al.quote_id = ?
    ORDER BY al.id DESC
    LIMIT 500
  `).all(id);
  res.json(rows);
});

module.exports = router;
