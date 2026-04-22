const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

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

let _cache = null;

function loadData() {
  if (_cache) return _cache;
  if (!fs.existsSync(DATA_FILE)) { _cache = initData(); return _cache; }
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.material_prices || data.material_prices.length === 0) {
      data.material_prices = DEFAULT_MATERIAL_PRICES.slice();
    } else if (DEFAULT_MATERIAL_PRICES.length) {
      // Upsert：seed 中有但 data.json 中没有的材料自动补进去，已有的不覆盖（保留用户手动录入的价格）
      const existing = new Set(data.material_prices.map(p => normMat(p.material)));
      DEFAULT_MATERIAL_PRICES.forEach(p => {
        if (!existing.has(normMat(p.material))) data.material_prices.push(p);
      });
    }
    if (!data.material_requisitions) data.material_requisitions = [];
    if (!data.assembly_orders) data.assembly_orders = [];
    if (!data.assembly_items) data.assembly_items = [];
    if (!data.assembly_users) data.assembly_users = [];
    if (typeof data.exchange_rate_rmb_to_hkd !== 'number' || !(data.exchange_rate_rmb_to_hkd > 0)) {
      data.exchange_rate_rmb_to_hkd = 1.08;
    }
    _cache = data;
    return _cache;
  }
  catch (e) { _cache = initData(); return _cache; }
}


function initData() {
  return {
    injection_orders: [], injection_items: [],
    slush_orders: [],    slush_items: [],
    spray_orders: [],    spray_items: [],
    assembly_orders: [],  assembly_items: [],
    problems: [],
    material_prices: DEFAULT_MATERIAL_PRICES.slice(),
    material_requisitions: [],
    assembly_users: [],
    nextId: 1
  };
}

function saveData(data) {
  _cache = data;
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

// 月份匹配：容忍 "YYYY-M-D"（completed_date 可能不补零）与 "YYYY-MM" 比较
function monthMatches(dateStr, month) {
  if (!dateStr || !month) return false;
  const parts = String(dateStr).split(/[-\/]/);
  if (parts.length < 2) return false;
  const normalized = parts[0] + '-' + String(parts[1]).padStart(2, '0');
  return normalized === month;
}

// ─── 材料价格解析（模糊匹配 + 混合料按最高比例组分取价） ───────────────────
// 规范化：去掉空格/括号/横杠并转小写，用于模糊比对
//   "PP(EP332K)" / "PP (EP332K)" / "PPEP332K" / "pp-ep332k" → "ppep332k"
//   "TPR 3度" / "TPR 3°" / "TPR3度" → "tpr3°"（度/°统一；数字全半角统一）
function normMat(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/度/g, '°')
    .replace(/[\s\-\(\)（）_]/g, '');
}

// 构建 normalized material -> unit_price (>0) 的映射
function buildPriceMap(prices) {
  const map = {};
  (prices || []).forEach(p => {
    const price = +(p.unit_price || 0);
    if (price > 0 && p.material) map[normMat(p.material)] = price;
  });
  return map;
}

