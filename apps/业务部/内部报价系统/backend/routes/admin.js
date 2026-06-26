const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../middleware/perms');
const { MENUS } = require('../permissions/menu_catalog');
const { templateFor } = require('../permissions/role_templates');

const router = express.Router();
router.use(requireAuth);
router.use(requirePerm('账号管理', 'admin'));

// 工具：把角色模板写入 user_perms（覆盖）
function applyTemplate(userId, dept, role) {
  const tpl = templateFor(dept, role);
  db.prepare('DELETE FROM user_perms WHERE user_id = ?').run(userId);
  const ins = db.prepare(`
    INSERT INTO user_perms (user_id, menu, can_view, can_edit, can_review, can_admin)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const p of tpl) {
    ins.run(userId, p.menu, p.can_view, p.can_edit, p.can_review, p.can_admin);
  }
}

// GET /api/admin/users
router.get('/users', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.dept, d.name_cn AS dept_name,
           u.role, u.locked_until, u.login_fails, u.last_login, u.created_at
    FROM users u LEFT JOIN departments d ON d.code = u.dept
    ORDER BY u.id
  `).all();
  const now = new Date();
  const out = rows.map(r => ({ ...r, is_locked: !!(r.locked_until && new Date(r.locked_until) > now) }));
  res.json(out);
});

// POST /api/admin/users  { username, password, display_name, dept, role }
router.post('/users', (req, res) => {
  const { username, password, display_name, dept, role } = req.body || {};
  if (!username || !password || !display_name || !dept || !role) {
    return res.status(400).json({ error: '字段缺失' });
  }
  if (!['staff', 'supervisor', 'admin'].includes(role)) return res.status(400).json({ error: 'role 非法' });
  if (String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  const dept_ok = db.prepare('SELECT 1 FROM departments WHERE code = ?').get(dept);
  if (!dept_ok) return res.status(400).json({ error: '部门不存在' });
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(String(username).trim());
  if (exists) return res.status(409).json({ error: '用户名已存在' });
  try {
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, dept, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(username).trim(), bcrypt.hashSync(String(password), 8),
           String(display_name).trim().slice(0, 32), dept, role);
    applyTemplate(info.lastInsertRowid, dept, role);
    db.prepare(`INSERT INTO audit_log (dept, actor, action, detail) VALUES (?, ?, 'register_user', ?)`)
      .run(dept, req.user.username, username);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/users/:id/reset-password  { password }
router.post('/users/:id/reset-password', (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '不存在' });
  db.prepare('UPDATE users SET password_hash = ?, login_fails = 0, locked_until = NULL WHERE id = ?')
    .run(bcrypt.hashSync(String(password), 8), id);
  db.prepare(`INSERT INTO audit_log (actor, action, detail) VALUES (?, 'reset_password', ?)`)
    .run(req.user.username, u.username);
  res.json({ ok: true });
});

// POST /api/admin/users/:id/lock
router.post('/users/:id/lock', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: '不能锁定自己' });
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '不存在' });
  db.prepare('UPDATE users SET locked_until = ? WHERE id = ?').run('2999-12-31T00:00:00.000Z', id);
  db.prepare(`INSERT INTO audit_log (actor, action, detail) VALUES (?, 'lock_user', ?)`)
    .run(req.user.username, u.username);
  res.json({ ok: true });
});

// POST /api/admin/users/:id/unlock
router.post('/users/:id/unlock', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '不存在' });
  db.prepare('UPDATE users SET locked_until = NULL, login_fails = 0 WHERE id = ?').run(id);
  db.prepare(`INSERT INTO audit_log (actor, action, detail) VALUES (?, 'unlock_user', ?)`)
    .run(req.user.username, u.username);
  res.json({ ok: true });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '不存在' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id); // user_perms 级联
  db.prepare(`INSERT INTO audit_log (actor, action, detail) VALUES (?, 'delete_user', ?)`)
    .run(req.user.username, u.username);
  res.json({ ok: true });
});

