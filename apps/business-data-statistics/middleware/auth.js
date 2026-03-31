const jwt = require('jsonwebtoken');
const { getOne, getAll } = require('../db/postgres');

const JWT_SECRET = process.env.JWT_SECRET || 'production-system-secret-key';
const JWT_EXPIRES = '24h';

// JWT 验证中间件
function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: '未登录' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: '登录已过期' });
  }
}

// 角色检查：仅统计组（系统设置的写操作）
function requireStats(req, res, next) {
  if (req.user.role !== 'stats') {
    return res.status(403).json({ success: false, message: '权限不足' });
  }
  next();
}

// 角色检查：统计组或管理层（系统设置的读操作）
function requireStatsOrManagement(req, res, next) {
  if (req.user.role === 'stats' || req.user.role === 'management') return next();
  return res.status(403).json({ success: false, message: '权限不足' });
}

// 模块权限检查
function modulePermission(moduleName) {
  return async (req, res, next) => {
    if (req.user.role === 'stats' || req.user.role === 'management') return next();
    const mod = await getOne(
      'SELECT 1 FROM user_modules WHERE user_id = ? AND module_name = ?',
      [req.user.id, moduleName]
    );
    if (!mod) return res.status(403).json({ success: false, message: '无模块权限' });
    next();
  };
}

// 数据锁定检查（统计组和管理层不受锁定限制）
async function checkDataLock(req, res, next) {
  if (req.user.role === 'stats' || req.user.role === 'management') return next();
  const { dept } = req.params;
  const recordDate = req.body.record_date || req.query.record_date;
  if (recordDate) {
    const month = recordDate.substring(0, 7);
    const lock = await getOne(
      'SELECT 1 FROM data_locks WHERE department = ? AND lock_month = ?',
      [dept, month]
    );
    if (lock) {
      return res.status(403).json({ success: false, message: `${month} 数据已锁定` });
    }
  }
  next();
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role, department: user.department },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

module.exports = { authenticate, requireStats, requireStatsOrManagement, modulePermission, checkDataLock, signToken, JWT_SECRET };
