const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const XLSX = require('xlsx');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const d = require('./db');
const { migrateIfNeeded } = require('./migrate');

// Run data migration (data.json → SQLite) on startup if needed
migrateIfNeeded();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'rr-procurement-secret-change-in-production';
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_PATH || path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// File upload: only xlsx/xls, max 10MB
const upload = multer({
  dest: path.join(os.tmpdir(), 'po-uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('只允许上传 Excel 文件 (.xlsx, .xls)'));
  }
});

// ─── Image Helper ───────────────────────────────────────────────────────
function saveImage(imageData) {
  if (!imageData) return '';
  const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) return '';
  const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const filename = Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return 'uploads/' + filename;
}

// ─── Middleware ──────────────────────────────────────────────────────────
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Health check (no auth needed)
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Login rate limiting: max 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '登录尝试过多，请15分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false
});

// JWT helper
function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.substring(7), JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Auth middleware: optional — allow all requests, populate req.user when token present
app.use('/api', (req, res, next) => {
  if (req.path === '/login') return next();
  const payload = verifyToken(req);
  req.user = payload ? payload.name : '管理员';
  next();
});

// ─── Login ──────────────────────────────────────────────────────────────
app.post('/api/login', loginLimiter, (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: '请输入用户名和密码' });
  const user = d.getUser(name);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });

  let pinMatch = false;
  if (user.pin && user.pin.startsWith('$2')) {
    pinMatch = bcrypt.compareSync(String(pin), user.pin);
  } else {
    pinMatch = user.pin === String(pin);
    if (pinMatch) {
      d.updateUserPin(user.name, bcrypt.hashSync(String(pin), 10));
    }
  }
  if (!pinMatch) return res.status(401).json({ error: '用户名或密码错误' });

  const token = jwt.sign({ name: user.name }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ success: true, name: user.name, token: token });
});

// ─── Base Data ──────────────────────────────────────────────────────────
app.get('/api/factories', (req, res) => {
  res.json({ mold_factories: d.getMoldFactories(), figure_factories: d.getFigureFactories() });
});

app.get('/api/customers', (req, res) => {
  res.json(d.getCustomers());
});

// ═══════════════════════════════════════════════════════════════════════
// MOLD ORDERS
// ═══════════════════════════════════════════════════════════════════════

// Stats (MUST be before /:id)
app.get('/api/mold-orders/stats', (req, res) => {
  const { year, month, group, group_by } = req.query;
  const orders = d.listMoldOrders({ year, month, group });

  const key = group_by === 'customer' ? 'customer' : group_by === 'workshop' ? 'group' : 'mold_factory';
  const grouped = {};
  orders.forEach(o => {
    const k = o[key] || '未知';
    if (!grouped[k]) grouped[k] = { name: k, count: 0, total_fee: 0 };
    grouped[k].count++;
    grouped[k].total_fee += (o.amount || 0);
  });

  const monthly = {};
  orders.forEach(o => {
    if (!o.order_date) return;
    const m = o.order_date.substring(0, 7);
    if (!monthly[m]) monthly[m] = { month: m, count: 0, total_fee: 0 };
    monthly[m].count++;
    monthly[m].total_fee += (o.amount || 0);
  });

  res.json({
    summary: Object.values(grouped).sort((a, b) => b.total_fee - a.total_fee),
    monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
    total_count: orders.length,
    total_fee: orders.reduce((s, o) => s + (o.amount || 0), 0)
  });
});

// List
app.get('/api/mold-orders', (req, res) => {
  const { group, factory, customer, status, year, month } = req.query;
  res.json(d.listMoldOrders({ group, factory, customer, status, year, month }));
});

// Get single
app.get('/api/mold-orders/:id', (req, res) => {
  const order = d.getMoldOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: '订单不存在' });
  res.json(order);
});