// GET /api/admin/customers — 现有所有 distinct 客户
router.get('/customers', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT customer FROM quotes WHERE customer IS NOT NULL AND customer != \'\' ORDER BY customer').all();
  res.json({ customers: rows.map(r => r.customer) });
});

// GET /api/admin/users/:id/customers — 该用户可见客户
router.get('/users/:id/customers', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '不存在' });
  const rows = db.prepare('SELECT customer FROM user_customers WHERE user_id = ? ORDER BY customer').all(id);
  res.json({ customers: rows.map(r => r.customer) });
});

// PUT /api/admin/users/:id/customers  { customers: [...] }
router.put('/users/:id/customers', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '不存在' });
  const list = Array.isArray(req.body && req.body.customers) ? req.body.customers : [];
  const clean = [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))];
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM user_customers WHERE user_id = ?').run(id);
    const ins = db.prepare('INSERT INTO user_customers (user_id, customer) VALUES (?, ?)');
    for (const c of clean) ins.run(id, c);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: e.message });
  }
  db.prepare(`INSERT INTO audit_log (actor, action, detail) VALUES (?, 'save_user_customers', ?)`)
    .run(req.user.username, u.username + ' → ' + clean.length + ' 客户');
  res.json({ ok: true });
});

// GET /api/admin/menus  — 菜单目录（前端权限矩阵渲染用，下期）
router.get('/menus', (req, res) => {
  res.json({ menus: MENUS });
});

// GET /api/admin/users/:id/perms  — 当前权限矩阵（14 个菜单全列出）
router.get('/users/:id/perms', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '不存在' });
  const rows = db.prepare('SELECT menu, can_view, can_edit, can_review, can_admin FROM user_perms WHERE user_id = ?').all(id);
  const map = {};
  for (const r of rows) map[r.menu] = r;
  const out = MENUS.map(m => ({
    menu: m.key,
    group: m.group,
    can_view:   map[m.key] ? map[m.key].can_view   : 0,
    can_edit:   map[m.key] ? map[m.key].can_edit   : 0,
    can_review: map[m.key] ? map[m.key].can_review : 0,
    can_admin:  map[m.key] ? map[m.key].can_admin  : 0,
  }));
  res.json({ user_id: id, username: u.username, perms: out });
});

// PUT /api/admin/users/:id/perms  { perms: [{menu, can_view, can_edit, can_review, can_admin}] }
router.put('/users/:id/perms', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '不存在' });
  const list = (req.body && req.body.perms) || [];
  if (!Array.isArray(list)) return res.status(400).json({ error: 'perms 必须是数组' });

  // 自我保护：不能去掉自己「账号管理·管理」位
  if (id === req.user.id) {
    const adminRow = list.find(r => r.menu === '账号管理');
    if (!adminRow || !adminRow.can_admin) {
      return res.status(400).json({ error: '不能去掉自己「账号管理·管理」权限' });
    }
  }

  const valid = new Set(MENUS.map(m => m.key));
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM user_perms WHERE user_id = ?').run(id);
    const ins = db.prepare(`
      INSERT INTO user_perms (user_id, menu, can_view, can_edit, can_review, can_admin)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const r of list) {
      if (!valid.has(r.menu)) continue;
      const v = r.can_view ? 1 : 0;
      const e = r.can_edit ? 1 : 0;
      const rv = r.can_review ? 1 : 0;
      const ad = r.can_admin ? 1 : 0;
      if (v || e || rv || ad) ins.run(id, r.menu, v, e, rv, ad);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }
  db.prepare(`INSERT INTO audit_log (actor, action, detail) VALUES (?, 'save_user_perms', ?)`)
    .run(req.user.username, u.username);
  res.json({ ok: true });
});

// 重新套角色模板（部门/角色变了之后）
// POST /api/admin/users/:id/apply-template
router.post('/users/:id/apply-template', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT dept, role, username FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '不存在' });
  applyTemplate(id, u.dept, u.role);
  db.prepare(`INSERT INTO audit_log (actor, action, detail) VALUES (?, 'apply_template', ?)`)
    .run(req.user.username, u.username);
  res.json({ ok: true });
});

module.exports = router;
