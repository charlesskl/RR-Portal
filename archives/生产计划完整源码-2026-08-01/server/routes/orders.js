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

// 货号 → 做工（成品/半成品）映射。导入时分好的类型记下来，下次同货号自动带出。
const WORK_TYPE_MAP_PATH = path.join(__dirname, '../data/work-type-map.json');
function loadWorkTypeMap() {
  try { return JSON.parse(fs.readFileSync(WORK_TYPE_MAP_PATH, 'utf8')); } catch { return {}; }
}
function saveWorkTypeMap(m) {
  fs.writeFileSync(WORK_TYPE_MAP_PATH, JSON.stringify(m, null, 2));
}

// 货号组 → 拉 的记忆映射 { workshop: { 货号组: 拉编号 } }。自动排拉据此分拉。
const ITEM_LINE_MAP_PATH = path.join(__dirname, '../data/item-line-map.json');
function loadItemLineMap() {
  try { return JSON.parse(fs.readFileSync(ITEM_LINE_MAP_PATH, 'utf8')); } catch { return {}; }
}
function saveItemLineMap(m) {
  fs.writeFileSync(ITEM_LINE_MAP_PATH, JSON.stringify(m, null, 2));
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
  'cell_format','row_color',
  ...Array.from({length: 31}, (_, i) => `day_${i + 1}`)
];
const ALLOWED_COLUMNS = new Set(ORDER_COLUMNS);

// 单事务条数上限。better-sqlite3 是同步的，一次性 5000 条会卡 event loop。
// 拆成小批后用 setImmediate 在批之间让出主线程，HTTP 仍能响应别的请求。
const CHUNK_SIZE = 500;
const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));

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

// 车间拉配置（2026-05-22 更新：key=拉名/编号，name=拉长，worker_count=人数）
const WORKSHOP_CONFIG = {
  A: { supervisor: '吴其雄', factory_area: '兴信A', worker_count: 50,
    lines: [
      { key: 'A1', name: '杨胜去', worker_count: 70 },
      { key: 'A2', name: '贾帅傅', worker_count: 55 },
      { key: 'A3', name: '李腾', worker_count: 33 },
      { key: 'A5', name: '杨轮', worker_count: 47 },
      { key: '新拉', name: '新拉', worker_count: 20, note: '预计6月份开拉' },
    ]},
  B: { supervisor: '吴敏敏', factory_area: '兴信B', worker_count: 50,
    lines: [
      { key: 'B1', name: '张宝财', worker_count: 53 },
      { key: 'B2', name: '杨春田', worker_count: 40 },
      { key: 'B3', name: '庞贵成', worker_count: 48 },
      { key: 'B5', name: '骆志凯', worker_count: 35 },
      { key: '新拉', name: '新拉', worker_count: 20, note: '预计6月份开拉' },
    ]},
  C: { supervisor: '刘荣华', factory_area: '华登', worker_count: 50,
    lines: [
      { key: 'C01', name: '黄磊峰', worker_count: 34 },
      { key: 'C02', name: '吴志锋', worker_count: 22 },
      { key: 'C04', name: '容东', worker_count: 54 },
      { key: 'C08', name: '肖雄', worker_count: 49 },
      { key: 'C12', name: '梁泽文', worker_count: 62 },
      { key: '二楼蛋糕机器拉', name: '王飞飞', worker_count: 33 },
    ]},
};
const WORKSHOP_LINES = {
  A: WORKSHOP_CONFIG.A.lines.map(l => l.key),
  B: WORKSHOP_CONFIG.B.lines.map(l => l.key),
  C: WORKSHOP_CONFIG.C.lines.map(l => l.key),
};

