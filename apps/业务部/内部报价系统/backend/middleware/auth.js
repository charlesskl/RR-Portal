const db = require('../db');

// 缓存权限 1 次/请求；session 存 user_id
function loadUserAndPerms(userId, requestedFactory) {
  const u = db.prepare('SELECT id, username, display_name, dept, role, factory_code, locked_until FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  const rows = db.prepare('SELECT menu, can_view, can_edit, can_review, can_admin FROM user_perms WHERE user_id = ?').all(userId);
  const perms = {};
  for (const r of rows) {
    perms[r.menu] = { can_view: r.can_view, can_edit: r.can_edit, can_review: r.can_review, can_admin: r.can_admin };
  }
  const defaultFactory = u.factory_code || 'qingxi';
  let factories = db.prepare(`
    SELECT f.code, f.name_cn
    FROM user_factories uf JOIN factories f ON f.code = uf.factory_code
    WHERE uf.user_id = ? AND f.active = 1
    ORDER BY f.sort_order
  `).all(userId);
  if (!factories.length) {
    factories = db.prepare('SELECT code, name_cn FROM factories WHERE code = ? AND active = 1').all(defaultFactory);
  }
  const allowedFactories = new Set(factories.map(f => f.code));
  const activeFactory = requestedFactory && allowedFactories.has(requestedFactory)
    ? requestedFactory
    : (allowedFactories.has(defaultFactory) ? defaultFactory : factories[0].code);
  const canSwitchFactory = factories.length > 1;
  const factory = db.prepare('SELECT name_cn FROM factories WHERE code = ?').get(activeFactory);
  return {
    id: u.id, username: u.username, display_name: u.display_name,
    dept: u.dept, role: u.role, factory_code: defaultFactory,
    active_factory_code: activeFactory,
    active_factory_name: factory ? factory.name_cn : activeFactory,
    factories, can_switch_factory: canSwitchFactory,
    locked_until: u.locked_until, perms,
    // 向后兼容字段（旧代码用到 name 的地方）
    name: u.display_name || u.username,
  };
}

function requireAuth(req, res, next) {
  const s = req.session;
  if (!s || !s.user_id) return res.status(401).json({ error: '未登录' });
  const user = loadUserAndPerms(s.user_id, s.factory_code);
  if (!user) { req.session = null; return res.status(401).json({ error: '账号失效' }); }
  // 锁定检查
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    req.session = null;
    return res.status(403).json({ error: '账号已锁定' });
  }
  req.user = user;
  next();
}

// 客户可见范围校验：返回 { status: 200|403|404 }
// admin 跳过；无客户(customer 空)的单仅 admin 可访问；否则该单 customer 必须在用户 user_customers 内
function quoteAccess(user, quoteId) {
  const q = db.prepare('SELECT customer, factory_code FROM quotes WHERE id = ?').get(quoteId);
  if (!q) return { status: 404 };
  if (q.factory_code !== user.active_factory_code) return { status: 403 };
  const isAdmin = user.perms && user.perms['账号管理'] && user.perms['账号管理'].can_admin;
  if (isAdmin) return { status: 200 };
  if (!q.customer) return { status: 403 };
  const ok = db.prepare('SELECT 1 FROM user_customers WHERE user_id = ? AND customer = ?').get(user.id, q.customer);
  return { status: ok ? 200 : 403 };
}

module.exports = { requireAuth, loadUserAndPerms, quoteAccess };