// Create
app.post('/api/mold-orders', (req, res) => {
  const user = req.user || '';
  const image = req.body.image_data ? saveImage(req.body.image_data) : '';
  const now = new Date().toISOString();
  const order = d.createMoldOrder({
    group: req.body.group || '',
    customer: req.body.customer || '',
    mold_name: req.body.mold_name || '',
    material: req.body.material || '',
    gate: req.body.gate || '',
    cav_up: req.body.cav_up || '',
    unit_price: Number(req.body.unit_price) || 0,
    amount: Number(req.body.amount) || 0,
    image: image,
    mold_factory: req.body.mold_factory || '',
    order_date: req.body.order_date || '',
    mold_start_date: req.body.mold_start_date || '',
    delivery_date: req.body.delivery_date || '',
    status: '已下单',
    payment_type: req.body.payment_type || '',
    notes: req.body.notes || '',
    created_by: user,
    created_at: now,
    updated_at: now
  });
  if (order.customer) d.addCustomer(order.customer);
  res.json(order);
});

// Update
app.put('/api/mold-orders/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = d.getMoldOrder(id);
  if (!existing) return res.status(404).json({ error: '订单不存在' });
  const patch = {};
  ['group', 'customer', 'mold_name', 'material', 'gate', 'cav_up', 'mold_factory',
   'order_date', 'mold_start_date', 'delivery_date', 'payment_type', 'notes'].forEach(f => {
    if (req.body[f] !== undefined) patch[f] = req.body[f];
  });
  if (req.body.unit_price !== undefined) patch.unit_price = Number(req.body.unit_price) || 0;
  if (req.body.amount !== undefined) patch.amount = Number(req.body.amount) || 0;
  if (req.body.image_data) patch.image = saveImage(req.body.image_data);
  patch.updated_at = new Date().toISOString();
  const order = d.updateMoldOrder(id, patch);
  if (order.customer) d.addCustomer(order.customer);
  res.json(order);
});

// Delete
app.delete('/api/mold-orders/:id', (req, res) => {
  const ok = d.deleteMoldOrder(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: '订单不存在' });
  res.json({ success: true });
});

// Status transition
app.put('/api/mold-orders/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const order = d.getMoldOrder(id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const validTransitions = {
    '已下单': ['已开模'],
    '已开模': ['已交模'],
    '已交模': ['已完成']
  };
  const newStatus = req.body.status;
  if (!validTransitions[order.status] || !validTransitions[order.status].includes(newStatus)) {
    return res.status(400).json({ error: '无效的状态变更' });
  }
  res.json(d.updateMoldOrder(id, { status: newStatus, updated_at: new Date().toISOString() }));
});

// ═══════════════════════════════════════════════════════════════════════
// FIGURE ORDERS
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/figure-orders/stats', (req, res) => {
  const { year, month, group, group_by } = req.query;
  const orders = d.listFigureOrders({ year, month, group });

  const key = group_by === 'customer' ? 'customer' : group_by === 'workshop' ? 'group' : 'figure_factory';
  const grouped = {};
  orders.forEach(o => {
    const k = o[key] || '未知';
    if (!grouped[k]) grouped[k] = { name: k, count: 0, qty: 0, total_fee: 0 };
    grouped[k].count++;
    grouped[k].qty += (o.quantity || 0);
    grouped[k].total_fee += (o.figure_fee || 0);
  });

  const monthly = {};
  orders.forEach(o => {
    if (!o.order_date) return;
    const m = o.order_date.substring(0, 7);
    if (!monthly[m]) monthly[m] = { month: m, count: 0, qty: 0, total_fee: 0 };
    monthly[m].count++;
    monthly[m].qty += (o.quantity || 0);
    monthly[m].total_fee += (o.figure_fee || 0);
  });

  res.json({
    summary: Object.values(grouped).sort((a, b) => b.total_fee - a.total_fee),
    monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
    total_count: orders.length,
    total_qty: orders.reduce((s, o) => s + (o.quantity || 0), 0),
    total_fee: orders.reduce((s, o) => s + (o.figure_fee || 0), 0)
  });
});

app.get('/api/figure-orders', (req, res) => {
  const { group, factory, customer, status, year, month } = req.query;
  res.json(d.listFigureOrders({ group, factory, customer, status, year, month }));
});

app.get('/api/figure-orders/:id', (req, res) => {
  const order = d.getFigureOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: '订单不存在' });
  res.json(order);
});

