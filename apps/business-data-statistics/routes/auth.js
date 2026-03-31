const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { getOne, getAll } = require('../db/postgres');
const { authenticate, signToken } = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '请输入用户名和密码' });
  }
  const user = await getOne('SELECT * FROM users WHERE username = ? AND status = ?', [username, 'active']);
  if (!user) {
    return res.status(401).json({ success: false, message: '用户名或密码错误' });
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ success: false, message: '用户名或密码错误' });
  }
  const modules = await getAll('SELECT module_name FROM user_modules WHERE user_id = ?', [user.id]);
  const token = signToken(user);
  res.json({
    success: true,
    token,
    user: {
      id: user.id, username: user.username, name: user.name,
      role: user.role, department: user.department,
      batch_permission: user.batch_permission,
      modules: modules.map(m => m.module_name)
    }
  });
}));

// GET /api/auth/me
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await getOne('SELECT id, username, name, role, department, batch_permission, status FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ success: false, message: '用户不存在' });
  const modules = await getAll('SELECT module_name FROM user_modules WHERE user_id = ?', [req.user.id]);
  res.json({ success: true, ...user, modules: modules.map(m => m.module_name) });
}));

module.exports = router;
