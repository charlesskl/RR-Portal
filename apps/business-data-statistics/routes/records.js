const express = require('express');
const router = express.Router();
const { getAll, getOne, query } = require('../db/postgres');
const { authenticate, modulePermission, checkDataLock } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const { DEPT_CONFIG, getAllInputFields } = require('../modules');
const { calculateRecord } = require('../modules/balance/calc');
const asyncHandler = require('../utils/async-handler');

// 验证部门参数
function validateDept(req, res, next) {
  const { dept } = req.params;
  if (!DEPT_CONFIG[dept]) {
    return res.status(400).json({ success: false, message: '无效部门' });
  }
  next();
}

// GET /api/:dept/records
router.get('/:dept/records', authenticate, validateDept, asyncHandler(async (req, res) => {
  const { dept } = req.params;
  const config = DEPT_CONFIG[dept];
  const { start_date, end_date, workshop_id } = req.query;

  let sql = `SELECT r.*, w.name as workshop_name, w.region, w.sort_order as workshop_sort_order
             FROM ${config.tableName} r
             LEFT JOIN workshops w ON r.workshop_id = w.id
             WHERE 1=1`;
  const params = [];

  if (start_date) { sql += ` AND r.record_date >= ?`; params.push(start_date); }
  if (end_date) { sql += ` AND r.record_date <= ?`; params.push(end_date); }
  if (workshop_id) { sql += ` AND r.workshop_id = ?`; params.push(workshop_id); }

  sql += ' ORDER BY r.record_date ASC, w.sort_order ASC, r.id ASC';
  const records = await getAll(sql, params);
  res.json({ success: true, data: records });
}));

