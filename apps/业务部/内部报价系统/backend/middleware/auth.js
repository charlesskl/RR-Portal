const db = require('../db');

// 缓存权限 1 次/请求；session 存 user_id
function loadUserAndPerms(userId) {
  const u = db.prepare('SELECT id, username, display_name, dept, role, locked_until FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  const rows = db.prepare('SELECT menu, can_view, can_edit, can_review, can_admin FROM user_perms WHERE user_id = ?').all(userId);
  const perms = {};
  for (const r of rows) {
    perms[r.menu] = { can_view: r.can_view, can_edit: r.can_edit, can_review: r.can_review, can_admin: r.can_admin };
  }
  return {
    id: u.id, username: u.username, display_name: u.display_name,
    dept: u.dept, role: u.role,
    locked_until: u.locked_until, perms,
    // 向后兼容字段（旧代码用到 name 的地方）
    name: u.display_name || u.username,
  };
}

function requireAuth(req, res, next) {
  const s = req.session;
  if (!s || !s.user_id) return res.status(401).json({ error: '未登录' });
  const user = loadUserAndPerms(s.user_id);
  if (!user) { req.session = null; return res.status(401).json({ error: '账号失效' }); }
  // 锁定检查
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    req.session = null;
    return res.status(403).json({ error: '账号已锁定' });
  }
  req.user = user;
  next();
}

module.exports = { requireAuth, loadUserAndPerms };