app.post('/api/figure-orders', (req, res) => {
  const user = req.user || '';
  const now = new Date().toISOString();
  const order = d.createFigureOrder({
    group: req.body.group || '',
    customer: req.body.customer || '',
    product_name: req.body.product_name || '',
    quantity: Number(req.body.quantity) || 0,
    figure_fee: Number(req.body.figure_fee) || 0,
    figure_factory: req.body.figure_factory || '',
    order_date: req.body.order_date || '',
    status: '已下单',
    payment_type: req.body.payment_type || '',
    notes: req.body.notes || '',
    created_by: user,
    created_at: now,
    updated_at: now
  });
  if (order.customer) d.addCustomer(order.customer);
  res.json(order);
});

app.put('/api/figure-orders/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = d.getFigureOrder(id);
  if (!existing) return res.status(404).json({ error: '订单不存在' });
  const patch = {};
  ['group', 'customer', 'product_name', 'figure_factory', 'order_date',
   'payment_type', 'notes'].forEach(f => {
    if (req.body[f] !== undefined) patch[f] = req.body[f];
  });
  if (req.body.quantity !== undefined) patch.quantity = Number(req.body.quantity) || 0;
  if (req.body.figure_fee !== undefined) patch.figure_fee = Number(req.body.figure_fee) || 0;
  patch.updated_at = new Date().toISOString();
  const order = d.updateFigureOrder(id, patch);
  if (order.customer) d.addCustomer(order.customer);
  res.json(order);
});

app.delete('/api/figure-orders/:id', (req, res) => {
  const ok = d.deleteFigureOrder(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: '订单不存在' });
  res.json({ success: true });
});

app.put('/api/figure-orders/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const order = d.getFigureOrder(id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  const validTransitions = {
    '已下单': ['制作中'],
    '制作中': ['已完成']
  };
  const newStatus = req.body.status;
  if (!validTransitions[order.status] || !validTransitions[order.status].includes(newStatus)) {
    return res.status(400).json({ error: '无效的状态变更' });
  }
  res.json(d.updateFigureOrder(id, { status: newStatus, updated_at: new Date().toISOString() }));
});

// ═══════════════════════════════════════════════════════════════════════
// PURCHASE ORDERS
// ═══════════════════════════════════════════════════════════════════════

function generatePoNumber(type) {
  const prefix = type === 'mold' ? 'B' : 'F';
  const dt = new Date();
  const dateStr = dt.getFullYear().toString() +
    String(dt.getMonth() + 1).padStart(2, '0') +
    String(dt.getDate()).padStart(2, '0');
  return prefix + dateStr;
}

app.get('/api/purchase-orders/next-number', (req, res) => {
  const type = req.query.type || 'mold';
  res.json({ po_number: generatePoNumber(type) });
});

app.get('/api/purchase-orders', (req, res) => {
  const { type, group, year, status } = req.query;
  res.json(d.listPurchaseOrders({ type, group, status, year }));
});

app.get('/api/purchase-orders/:id', (req, res) => {
  const po = d.getPurchaseOrder(Number(req.params.id));
  if (!po) return res.status(404).json({ error: '采购单不存在' });
  res.json(po);
});

app.post('/api/purchase-orders', (req, res) => {
  const user = req.user || '';
  const b = req.body;
  const items = (b.items || []).map((item, i) => {
    const processed = { ...item, seq: i + 1 };
    if (item.image_data) {
      processed.image = saveImage(item.image_data);
      delete processed.image_data;
    }
    return processed;
  });

  const po = d.createPurchaseOrder({
    po_number: b.po_number || generatePoNumber(b.type),
    type: b.type || 'mold',
    group: b.group || '',
    supplier_name: b.supplier_name || '',
    supplier_contact: b.supplier_contact || '',
    supplier_phone: b.supplier_phone || '',
    supplier_fax: b.supplier_fax || '',
    our_contact: b.our_contact || '',
    our_phone: b.our_phone || '0769-87362376',
    product_name: b.product_name || '',
    customer: b.customer || '',
    items: items,
    delivery_date_text: b.delivery_date_text || '',
    delivery_address: b.delivery_address || '东莞清溪上元管理区银坑路兴信厂',
    payment_terms: b.payment_terms || '开模付首期款50%，交模后付尾期50%',
    payment_type: b.payment_type || '',
    tax_rate: Number(b.tax_rate) || 13,
    settlement_days: Number(b.settlement_days) || 30,
    notes: b.notes || '',
    status: '草稿',
    created_by: user,
    created_at: new Date().toISOString(),
    updated_at: ''
  });
  res.json(po);
});