// 解析材料名获取单价：
// 1) 规范化直接匹配
// 2) 混合料 "70%ABS抽粒+30%ABS 750W" → 取比例最高的组分的单价
function resolvePrice(material, priceMap) {
  if (!material) return 0;
  const direct = priceMap[normMat(material)];
  if (direct) return direct;
  const parts = String(material).split(/[+＋]/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return 0;
  const mixed = parts.map(p => {
    const m = p.match(/^(\d+(?:\.\d+)?)\s*[%％]\s*(.+)$/);
    return m ? { pct: +m[1], name: m[2].trim() } : null;
  }).filter(Boolean);
  if (mixed.length < 2) return 0;
  mixed.sort((a, b) => b.pct - a.pct);
  for (const m of mixed) {
    const price = priceMap[normMat(m.name)];
    if (price) return price;
  }
  return 0;
}

// ─── 通用 CRUD 帮助 ─────────────────────────────────────────────────────────
function getOrders(type) {
  const data = loadData();
  const orders = data[`${type}_orders`].slice().sort((a, b) => b.id - a.id);
  // 用 Map 索引 items，避免 O(n²) 过滤
  const itemsByOrder = {};
  (data[`${type}_items`] || []).forEach(i => {
    (itemsByOrder[i.order_id] = itemsByOrder[i.order_id] || []).push(i);
  });
  orders.forEach(o => {
    o.items = (itemsByOrder[o.id] || []).sort((a,b) => a.sort_order - b.sort_order);
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

// ─── PIN 安全验证 ────────────────────────────────────────────────────────────
const PIN_SALT = process.env.PIN_SALT || 'rr-production-pin-salt-2026';
function hashPin(pin) {
  return crypto.createHash('sha256').update(PIN_SALT + String(pin)).digest('hex');
}

// PIN 已迁移到 data.json 的 auth_pins（哈希存储），源码不再保存明文 PIN
const DEFAULT_PIN = '1234';
const ALL_SUPERVISORS = ['段新辉','唐海林','蒙海欢','万志勇','章发东','刘际维','甘勇辉','王玉国'];
const ALL_MANAGERS = ['易东存'];

(function initPins() {
  const data = loadData();
  if (!data.auth_pins) data.auth_pins = {};
  if (!data.auth_pins.supervisors) data.auth_pins.supervisors = {};
  if (!data.auth_pins.manager) data.auth_pins.manager = {};
  if (!data.auth_pins_must_change) data.auth_pins_must_change = {};
  if (!data.auth_pins_must_change.supervisors) data.auth_pins_must_change.supervisors = {};
  if (!data.auth_pins_must_change.manager) data.auth_pins_must_change.manager = {};
  // 自动为没有 PIN 的主管/经理设置默认 PIN (1234)，并标记强制修改
  let changed = false;
  for (const name of ALL_SUPERVISORS) {
    if (!data.auth_pins.supervisors[name]) {
      data.auth_pins.supervisors[name] = hashPin(DEFAULT_PIN);
      data.auth_pins_must_change.supervisors[name] = true;
      changed = true;
      console.log(`Auto-initialized default PIN for supervisor: ${name}`);
    }
  }
  for (const name of ALL_MANAGERS) {
    if (!data.auth_pins.manager[name]) {
      data.auth_pins.manager[name] = hashPin(DEFAULT_PIN);
      data.auth_pins_must_change.manager[name] = true;
      changed = true;
      console.log(`Auto-initialized default PIN for manager: ${name}`);
    }
  }
  if (changed) saveData(data);
})();

function verifyPin(name, pin, role) {
  const data = loadData();
  const pins = data.auth_pins || {};
  const hash = hashPin(pin);
  if (role === 'manager') {
    return pins.manager && pins.manager[name] === hash;
  }
  return pins.supervisors && pins.supervisors[name] === hash;
}

// ─── PIN Brute-Force Lockout (in-memory, per IP+key) ─────────────────────────
// 5 failed attempts within 15 min triggers 15-min lockout.
const PIN_ATTEMPTS = new Map();
const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;
function checkPinLockout(key) {
  const rec = PIN_ATTEMPTS.get(key);
  if (!rec) return { allowed: true };
  if (rec.lockUntil && Date.now() < rec.lockUntil) {
    const remaining = Math.ceil((rec.lockUntil - Date.now()) / 1000);
    return { allowed: false, remaining };
  }
  return { allowed: true };
}
function recordPinFailure(key) {
  const now = Date.now();
  let rec = PIN_ATTEMPTS.get(key);
  if (!rec || now - rec.firstAt > PIN_WINDOW_MS) {
    rec = { count: 0, firstAt: now, lockUntil: 0 };
  }
  rec.count += 1;
  if (rec.count >= PIN_MAX_ATTEMPTS) {
    rec.lockUntil = now + PIN_WINDOW_MS;
  }
  PIN_ATTEMPTS.set(key, rec);
}
function clearPinFailures(key) {
  PIN_ATTEMPTS.delete(key);
}
function pinKey(req, name) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  return `${ip}:${name || 'anon'}`;
}

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'rr-production' }));

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
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ─── 写操作认证中间件 ─────────────────────────────────────────────────────────
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') return next();
  // PATCH /status 已有 PIN 验证
  if (req.method === 'PATCH' && req.path.match(/\/\d+\/status$/)) return next();
  // 认证端点本身不需要 X-User
  if (req.path === '/verify-pin' || req.path === '/change-pin' || req.path === '/reset-supervisor-pin' || req.path === '/recalc-amounts' || req.path === '/manager-update-prices') return next();
  const user = req.headers['x-user'];
  if (!user || !decodeURIComponent(user).trim()) {
    return res.status(401).json({ error: '未授权：请登录后操作' });
  }
  next();
});