// POST /api/:dept/records
router.post('/:dept/records', authenticate, modulePermission('balance'), validateDept, checkDataLock, asyncHandler(async (req, res) => {
  const { dept } = req.params;
  const config = DEPT_CONFIG[dept];
  const inputFields = getAllInputFields(dept);
  const records = Array.isArray(req.body) ? req.body : [req.body];
  const inserted = [];

  for (const raw of records) {
    const calculated = await calculateRecord(dept, raw);
    const allFields = [...inputFields, ...config.uniqueCalcFields, 'balance', 'balance_ratio',
                       'record_date', 'workshop_id', 'created_by', 'updated_by'];
    calculated.created_by = req.user.id;
    calculated.updated_by = req.user.id;

    const validFields = allFields.filter(f => calculated[f] !== undefined);
    const values = validFields.map(f => calculated[f]);
    const placeholders = validFields.map(() => '?').join(', ');

    const result = await query(
      `INSERT INTO ${config.tableName} (${validFields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    inserted.push(result.rows[0]);
    await logAction(req.user.id, req.user.name, 'create', config.tableName, result.rows[0].id, null, result.rows[0]);
  }

  res.json({ success: true, data: inserted.length === 1 ? inserted[0] : inserted });
}));

// PUT /api/:dept/records/:id
router.put('/:dept/records/:id', authenticate, modulePermission('balance'), validateDept, checkDataLock, asyncHandler(async (req, res) => {
  const { dept, id } = req.params;
  const config = DEPT_CONFIG[dept];
  const old = await getOne(`SELECT * FROM ${config.tableName} WHERE id = ?`, [id]);
  if (!old) return res.status(404).json({ success: false, message: '记录不存在' });

  const merged = { ...old, ...req.body };
  const calculated = await calculateRecord(dept, merged);
  calculated.updated_by = req.user.id;
  calculated.updated_at = new Date().toISOString();

  const inputFields = getAllInputFields(dept);
  const allUpdatable = [...inputFields, ...config.uniqueCalcFields, 'balance', 'balance_ratio',
                        'record_date', 'workshop_id', 'updated_by', 'updated_at'];
  const setClauses = allUpdatable.filter(f => calculated[f] !== undefined).map(f => `${f} = ?`);
  const values = allUpdatable.filter(f => calculated[f] !== undefined).map(f => calculated[f]);
  values.push(id);

  await query(`UPDATE ${config.tableName} SET ${setClauses.join(', ')} WHERE id = ?`, values);
  const updated = await getOne(`SELECT * FROM ${config.tableName} WHERE id = ?`, [id]);
  await logAction(req.user.id, req.user.name, 'update', config.tableName, id, old, updated);
  res.json({ success: true, data: updated });
}));

// DELETE /api/:dept/records/batch（必须在 /:id 之前注册，否则 "batch" 会被匹配为 :id）
router.delete('/:dept/records/batch', authenticate, modulePermission('balance'), validateDept, asyncHandler(async (req, res) => {
  const { dept } = req.params;
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ success: false, message: '请选择记录' });

  if (req.user.role !== 'stats' && !req.user.batch_permission) {
    return res.status(403).json({ success: false, message: '无批量删除权限' });
  }

  const config = DEPT_CONFIG[dept];
  const placeholders = ids.map(() => '?').join(', ');
  await query(`DELETE FROM ${config.tableName} WHERE id IN (${placeholders})`, ids);
  await logAction(req.user.id, req.user.name, 'batch_delete', config.tableName, null, { ids }, null);
  res.json({ success: true, deleted: ids.length });
}));

// DELETE /api/:dept/records/:id
router.delete('/:dept/records/:id', authenticate, modulePermission('balance'), validateDept, checkDataLock, asyncHandler(async (req, res) => {
  const { dept, id } = req.params;
  const config = DEPT_CONFIG[dept];
  const old = await getOne(`SELECT * FROM ${config.tableName} WHERE id = ?`, [id]);
  if (!old) return res.status(404).json({ success: false, message: '记录不存在' });

  await query(`DELETE FROM ${config.tableName} WHERE id = ?`, [id]);
  await logAction(req.user.id, req.user.name, 'delete', config.tableName, id, old, null);
  res.json({ success: true });
}));

// GET /api/:dept/summary
router.get('/:dept/summary', authenticate, validateDept, asyncHandler(async (req, res) => {
  const { dept } = req.params;
  const config = DEPT_CONFIG[dept];
  const { start_date, end_date } = req.query;

  // 从 DEPT_CONFIG 获取部门独有字段，动态生成 SUM 子句
  const uniqueInputFields = config.uniqueInputFields || [];
  const uniqueExpenseFields = config.uniqueExpenseFields || [];
  // 合并独有输入字段和独有费用字段（去重）
  const allUniqueFields = [...new Set([...uniqueInputFields, ...uniqueExpenseFields])];
  const uniqueSumClauses = allUniqueFields
    .map(field => `SUM(r.${field}) as ${field}`)
    .join(',\n             ');

  let sql = `SELECT w.name as workshop_name, w.region, w.id as workshop_id,
             SUM(r.supervisor_count) as supervisor_count,
             SUM(r.worker_count) as worker_count,
             SUM(r.daily_output) as daily_output,
             SUM(r.worker_wage) as worker_wage,
             SUM(r.supervisor_wage) as supervisor_wage,
             SUM(r.rent) as rent,
             SUM(r.utility_fee) as utility_fee,
             SUM(r.tool_investment) as tool_investment,
             SUM(r.equipment) as equipment,
             SUM(r.renovation) as renovation,
             SUM(r.misc_fee) as misc_fee,
             SUM(r.shipping_fee) as shipping_fee,
             SUM(r.social_insurance) as social_insurance,
             SUM(r.tax) as tax,
             SUM(r.balance) as balance${uniqueSumClauses ? ',\n             ' + uniqueSumClauses : ''}
             FROM ${config.tableName} r
             LEFT JOIN workshops w ON r.workshop_id = w.id
             WHERE 1=1`;
  const params = [];
  if (start_date) { sql += ` AND r.record_date >= ?`; params.push(start_date); }
  if (end_date) { sql += ` AND r.record_date <= ?`; params.push(end_date); }
  sql += ` GROUP BY w.id, w.name, w.region, w.sort_order ORDER BY w.sort_order`;

  const rows = await getAll(sql, params);
  rows.forEach(r => {
    r.balance_ratio = r.daily_output > 0 ? r.balance / r.daily_output : 0;
  });

  res.json({ success: true, data: rows });
}));

module.exports = router;
