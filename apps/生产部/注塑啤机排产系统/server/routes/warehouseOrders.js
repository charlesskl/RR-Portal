const express = require('express');
const router = express.Router();
const db = require('../db/connection');

const COLS = [
  'delivery_date', 'delivery_code', 'order_no', 'mold_no', 'part_name', 'color',
  'order_qty', 'delivery_pcs', 'cavity', 'delivery_shots',
  'shot_weight', 'material_kg', 'material_type',
  'unit_price', 'amount',
  'box_glue', 'box_paper', 'pallet', 'notes',
  'pmc_follow', 'workshop', 'status', 'schedule_item_id',
  // 入库单实物单字段
  'color_powder_no', 'color_powder_batch', 'shift',
  'material_pickup_no', 'color_powder_pickup_no',
  'applicant', 'dept_supervisor', 'warehouse_keeper',
];

function pick(obj) {
  const out = {};
  for (const c of COLS) out[c] = (obj[c] === undefined) ? null : obj[c];
  return out;
}

// 自动算金额：送货啤数 × 单价
function recalcAmount(row) {
  if (row.amount == null && row.delivery_shots != null && row.unit_price != null) {
    row.amount = Math.round(Number(row.delivery_shots) * Number(row.unit_price) * 100) / 100;
  }
  return row;
}

// ---- 列表 ----
// 参数: workshop, month (YYYY-MM), pmc, status, order_no
router.get('/', (req, res) => {
  const { workshop = 'B', month, pmc, status, order_no } = req.query;
  const where = ['workshop = ?'];
  const params = [workshop];
  if (month) { where.push("substr(delivery_date,1,7) = ?"); params.push(month); }
  if (pmc)   { where.push('pmc_follow = ?');   params.push(pmc); }
  if (status){ where.push('status = ?');       params.push(status); }
  if (order_no) { where.push('order_no LIKE ?'); params.push('%' + order_no + '%'); }
  const rows = db.prepare(
    `SELECT * FROM pi_warehouse_orders WHERE ${where.join(' AND ')} ORDER BY delivery_date DESC, id DESC`
  ).all(...params);
  res.json(rows);
});

// ---- 详情 ----
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM pi_warehouse_orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ message: '不存在' });
  res.json(row);
});

// ---- 新建 ----
router.post('/', (req, res) => {
  try {
    const row = recalcAmount(pick(req.body));
    const cols = COLS.filter(c => row[c] != null);
    const sql = `INSERT INTO pi_warehouse_orders (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`;
    const result = db.prepare(sql).run(row);
    const created = db.prepare('SELECT * FROM pi_warehouse_orders WHERE id = ?').get(result.lastInsertRowid);
    res.json(created);
  } catch (e) {
    console.error('新建入库单失败:', e);
    res.status(500).json({ message: e.message });
  }
});

// ---- 修改 ----
router.put('/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM pi_warehouse_orders WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ message: '不存在' });

  const merged = { ...cur, ...pick(req.body) };
  // 单价或送货啤数变了 → 重算金额（除非用户显式传了 amount）
  if (req.body.amount == null && (req.body.delivery_shots !== undefined || req.body.unit_price !== undefined)) {
    merged.amount = (merged.delivery_shots != null && merged.unit_price != null)
      ? Math.round(Number(merged.delivery_shots) * Number(merged.unit_price) * 100) / 100
      : null;
  }
  merged.updated_at = new Date().toISOString();

  const sql = `UPDATE pi_warehouse_orders SET ${COLS.map(c => `${c}=@${c}`).join(', ')}, updated_at=@updated_at WHERE id=@id`;
  db.prepare(sql).run({ ...merged, id: cur.id });

  const updated = db.prepare('SELECT * FROM pi_warehouse_orders WHERE id = ?').get(cur.id);
  res.json(updated);
});

// ---- 删除 ----
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM pi_warehouse_orders WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ message: '不存在' });
  res.json({ ok: true });
});

// ---- 标记入库 / 取消入库 ----
router.post('/:id/check-in', (req, res) => {
  const { undo } = req.body || {};
  if (undo) {
    db.prepare("UPDATE pi_warehouse_orders SET status='pending', checked_in_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  } else {
    db.prepare("UPDATE pi_warehouse_orders SET status='checked-in', checked_in_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  }
  const row = db.prepare('SELECT * FROM pi_warehouse_orders WHERE id = ?').get(req.params.id);
  res.json(row);
});

// ---- PMC 选项（已用过的 + 外发供应商表里有的 PMC） ----
router.get('/_/pmc-options', (req, res) => {
  const workshop = req.query.workshop || 'B';
  const set = new Set();
  for (const r of db.prepare("SELECT DISTINCT pmc_follow FROM pi_warehouse_orders WHERE workshop=? AND pmc_follow IS NOT NULL AND pmc_follow != ''").all(workshop)) set.add(r.pmc_follow);
  for (const r of db.prepare("SELECT DISTINCT pmc_follow FROM outsource_orders WHERE pmc_follow IS NOT NULL AND pmc_follow != ''").all()) set.add(r.pmc_follow);
  res.json([...set].sort((a, b) => a.localeCompare(b, 'zh')));
});

module.exports = router;
