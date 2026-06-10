const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const router = express.Router();
const db = require('../db/connection');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// 列映射（按 Excel 第 2 行表头位置）
const COL_MAP = {
  machine_no:     0,  // 机台号
  machine_type:   1,  // 机型
  robot_arm:      2,  // 机械手类型
  product_code:   3,  // 产品货号
  mold_name:      4,  // 产品名称（实际是模号 + 品名）
  order_no:       5,  // 订单号
  material_type:  6,  // 料型
  color:          7,  // 颜色
  quantity:       8,  // 订单数量/未啤数
  daily_qty:      9,  // 预计日产量
  days_needed:   10,  // 预计天数
  est_finish:    11,  // 预计完成期
  order_delivery: 12, // 订单交货期
  notes:         13,  // 备注（模具情况）
};

function toIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d.-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function toFloatOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function trim(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

// 解析 Excel buffer，返回 { title, items: [...] }
function parseMonthlyPlanXlsx(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('Excel 没有工作表');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });

  // R1 = 标题（如 "啤机部B生产月计划表"），R2 = 表头，R3+ = 数据
  const title = (rows[0] && rows[0][0]) ? String(rows[0][0]).trim() : '';

  const items = [];
  let currentMachine = null;  // 处理合并单元格：机台号空白 = 继承上一行
  let sortOrder = 0;

  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => c === null || c === '')) continue;

    const m = trim(r[COL_MAP.machine_no]);
    if (m) currentMachine = m;

    const productCode = trim(r[COL_MAP.product_code]);
    const moldName    = trim(r[COL_MAP.mold_name]);
    const orderNo     = trim(r[COL_MAP.order_no]);
    // 整行有效性判断：至少有 货号 / 模号 / 订单号 之一
    if (!productCode && !moldName && !orderNo) continue;

    items.push({
      machine_no:     currentMachine,
      machine_type:   trim(r[COL_MAP.machine_type]),
      robot_arm:      trim(r[COL_MAP.robot_arm]),
      product_code:   productCode,
      mold_name:      moldName,
      order_no:       orderNo,
      material_type:  trim(r[COL_MAP.material_type]),
      color:          trim(r[COL_MAP.color]),
      quantity:       toIntOrNull(r[COL_MAP.quantity]),
      daily_qty:      toIntOrNull(r[COL_MAP.daily_qty]),
      days_needed:    toFloatOrNull(r[COL_MAP.days_needed]),
      est_finish:     trim(r[COL_MAP.est_finish]),
      order_delivery: trim(r[COL_MAP.order_delivery]),
      notes:          trim(r[COL_MAP.notes]),
      sort_order:     sortOrder++,
    });
  }

  return { title, items };
}

// ---- 列表 ----
router.get('/', (req, res) => {
  const workshop = req.query.workshop || 'B';
  const plans = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM monthly_plan_items WHERE plan_id = p.id) AS item_count
    FROM monthly_plans p WHERE workshop = ? ORDER BY year_month DESC, id DESC
  `).all(workshop);
  res.json(plans);
});

// ---- 详情 ----
router.get('/:id', (req, res) => {
  const plan = db.prepare('SELECT * FROM monthly_plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).json({ message: '月计划不存在' });
  const items = db.prepare('SELECT * FROM monthly_plan_items WHERE plan_id = ? ORDER BY sort_order, id').all(req.params.id);
  res.json({ plan, items });
});

// ---- 上传 + 解析 + 入库 ----
router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请上传 Excel 文件' });
  const workshop = req.body.workshop || 'B';
  const yearMonth = req.body.year_month || new Date().toISOString().slice(0, 7);

  try {
    const { title, items } = parseMonthlyPlanXlsx(req.file.buffer);
    if (items.length === 0) return res.status(400).json({ message: '未解析到任何月计划行' });

    const tx = db.transaction(() => {
      const planResult = db.prepare(`
        INSERT INTO monthly_plans (year_month, workshop, title, source_file)
        VALUES (?, ?, ?, ?)
      `).run(yearMonth, workshop, title || null, req.file.originalname);
      const planId = planResult.lastInsertRowid;

      const insItem = db.prepare(`
        INSERT INTO monthly_plan_items (
          plan_id, machine_no, machine_type, robot_arm,
          product_code, mold_name, order_no, material_type, color,
          quantity, daily_qty, days_needed, est_finish, order_delivery, notes, sort_order
        ) VALUES (
          @plan_id, @machine_no, @machine_type, @robot_arm,
          @product_code, @mold_name, @order_no, @material_type, @color,
          @quantity, @daily_qty, @days_needed, @est_finish, @order_delivery, @notes, @sort_order
        )
      `);
      for (const it of items) insItem.run({ ...it, plan_id: planId });
      return planId;
    });

    const planId = tx();
    res.json({ message: `已导入 ${items.length} 条`, plan_id: planId, count: items.length, title });
  } catch (e) {
    console.error('月计划导入失败:', e);
    res.status(500).json({ message: '导入失败: ' + e.message });
  }
});

// ---- 删除 ----
router.delete('/:id', (req, res) => {
  // schedule_items.plan_id 没强制外键，但 ON DELETE CASCADE 会清 monthly_plan_items
  const info = db.prepare('DELETE FROM monthly_plans WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ message: '不存在' });
  res.json({ ok: true });
});

module.exports = router;
