const express = require('express');
const router = express.Router();
const { getAll } = require('../db/postgres');
const { authenticate, requireStatsOrManagement } = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');

// 统计组+管理层可查看
router.get('/', authenticate, requireStatsOrManagement, asyncHandler(async (req, res) => {
  const { start_date, end_date, user_id, action, limit: lim } = req.query;
  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];
  if (start_date) { sql += ' AND created_at >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND created_at <= ?'; params.push(end_date + 'T23:59:59Z'); }
  if (user_id) { sql += ' AND user_id = ?'; params.push(user_id); }
  if (action) { sql += ' AND action = ?'; params.push(action); }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(parseInt(lim) || 200);
  res.json({ success: true, data: await getAll(sql, params) });
}));

module.exports = router;