app.put('/api/purchase-orders/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = d.getPurchaseOrder(id);
  if (!existing) return res.status(404).json({ error: '采购单不存在' });
  const b = req.body;
  const patch = {};
  ['po_number', 'type', 'group', 'supplier_name', 'supplier_contact', 'supplier_phone',
   'supplier_fax', 'our_contact', 'our_phone', 'product_name', 'customer',
   'delivery_date_text', 'delivery_address', 'payment_terms', 'payment_type', 'notes'].forEach(f => {
    if (b[f] !== undefined) patch[f] = b[f];
  });
  if (b.tax_rate !== undefined) patch.tax_rate = Number(b.tax_rate) || 13;
  if (b.settlement_days !== undefined) patch.settlement_days = Number(b.settlement_days) || 30;
  if (b.items) {
    patch.items = b.items.map((item, i) => {
      const processed = { ...item, seq: i + 1 };
      if (item.image_data) {
        processed.image = saveImage(item.image_data);
        delete processed.image_data;
      }
      return processed;
    });
  }
  patch.updated_at = new Date().toISOString();
  res.json(d.updatePurchaseOrder(id, patch));
});

app.delete('/api/purchase-orders/:id', (req, res) => {
  const ok = d.deletePurchaseOrder(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: '采购单不存在' });
  res.json({ success: true });
});

// Status transition — on confirm, auto-create summary order in main list
app.put('/api/purchase-orders/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const po = d.getPurchaseOrder(id);
  if (!po) return res.status(404).json({ error: '采购单不存在' });
  const valid = { '草稿': ['已确认'], '已确认': ['草稿'] };
  const newStatus = req.body.status;
  if (!valid[po.status] || !valid[po.status].includes(newStatus)) {
    return res.status(400).json({ error: '无效的状态变更' });
  }

  const now = new Date().toISOString();
  const updatedPO = d.updatePurchaseOrder(id, { status: newStatus, updated_at: now });

  if (newStatus === '已确认') {
    const user = req.user || '';
    const items = po.items || [];
    const totalAmount = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    const today = now.substring(0, 10);

    if (po.type === 'mold') {
      d.createMoldOrder({
        group: po.group || '',
        customer: po.product_name || '',
        mold_name: items.map(it => it.part_name).filter(Boolean).join(', ') || po.product_name || '',
        amount: totalAmount,
        mold_factory: po.supplier_name || '',
        order_date: today,
        status: '已下单',
        payment_type: po.payment_type || '',
        notes: '来自采购单 ' + po.po_number,
        created_by: user,
        created_at: now,
        updated_at: now,
        from_po_id: po.id
      });
    } else {
      d.createFigureOrder({
        group: po.group || '',
        customer: po.product_name || '',
        product_name: items.map(it => it.product_name).filter(Boolean).join(', ') || po.product_name || '',
        quantity: totalQty,
        figure_fee: totalAmount,
        figure_factory: po.supplier_name || '',
        order_date: today,
        status: '已下单',
        payment_type: po.payment_type || '',
        notes: '来自采购单 ' + po.po_number,
        created_by: user,
        created_at: now,
        updated_at: now,
        from_po_id: po.id
      });
    }
  }

  res.json(updatedPO);
});

// ═══════════════════════════════════════════════════════════════════════
// IMPORT EXCEL PO  (parseExcelPO unchanged from previous version)
// ═══════════════════════════════════════════════════════════════════════

function getCellValue(ws, r, c) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr];
  return cell ? String(cell.v).trim() : '';
}

function getNextCellValue(ws, r, c, maxC) {
  for (let cc = c + 1; cc <= Math.min(c + 3, maxC); cc++) {
    const v = getCellValue(ws, r, cc);
    if (v) return v;
  }
  return '';
}

