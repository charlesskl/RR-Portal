// 自动化设备统计系统 - 后端服务
// Express + JSON 文件存储（与工程啤办单同模式），数据落盘 data/data.json
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3008;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// ─── 种子数据（迁移自原 OpenAI Sites 版本 2026-08-15 快照）─────────────────────
const SEED = {
  nextId: 100,
  equipment: [
    { id: 1, factory: '兴信B', workshop: '装配', name: '视觉贴标机', qty: 51, unitPrice: 43089, investment: 252.59, maOrder: 8660, orders: 4813.52, saved: 683.04, balance: 358.20, unitSave: .1419, update: '08-15' },
    { id: 2, factory: '兴信B', workshop: '装配', name: 'NFC检测机', qty: 1, unitPrice: 12000, investment: 1.38, maOrder: 0, orders: 7.2, saved: 0.05, balance: -1.38, unitSave: .007, update: '08-15' },
    { id: 3, factory: '兴信A', workshop: '装配', name: '视觉贴标机-单机', qty: 2, unitPrice: 32000, investment: 7.36, maOrder: 1324, orders: 41.52, saved: 1.79, balance: -5.57, unitSave: .043, update: '08-15' },
    { id: 4, factory: '兴信A', workshop: '装配', name: '称重机', qty: 15, unitPrice: 18800, investment: 32.41, maOrder: 22141, orders: 4235.53, saved: 21.18, balance: -11.24, unitSave: .005, update: '08-15' },
    { id: 5, factory: '兴信A', workshop: '喷油', name: 'UV蜘蛛手', qty: 4, unitPrice: 33000, investment: 15.17, maOrder: 700, orders: 505.52, saved: 48.02, balance: 32.85, unitSave: .095, update: '08-15' },
    { id: 6, factory: '华登', workshop: '喷油', name: '6轴喷油机器人', qty: 1, unitPrice: 68000, investment: 7.82, maOrder: 500, orders: 259.56, saved: 16.87, balance: 9.06, unitSave: .065, update: '08-15' },
    { id: 7, factory: '华嘉', workshop: '装配', name: '富格乐飞机盒拆盒机', qty: 3, unitPrice: 68500, investment: 23.62, maOrder: 0, orders: 255.00, saved: 20.91, balance: -2.71, unitSave: .082, update: '08-15' },
    { id: 8, factory: '华嘉', workshop: '装配', name: '富格乐飞机盒贴标机', qty: 5, unitPrice: 36800, investment: 21.15, maOrder: 0, orders: 353.28, saved: 17.31, balance: -3.84, unitSave: .049, update: '08-15' },
    { id: 9, factory: '湖南', workshop: '装配', name: '自动拆盒粘胶装盒封盒装卡片一体机', qty: 1, unitPrice: 206000, investment: 23.68, maOrder: 0, orders: 12.11, saved: 2.06, balance: -21.62, unitSave: .17, update: '08-15' },
    { id: 10, factory: '湖南', workshop: '装配', name: '半自动四方形贴标机', qty: 2, unitPrice: 14000, investment: 3.22, maOrder: 0, orders: 52.87, saved: 13.66, balance: 10.44, unitSave: .2583, update: '08-15' },
    { id: 11, factory: '河源', workshop: '装配', name: '套标+收缩一体机', qty: 1, unitPrice: 95000, investment: 10.92, maOrder: 0, orders: 0, saved: 0, balance: -10.92, unitSave: .17, update: '08-15' },
    { id: 12, factory: '河源', workshop: '装配', name: '立式包装机', qty: 2, unitPrice: 32500, investment: 3.74, maOrder: 0, orders: 0, saved: 0, balance: -3.74, unitSave: .04, update: '08-15' },
    { id: 13, factory: '河源', workshop: '装配', name: '半自动圆形贴标机', qty: 2, unitPrice: 2500, investment: .29, maOrder: 0, orders: 0, saved: 0, balance: -.29, unitSave: .06, update: '08-15' },
    { id: 14, factory: '河源', workshop: '装配', name: '点胶机', qty: 2, unitPrice: 33000, investment: 3.79, maOrder: 0, orders: 0, saved: 0, balance: -3.79, unitSave: .34, update: '08-15' },
  ],
  records: [
    { id: 1, date: '2026-08-15', factory: '华嘉', workshop: '装配', equipment: '富格乐飞机盒贴标机', line: '2号机', production: 18600, operator: '部门负责人', note: '日常产量上报' },
    { id: 2, date: '2026-08-15', factory: '湖南', workshop: '装配', equipment: '半自动四方形贴标机', line: '1号线', production: 12400, operator: '部门负责人', note: 'SkyCastle四方盒' },
    { id: 3, date: '2026-08-14', factory: '兴信B', workshop: '装配', equipment: 'NFC检测机', line: '1号线', production: 30000, operator: '部门负责人', note: '数据已同步' },
  ],
  users: [
    { id: 1, name: '陈管理员', account: 'wendyxiaowen5@gmail.com', role: '系统管理员', department: '全部部门', workshop: '全部车间', status: true },
    { id: 2, name: '兴信A负责人', account: 'xingxina@company.com', role: '部门负责人', department: '兴信A', workshop: '全部车间', status: true },
    { id: 3, name: '华嘉装配车间', account: 'huajia-zp@company.com', role: '车间录入员', department: '华嘉', workshop: '装配', status: true },
    { id: 4, name: '河源装配车间', account: 'heyuan-zp@company.com', role: '车间录入员', department: '河源', workshop: '装配', status: false },
  ],
};

