// 权限检查中间件 / 工具
// req.user.perms 形如 { '业务部': {can_view:1, can_edit:1, ...}, ... }

function hasPerm(user, menu, action) {
  if (!user || !user.perms) return false;
  const p = user.perms[menu];
  if (!p) return false;
  return !!p['can_' + action];
}

function requirePerm(menu, action) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    if (!hasPerm(req.user, menu, action)) {
      return res.status(403).json({ error: `无 ${menu}·${action} 权限` });
    }
    next();
  };
}

module.exports = { hasPerm, requirePerm };
