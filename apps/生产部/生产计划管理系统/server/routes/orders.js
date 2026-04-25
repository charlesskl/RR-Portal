const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../db/connection');

// 拉名自定义配置文件
const LINE_CONFIG_PATH = path.join(__dirname, '../data/line-config.json');
function loadLineConfig() {
  try { return JSON.parse(fs.readFileSync(LINE_CONFIG_PATH, 'utf8')); } catch { return {}; }
}
function saveLineConfig(config) {
  fs.writeFileSync(LINE_CONFIG_PATH, JSON.stringify(config, null, 2));
}

// 表格布局配置（列宽、行高、冻结位置）
const SHEET_SETTINGS_PATH = path.join(__dirname, '../data/sheet-settings.json');
function loadSheetSettings() {
  try { return JSON.parse(fs.readFileSync(SHEET_SETTINGS_PATH, 'utf8')); } catch { return {}; }
}
function saveSheetSettings(s) {
  fs.writeFileSync(SHEET_SETTINGS_PATH, JSON.stringify(s, null, 2));
}

const ORDER_COLUMNS = [
  'workshop','status','supervisor','line_name','worker_count','factory_area',
  'client','order_date','third_party','country','contract','item_no',
  'product_name','version','quantity','work_type',
  'production_count','production_progress','special_notes',
  'plastic_due','material_due','carton_due','packaging_due','sticker',
  'start_date','complete_date','ship_date',
  'target_time','daily_target','days','unit_price','process_value',
  'inspection_date','month','warehouse_record','output_value','process_price','remark',
  'cell_format',
  ...Array.from({length: 31}, (_, i) => `day_${i + 1}`)
];

// GET /api/orders?workshop=A&status=active
router.get('/', (req, res) => {
  const { workshop, status } = req.query;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (workshop) { sql += ' AND workshop = ?'; params.push(workshop); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY line_name ASC, ship_date ASC, id ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// 车间拉配置
const WORKSHOP_CONFIG = {
  A: { supervisor: '吴其雄', factory_area: '兴信A', worker_count: 50,
    lines: [
      { key: 'A1', name: 'A1' },
      { key: 'A2', name: 'A2' },
      { key: 'A3', name: 'A3' },
      { key: 'A4', name: 'A4' },
    ]},
  B: { supervisor: '吴敏敏', factory_area: '兴信B', worker_count: 50,
    lines: [
      { key: 'B1', name: '庞贵成' },
      { key: 'B2', name: '张宝财' },
      { key: 'B3', name: '杨春田' },
    ]},
  C: { supervisor: '刘荣华', factory_area: '华登', worker_count: 50,
    lines: [
      { key: 'C1', name: '肖雄' },
      { key: 'C2', name: '王飞' },
      { key: 'C3', name: '王航' },
      { key: 'C4', name: '容东' },
      { key: 'C5', name: '王飞飞' },
    ]},
};
const WORKSHOP_LINES = {
  A: WORKSHOP_CONFIG.A.lines.map(l => l.key),
  B: WORKSHOP_CONFIG.B.lines.map(l => l.key),
  C: WORKSHOP_CONFIG.C.lines.map(l => l.key),
};

// GET /api/orders/lines?workshop=B
router.get('/lines', (req, res) => {
  const { workshop } = req.query;
  if (!workshop) return res.status(400).json({ message: 'workshop required' });
  const config = WORKSHOP_CONFIG[workshop];
  if (!config) return res.json({ lines: [] });
  // 合并自定义名称
  const custom = loadLineConfig();
  const lines = config.lines.map(l => ({
    key: l.key,
    name: (custom[workshop] && custom[workshop][l.key]) || l.name,
  }));
  res.json({ lines });
});

// GET /api/orders/sheet-settings?workshop=B
router.get('/sheet-settings', (req, res) => {
  const { workshop } = req.query;
  if (!workshop) return res.status(400).json({ message: 'workshop required' });
  const all = loadSheetSettings();
  res.json(all[workshop] || {});
});

// PUT /api/orders/sheet-settings — 保存列宽/行高/冻结
router.put('/sheet-settings', (req, res) => {
  const { workshop, settings } = req.body;
  if (!workshop || !settings) return res.status(400).json({ message: 'workshop, settings required' });
  const all = loadSheetSettings();
  all[workshop] = { ...(all[workshop] || {}), ...settings };
  saveSheetSettings(all);
  res.json({ success: true });
});

// PUT /api/orders/line-config — 更新拉名
router.put('/line-config', (req, res) => {
  const { workshop, lineKey, name } = req.body;
  if (!workshop || !lineKey || !name) return res.status(400).json({ message: 'workshop, lineKey, name required' });
  const config = loadLineConfig();
  if (!config[workshop]) config[workshop] = {};
  config[workshop][lineKey] = name;
  saveLineConfig(config);
  res.json({ success: true });
});

// GET /api/orders/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ message: 'Order not found' });
  res.json(row);
});

// POST /api/orders (single or batch)
router.post('/', (req, res) => {
  const orders = Array.isArray(req.body) ? req.body : [req.body];
  const placeholders = ORDER_COLUMNS.map(() => '?').join(',');
  const stmt = db.prepare(`INSERT INTO orders (${ORDER_COLUMNS.join(',')}) VALUES (${placeholders})`);
  const checkDup = db.prepare('SELECT id FROM orders WHERE contract = ? AND item_no = ? AND workshop = ? LIMIT 1');

  const insertMany = db.transaction((list) => {
    const ids = [];
    let skipped = 0;
    for (const o of list) {
      // 去重：合同号+货号+车间 已存在则跳过
      if (o.contract && o.item_no && o.workshop) {
        const existing = checkDup.get(o.contract, o.item_no, o.workshop);
        if (existing) { skipped++; continue; }
      }
      const values = ORDER_COLUMNS.map(c => o[c] ?? null);
      const info = stmt.run(...values);
      ids.push(info.lastInsertRowid);
    }
    return { ids, skipped };
  });

  const { ids, skipped } = insertMany(orders);
  res.json({ inserted: ids.length, skipped, ids });
});

// PUT /api/orders/:id
const ALLOWED_COLUMNS = new Set(ORDER_COLUMNS);
router.put('/:id', (req, res) => {
  const data = req.body;
  const keys = Object.keys(data).filter(k => ALLOWED_COLUMNS.has(k));
  if (keys.length === 0) return res.status(400).json({ message: 'No fields to update' });

  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => data[k]);
  values.push(req.params.id);

  db.prepare(`UPDATE orders SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values);
  res.json({ success: true });
});

// PUT /api/orders/:id/status
router.put('/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, req.params.id);
  res.json({ success: true });
});

// DELETE /api/orders/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/orders/batch-status  { ids: [1,2,3], status: 'completed' }
router.post('/batch-status', (req, res) => {
  const { ids, status } = req.body;
  if (!ids?.length || !['active', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ message: 'Invalid request' });
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(status, ...ids);
  res.json({ success: true, updated: ids.length });
});

// POST /api/orders/batch-delete  { ids: [1,2,3] }
router.post('/batch-delete', (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) {
    return res.status(400).json({ message: 'ids required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM orders WHERE id IN (${placeholders})`).run(...ids);
  res.json({ success: true, deleted: ids.length });
});

