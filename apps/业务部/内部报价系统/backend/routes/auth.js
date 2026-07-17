const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { loadUserAndPerms, requireAuth } = require('../middleware/auth');

const router = express.Router();

const MAX_FAILS = 5;
const LOCK_MIN = 15;

// POST /api/auth/login  { username, password }
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' });
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!u) return res.status(401).json({ error: '用户名或密码错误' });

  // 锁定检查
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    return res.status(403).json({ error: '账号已锁定，请联系管理员或稍后重试' });
  }
  if (!bcrypt.compareSync(String(password), u.password_hash)) {
    const fails = (u.login_fails || 0) + 1;
    let lockUntil = null;
    if (fails >= MAX_FAILS) {
      lockUntil = new Date(Date.now() + LOCK_MIN * 60 * 1000).toISOString();
    }
    db.prepare('UPDATE users SET login_fails = ?, locked_until = ? WHERE id = ?')
      .run(fails, lockUntil, u.id);
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  // 成功
  db.prepare('UPDATE users SET login_fails = 0, last_login = datetime(\'now\') WHERE id = ?').run(u.id);
  req.session.user_id = u.id;
  req.session.factory_code = u.factory_code || 'qingxi';

  db.prepare(`INSERT INTO audit_log (dept, actor, action, detail) VALUES (?, ?, 'login', ?)`)
    .run(u.dept, u.username, u.role);

  const me = loadUserAndPerms(u.id, req.session.factory_code);
  const deptRow = db.prepare('SELECT name_cn FROM departments WHERE code = ?').get(u.dept);
  res.json({
    id: me.id, username: me.username, display_name: me.display_name,
    dept: me.dept, dept_name: deptRow ? deptRow.name_cn : me.dept,
    role: me.role, perms: me.perms,
    factory_code: me.factory_code, active_factory_code: me.active_factory_code,
    active_factory_name: me.active_factory_name, factories: me.factories,
    can_switch_factory: me.can_switch_factory,
  });
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const s = req.session;
  if (!s || !s.user_id) return res.status(401).json({ error: '未登录' });
  const me = loadUserAndPerms(s.user_id, s.factory_code);
  if (!me) { req.session = null; return res.status(401).json({ error: '账号失效' }); }
  if (me.locked_until && new Date(me.locked_until) > new Date()) {
    req.session = null;
    return res.status(403).json({ error: '账号已锁定' });
  }
  const deptRow = db.prepare('SELECT name_cn FROM departments WHERE code = ?').get(me.dept);
  res.json({
    id: me.id, username: me.username, display_name: me.display_name,
    dept: me.dept, dept_name: deptRow ? deptRow.name_cn : me.dept,
    role: me.role, perms: me.perms,
    factory_code: me.factory_code, active_factory_code: me.active_factory_code,
    active_factory_name: me.active_factory_name, factories: me.factories,
    can_switch_factory: me.can_switch_factory,
  });
});

// POST /api/auth/factory { factory_code } — 管理员切换当前活动厂区
router.post('/factory', requireAuth, (req, res) => {
  if (!req.user.can_switch_factory) return res.status(403).json({ error: '当前账号不能切换厂区' });
  const factoryCode = String((req.body && req.body.factory_code) || '').trim();
  const factory = (req.user.factories || []).find(f => f.code === factoryCode);
  if (!factory) return res.status(400).json({ error: '厂区不存在' });
  req.session.factory_code = factory.code;
  res.json({ ok: true, factory_code: factory.code, factory_name: factory.name_cn });
});

// POST /api/auth/change-password  { current, new }
router.post('/change-password', (req, res) => {
  const s = req.session;
  if (!s || !s.user_id) return res.status(401).json({ error: '未登录' });
  const { current, new: newPwd } = req.body || {};
  if (!current || !newPwd) return res.status(400).json({ error: '缺少 current 或 new' });
  if (String(newPwd).length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!u) return res.status(404).json({ error: '账号不存在' });
  if (!bcrypt.compareSync(String(current), u.password_hash)) {
    return res.status(401).json({ error: '当前密码错误' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(String(newPwd), 8), u.id);
  res.json({ ok: true });
});

module.exports = router;