// ─── 路由工厂 ─────────────────────────────────────────────────────────────────
['injection', 'slush', 'spray', 'assembly'].forEach(type => {
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

  // 主管审核后锁定，仅主管/经理可修改删除
  const LOCKED_STATUSES = ['待经理审核', '待生产', '生产中', '已完成'];

  function checkLock(req, res, order, action) {
    if (!order || !LOCKED_STATUSES.includes(order.status)) return false;
    const user = decodeURIComponent(req.headers['x-user'] || '');
    if (ALL_SUPERVISORS.includes(user) || ALL_MANAGERS.includes(user)) return false;
    res.status(403).json({ error: `主管已审核，普通用户不可${action}` });
    return true;
  }

  app.put(`/api/${type}/:id`, (req, res) => {
    try {
      const data = loadData();
      const order = data[`${type}_orders`].find(o => o.id === +req.params.id);
      if (checkLock(req, res, order, '修改')) return;
      const { items, ...header } = req.body;
      const updated = updateOrder(type, req.params.id, header, items);
      updated ? res.json(updated) : res.status(404).json({ error: '未找到' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete(`/api/${type}/:id`, (req, res) => {
    const data = loadData();
    const order = data[`${type}_orders`].find(o => o.id === +req.params.id);
    if (checkLock(req, res, order, '删除')) return;
    deleteOrder(type, req.params.id);
    res.json({ success: true });
  });

  app.patch(`/api/${type}/:id/status`, (req, res) => {
    const { status, pin, reviewer_name, reviewer_role } = req.body;
    // 审核操作需要 PIN 验证（主管审核 / 经理审核 / 驳回）
    const reviewStatuses = ['待经理审核', '待生产', '已驳回'];
    if (reviewStatuses.includes(status)) {
      if (!pin || !reviewer_name) {
        return res.status(403).json({ error: 'PIN验证失败' });
      }
      const role = reviewer_role || 'supervisor';
      if (!verifyPin(reviewer_name, pin, role)) {
        return res.status(403).json({ error: 'PIN验证失败' });
      }
    }
    // 发至模厂/发至湖南：经理审核通过（待生产）→ 直接设为已完成，实际用料=领料重量，自动计算料金额
    if (status === '待生产' && type === 'injection') {
      const data = loadData();
      const order = data.injection_orders.find(o => o.id === +req.params.id);
      const isAutoComplete = order && (
        order.send_to === '发至模厂' || order.send_to === '发至湖南' ||
        order.workshop === '模厂'
      );
      if (isAutoComplete) {
        order.status = '已完成';
        order.updated_at = new Date().toISOString();
        order.completed_date = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
        // 实际用料 = 领料重量，用料金额 = 领料重量 × 单价
        const priceMap = buildPriceMap(data.material_prices);
        const items = data.injection_items.filter(i => i.order_id === +req.params.id);
        items.forEach(item => {
          const weight = +(item.collected_weight_kg || item.required_material_kg || 0);
          const price = resolvePrice(item.material, priceMap);
          item.actual_weight_kg = weight;
          item.actual_amount_hkd = Math.round(weight * 2.20462 * price * 100) / 100;
        });
        saveData(data);
        return res.json({ success: true, auto_completed: true });
      }
    }
    // 驳回时保存原因
    if (status === '已驳回' && req.body.reason) {
      const data = loadData();
      const order = data[`${type}_orders`].find(o => o.id === +req.params.id);
      if (order) {
        order.status = status;
        order.reject_reason = req.body.reason;
        order.updated_at = new Date().toISOString();
        saveData(data);
        return res.json({ success: true });
      }
    }
    updateStatus(type, req.params.id, status);
    res.json({ success: true });
  });

  // 局部更新明细行字段（啤机填写 / 仓库填写）
  app.patch(`/api/${type}/:id/items`, (req, res) => {
    try {
      const data = loadData();
      const updates = req.body.updates || [];
      const items = data[`${type}_items`];
      const ITEM_WHITELIST = ['receipt_no','collected_weight_kg','actual_weight_kg','actual_amount_hkd','injection_cost'];
      const rate = +(data.exchange_rate_rmb_to_hkd || 1.08);
      updates.forEach(u => {
        const item = items.find(i => i.id === +u.id && i.order_id === +req.params.id);
        if (item) {
          ITEM_WHITELIST.forEach(f => { if (f in u) item[f] = u[f]; });
          // 啤办费：新录入的 injection_cost 视为 RMB，自动换算 HKD
          // 历史已录入但无 injection_cost_hkd 的订单保持原值（视为 HKD），不触发换算
          if (type === 'injection' && 'injection_cost' in u) {
            const rmb = +(u.injection_cost || 0);
            if (rmb > 0) {
              item.injection_cost_hkd = Math.round(rmb * rate * 100) / 100;
              item.exchange_rate_at_save = rate;
            } else {
              item.injection_cost_hkd = null;
              item.exchange_rate_at_save = null;
            }
          }
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

// ─── 权限角色查询 ──────────────────────────────────────────────────────────────
app.get('/api/roles', (req, res) => {
  res.json({ supervisors: ALL_SUPERVISORS, managers: ALL_MANAGERS });
});

// ─── 客户列表管理 ──────────────────────────────────────────────────────────────
const DEFAULT_CLIENTS = ['ZURU','JAZWARES','Moose','TOMY','Tigerhead','Zanzoon(嘉苏)','AZAD','Brybelly +Entertoymen','Lifelines','ToyMonster','Cepia','Tikino','Sky Castle','Masterkidz','John Adams','智海鑫','PWP(多美）','CareFocus','永恒','spin master','Tokidos'];

// 启动时合并客户默认列表（旧数据迁移，幂等）
(function initClients() {
  const data = loadData();
  if (!data.clients) {
    data.clients = DEFAULT_CLIENTS.slice();
    saveData(data);
  } else if (data.clients.length < DEFAULT_CLIENTS.length) {
    data.clients = [...new Set([...data.clients, ...DEFAULT_CLIENTS])];
    saveData(data);
  }
})();

app.get('/api/clients', (req, res) => {
  const data = loadData();
  res.json(data.clients || DEFAULT_CLIENTS);
});

app.put('/api/clients', (req, res) => {
  try {
    if (!Array.isArray(req.body) || !req.body.every(c => typeof c === 'string')) {
      return res.status(400).json({ error: '客户列表格式错误：需要字符串数组' });
    }
    const data = loadData();
    data.clients = req.body;
    saveData(data);
    res.json(data.clients);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── 系统设置（汇率等） ─────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const data = loadData();
  res.json({ exchange_rate_rmb_to_hkd: data.exchange_rate_rmb_to_hkd || 1.08 });
});

// ─── 原料价格管理 ──────────────────────────────────────────────────────────────
app.get('/api/material-prices', (req, res) => {
  const data = loadData();
  res.json(data.material_prices || DEFAULT_MATERIAL_PRICES.slice());
});

// 旧端点：仅更新价格表，不再触发回填（回填需走 /api/manager-update-prices，需经理 PIN）
// 保留以兼容现有 UI 调用；任何写改历史 actual_amount_hkd 的能力都收敛到经理端点
app.put('/api/material-prices', (req, res) => {
  try {
    if (!Array.isArray(req.body) || !req.body.every(p => p && typeof p === 'object' && typeof p.material === 'string')) {
      return res.status(400).json({ error: '原料价格格式错误：需要含 material 字段的对象数组' });
    }
    const data = loadData();
    data.material_prices = req.body;

    // 方案 C：补录价格后回填历史订单中「金额为 0 且重量>0」的明细
    // 已有金额的保留历史价格不动；本次仍为 0 的材料不处理
    const priceMap = buildPriceMap(data.material_prices);
    let backfilled = 0;
    (data.injection_items || []).forEach(item => {
      const amount = +(item.actual_amount_hkd || 0);
      const weight = +(item.actual_weight_kg || 0);
      if (amount > 0 || weight <= 0) return;
      const price = resolvePrice(item.material, priceMap);
      if (price <= 0) return;
      item.actual_amount_hkd = Math.round(weight * 2.20462 * price * 100) / 100;
      backfilled++;
    });
    saveData(data);
    res.json({ prices: data.material_prices, backfilled });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── 原料用量汇总统计 ──────────────────────────────────────────────────────────
app.get('/api/material-stats', (req, res) => {
  const data = loadData();
  const month = req.query.month; // optional YYYY-MM filter

  // 以价格表为基础建立统计结构（按规范化 key 聚合，容纳格式差异与混合料）
  const priceMap = buildPriceMap(data.material_prices);
  const stats = {};
  (data.material_prices || []).forEach((p, i) => {
    stats[normMat(p.material)] = {
      seq: i + 1, material: p.material, unit_price: +p.unit_price || 0,
      notes: p.notes || '', total_actual_weight: 0, total_amount: 0
    };
  });

  // 如有月份、订单编号、产品编号、客名或车间过滤，先找出匹配的订单 ID 集合
  const orderSearch = req.query.order_number; // optional order number search
  const workshop = req.query.workshop; // optional workshop filter
  const docSearch = req.query.doc_number; // optional product number search
  const clientSearch = req.query.client_name; // optional client name search
  // 只统计已完成订单，月份按完成日期匹配
  const q = (orderSearch || '').toLowerCase();
  const dq = (docSearch || '').toLowerCase();
  const cq = (clientSearch || '').toLowerCase();
  const validOrderIds = new Set(
    (data.injection_orders || [])
      .filter(o => {
        if (o.status !== '已完成') return false;
        if (month && !monthMatches(o.completed_date, month)) return false;
        if (q && !((o.order_number || '') + (o.doc_number || '')).toLowerCase().includes(q)) return false;
        if (dq && !(o.doc_number || '').toLowerCase().includes(dq)) return false;
        if (cq && !(o.client_name || '').toLowerCase().includes(cq)) return false;
        if (workshop && o.workshop !== workshop) return false;
        return true;
      })
      .map(o => o.id)
  );

  // 累加 injection_items 里的仓库实填数据（按规范化 key 合并同义名）
  (data.injection_items || []).forEach(item => {
    if (!item.material) return;
    if (!validOrderIds.has(item.order_id)) return;
    const key = normMat(item.material);
    if (!stats[key]) {
      // 价格表里没这条 → 尝试解析（含混合料）拿一个参考价，否则标记未录入
      const resolved = resolvePrice(item.material, priceMap);
      stats[key] = {
        seq: Object.keys(stats).length + 1, material: item.material,
        unit_price: resolved, notes: '', total_actual_weight: 0, total_amount: 0
      };
    }
    stats[key].total_actual_weight += +(item.actual_weight_kg || 0);
    stats[key].total_amount        += +(item.actual_amount_hkd || 0);
  });
  // 补充 no_price 标记供前端徽章判断
  const result = Object.values(stats).map(s => ({ ...s, no_price: !(+s.unit_price > 0) }));
  res.json(result);
});

// 发至外厂订单判定（模厂/湖南不计啤办费）
function isSendToExternal(o) {
  return o.send_to === '发至模厂' || o.send_to === '发至湖南' || o.workshop === '模厂';
}

// 按 order_id 预分组 items，避免端点里每个订单线性扫描整个 items 表（O(M*N) → O(M+N)）
function groupItemsByOrder(items) {
  const by = {};
  for (const it of items) {
    (by[it.order_id] ||= []).push(it);
  }
  for (const k in by) by[k].sort((a, b) => a.sort_order - b.sort_order);
  return by;
}

// ─── 啤办费用汇总 ─────────────────────────────────────────────────────────────
app.get('/api/injection-costs', (req, res) => {
  const data = loadData();
  const month = req.query.month; // optional YYYY-MM filter
  // 只统计已完成订单，月份按完成日期匹配
  let orders = (data.injection_orders || []).filter(o => o.status === '已完成');
  if (month) orders = orders.filter(o => monthMatches(o.completed_date, month));
  const itemsByOrder = groupItemsByOrder(data.injection_items || []);
  const result = [];
  orders.forEach(o => {
    const orderItems = itemsByOrder[o.id] || [];
    orderItems.forEach(it => {
      result.push({
        order_number: o.order_number || '',
        doc_number: o.doc_number || '',
        product_name: o.product_name || '',
        client_name: o.client_name || '',
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

// ─── 啤办总费用汇总（料费 + 啤办费） ─────────────────────────────────────────
app.get('/api/injection-total-costs', (req, res) => {
  const data = loadData();
  const month = req.query.month;
  // 只统计已完成订单，按完成月份分组（3月的订单在4月完成就算4月费用）
  let orders = (data.injection_orders || []).filter(o => o.status === '已完成');
  if (month) orders = orders.filter(o => monthMatches(o.completed_date, month));
  const itemsByOrder = groupItemsByOrder(data.injection_items || []);
  const priceMap = buildPriceMap(data.material_prices);
  const result = orders.map(o => {
    const orderItems = itemsByOrder[o.id] || [];
    // 发至模厂/发至湖南（或车间=模厂）的订单不统计啤办费，也不提示缺项
    const skipInjCost = isSendToExternal(o);
    let totalMat = 0, totalInj = 0, hasMissingPrice = false, hasMissingInj = false;
    const details = orderItems.map(it => {
      const matRaw = +(it.actual_amount_hkd || 0);
      const mat = Number.isFinite(matRaw) ? matRaw : 0;
      // 啤办费优先用 injection_cost_hkd（换算后），无则回退 injection_cost（legacy 视为 HKD）
      const injRaw = it.injection_cost;
      const hasRaw = !(injRaw === null || injRaw === undefined || injRaw === '');
      const injHkdRaw = it.injection_cost_hkd;
      const hasHkd = !(injHkdRaw === null || injHkdRaw === undefined || injHkdRaw === '');
      const injHkdNum = hasHkd ? +(injHkdRaw || 0) : (hasRaw ? +(injRaw || 0) : 0);
      const inj = Number.isFinite(injHkdNum) ? injHkdNum : 0;
      totalMat += mat;
      if (!skipInjCost) totalInj += inj;
      // 料价缺：有材料名但模糊解析找不到价格
      if (it.material && resolvePrice(it.material, priceMap) <= 0) hasMissingPrice = true;
      // 啤办费缺：没有填写（null/undefined/空字符串），发至订单除外
      if (!skipInjCost && !hasRaw && !hasHkd) hasMissingInj = true;
      return {
        mold_id: it.mold_id || '',
        mold_name: it.mold_name || '',
        material: it.material || '',
        material_cost: Math.round(mat * 100) / 100,
        injection_cost: skipInjCost ? null : (!hasRaw && !hasHkd ? null : inj),
        injection_cost_rmb: skipInjCost ? null : (hasHkd && hasRaw ? +injRaw : null)
      };
    });
    return {
      order_number: o.order_number || '',
      product_name: o.product_name || '',
      client_name: o.client_name || '',
      doc_number: o.doc_number || '',
      date: o.date || '',
      workshop: o.workshop || '',
      send_to: o.send_to || '',
      skip_inj: skipInjCost,
      status: o.status,
      total_material_cost: Math.round(totalMat * 100) / 100,
      total_injection_cost: Math.round(totalInj * 100) / 100,
      total_cost: Math.round((totalMat + totalInj) * 100) / 100,
      has_missing_price: hasMissingPrice,
      has_missing_injection_cost: hasMissingInj,
      items: details
    };
  });
  res.json(result);
});

// ─── 待审核提醒 ─────────────────────────────────────────────────────────────
app.get('/api/pending-reviews', (req, res) => {
  const data = loadData();
  const role = req.query.role;
  const name = req.query.name ? decodeURIComponent(req.query.name) : '';

  if (role === 'supervisor' && name) {
    const injPending = (data.injection_orders || []).filter(o => o.status === '待审核' && o.supervisor === name);
    const asmPending = (data.assembly_orders || []).filter(o => o.status === '待审核' && o.supervisor === name);
    const allPending = [...injPending, ...asmPending];
    return res.json({
      count: allPending.length,
      orders: allPending.map(o => ({
        id: o.id, order_number: o.order_number, client_name: o.client_name, date: o.date,
        type: injPending.includes(o) ? 'injection' : 'assembly'
      }))
    });
  }
  if (role === 'manager') {
    const injPending = (data.injection_orders || []).filter(o => o.status === '待经理审核');
    const asmPending = (data.assembly_orders || []).filter(o => o.status === '待经理审核');
    const allPending = [...injPending.map(o => ({ id: o.id, order_number: o.order_number, client_name: o.client_name, date: o.date, supervisor: o.supervisor, type: 'injection' })),
                        ...asmPending.map(o => ({ id: o.id, order_number: o.order_number, client_name: o.client_name, date: o.date, type: 'assembly' }))];
    return res.json({ count: allPending.length, orders: allPending });
  }
  res.json({ count: 0, orders: [] });
});

// ─── 发至订单手动触发完成并计算料费 ──────────────────────────────────────────
app.post('/api/injection/:id/auto-complete', (req, res) => {
  const data = loadData();
  const order = data.injection_orders.find(o => o.id === +req.params.id);
  if (!order) return res.status(404).json({ error: '未找到' });
  if (!isSendToExternal(order)) return res.status(400).json({ error: '该订单不是发至外厂订单' });
  order.status = '已完成';
  order.updated_at = new Date().toISOString();
  order.completed_date = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
  const priceMap = buildPriceMap(data.material_prices);
  const items = data.injection_items.filter(i => i.order_id === +req.params.id);
  items.forEach(item => {
    const weight = +(item.collected_weight_kg || item.required_material_kg || 0);
    const price = resolvePrice(item.material, priceMap);
    item.actual_weight_kg = weight;
    item.actual_amount_hkd = Math.round(weight * 2.20462 * price * 100) / 100;
  });
  saveData(data);
  res.json({ success: true });
});

// ─── 喷油部：实际收到胶件时间 ────────────────────────────────────────────────
app.patch('/api/spray/:id/actual-receive', (req, res) => {
  const data = loadData();
  const order = data.spray_orders.find(o => o.id === +req.params.id);
  if (!order) return res.status(404).json({ error: '未找到' });
  order.actual_receive_time = req.body.actual_receive_time || null;
  order.updated_at = new Date().toISOString();
  saveData(data);
  res.json({ success: true });
});

// ─── 喷油部：更新喷油部可编辑字段 ────────────────────────────────────────────
app.patch('/api/spray/:id/spray-fields', (req, res) => {
  const data = loadData();
  const order = data.spray_orders.find(o => o.id === +req.params.id);
  if (!order) return res.status(404).json({ error: '未找到' });
  const { actual_receive_time, spray_notes } = req.body;
  if (actual_receive_time !== undefined) order.actual_receive_time = actual_receive_time || null;
  if (spray_notes !== undefined) order.spray_notes = spray_notes || '';
  order.updated_at = new Date().toISOString();
  saveData(data);
  res.json({ success: true });
});

// ─── 喷油部：更新单项喷油复交货时间 ──────────────────────────────────────────
app.patch('/api/spray/:id/item-delivery', (req, res) => {
  const data = loadData();
  const order = data.spray_orders.find(o => o.id === +req.params.id);
  if (!order) return res.status(404).json({ error: '未找到' });
  const { item_id, delivery_time } = req.body;
  if (item_id === undefined) return res.status(400).json({ error: '参数不完整' });
  const items = data.spray_items.filter(i => i.order_id === +req.params.id);
  const item = items.find(it => it.id === item_id);
  if (!item) return res.status(404).json({ error: '未找到该项' });
  item.delivery_time = delivery_time || null;
  order.updated_at = new Date().toISOString();
  saveData(data);
  res.json({ success: true });
});

// ─── 喷油部：更新单项工序进度（按工序逐个打勾） ──────────────────────────────
app.patch('/api/spray/:id/item-progress', (req, res) => {
  const data = loadData();
  const order = data.spray_orders.find(o => o.id === +req.params.id);
  if (!order) return res.status(404).json({ error: '未找到' });
  const { item_id, processes_done, done_by } = req.body;
  if (item_id === undefined || !Array.isArray(processes_done) || !done_by) {
    return res.status(400).json({ error: '参数不完整' });
  }
  const items = data.spray_items.filter(i => i.order_id === +req.params.id);
  const item = items.find(it => it.id === item_id);
  if (!item) return res.status(404).json({ error: '未找到该项' });
  if (!item.process_status) item.process_status = {};
  const now = new Date().toISOString();
  processes_done.forEach(p => {
    item.process_status[p] = { done: true, done_by, done_at: now };
  });
  // 检查该项所有工序是否全部完成
  const allProcs = (item.process || '').split('/').map(s => s.trim()).filter(Boolean);
  const itemAllDone = allProcs.length > 0 && allProcs.every(p => item.process_status[p] && item.process_status[p].done);
  if (itemAllDone) {
    item.progress = '已完成';
    item.progress_by = done_by;
    item.progress_at = now;
  }
  // 有工序完成且订单仍为待生产 → 自动改为生产中
  if (order.status === '待生产') {
    order.status = '生产中';
  }
  // 所有项目都已完成 → 自动标记订单已完成
  const orderAllDone = items.every(it => it.progress === '已完成');
  if (orderAllDone) {
    order.status = '已完成';
    order.completed_date = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
  }
  order.updated_at = now;
  saveData(data);
  res.json({ success: true, item_done: itemAllDone, order_done: orderAllDone });
});

// ─── PIN 验证接口 ────────────────────────────────────────────────────────────
app.post('/api/verify-pin', (req, res) => {
  const { name, pin, role } = req.body;
  if (!name || !pin || !role) {
    return res.json({ success: false });
  }
  const success = verifyPin(name, pin, role);
  if (!success) return res.json({ success: false });
  const data = loadData();
  const bucket = role === 'manager' ? 'manager' : 'supervisors';
  const mustChange = !!(data.auth_pins_must_change && data.auth_pins_must_change[bucket] && data.auth_pins_must_change[bucket][name]);
  res.json({ success: true, must_change: mustChange });
});

// 经理重置主管 PIN（需经理 PIN 授权）
app.post('/api/reset-supervisor-pin', (req, res) => {
  const { manager_name, manager_pin, target_name, new_pin } = req.body;
  if (!manager_name || !manager_pin || !target_name || !new_pin) {
    return res.status(400).json({ error: '参数不完整' });
  }
  if (!ALL_MANAGERS.includes(manager_name)) {
    return res.status(400).json({ error: '经理不存在' });
  }
  const lockKey = pinKey(req, manager_name);
  const gate = checkPinLockout(lockKey);
  if (!gate.allowed) {
    return res.status(429).json({ error: `尝试过多，请 ${gate.remaining} 秒后重试` });
  }
  if (!verifyPin(manager_name, manager_pin, 'manager')) {
    recordPinFailure(lockKey);
    return res.status(403).json({ error: '经理 PIN 验证失败' });
  }
  clearPinFailures(lockKey);
  if (!ALL_SUPERVISORS.includes(target_name)) {
    return res.status(400).json({ error: '目标主管不存在' });
  }
  const newPinStr = String(new_pin);
  if (!/^\d{4,8}$/.test(newPinStr)) {
    return res.status(400).json({ error: '新 PIN 须为 4-8 位纯数字' });
  }
  const data = loadData();
  if (!data.auth_pins) data.auth_pins = { supervisors: {}, manager: {} };
  if (!data.auth_pins.supervisors) data.auth_pins.supervisors = {};
  if (!data.auth_pins_must_change) data.auth_pins_must_change = { supervisors: {}, manager: {} };
  if (!data.auth_pins_must_change.supervisors) data.auth_pins_must_change.supervisors = {};
  if (!Array.isArray(data.audit_log)) data.audit_log = [];
  data.auth_pins.supervisors[target_name] = hashPin(newPinStr);
  data.auth_pins_must_change.supervisors[target_name] = true;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  data.audit_log.push({
    ts: new Date().toISOString(),
    action: 'reset-supervisor-pin',
    actor: manager_name,
    target: target_name,
    ip,
    ua: req.headers['user-agent'] || ''
  });
  // cap audit log to last 2000 entries
  if (data.audit_log.length > 2000) data.audit_log = data.audit_log.slice(-2000);
  saveData(data);
  console.log(`[reset-pin] manager=${manager_name} reset supervisor=${target_name} from=${ip}`);
  res.json({ success: true });
});

// ─── 经理认证 + 审计辅助（manager-update-prices / recalc-amounts 共用） ─────
function authManager(req, res) {
  const { manager_name, manager_pin } = req.body;
  if (!manager_name || !manager_pin) {
    res.status(400).json({ error: '参数不完整' });
    return null;
  }
  if (!ALL_MANAGERS.includes(manager_name)) {
    res.status(400).json({ error: '经理不存在' });
    return null;
  }
  const lockKey = pinKey(req, manager_name);
  const gate = checkPinLockout(lockKey);
  if (!gate.allowed) {
    res.status(429).json({ error: `尝试过多，请 ${gate.remaining} 秒后重试` });
    return null;
  }
  if (!verifyPin(manager_name, manager_pin, 'manager')) {
    recordPinFailure(lockKey);
    res.status(403).json({ error: '经理 PIN 验证失败' });
    return null;
  }
  clearPinFailures(lockKey);
  return manager_name;
}

function appendAudit(data, req, action, actor, extra) {
  if (!Array.isArray(data.audit_log)) data.audit_log = [];
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  data.audit_log.push({
    ts: new Date().toISOString(),
    action,
    actor,
    ip,
    ua: req.headers['user-agent'] || '',
    ...(extra || {})
  });
  if (data.audit_log.length > 2000) data.audit_log = data.audit_log.slice(-2000);
}

// 经理更新价格表（保存后自动回填金额=0 的历史明细）
app.post('/api/manager-update-prices', (req, res) => {
  const actor = authManager(req, res);
  if (!actor) return;
  const { prices, exchange_rate } = req.body;
  if (!Array.isArray(prices)) {
    return res.status(400).json({ error: '参数不完整' });
  }
  if (!prices.every(p => p && typeof p === 'object' && typeof p.material === 'string' && p.material.trim())) {
    return res.status(400).json({ error: '价格数据格式错误' });
  }
  const data = loadData();
  data.material_prices = prices.map(p => ({
    material: String(p.material).trim(),
    unit_price: +(p.unit_price || 0),
    notes: String(p.notes || '')
  }));
  if (exchange_rate !== undefined && exchange_rate !== null && exchange_rate !== '') {
    const rate = +exchange_rate;
    if (!(rate > 0) || !Number.isFinite(rate)) {
      return res.status(400).json({ error: '汇率必须为正数' });
    }
    data.exchange_rate_rmb_to_hkd = rate;
  }
  const priceMap = buildPriceMap(data.material_prices);
  let backfilled = 0;
  (data.injection_items || []).forEach(item => {
    const amount = +(item.actual_amount_hkd || 0);
    const weight = +(item.actual_weight_kg || 0);
    if (amount > 0 || weight <= 0) return;
    const price = resolvePrice(item.material, priceMap);
    if (price <= 0) return;
    item.actual_amount_hkd = Math.round(weight * 2.20462 * price * 100) / 100;
    backfilled++;
  });
  appendAudit(data, req, 'manager-update-prices', actor, { total: data.material_prices.length, backfilled });
  saveData(data);
  console.log(`[price-update] manager=${actor} total=${data.material_prices.length} backfilled=${backfilled}`);
  res.json({ success: true, total: data.material_prices.length, backfilled });
});

// 经理一键重算：按当前价格表回填所有「金额=0 且 重量>0」的历史明细
app.post('/api/recalc-amounts', (req, res) => {
  const actor = authManager(req, res);
  if (!actor) return;
  const data = loadData();
  const priceMap = buildPriceMap(data.material_prices);
  let backfilled = 0, skipped = 0, missingPrice = 0;
  (data.injection_items || []).forEach(item => {
    const amount = +(item.actual_amount_hkd || 0);
    const weight = +(item.actual_weight_kg || 0);
    if (amount > 0 || weight <= 0) { skipped++; return; }
    const price = resolvePrice(item.material, priceMap);
    if (price <= 0) { missingPrice++; return; }
    item.actual_amount_hkd = Math.round(weight * 2.20462 * price * 100) / 100;
    backfilled++;
  });
  if (backfilled > 0) {
    appendAudit(data, req, 'recalc-amounts', actor, { backfilled, missing_price: missingPrice });
    saveData(data);
  }
  console.log(`[recalc] manager=${actor} backfilled=${backfilled} missing_price=${missingPrice}`);
  res.json({ success: true, backfilled, missing_price: missingPrice });
});

app.post('/api/change-pin', (req, res) => {
  const { name, old_pin, new_pin, role } = req.body;
  if (!name || !new_pin || !role) {
    return res.status(400).json({ error: '参数不完整' });
  }
  if (new_pin.length < 4) {
    return res.status(400).json({ error: 'PIN码至少4位' });
  }
  const data = loadData();
  const bucket = role === 'manager' ? 'manager' : 'supervisors';
  const existing = data.auth_pins[bucket][name];
  // 首次设置 PIN（用户不存在）：不需要旧 PIN
  if (existing) {
    if (!old_pin) return res.status(400).json({ error: '请输入原PIN码' });
    if (!verifyPin(name, old_pin, role)) {
      return res.status(403).json({ error: '原PIN码错误' });
    }
  }
  data.auth_pins[bucket][name] = hashPin(new_pin);
  if (data.auth_pins_must_change && data.auth_pins_must_change[bucket]) {
    delete data.auth_pins_must_change[bucket][name];
  }
  saveData(data);
  res.json({ success: true, first_time: !existing });
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

// ─── 夹具部用户验证 ──────────────────────────────────────────────────────────
app.post('/api/assembly-users/verify', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.json({ success: false });
  const data = loadData();
  const hash = hashPin(pin);
  const user = (data.assembly_users || []).find(u => u.name === name && u.pin === hash);
  res.json({ success: !!user });
});

app.get('/api/assembly-users', (req, res) => {
  const data = loadData();
  res.json((data.assembly_users || []).map(u => ({ name: u.name })));
});

app.post('/api/assembly-users', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: '姓名和PIN必填' });
  const data = loadData();
  if (!data.assembly_users) data.assembly_users = [];
  if (data.assembly_users.find(u => u.name === name)) {
    return res.status(400).json({ error: '用户已存在' });
  }
  data.assembly_users.push({ name, pin: hashPin(pin) });
  saveData(data);
  res.status(201).json({ success: true });
});

// ─── 统计 ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const data = loadData();
  const count = (arr, status) => status ? arr.filter(o => o.status === status).length : arr.length;
  const stat = type => ({
    total:      count(data[`${type}_orders`] || []),
    pending:    count(data[`${type}_orders`] || [], '待生产'),
    inProgress: count(data[`${type}_orders`] || [], '生产中'),
    done:       count(data[`${type}_orders`] || [], '已完成')
  });
  res.json({ injection: stat('injection'), slush: stat('slush'), spray: stat('spray'), assembly: stat('assembly') });
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
  console.log(`  夹具部:  http://${ip}:${PORT}/assembly.html`);
  console.log(`  原料仓库: http://${ip}:${PORT}/warehouse.html`);
  console.log('='.repeat(55));
});