// POST /api/orders/auto-assign — 自动排拉
// 规则：同货号放同一拉，各拉按总数量均衡分配，每拉内按走货期排序
router.post('/auto-assign', (req, res) => {
  const { workshop } = req.body;
  if (!workshop) return res.status(400).json({ message: 'workshop required' });

  const lines = WORKSHOP_LINES[workshop];
  if (!lines) return res.status(400).json({ message: 'invalid workshop' });

  // 获取该车间所有 active 订单
  const orders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ?').all(workshop, 'active');
  if (orders.length === 0) return res.json({ success: true, message: '没有待排订单' });

  // 按货号主编号分组（提取数字部分，如 92119-S001 → 92119，92125H-S001 → 92125）
  function getItemGroup(itemNo) {
    if (!itemNo) return 'unknown';
    const match = itemNo.match(/^(\d+)/);
    return match ? match[1] : itemNo;
  }

  const groups = {};
  for (const order of orders) {
    const key = getItemGroup(order.item_no);
    if (!groups[key]) groups[key] = { item_no: key, orders: [], totalQty: 0 };
    groups[key].orders.push(order);
    groups[key].totalQty += (order.quantity || 0);
  }

  // 按总数量从大到小排序（大的先分，更均衡）
  const sortedGroups = Object.values(groups).sort((a, b) => b.totalQty - a.totalQty);

  // 贪心分配：每次把货号组分给当前总量最小的拉
  const lineLoads = {};
  const lineAssign = {};
  for (const line of lines) {
    lineLoads[line] = 0;
    lineAssign[line] = [];
  }

  for (const group of sortedGroups) {
    // 找当前负载最小的拉
    let minLine = lines[0];
    for (const line of lines) {
      if (lineLoads[line] < lineLoads[minLine]) minLine = line;
    }
    lineAssign[minLine].push(group);
    lineLoads[minLine] += group.totalQty;
  }

  // 更新数据库：设置 line_name、主管、厂区、人数，每拉内按走货期排序
  const config = WORKSHOP_CONFIG[workshop];
  const updateStmt = db.prepare(
    'UPDATE orders SET line_name = ?, supervisor = ?, factory_area = ?, worker_count = ?, updated_at = datetime(\'now\') WHERE id = ?'
  );
  const assignMany = db.transaction(() => {
    for (const [line, groups] of Object.entries(lineAssign)) {
      const allOrders = groups.flatMap(g => g.orders);
      allOrders.sort((a, b) => {
        const da = a.ship_date || '9999';
        const db2 = b.ship_date || '9999';
        return da.localeCompare(db2);
      });
      for (const order of allOrders) {
        updateStmt.run(line, config.supervisor, config.factory_area, config.worker_count, order.id);
      }
    }
  });
  assignMany();

  // 返回分配结果
  const result = {};
  for (const [line, groups] of Object.entries(lineAssign)) {
    result[line] = { count: groups.reduce((s, g) => s + g.orders.length, 0), totalQty: lineLoads[line] };
  }
  res.json({ success: true, assignment: result });
});

module.exports = router;