// ─── JSON 文件存储（原子写入）─────────────────────────────────────────────────
let _cache = null;
function loadData() {
  if (_cache) return _cache;
  if (!fs.existsSync(DATA_FILE)) {
    _cache = JSON.parse(JSON.stringify(SEED));
    saveData(_cache);
    return _cache;
  }
  _cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return _cache;
}
function saveData(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
  _cache = data;
}

function publicState(data) {
  return {
    equipment: data.equipment,
    records: data.records,
    users: data.users.map(({ passwordHash, passwordSalt, ...user }) => user),
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {
    passwordSalt: salt,
    passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'),
  };
}

// 更新日期显示格式（MM-DD，中国时区）
function todayLabel() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ─── 计算公式（与原页面逻辑一致）───────────────────────────────────────────────
// investment：RMB → HKD（汇率 0.87），单位万
function calcInvestment(unitPrice, qty) { return unitPrice * qty / 0.87 / 10000; }

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/state', (req, res) => res.json(publicState(loadData())));

// 新增设备
app.post('/api/equipment', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.department || !b.workshop) return res.status(400).json({ error: '缺少必填字段' });
  const data = loadData();
  if (data.equipment.some(e => e.factory === b.department && e.workshop === b.workshop && e.name === b.name)) {
    return res.status(409).json({ error: '该部门车间下已存在同名设备' });
  }
  const qty = Number(b.quantity) || 1;
  const unitPrice = Number(b.unitPrice) || 0;
  const unitSave = Math.max(0, (Number(b.manualPrice) || 0) - (Number(b.machinePrice) || 0));
  const orders = Number(b.orders) || 0;
  const investment = calcInvestment(unitPrice, qty);
  const saved = orders * unitSave;
  data.equipment.push({
    id: data.nextId++, factory: b.department, workshop: b.workshop, name: b.name,
    qty, unitPrice, investment, maOrder: Number(b.maOrder) || 0, orders, saved,
    balance: saved - investment, unitSave, update: todayLabel(),
  });
  saveData(data);
  res.status(201).json(publicState(data));
});

// 编辑设备
app.put('/api/equipment/:id', (req, res) => {
  const data = loadData();
  const eq = data.equipment.find(e => e.id === +req.params.id);
  if (!eq) return res.status(404).json({ error: '设备不存在' });
  const b = req.body || {};
  const qty = Number(b.quantity) || 1;
  const unitPrice = Number(b.unitPrice) || 0;
  const unitSave = Number(b.unitSave) || 0;
  const orders = Number(b.orders) || 0;
  const investment = calcInvestment(unitPrice, qty);
  const saved = orders * unitSave;
  Object.assign(eq, {
    factory: b.department ?? eq.factory, workshop: b.workshop ?? eq.workshop,
    name: b.name ?? eq.name, qty, unitPrice, investment,
    maOrder: Number(b.maOrder) || 0, orders, saved,
    balance: saved - investment, unitSave, update: todayLabel(),
  });
  saveData(data);
  res.json(publicState(data));
});

// 录入生产数据：追加记录并重算设备累计
app.post('/api/records', (req, res) => {
  const b = req.body || {};
  const production = Number(b.production) || 0;
  if (!b.equipment || !production) return res.status(400).json({ error: '缺少必填字段' });
  const data = loadData();
  const eq = data.equipment.find(e => e.factory === b.department && e.workshop === b.workshop && e.name === b.equipment);
  if (eq) {
    eq.orders += production / 10000;
    eq.saved += production * eq.unitSave / 10000;
    eq.balance += production * eq.unitSave / 10000;
    eq.update = todayLabel();
  }
  data.records.unshift({
    id: data.nextId++, date: b.date || new Date().toISOString().slice(0, 10),
    factory: b.department, workshop: b.workshop, equipment: b.equipment,
    line: b.line || '未填写', production, operator: '当前负责人', note: b.note || '日常产量上报',
  });
  saveData(data);
  res.status(201).json(publicState(data));
});

// 新增用户
app.post('/api/users', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.account || !b.role || !b.password) return res.status(400).json({ error: '缺少必填字段' });
  if (String(b.password).length < 8) return res.status(400).json({ error: '密码至少需要 8 位字符' });
  const data = loadData();
  if (data.users.some(u => u.account === b.account)) return res.status(409).json({ error: '账号已存在' });
  data.users.push({
    id: data.nextId++, name: b.name, account: b.account, role: b.role,
    department: b.department || '全部部门', workshop: b.workshop || '全部车间', status: true,
    ...hashPassword(String(b.password)),
  });
  saveData(data);
  res.status(201).json(publicState(data));
});

// 启用/停用用户
app.patch('/api/users/:id', (req, res) => {
  const data = loadData();
  const user = data.users.find(u => u.id === +req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (typeof req.body?.status === 'boolean') user.status = req.body.status;
  if (req.body?.role) user.role = req.body.role;
  if (req.body?.department) user.department = req.body.department;
  if (req.body?.workshop) user.workshop = req.body.workshop;
  saveData(data);
  res.json(publicState(data));
});

// 管理员重置用户密码；只保存 scrypt 哈希和随机盐，不落盘明文密码
app.put('/api/users/:id/password', (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ error: '密码至少需要 8 位字符' });
  const data = loadData();
  const user = data.users.find(u => u.id === +req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  Object.assign(user, hashPassword(password));
  saveData(data);
  res.json(publicState(data));
});

// ─── 静态资源（Vite 构建产物）+ SPA 回退 ─────────────────────────────────────
const DIST_DIR = path.join(__dirname, 'dist');
app.use(express.static(DIST_DIR, { maxAge: '1h' }));
app.get(/^(?!\/(api|health)(\/|$)).*/, (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`自动化设备统计系统已启动: http://localhost:${PORT}`);
});
