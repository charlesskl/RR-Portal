const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// ─── JSON 文件存储 ───────────────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 默认原料价格从文件读取（200条完整数据）
const DEFAULT_PRICES_FILE = path.join(DATA_DIR, 'default-material-prices.json');
let DEFAULT_MATERIAL_PRICES = [];
try {
  DEFAULT_MATERIAL_PRICES = JSON.parse(fs.readFileSync(DEFAULT_PRICES_FILE, 'utf8'));
} catch (e) {
  console.warn('Warning: default-material-prices.json not found, starting with empty prices');
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return initData();
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.material_prices || data.material_prices.length === 0) data.material_prices = DEFAULT_MATERIAL_PRICES.slice();
    if (!data.material_requisitions) data.material_requisitions = [];
    return data;
  }
  catch (e) { return initData(); }
}

function initData() {
  return {
    injection_orders: [], injection_items: [],
    slush_orders: [],    slush_items: [],
    spray_orders: [],    spray_items: [],
    problems: [],
    material_prices: DEFAULT_MATERIAL_PRICES.slice(),
    material_requisitions: [],
    nextId: 1
  };
}

function saveData(data) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

// ─── 通用 CRUD 帮助 ─────────────────────────────────────────────────────────
function getOrders(type) {
  const data = loadData();
  const orders = data[`${type}_orders`].sort((a, b) => b.id - a.id);
  // 附带 items 信息（完成时间等）供前端显示
  const items = data[`${type}_items`] || [];
  orders.forEach(o => {
    o.items = items.filter(i => i.order_id === o.id).sort((a,b) => a.sort_order - b.sort_order);
  });
  return orders;
}

function getOrderById(type, id) {
  const data = loadData();
  const order = data[`${type}_orders`].find(o => o.id === +id);
  if (!order) return null;
  const items = data[`${type}_items`].filter(i => i.order_id === +id).sort((a,b) => a.sort_order - b.sort_order);
  return { ...order, items };
}

function createOrder(type, header, items) {
  const data = loadData();
  const now = new Date().toISOString();
  const id = data.nextId++;
  const order = { id, ...header, status: header.status || '待生产', created_at: now, updated_at: now };
  data[`${type}_orders`].push(order);
  if (items?.length) {
    items.forEach((it, i) => {
      data[`${type}_items`].push({ id: data.nextId++, order_id: id, sort_order: i, ...it });
    });
  }
  saveData(data);
  return getOrderById(type, id);
}

function updateOrder(type, id, header, items) {
  const data = loadData();
  const idx = data[`${type}_orders`].findIndex(o => o.id === +id);
  if (idx === -1) return null;
  data[`${type}_orders`][idx] = { ...data[`${type}_orders`][idx], ...header, updated_at: new Date().toISOString() };
  if (items !== undefined) {
    data[`${type}_items`] = data[`${type}_items`].filter(i => i.order_id !== +id);
    items.forEach((it, i) => {
      data[`${type}_items`].push({ id: data.nextId++, order_id: +id, sort_order: i, ...it });
    });
  }
  saveData(data);
  return getOrderById(type, id);
}

function deleteOrder(type, id) {
  const data = loadData();
  data[`${type}_orders`] = data[`${type}_orders`].filter(o => o.id !== +id);
  data[`${type}_items`]  = data[`${type}_items`].filter(i => i.order_id !== +id);
  saveData(data);
}