// 把订单的 line_name（可能是拉编号 B1、拉长名 张宝财、或 "B1(张宝财)"）归一成拉编号
function resolveLineKey(workshop, raw) {
  if (raw == null) return null;
  const v = String(raw).trim();
  if (!v) return null;
  const cfg = WORKSHOP_CONFIG[workshop];
  if (!cfg) return null;
  for (const l of cfg.lines) {
    if (v === l.key || v === l.name) return l.key;
  }
  const m = v.match(/^(.+?)[（(]/);   // 形如 "B1(张宝财)"
  if (m) {
    const head = m[1].trim();
    for (const l of cfg.lines) if (head === l.key || head === l.name) return l.key;
  }
  return null;
}

// 货号 key：用完整货号（去空格）。同货号才算同一组，不按开头数字归并。
function getItemGroup(itemNo) {
  if (itemNo == null || String(itemNo).trim() === '') return 'unknown';
  return String(itemNo).trim();
}

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

// POST /api/orders/batch-update — 批量更新多条订单字段，避免 syncFormats 一次过拆成 N 个 PUT 撞 nginx 限流
// body: { updates: [{ id: 1, fields: { cell_format: '...', status: '...' } }, ...] }
router.post('/batch-update', async (req, res) => {
  const { updates } = req.body;
  if (!Array.isArray(updates)) return res.status(400).json({ message: 'updates must be array' });
  let n = 0;
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const tx = db.transaction(() => {
      for (const u of chunk) {
        if (!u || !u.id || !u.fields || typeof u.fields !== 'object') continue;
        const keys = Object.keys(u.fields).filter(k => ALLOWED_COLUMNS.has(k));
        if (keys.length === 0) continue;
        const sets = keys.map(k => `${k} = ?`).join(', ');
        const values = keys.map(k => u.fields[k]);
        values.push(u.id);
        db.prepare(`UPDATE orders SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values);
        n++;
      }
    });
    tx();
    if (i + CHUNK_SIZE < updates.length) await yieldToEventLoop();
  }
  res.json({ success: true, updated: n });
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

// GET /api/orders/work-type-map — 取货号→做工映射
router.get('/work-type-map', (req, res) => {
  res.json(loadWorkTypeMap());
});

// PUT /api/orders/work-type-map — 批量保存货号→做工映射
// body: { entries: [{ item_no, work_type }, ...] }
router.put('/work-type-map', (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ message: 'entries must be array' });
  const map = loadWorkTypeMap();
  let n = 0;
  for (const e of entries) {
    if (!e || !e.item_no || !e.work_type) continue;
    const key = String(e.item_no).trim();
    if (!key) continue;
    map[key] = String(e.work_type).trim();
    n++;
  }
  saveWorkTypeMap(map);
  res.json({ success: true, saved: n });
});

// GET /api/orders/item-line-map?workshop=B — 查看货号→拉记忆映射（须在 /:id 之前注册）
router.get('/item-line-map', (req, res) => {
  const { workshop } = req.query;
  const full = loadItemLineMap();
  res.json(workshop ? (full[workshop] || {}) : full);
});

// PUT /api/orders/item-line-map — 批量保存 (货号组+做工)→拉 映射
// body: { workshop, entries: [{ item_no, work_type, line }, ...] }
router.put('/item-line-map', (req, res) => {
  const { workshop, entries } = req.body;
  if (!workshop || !Array.isArray(entries)) return res.status(400).json({ message: 'workshop, entries required' });
  const full = loadItemLineMap();
  const map = full[workshop] || {};
  let n = 0;
  for (const e of entries) {
    if (!e || !e.item_no || !e.line) continue;
    const key = getItemGroup(e.item_no) + '|' + String(e.work_type == null ? '' : e.work_type).trim();
    map[key] = String(e.line).trim();
    n++;
  }
  full[workshop] = map;
  saveItemLineMap(full);
  res.json({ success: true, saved: n });
});

// GET /api/orders/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ message: 'Order not found' });
  res.json(row);
});

// POST /api/orders (single or batch) — 不做任何去重，全部插入
router.post('/', async (req, res) => {
  const orders = Array.isArray(req.body) ? req.body : [req.body];
  const placeholders = ORDER_COLUMNS.map(() => '?').join(',');
  const stmt = db.prepare(`INSERT INTO orders (${ORDER_COLUMNS.join(',')}) VALUES (${placeholders})`);

  const ids = [];
  for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
    const chunk = orders.slice(i, i + CHUNK_SIZE);
    const tx = db.transaction(() => {
      for (const o of chunk) {
        const values = ORDER_COLUMNS.map(c => o[c] ?? null);
        const info = stmt.run(...values);
        ids.push(info.lastInsertRowid);
      }
    });
    tx();
    if (i + CHUNK_SIZE < orders.length) await yieldToEventLoop();
  }

  res.json({ inserted: ids.length, skipped: 0, ids });
});

// PUT /api/orders/:id
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
router.post('/batch-status', async (req, res) => {
  const { ids, status } = req.body;
  if (!ids?.length || !['active', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ message: 'Invalid request' });
  }
  // SQLite IN(...) 默认 999 参数上限；按 CHUNK_SIZE 拆批顺便让出 event loop
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(status, ...chunk);
    if (i + CHUNK_SIZE < ids.length) await yieldToEventLoop();
  }
  res.json({ success: true, updated: ids.length });
});

// POST /api/orders/batch-delete  { ids: [1,2,3] }
router.post('/batch-delete', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) {
    return res.status(400).json({ message: 'ids required' });
  }
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    db.prepare(`DELETE FROM orders WHERE id IN (${placeholders})`).run(...chunk);
    if (i + CHUNK_SIZE < ids.length) await yieldToEventLoop();
  }
  res.json({ success: true, deleted: ids.length });
});

// POST /api/orders/auto-assign — 自动排拉（纯货号记忆映射，不做数量均衡）
// 规则：同（货号组+做工）进同一条拉；成品/半成品各记各的拉，不混在一起。
//   1. 学习：(货号组|做工) 若当前订单已落在某条已知拉上 → 记进映射（多数票，最新手工排拉为准）
//   2. 应用：(货号组|做工) 在映射里 → 整组订单设到该拉；不在映射里 → 不动，计入「未分配」
//   3. 保存映射，供下次（含重新导入后）自动带出
router.post('/auto-assign', async (req, res) => {
  const { workshop } = req.body;
  if (!workshop) return res.status(400).json({ message: 'workshop required' });

  const cfg = WORKSHOP_CONFIG[workshop];
  if (!cfg) return res.status(400).json({ message: 'invalid workshop' });

  const orders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ?').all(workshop, 'active');
  if (orders.length === 0) return res.json({ success: true, message: '没有待排订单', assignment: {}, unmapped: 0 });

  // 按 (货号组 + 做工) 分组 —— 成品和半成品即使同货号也算不同组，可去不同拉
  const groups = {};
  for (const o of orders) {
    const g = getItemGroup(o.item_no) + '|' + String(o.work_type == null ? '' : o.work_type).trim();
    (groups[g] = groups[g] || []).push(o);
  }

  // 加载并学习映射：每个货号组按当前订单落在哪条已知拉做多数票
  const fullMap = loadItemLineMap();
  const map = fullMap[workshop] || {};
  for (const [g, list] of Object.entries(groups)) {
    const votes = {};
    for (const o of list) {
      const key = resolveLineKey(workshop, o.line_name);
      if (key) votes[key] = (votes[key] || 0) + 1;
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (best) map[g] = best[0];   // 学到的覆盖旧的（最新手工排拉为准）
  }

  // 应用：映射命中的货号组 → 整组订单设到该拉；拉内按走货期排序
  const updateStmt = db.prepare(
    'UPDATE orders SET line_name = ?, supervisor = ?, factory_area = ?, worker_count = ?, updated_at = datetime(\'now\') WHERE id = ?'
  );
  const toAssign = [];
  const assignment = {};
  let unmapped = 0;
  for (const [g, list] of Object.entries(groups)) {
    const line = map[g];
    if (!line) { unmapped += list.length; continue; }
    const lineCfg = cfg.lines.find(l => l.key === line);
    const wc = (lineCfg && lineCfg.worker_count) || cfg.worker_count;
    const sorted = [...list].sort((a, b) => (a.ship_date || '9999').localeCompare(b.ship_date || '9999'));
    for (const o of sorted) toAssign.push([line, wc, o.id]);
    if (!assignment[line]) assignment[line] = { count: 0, totalQty: 0 };
    assignment[line].count += list.length;
    assignment[line].totalQty += list.reduce((s, o) => s + (Number(o.quantity) || 0), 0);
  }

  // 分批写库，避免一次大事务卡 event loop
  for (let i = 0; i < toAssign.length; i += CHUNK_SIZE) {
    const chunk = toAssign.slice(i, i + CHUNK_SIZE);
    const tx = db.transaction(() => {
      for (const [line, wc, orderId] of chunk) {
        updateStmt.run(line, cfg.supervisor, cfg.factory_area, wc, orderId);
      }
    });
    tx();
    if (i + CHUNK_SIZE < toAssign.length) await yieldToEventLoop();
  }

  // 保存映射
  fullMap[workshop] = map;
  saveItemLineMap(fullMap);

  res.json({ success: true, assignment, unmapped, mappedGroups: Object.keys(map).length });
});

module.exports = router;
