const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { getAll, getOne, query } = require('../db/postgres');
const { authenticate, requireStats, requireStatsOrManagement } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const asyncHandler = require('../utils/async-handler');

// GET /api/users（统计组+管理层可查看）
router.get('/', authenticate, requireStatsOrManagement, asyncHandler(async (req, res) => {
  const users = await getAll(`
    SELECT u.*, array_agg(um.module_name) FILTER (WHERE um.module_name IS NOT NULL) as modules
    FROM users u LEFT JOIN user_modules um ON u.id = um.user_id
    GROUP BY u.id ORDER BY u.id
  `);
  users.forEach(u => { delete u.password_hash; });
  res.json({ success: true, data: users });
}));

// POST /api/users — 保留手动 try/catch：需要特殊处理唯一约束冲突 (err.code === '23505')
router.post('/', authenticate, requireStats, async (req, res) => {
  try {
    const { username, name, password, role, department, batch_permission } = req.body;
    if (!username || !name || !password) {
      return res.status(400).json({ success: false, message: '请填写必填项' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (username, password_hash, name, role, department, batch_permission)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id, username, name, role, department, batch_permission, status, created_at`,
      [username, hash, name, role || 'entry', department || null, batch_permission || false]
    );
    await logAction(req.user.id, req.user.name, 'create_user', 'users', result.rows[0].id, null, result.rows[0]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: '用户名已存在' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/users/:id
router.put('/:id', authenticate, requireStats, asyncHandler(async (req, res) => {
  const { name, role, department, batch_permission } = req.body;
  const old = await getOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ success: false, message: '用户不存在' });

  await query(
    'UPDATE users SET name = ?, role = ?, department = ?, batch_permission = ?, updated_at = NOW() WHERE id = ?',
    [name || old.name, role || old.role, department, batch_permission ?? old.batch_permission, req.params.id]
  );
  const updated = await getOne('SELECT id, username, name, role, department, batch_permission, status FROM users WHERE id = ?', [req.params.id]);
  await logAction(req.user.id, req.user.name, 'update_user', 'users', req.params.id, old, updated);
  res.json({ success: true, data: updated });
}));

// PUT /api/users/:id/status
router.put('/:id/status', authenticate, requireStats, asyncHandler(async (req, res) => {
  const { status } = req.body;
  await query('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?', [status, req.params.id]);
  res.json({ success: true });
}));

// PUT /api/users/:id/password
router.put('/:id/password', authenticate, requireStats, asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, message: '请输入新密码' });
  const hash = await bcrypt.hash(password, 10);
  await query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [hash, req.params.id]);
  res.json({ success: true });
}));

// GET /api/users/:id/modules
router.get('/:id/modules', authenticate, requireStats, asyncHandler(async (req, res) => {
  const modules = await getAll('SELECT module_name FROM user_modules WHERE user_id = ?', [req.params.id]);
  res.json({ success: true, data: modules.map(m => m.module_name) });
}));

// PUT /api/users/:id/modules
router.put('/:id/modules', authenticate, requireStats, asyncHandler(async (req, res) => {
  const { modules } = req.body;
  await query('DELETE FROM user_modules WHERE user_id = ?', [req.params.id]);
  const mods = modules || [];
  if (mods.length > 0) {
    // 批量插入：一条 SQL 插入所有模块，避免 N+1 循环
    const placeholders = mods.map((_, i) => `(?, ?)`).join(', ');
    const values = mods.flatMap(mod => [req.params.id, mod]);
    await query(`INSERT INTO user_modules (user_id, module_name) VALUES ${placeholders}`, values);
  }
  res.json({ success: true });
}));

// DELETE /api/users/:id（仅统计组，不能删除自己）
router.delete('/:id', authenticate, requireStats, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.user.id) {
    return res.status(400).json({ success: false, message: '不能删除当前登录的用户' });
  }
  const user = await getOne('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ success: false, message: '用户不存在' });

  // 先删除模块权限关联，再删除用户
  await query('DELETE FROM user_modules WHERE user_id = ?', [userId]);
  await query('DELETE FROM users WHERE id = ?', [userId]);
  await logAction(req.user.id, req.user.name, 'delete_user', 'users', userId, user, null);
  res.json({ success: true });
}));

module.exports = router;