function updateStatus(type, id, status) {
  const data = loadData();
  const order = data[`${type}_orders`].find(o => o.id === +id);
  if (order) {
    order.status = status;
    order.updated_at = new Date().toISOString();
    if (status === '已完成') {
      order.completed_date = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
    }
    saveData(data);
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
// 禁用 HTML 缓存，确保每次都获取最新版本
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── 路由工厂 ─────────────────────────────────────────────────────────────────
['injection', 'slush', 'spray'].forEach(type => {
  app.get(`/api/${type}`, (req, res) => res.json(getOrders(type)));

  app.get(`/api/${type}/:id`, (req, res) => {
    const o = getOrderById(type, req.params.id);
    o ? res.json(o) : res.status(404).json({ error: '未找到' });
  });

  app.post(`/api/${type}`, (req, res) => {
    try {
      const { items, ...header } = req.body;
      res.status(201).json(createOrder(type, header, items));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put(`/api/${type}/:id`, (req, res) => {
    try {
      const { items, ...header } = req.body;
      const updated = updateOrder(type, req.params.id, header, items);
      updated ? res.json(updated) : res.status(404).json({ error: '未找到' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete(`/api/${type}/:id`, (req, res) => {
    deleteOrder(type, req.params.id);
    res.json({ success: true });
  });

  app.patch(`/api/${type}/:id/status`, (req, res) => {
    updateStatus(type, req.params.id, req.body.status);
    res.json({ success: true });
  });

  // 局部更新明细行字段（啤机填写 / 仓库填写）
  app.patch(`/api/${type}/:id/items`, (req, res) => {
    try {
      const data = loadData();
      const updates = req.body.updates || [];
      const items = data[`${type}_items`];
      updates.forEach(u => {
        const item = items.find(i => i.id === +u.id && i.order_id === +req.params.id);
        if (item) {
          const { id: _id, order_id: _oid, sort_order: _so, ...fields } = u;
          Object.assign(item, fields);
        }
      });
      saveData(data);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// ─── 问题反馈路由 ──────────────────────────────────────────────────────────────
app.get('/api/problems', (req, res) => {
  const data = loadData();
  let list = data.problems || [];
  if (req.query.type)     list = list.filter(p => p.order_type === req.query.type);
  if (req.query.order_id) list = list.filter(p => p.order_id === +req.query.order_id);
  res.json(list.sort((a, b) => b.id - a.id));
});

app.post('/api/problems', (req, res) => {
  const data = loadData();
  if (!data.problems) data.problems = [];
  const { order_type, order_id, order_number, description, reported_by } = req.body;
  const problem = {
    id: data.nextId++,
    order_type, order_id: +order_id, order_number,
    description, reported_by,
    status: '待处理',
    created_at: new Date().toISOString(),
    resolved_at: null
  };
  data.problems.push(problem);
  saveData(data);
  res.status(201).json(problem);
});

app.patch('/api/problems/:id/resolve', (req, res) => {
  const data = loadData();
  const p = (data.problems || []).find(p => p.id === +req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  p.status = '已解决';
  p.resolved_at = new Date().toISOString();
  saveData(data);
  res.json(p);
});

// ─── 原料价格管理 ──────────────────────────────────────────────────────────────
app.get('/api/material-prices', (req, res) => {
  const data = loadData();
  res.json(data.material_prices || DEFAULT_MATERIAL_PRICES.slice());
});

app.put('/api/material-prices', (req, res) => {
  try {
    const data = loadData();
    data.material_prices = req.body;
    saveData(data);
    res.json(data.material_prices);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── 原料用量汇总统计 ──────────────────────────────────────────────────────────
app.get('/api/material-stats', (req, res) => {
  const data = loadData();
  const month = req.query.month; // optional YYYY-MM filter

  // 以价格表为基础建立统计结构
  const stats = {};
  (data.material_prices || []).forEach((p, i) => {
    stats[p.material] = {
      seq: i + 1, material: p.material, unit_price: p.unit_price,
      notes: p.notes || '', total_actual_weight: 0, total_amount: 0
    };
  });

  // 如有月份、订单编号或车间过滤，先找出匹配的订单 ID 集合
  const orderSearch = req.query.order_number; // optional order number search
  const workshop = req.query.workshop; // optional workshop filter
  let validOrderIds = null;
  if (month || orderSearch || workshop) {
    const q = (orderSearch || '').toLowerCase();
    validOrderIds = new Set(
      (data.injection_orders || [])
        .filter(o => {
          if (month && !(o.date || '').startsWith(month)) return false;
          if (q && !((o.order_number || '') + (o.doc_number || '')).toLowerCase().includes(q)) return false;
          if (workshop && o.workshop !== workshop) return false;
          return true;
        })
        .map(o => o.id)
    );
  }

  // 累加 injection_items 里的仓库实填数据
  (data.injection_items || []).forEach(item => {
    if (!item.material) return;
    if (validOrderIds && !validOrderIds.has(item.order_id)) return;
    if (!stats[item.material]) {
      stats[item.material] = {
        seq: Object.keys(stats).length + 1, material: item.material,
        unit_price: 0, notes: '', total_actual_weight: 0, total_amount: 0
      };
    }
    stats[item.material].total_actual_weight += +(item.actual_weight_kg || 0);
    stats[item.material].total_amount        += +(item.actual_amount_hkd || 0);
  });
  res.json(Object.values(stats));
});

// ─── 啤办费用汇总 ─────────────────────────────────────────────────────────────
app.get('/api/injection-costs', (req, res) => {
  const data = loadData();
  const month = req.query.month; // optional YYYY-MM filter
  let orders = data.injection_orders || [];
  if (month) orders = orders.filter(o => (o.date || '').startsWith(month));
  const items = data.injection_items || [];
  const result = [];
  orders.forEach(o => {
    const orderItems = items.filter(i => i.order_id === o.id).sort((a,b) => a.sort_order - b.sort_order);
    orderItems.forEach(it => {
      result.push({
        order_number: o.order_number || '',
        doc_number: o.doc_number || '',
        date: o.date || '',
        workshop: o.workshop || '',
        mold_id: it.mold_id || '',
        mold_name: it.mold_name || '',
        injection_cost: it.injection_cost || null,
        notes: it.notes || ''
      });
    });
  });
  res.json(result);
});

// ─── 领料单 ───────────────────────────────────────────────────────────────────
app.get('/api/requisitions', (req, res) => {
  const data = loadData();
  let list = data.material_requisitions || [];
  if (req.query.order_id) list = list.filter(r => r.order_id === +req.query.order_id);
  res.json(list.sort((a, b) => b.id - a.id));
});

app.post('/api/requisitions', (req, res) => {
  try {
    const data = loadData();
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const dayReqs = (data.material_requisitions || []).filter(r => (r.req_number || '').includes(dateStr));
    const seq = String(dayReqs.length + 1).padStart(3, '0');
    const requisition = {
      id: data.nextId++,
      req_number: `LL-${dateStr}-${seq}`,
      date: req.body.date || now.toISOString().slice(0, 10),
      order_id: req.body.order_id ? +req.body.order_id : null,
      order_number: req.body.order_number || '',
      material: req.body.material || '',
      requested_weight_kg: +(req.body.requested_weight_kg) || 0,
      applicant: req.body.applicant || '',
      notes: req.body.notes || '',
      status: '待出库',
      issued_at: null,
      created_at: now.toISOString()
    };
    data.material_requisitions.push(requisition);
    saveData(data);
    res.status(201).json(requisition);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/requisitions/:id/status', (req, res) => {
  const data = loadData();
  const r = (data.material_requisitions || []).find(r => r.id === +req.params.id);
  if (!r) return res.status(404).json({ error: '未找到' });
  r.status = req.body.status;
  if (req.body.status === '已出库') r.issued_at = new Date().toISOString();
  saveData(data);
  res.json(r);
});

app.delete('/api/requisitions/:id', (req, res) => {
  const data = loadData();
  data.material_requisitions = (data.material_requisitions || []).filter(r => r.id !== +req.params.id);
  saveData(data);
  res.json({ success: true });
});

// ─── 统计 ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const data = loadData();
  const count = (arr, status) => status ? arr.filter(o => o.status === status).length : arr.length;
  const stat = type => ({
    total:      count(data[`${type}_orders`]),
    pending:    count(data[`${type}_orders`], '待生产'),
    inProgress: count(data[`${type}_orders`], '生产中'),
    done:       count(data[`${type}_orders`], '已完成')
  });
  res.json({ injection: stat('injection'), slush: stat('slush'), spray: stat('spray') });
});

// ─── 启动 ─────────────────────────────────────────────────────────────────────
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces))
    for (const iface of ifaces[name])
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('='.repeat(55));
  console.log('  生产订单管理系统已启动！');
  console.log('='.repeat(55));
  console.log(`  本机访问:   http://localhost:${PORT}`);
  console.log(`  局域网访问: http://${ip}:${PORT}`);
  console.log('='.repeat(55));
  console.log('  各部门入口:');
  console.log(`  工程部:  http://${ip}:${PORT}/engineering.html`);
  console.log(`  啤机部:  http://${ip}:${PORT}/injection.html`);
  console.log(`  搪胶部:  http://${ip}:${PORT}/slush.html`);
  console.log(`  喷油部:  http://${ip}:${PORT}/spray.html`);
  console.log(`  原料仓库: http://${ip}:${PORT}/warehouse.html`);
  console.log('='.repeat(55));
});