function parseExcelPO(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const sheetName = wb.SheetNames[0];
  const range = XLSX.utils.decode_range(ws['!ref']);

  const moldHeaders = ['模具名称', '零件名称', '入水方式', 'GATE', '穴数', '套数', '模具材料', '工模尺寸', '工模材质'];
  const figureHeaders = ['手办名称', '产品名称', '加工工艺', '性质', '规格材质', '规格'];
  const genericHeaders = ['序号', '名称', '货名', '项目内容', '单价', '金额'];

  let headerRow = -1;
  let poType = '';
  let moldScore = 0, figureScore = 0;

  for (let r = 0; r <= Math.min(range.e.r, 25); r++) {
    let rowMold = 0, rowFigure = 0, rowGeneric = 0;
    for (let c = range.s.c; c <= Math.min(range.e.c, 20); c++) {
      const v = getCellValue(ws, r, c);
      if (!v) continue;
      for (const kw of moldHeaders) { if (v.includes(kw)) rowMold++; }
      for (const kw of figureHeaders) { if (v.includes(kw)) rowFigure++; }
      for (const kw of genericHeaders) { if (v.includes(kw)) rowGeneric++; }
    }
    if (rowMold > 0 && rowGeneric >= 1) { headerRow = r; moldScore = rowMold + rowGeneric; break; }
    if (rowFigure > 0 && rowGeneric >= 1) { headerRow = r; figureScore = rowFigure + rowGeneric; break; }
    if (rowGeneric >= 2 && headerRow < 0) { headerRow = r; }
  }

  if (moldScore === 0 && figureScore === 0 && headerRow >= 0) {
    if (sheetName === 'B' || sheetName.includes('B')) moldScore = 1;
    else if (sheetName.includes('A') || sheetName.includes('兴信')) figureScore = 1;
    let allText = '';
    for (let r = 0; r <= Math.min(range.e.r, 30); r++) {
      for (let c = range.s.c; c <= Math.min(range.e.c, 14); c++) {
        allText += getCellValue(ws, r, c) + ' ';
      }
    }
    if (allText.match(/工模|模具|开模|模价/)) moldScore += 2;
    if (allText.match(/手办|样板|样办|上色|打板|打样|手板|3D/)) figureScore += 2;
  }

  if (headerRow < 0) {
    throw new Error('无法识别采购单格式，未找到表头行（需包含序号/名称/单价/金额等列）');
  }

  poType = moldScore > figureScore ? 'mold' : (figureScore > moldScore ? 'figure' : '');
  if (!poType) {
    poType = (sheetName === 'B' || sheetName.includes('工模')) ? 'mold' : 'figure';
  }

  let supplier = '', poNumber = '', customer = '', productName = '';
  const infoEnd = Math.min(headerRow, 20);
  for (let r = 0; r <= infoEnd; r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 14); c++) {
      const v = getCellValue(ws, r, c);
      if (!v) continue;
      if (v.match(/^供应商[：:]/) || v.match(/^供方[：:]/)) {
        let sVal = v.replace(/^(?:供应商|供方)[：:]/, '').trim();
        if (!sVal) sVal = getNextCellValue(ws, r, c, range.e.c);
        if (!supplier) supplier = sVal;
      }
      if (v.match(/^(?:From|发件|公司名称)[：:]/i) && !supplier) {
        let sVal = v.replace(/^(?:From|发件|公司名称)[：:]/i, '').trim();
        if (!sVal) sVal = getNextCellValue(ws, r, c, range.e.c);
        if (sVal) supplier = sVal;
      }
      if (v.includes('订单编号') && (v.includes('：') || v.includes(':'))) {
        let numVal = v.replace(/.*订单编号[：:]/, '').trim();
        if (!numVal) numVal = getNextCellValue(ws, r, c, range.e.c);
        if (!poNumber) poNumber = numVal;
      }
      if (v.match(/(?:产品货号|货名|货号)[：:]/)) {
        const pMatch = v.match(/(?:产品货号|货名|货号)[：:]\s*(\S+)/);
        if (pMatch && !productName) {
          if (!pMatch[1].startsWith('客户')) productName = pMatch[1];
          else {
            const nextProd = getNextCellValue(ws, r, c, range.e.c);
            if (nextProd && !nextProd.includes('客户')) productName = nextProd;
          }
        }
        const cMatch = v.match(/客户[：:]\s*(\S+)/);
        if (cMatch && !customer) customer = cMatch[1];
        if (!customer) {
          for (let cc = c + 1; cc <= Math.min(range.e.c, 14); cc++) {
            const cv = getCellValue(ws, r, cc);
            if (cv.includes('客户')) {
              const cm = cv.match(/客户[：:]\s*(\S+)/);
              if (cm) customer = cm[1];
              break;
            }
          }
        }
      }
      if (v.match(/^客户[：:]/) && !customer) {
        const cm = v.match(/客户[：:]\s*(\S+)/);
        if (cm) customer = cm[1];
      }
    }
  }

  let orderDate = '';
  for (let r = 0; r <= infoEnd; r++) {
    if (orderDate) break;
    for (let c = range.s.c; c <= Math.min(range.e.c, 14); c++) {
      const v = getCellValue(ws, r, c);
      const dm1 = v.match(/日期[：:]\s*(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
      if (dm1) { orderDate = dm1[1].replace(/\//g, '-'); break; }
      const dm2 = v.match(/日期[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (dm2) { orderDate = dm2[1] + '-' + dm2[2].padStart(2, '0') + '-' + dm2[3].padStart(2, '0'); break; }
      if (v.match(/^日期[：:]?\s*$/)) {
        for (let cc = c + 1; cc <= Math.min(c + 3, range.e.c); cc++) {
          const dv = getCellValue(ws, r, cc);
          const dm3 = dv.match(/^(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
          if (dm3) { orderDate = dm3[1].replace(/\//g, '-'); break; }
          const dm4 = dv.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
          if (dm4) { orderDate = dm4[1] + '-' + dm4[2].padStart(2, '0') + '-' + dm4[3].padStart(2, '0'); break; }
          const cell = ws[XLSX.utils.encode_cell({ r, c: cc })];
          if (cell && cell.t === 'n' && cell.v > 40000 && cell.v < 55000) {
            const dt = XLSX.SSF.parse_date_code(cell.v);
            orderDate = dt.y + '-' + String(dt.m).padStart(2, '0') + '-' + String(dt.d).padStart(2, '0');
            break;
          }
        }
        if (orderDate) break;
      }
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'd') {
        const dt = new Date(cell.v);
        orderDate = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
        break;
      }
    }
  }
  if (!orderDate) {
    const fnMatch = path.basename(filePath).match(/^(\d{4})(\d{2})(\d{2})/);
    if (fnMatch) {
      const y = Number(fnMatch[1]), m = Number(fnMatch[2]), dd = Number(fnMatch[3]);
      if (y >= 2020 && y <= 2030 && m >= 1 && m <= 12 && dd >= 1 && dd <= 31) {
        orderDate = fnMatch[1] + '-' + fnMatch[2] + '-' + fnMatch[3];
      }
    }
  }
  if (orderDate) {
    const parts = orderDate.split('-');
    if (parts.length === 3) orderDate = parts[0] + '-' + parts[1].padStart(2, '0') + '-' + parts[2].padStart(2, '0');
  }

  let supplierContact = '', supplierPhone = '';
  for (let r = 0; r <= infoEnd; r++) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 14); c++) {
      const v = getCellValue(ws, r, c);
      if (v.match(/^联络人[：:]/) || v.match(/^联系人[：:]/)) {
        let cVal = v.replace(/^联[络系]人[：:]/, '').trim();
        if (!cVal) cVal = getNextCellValue(ws, r, c, range.e.c);
        if (cVal && !supplierContact) supplierContact = cVal;
      }
      if (v.match(/^联系电话[：:]/) && !supplierPhone) {
        let pVal = v.replace(/^联系电话[：:]/, '').trim();
        if (!pVal) pVal = getNextCellValue(ws, r, c, range.e.c);
        supplierPhone = pVal;
      }
    }
  }

  let deliveryText = '';
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const v = getCellValue(ws, r, range.s.c) || getCellValue(ws, r, range.s.c + 1);
    if (v.match(/^\d+[\.\s].*年.*月.*日.*交货/)) { deliveryText = v; break; }
  }

  const colMap = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = getCellValue(ws, headerRow, c);
    if (!h) continue;
    if (h.includes('序号') || h.match(/^No\.?$/i) || h.match(/Item\s*No/i)) colMap.seq = c;
    if (h.match(/模具名称|零件名称|手办名称|产品名称|项目内容|^名称$/) || (h.includes('货名') && !colMap.name)) colMap.name = c;
    if (h.match(/入水方式|GATE|性质|加工工艺|工序|规格材质|^规格$/)) colMap.gate = c;
    if (h.match(/产品材料|^材料$|^胶料$/)) colMap.material = c;
    if (h.match(/模具材料|工模材质/)) colMap.mold_material = c;
    if (h.match(/穴数|套数|CAV/i)) colMap.cav_up = c;
    if (h.includes('工模尺寸')) colMap.mold_size = c;
    if (h === '数量' || h.match(/^Qty$/i)) colMap.quantity = c;
    if (h === '单位') colMap.unit = c;
    if (h.match(/单价/) && !h.includes('未含税')) colMap.unit_price = c;
    if (h.match(/单价.*含.*税/) && colMap.unit_price) colMap.unit_price = c;
    if (h.match(/^Unit\s*Price$/i)) colMap.unit_price = c;
    if (h.match(/金额|金\s*额|Total|合计/i) && !colMap.amount) colMap.amount = c;
    if (h.match(/备.*注|^备注$|Remark/i)) colMap.notes = c;
    if (h.includes('图片')) colMap.image = c;
  }

  const items = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const seqVal = getCellValue(ws, r, colMap.seq !== undefined ? colMap.seq : range.s.c);
    const nameVal = colMap.name !== undefined ? getCellValue(ws, r, colMap.name) : '';
    const amountStr = colMap.amount !== undefined ? getCellValue(ws, r, colMap.amount) : '';

    if (seqVal.includes('合计') || nameVal.includes('合计')) break;
    if (colMap.amount !== undefined) {
      let isTotal = false;
      for (let cc = Math.max(range.s.c, colMap.amount - 2); cc < colMap.amount; cc++) {
        if (getCellValue(ws, r, cc).includes('合计')) { isTotal = true; break; }
      }
      if (isTotal) break;
    }

    const gateVal = colMap.gate !== undefined ? getCellValue(ws, r, colMap.gate) : '';
    const rowText = seqVal + nameVal + gateVal;
    if (rowText.match(/采购签核|确认签核|付款条件|付款方式/)) break;
    const qtyVal = colMap.quantity !== undefined ? getCellValue(ws, r, colMap.quantity) : '';
    const amountNum = Number(amountStr) || 0;
    const hasName = nameVal && !nameVal.match(/^[：:．.、\s]+$/) && !nameVal.includes('签核') && !nameVal.includes('确认');
    const hasData = hasName || amountNum > 0 || (qtyVal && Number(qtyVal) > 0);
    if (!hasData) continue;

    if (poType === 'mold') {
      items.push({
        part_name: nameVal,
        material: colMap.material !== undefined ? getCellValue(ws, r, colMap.material) : '',
        gate: gateVal,
        cav_up: colMap.cav_up !== undefined ? getCellValue(ws, r, colMap.cav_up) : '',
        unit_price: Number(colMap.unit_price !== undefined ? getCellValue(ws, r, colMap.unit_price) : 0) || 0,
        amount: Number(amountStr) || 0,
        notes: colMap.notes !== undefined ? getCellValue(ws, r, colMap.notes) : ''
      });
    } else {
      items.push({
        product_name: nameVal,
        nature: gateVal,
        quantity: Number(qtyVal) || 0,
        unit: colMap.unit !== undefined ? getCellValue(ws, r, colMap.unit) : '',
        unit_price: Number(colMap.unit_price !== undefined ? getCellValue(ws, r, colMap.unit_price) : 0) || 0,
        amount: Number(amountStr) || 0,
        notes: colMap.notes !== undefined ? getCellValue(ws, r, colMap.notes) : ''
      });
    }
  }

  let group = '';
  if (sheetName === 'B' || sheetName.match(/^B\d*$/)) group = 'B车间';
  else if (sheetName.includes('兴信A') || sheetName === 'A' || sheetName.match(/^A\d*$/)) group = 'A车间';
  else if (sheetName.includes('华登')) group = '华登车间';
  if (!group) {
    const fn = path.basename(filePath);
    if (fn.match(/A\./i) || fn.match(/A$/)) group = 'A车间';
    else if (fn.match(/B\./i) || fn.match(/B$/)) group = 'B车间';
  }

  return {
    type: poType,
    po_number: poNumber,
    supplier_name: supplier,
    supplier_contact: supplierContact,
    supplier_phone: supplierPhone,
    product_name: productName,
    customer: customer,
    group: group,
    order_date: orderDate,
    delivery_text: deliveryText,
    items: items
  };
}

// Import Excel → preview parsed data
app.post('/api/import-po/preview', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    const result = parseExcelPO(req.file.path);
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.json(result);
  } catch (e) {
    try { if (req.file) fs.unlinkSync(req.file.path); } catch(ex) {}
    res.status(400).json({ error: e.message });
  }
});

