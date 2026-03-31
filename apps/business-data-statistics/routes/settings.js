const express = require('express');
const router = express.Router();
const { getAll, getOne, query } = require('../db/postgres');
const { authenticate, requireStats } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const asyncHandler = require('../utils/async-handler');
const FormulaParser = require('../shared/formula-parser');
const { DEPT_CONFIG } = require('../modules');

// === 费用项管理（已迁移到 field_tags + field_registry，此端点改为查询新表）===
router.get('/expense-items', authenticate, asyncHandler(async (req, res) => {
  const { department } = req.query;
  // 从 field_registry + field_tags 合成旧格式数据
  let sql = `SELECT fr.id, fr.department, fr.field_key as field_name, fr.field_label as display_name,
             fr.sort_order, true as is_shared, (fr.field_type = 'calc') as is_calculated, true as enabled
             FROM field_registry fr
             INNER JOIN field_tags ft ON fr.module = ft.module AND fr.field_key = ft.field_key AND ft.tag = 'expense'
               AND (ft.department = fr.department OR ft.department = '_shared')
             WHERE fr.module = 'balance'`;
  const params = [];
  if (department) { sql += ' AND (fr.department = ? OR fr.department = ?)'; params.push(department, '_shared'); }
  sql += ' ORDER BY fr.department, fr.sort_order';
  res.json({ success: true, data: await getAll(sql, params) });
}));

// === 计算规则（已迁移到 formula_configs，此端点改为查询新表）===
router.get('/calc-rules', authenticate, asyncHandler(async (req, res) => {
  const { department } = req.query;
  // 从 formula_configs 合成旧格式数据
  let sql = `SELECT id, department, field_key as formula_type, formula_text as participating_fields, updated_at
             FROM formula_configs WHERE module = 'balance'`;
  const params = [];
  if (department) { sql += ' AND department = ?'; params.push(department); }
  sql += ' ORDER BY sort_order';
  res.json({ success: true, data: await getAll(sql, params) });
}));

// === 公式常量（按月生效，向后延续）===

// 获取常量列表（可选按 name 过滤）
router.get('/constants', authenticate, asyncHandler(async (req, res) => {
  const { module: mod, name } = req.query;
  let sql = 'SELECT * FROM formula_constants WHERE 1=1';
  const params = [];
  if (mod) { sql += ' AND module = ?'; params.push(mod); }
  if (name) { sql += ' AND name = ?'; params.push(name); }
  sql += ' ORDER BY name, effective_month DESC';
  res.json({ success: true, data: await getAll(sql, params) });
}));

// 获取所有常量名称（去重，用于下拉列表）
router.get('/constants/names', authenticate, asyncHandler(async (req, res) => {
  const { module: mod } = req.query;
  let sql = 'SELECT DISTINCT name, label FROM formula_constants WHERE 1=1';
  const params = [];
  if (mod) { sql += ' AND module = ?'; params.push(mod); }
  sql += ' ORDER BY name';
  res.json({ success: true, data: await getAll(sql, params) });
}));

// 查询某日期生效的所有常量值（计算用）
router.get('/constants/resolve', authenticate, asyncHandler(async (req, res) => {
  const { module: mod, date } = req.query;
  if (!date) return res.status(400).json({ success: false, message: '请提供日期' });
  const month = date.substring(0, 7); // '2026-03-15' → '2026-03'
  // 每个常量取 effective_month <= 当月 的最新值
  const rows = await getAll(
    `SELECT DISTINCT ON (name) name, label, value, effective_month
     FROM formula_constants WHERE module = ? AND effective_month <= ?
     ORDER BY name, effective_month DESC`,
    [mod || 'balance', month]
  );
  const map = {};
  for (const r of rows) { map[r.name] = parseFloat(r.value); }
  res.json({ success: true, data: map, details: rows });
}));