// Helper: match full supplier name to existing short factory name
function matchFactory(fullName, factoryList) {
  if (!fullName) return '';
  if (factoryList.includes(fullName)) return fullName;
  for (const short of factoryList) {
    if (fullName.includes(short)) return short;
  }
  return fullName;
}

// Import Excel → create PO + auto-confirm → create order
app.post('/api/import-po/confirm', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    const parsed = parseExcelPO(req.file.path);
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    const factoryList = parsed.type === 'mold' ? d.getMoldFactories() : d.getFigureFactories();
    const matchedFactory = matchFactory(parsed.supplier_name, factoryList);
    const user = req.user || '';
    const group = req.body.group || '';
    const paymentType = req.body.payment_type || '';
    const customerOverride = req.body.customer || '';
    const today = new Date().toISOString().substring(0, 10);
    const orderDate = req.body.order_date || parsed.order_date || today;
    const now = new Date().toISOString();

    const po = d.createPurchaseOrder({
      po_number: parsed.po_number || generatePoNumber(parsed.type),
      type: parsed.type,
      group: group,
      supplier_name: parsed.supplier_name,
      supplier_contact: parsed.supplier_contact,
      supplier_phone: parsed.supplier_phone,
      supplier_fax: '',
      our_contact: user,
      our_phone: '0769-87362376',
      product_name: parsed.product_name,
      customer: customerOverride || parsed.customer,
      items: parsed.items,
      delivery_date_text: parsed.delivery_text,
      delivery_address: '东莞清溪上元管理区银坑路兴信厂',
      payment_terms: '',
      payment_type: paymentType,
      tax_rate: 13,
      settlement_days: 30,
      notes: '',
      status: '已确认',
      created_by: user,
      created_at: now,
      updated_at: ''
    });

    const totalAmount = (parsed.items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);

    if (parsed.type === 'mold') {
      d.createMoldOrder({
        group: group,
        customer: customerOverride || parsed.customer || '',
        mold_name: parsed.product_name || '',
        unit_price: (parsed.items || []).length,
        amount: totalAmount,
        mold_factory: matchedFactory || '',
        order_date: orderDate,
        status: '已下单',
        payment_type: paymentType,
        notes: '导入自采购单 ' + po.po_number,
        created_by: user,
        created_at: now,
        updated_at: now,
        from_po_id: po.id
      });
    } else {
      const totalQty = (parsed.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      d.createFigureOrder({
        group: group,
        customer: customerOverride || parsed.customer || '',
        product_name: parsed.product_name || '',
        quantity: totalQty,
        figure_fee: totalAmount,
        figure_factory: matchedFactory || '',
        order_date: orderDate,
        status: '已下单',
        payment_type: paymentType,
        notes: '导入自采购单 ' + po.po_number,
        created_by: user,
        created_at: now,
        updated_at: now,
        from_po_id: po.id
      });
    }

    const finalCustomer = customerOverride || parsed.customer;
    if (finalCustomer) d.addCustomer(finalCustomer);

    res.json({ success: true, po: po, parsed: parsed });
  } catch (e) {
    try { if (req.file) fs.unlinkSync(req.file.path); } catch(ex) {}
    res.status(400).json({ error: e.message });
  }
});

// ─── Global Error Handler ────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', new Date().toISOString(), err.stack || err.message);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '文件大小不能超过10MB' });
    return res.status(400).json({ error: '文件上传错误: ' + err.message });
  }
  res.status(500).json({ error: '服务器内部错误' });
});

process.on('uncaughtException', (err) => { console.error('[FATAL] Uncaught Exception:', err); });
process.on('unhandledRejection', (reason) => { console.error('[FATAL] Unhandled Rejection:', reason); });

app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { localIP = net.address; break; }
    }
  }
  console.log('模具手办采购订单系统已启动');
  console.log('本机访问: http://localhost:' + PORT);
  console.log('局域网访问: http://' + localIP + ':' + PORT);
  console.log('数据目录: ' + DATA_DIR);
});