// 新增/更新常量值（某月）
router.post('/constants', authenticate, requireStats, asyncHandler(async (req, res) => {
  const { module: mod, name, label, value, effective_month } = req.body;
  if (!name || !label || value === undefined || !effective_month) {
    return res.status(400).json({ success: false, message: '必填项缺失' });
  }
  const result = await query(
    `INSERT INTO formula_constants (module, name, label, value, effective_month)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (module, name, effective_month) DO UPDATE SET value = ?, label = ?, updated_at = NOW()
     RETURNING *`,
    [mod || 'balance', name, label, value, effective_month, value, label]
  );
  res.json({ success: true, data: result.rows[0] });
}));

// 删除某个常量的某月记录
router.delete('/constants/:id', authenticate, requireStats, asyncHandler(async (req, res) => {
  await query('DELETE FROM formula_constants WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

// === 字段注册表（只读）===
router.get('/field-registry', authenticate, asyncHandler(async (req, res) => {
  const { module: mod, department } = req.query;
  let sql = 'SELECT * FROM field_registry WHERE 1=1';
  const params = [];
  if (mod) { sql += ' AND module = ?'; params.push(mod); }
  if (department) { sql += ' AND department = ?'; params.push(department); }
  sql += ' ORDER BY sort_order';
  res.json({ success: true, data: await getAll(sql, params) });
}));

// === 字段标签 ===
router.get('/field-tags', authenticate, asyncHandler(async (req, res) => {
  const { module: mod, department } = req.query;
  let sql = 'SELECT * FROM field_tags WHERE 1=1';
  const params = [];
  if (mod) { sql += ' AND module = ?'; params.push(mod); }
  if (department) { sql += ' AND department = ?'; params.push(department); }
  res.json({ success: true, data: await getAll(sql, params) });
}));

router.put('/field-tags', authenticate, requireStats, asyncHandler(async (req, res) => {
  // 批量更新标签：接收 { module, department, field_key, tag } 数组
  const { tags } = req.body; // [{ module, department, field_key, tag, action: 'add'|'remove' }]
  if (!Array.isArray(tags)) return res.status(400).json({ success: false, message: '参数格式错误' });

  for (const t of tags) {
    if (t.action === 'remove') {
      await query('DELETE FROM field_tags WHERE module = ? AND department = ? AND field_key = ? AND tag = ?',
        [t.module, t.department, t.field_key, t.tag]);
    } else {
      await query(
        `INSERT INTO field_tags (module, department, field_key, tag) VALUES (?, ?, ?, ?)
         ON CONFLICT (module, department, field_key, tag) DO NOTHING`,
        [t.module, t.department, t.field_key, t.tag]);
    }
  }
  res.json({ success: true });
}));

// === 公式配置 ===

// 辅助：加载指定部门的标签映射（SUM 展开用）
async function loadTagMap(mod, department) {
  const rows = await getAll(
    'SELECT department, field_key, tag FROM field_tags WHERE module = ? AND (department = ? OR department = ?)',
    [mod, '_shared', department]
  );
  // 按 { department: { tag: [field_key, ...] } } 组织
  const map = {};
  for (const r of rows) {
    if (!map[r.department]) map[r.department] = {};
    if (!map[r.department][r.tag]) map[r.department][r.tag] = [];
    map[r.department][r.tag].push(r.field_key);
  }
  return map;
}

// GET 公式列表
router.get('/formulas', authenticate, asyncHandler(async (req, res) => {
  const { module: mod, department } = req.query;
  let sql = 'SELECT * FROM formula_configs WHERE 1=1';
  const params = [];
  if (mod) { sql += ' AND module = ?'; params.push(mod); }
  if (department) { sql += ' AND department = ?'; params.push(department); }
  sql += ' ORDER BY sort_order';
  res.json({ success: true, data: await getAll(sql, params) });
}));

// POST 新增公式
router.post('/formulas', authenticate, requireStats, asyncHandler(async (req, res) => {
  const { module: mod, department, field_key, field_label, formula_text, display_format, decimal_places, sort_order } = req.body;
  if (!mod || !department || !field_key || !field_label || !formula_text) {
    return res.status(400).json({ success: false, message: '必填项缺失' });
  }
  const result = await query(
    `INSERT INTO formula_configs (module, department, field_key, field_label, formula_text, display_format, decimal_places, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [mod, department, field_key, field_label, formula_text, display_format || 'number', decimal_places ?? 2, sort_order || 0]
  );
  await logAction(req.user.id, req.user.name, 'create_formula', 'formula_configs', result.rows[0].id, null, result.rows[0]);
  res.json({ success: true, data: result.rows[0] });
}));

// PUT 批量排序（必须在 /:id 之前）
router.put('/formulas/sort', authenticate, requireStats, asyncHandler(async (req, res) => {
  const items = req.body.items; // { items: [{id, sort_order}, ...] }
  if (!Array.isArray(items)) return res.status(400).json({ success: false, message: '参数格式错误' });
  for (const item of items) {
    await query('UPDATE formula_configs SET sort_order = ?, updated_at = NOW() WHERE id = ?', [item.sort_order, item.id]);
  }
  res.json({ success: true });
}));

// POST 验证公式
router.post('/formulas/validate', authenticate, requireStats, asyncHandler(async (req, res) => {
  const { module: mod, department, formula_text, field_key: selfKey } = req.body;
  if (!formula_text) return res.status(400).json({ success: false, message: '公式文本不能为空' });

  // 加载可用字段
  const fields = await getAll(
    'SELECT field_key FROM field_registry WHERE module = ? AND (department = ? OR department = ?)',
    [mod, '_shared', department]
  );
  const availableFields = fields.map(f => f.field_key);

  // 加载可用标签
  const tagRows = await getAll('SELECT DISTINCT tag FROM field_tags WHERE module = ?', [mod]);
  const availableTags = {};
  for (const t of tagRows) { availableTags[t.tag] = true; }

  // 加载已有公式 field_key
  const formulaRows = await getAll('SELECT field_key FROM formula_configs WHERE module = ? AND department = ?', [mod, department]);
  const formulaKeys = formulaRows.map(f => f.field_key);

  const result = FormulaParser.validateFormula(formula_text, availableFields, availableTags, formulaKeys, selfKey);
  res.json({ success: true, data: result });
}));

// POST 测试公式
router.post('/formulas/test', authenticate, requireStats, asyncHandler(async (req, res) => {
  const { module: mod, department, formula_text, decimal_places, test_data } = req.body;
  if (!formula_text || !test_data) return res.status(400).json({ success: false, message: '参数不完整' });

  const tags = await loadTagMap(mod, department);
  const result = FormulaParser.calculateFormula(
    { formula_text, decimal_places: decimal_places ?? 2 },
    test_data, tags, {}, department
  );
  res.json({ success: true, data: result });
}));

// POST 重算历史数据
router.post('/formulas/recalculate', authenticate, requireStats, asyncHandler(async (req, res) => {
  const { module: mod, department, start_date, end_date } = req.body;
  if (!department || !start_date || !end_date) {
    return res.status(400).json({ success: false, message: '请选择部门和时间范围' });
  }

  const config = DEPT_CONFIG[department];
  if (!config) return res.status(400).json({ success: false, message: '无效部门' });

  // 加载公式和标签
  const formulas = await getAll(
    'SELECT * FROM formula_configs WHERE module = ? AND department = ? AND enabled = true ORDER BY sort_order',
    [mod || 'balance', department]
  );
  const tags = await loadTagMap(mod || 'balance', department);

  // 查询需要重算的记录数
  const countResult = await getOne(
    `SELECT COUNT(*) as cnt FROM ${config.tableName} WHERE record_date >= ? AND record_date <= ?`,
    [start_date, end_date]
  );
  const totalCount = parseInt(countResult.cnt);

  if (totalCount > 10000) {
    return res.status(400).json({ success: false, message: `共 ${totalCount} 条记录，超过 10000 条上限。请缩小时间范围分次操作。` });
  }

  // 分批处理，每批 500 条
  const BATCH_SIZE = 500;
  let processed = 0;

  const records = await getAll(
    `SELECT * FROM ${config.tableName} WHERE record_date >= ? AND record_date <= ? ORDER BY id`,
    [start_date, end_date]
  );

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    for (const record of batch) {
      // 根据记录日期查找当月生效的常量值
      const recordMonth = String(record.record_date).substring(0, 7);
      const constRows = await getAll(
        `SELECT DISTINCT ON (name) name, value FROM formula_constants WHERE module = ? AND effective_month <= ? ORDER BY name, effective_month DESC`,
        [mod || 'balance', recordMonth]
      );
      const constants = {};
      for (const c of constRows) { constants[c.name] = parseFloat(c.value); }
      // 用公式解析器重新计算
      const calcResult = FormulaParser.calculateAll(formulas, record, tags, department, constants);

      // 只更新有变化的计算字段
      const updates = [];
      const values = [];
      for (const [fieldKey, value] of Object.entries(calcResult.results)) {
        if (value !== null && record[fieldKey] !== undefined) {
          updates.push(`${fieldKey} = ?`);
          values.push(value);
        }
      }

      if (updates.length > 0) {
        updates.push('updated_at = NOW()');
        values.push(record.id);
        await query(`UPDATE ${config.tableName} SET ${updates.join(', ')} WHERE id = ?`, values);
      }
    }
    processed += batch.length;
  }

  // 记录审计日志
  await logAction(req.user.id, req.user.name, 'recalculate', config.tableName, null,
    { department, start_date, end_date },
    { processed_count: processed }
  );

  res.json({ success: true, data: { processed: processed, total: totalCount } });
}));

// PUT 修改公式
router.put('/formulas/:id', authenticate, requireStats, asyncHandler(async (req, res) => {
  const { field_key, field_label, formula_text, display_format, decimal_places, sort_order, enabled } = req.body;
  const old = await getOne('SELECT * FROM formula_configs WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ success: false, message: '公式不存在' });

  const result = await query(
    `UPDATE formula_configs SET field_key = ?, field_label = ?, formula_text = ?, display_format = ?,
     decimal_places = ?, sort_order = ?, enabled = ?, updated_at = NOW() WHERE id = ? RETURNING *`,
    [field_key || old.field_key, field_label || old.field_label, formula_text || old.formula_text,
     display_format || old.display_format, decimal_places ?? old.decimal_places,
     sort_order ?? old.sort_order, enabled ?? old.enabled, req.params.id]
  );
  await logAction(req.user.id, req.user.name, 'update_formula', 'formula_configs', req.params.id, old, result.rows[0]);
  res.json({ success: true, data: result.rows[0] });
}));

// DELETE 删除公式
router.delete('/formulas/:id', authenticate, requireStats, asyncHandler(async (req, res) => {
  const old = await getOne('SELECT * FROM formula_configs WHERE id = ?', [req.params.id]);
  if (!old) return res.status(404).json({ success: false, message: '公式不存在' });
  await query('DELETE FROM formula_configs WHERE id = ?', [req.params.id]);
  await logAction(req.user.id, req.user.name, 'delete_formula', 'formula_configs', req.params.id, old, null);
  res.json({ success: true });
}));

// === 数据锁定 ===
router.get('/data-locks', authenticate, asyncHandler(async (req, res) => {
  const locks = await getAll(`
    SELECT dl.*, u.name as locked_by_name FROM data_locks dl
    LEFT JOIN users u ON dl.locked_by = u.id
    ORDER BY dl.department, dl.lock_month DESC
  `);
  res.json({ success: true, data: locks });
}));

// 保留手动 try/catch：需要特殊处理唯一约束冲突 (err.code === '23505')
router.post('/data-locks', authenticate, requireStats, async (req, res) => {
  try {
    const { department, lock_month } = req.body;
    const result = await query(
      'INSERT INTO data_locks (department, lock_month, locked_by) VALUES (?, ?, ?) RETURNING *',
      [department, lock_month, req.user.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: '该月已锁定' });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/data-locks/:id', authenticate, requireStats, asyncHandler(async (req, res) => {
  await query('DELETE FROM data_locks WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

module.exports = router;
