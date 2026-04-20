# Scheduling System Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the order-sync scheduling system from scratch with multi-workshop support, Excel-like UI (Handsontable), scan import, manual entry, and Excel export.

**Architecture:** Express + SQLite backend serving a React + Vite + Ant Design + Handsontable frontend. Multi-workshop (A/B/C) with data isolation. Tab-based UI mirroring Excel sheets. Borrows workshop portal pattern from paiji-system.

**Tech Stack:** Node.js, Express, better-sqlite3, ExcelJS, React 19, Vite, Ant Design, Handsontable, axios, dayjs

**Reference Files:**
- Excel template: `C:\Users\Administrator\Desktop\2026年3月21日更新.xlsx`
- Paiji-system (workshop pattern): `C:\Users\Administrator\paiji-system\`
- Current order-sync (to be replaced): `C:\Users\Administrator\zouhuo-system\order-sync\`

---

## Task 1: Clean up order-sync and set up project scaffolding

**Goal:** Remove old code and set up fresh project structure.

**Files:**
- Delete all: `order-sync/server/test_*.js`, `order-sync/server/services/insert_excel.py`, `order-sync/server/services/kdocs-writer.js`, `order-sync/server/services/inserter.js`, `order-sync/server/routes/kdocs.js`, `order-sync/server/routes/kingsoft.js`
- Delete: `order-sync/server/data/kdocs-cookies.json`
- Create: `order-sync/server/db/connection.js`
- Create: `order-sync/server/db/init.js`
- Modify: `order-sync/server/package.json` (replace dependencies)
- Modify: `order-sync/client/package.json` (add handsontable)
- Modify: `order-sync/start.bat`

**Step 1: Delete old files**

```bash
cd /c/Users/Administrator/zouhuo-system/order-sync/server
rm -f test_*.js
rm -f services/insert_excel.py services/kdocs-writer.js services/inserter.js
rm -f routes/kdocs.js routes/kingsoft.js
rm -f data/kdocs-cookies.json
```

**Step 2: Update server package.json**

Replace `order-sync/server/package.json` with:

```json
{
  "name": "scheduling-server",
  "version": "2.0.0",
  "main": "app.js",
  "scripts": {
    "start": "node app.js",
    "dev": "node --watch app.js"
  },
  "dependencies": {
    "better-sqlite3": "^12.6.2",
    "cors": "^2.8.5",
    "exceljs": "^4.4.0",
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "xlsx": "^0.18.5"
  }
}
```

**Step 3: Update client package.json**

Replace `order-sync/client/package.json` with:

```json
{
  "name": "scheduling-client",
  "private": true,
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@ant-design/icons": "^6.1.0",
    "@handsontable/react": "^15.0.0",
    "antd": "^6.3.1",
    "axios": "^1.13.6",
    "dayjs": "^1.11.19",
    "handsontable": "^15.0.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^5.1.1",
    "vite": "^7.3.1"
  }
}
```

**Step 4: Install dependencies**

```bash
cd /c/Users/Administrator/zouhuo-system/order-sync/server && npm install
cd /c/Users/Administrator/zouhuo-system/order-sync/client && npm install
```

**Step 5: Create directory structure**

```bash
mkdir -p /c/Users/Administrator/zouhuo-system/order-sync/server/db
mkdir -p /c/Users/Administrator/zouhuo-system/order-sync/server/data
mkdir -p /c/Users/Administrator/zouhuo-system/order-sync/server/uploads
```

**Step 6: Update start.bat**

```batch
@echo off
chcp 65001 >nul
echo Starting Scheduling System...
echo.
echo Backend: http://localhost:8080
echo Frontend Dev: http://localhost:3001
echo.

start "Scheduling-Backend" cmd /k "cd /d %~dp0server && node app.js"
timeout /t 2 >nul
start "Scheduling-Frontend" cmd /k "cd /d %~dp0client && npm run dev"
timeout /t 3 >nul
start "" "http://localhost:3001"
```

**Step 7: Commit**

```bash
git add -A && git commit -m "chore: clean up old order-sync code, set up new scaffolding"
```

---

## Task 2: Backend — Database layer (SQLite)

**Goal:** Create SQLite database with orders and summary tables.

**Files:**
- Create: `order-sync/server/db/connection.js`
- Create: `order-sync/server/db/init.js`

**Step 1: Create connection.js**

```javascript
// order-sync/server/db/connection.js
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'scheduling.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
```

**Step 2: Create init.js**

```javascript
// order-sync/server/db/init.js
const db = require('./connection');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workshop TEXT NOT NULL DEFAULT 'B',
      status TEXT DEFAULT 'active',
      
      supervisor TEXT,
      line_name TEXT,
      worker_count INTEGER,
      factory_area TEXT,
      client TEXT,
      order_date TEXT,
      third_party TEXT,
      country TEXT,
      contract TEXT,
      item_no TEXT,
      product_name TEXT,
      version TEXT,
      quantity INTEGER,
      work_type TEXT,
      
      production_count INTEGER DEFAULT 0,
      production_progress REAL DEFAULT 0,
      special_notes TEXT,
      
      plastic_due TEXT,
      material_due TEXT,
      carton_due TEXT,
      packaging_due TEXT,
      sticker TEXT,
      
      start_date TEXT,
      complete_date TEXT,
      ship_date TEXT,
      
      target_time REAL,
      daily_target INTEGER,
      days REAL,
      unit_price REAL,
      process_value REAL,
      inspection_date TEXT,
      month INTEGER,
      warehouse_record TEXT,
      output_value REAL,
      process_price REAL,
      remark TEXT,
      
      day_1 INTEGER DEFAULT 0,
      day_2 INTEGER DEFAULT 0,
      day_3 INTEGER DEFAULT 0,
      day_4 INTEGER DEFAULT 0,
      day_5 INTEGER DEFAULT 0,
      day_6 INTEGER DEFAULT 0,
      day_7 INTEGER DEFAULT 0,
      day_8 INTEGER DEFAULT 0,
      day_9 INTEGER DEFAULT 0,
      day_10 INTEGER DEFAULT 0,
      day_11 INTEGER DEFAULT 0,
      day_12 INTEGER DEFAULT 0,
      day_13 INTEGER DEFAULT 0,
      day_14 INTEGER DEFAULT 0,
      day_15 INTEGER DEFAULT 0,
      day_16 INTEGER DEFAULT 0,
      day_17 INTEGER DEFAULT 0,
      day_18 INTEGER DEFAULT 0,
      day_19 INTEGER DEFAULT 0,
      day_20 INTEGER DEFAULT 0,
      day_21 INTEGER DEFAULT 0,
      day_22 INTEGER DEFAULT 0,
      day_23 INTEGER DEFAULT 0,
      day_24 INTEGER DEFAULT 0,
      day_25 INTEGER DEFAULT 0,
      day_26 INTEGER DEFAULT 0,
      day_27 INTEGER DEFAULT 0,
      day_28 INTEGER DEFAULT 0,
      day_29 INTEGER DEFAULT 0,
      day_30 INTEGER DEFAULT 0,
      day_31 INTEGER DEFAULT 0,
      
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_workshop ON orders(workshop)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workshop TEXT NOT NULL,
      line_name TEXT,
      worker_count INTEGER,
      client TEXT,
      month INTEGER,
      value REAL DEFAULT 0,
      year INTEGER,
      weekly_orders REAL DEFAULT 0,
      weekly_remaining REAL DEFAULT 0,
      weekly_cancelled REAL DEFAULT 0,
      remark TEXT
    )
  `);

  console.log('Database initialized');
}

module.exports = { initDatabase };
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add SQLite database layer with orders and summary tables"
```

---

## Task 3: Backend — Express server and orders API

**Goal:** Create main Express server and orders CRUD routes.

**Files:**
- Create: `order-sync/server/app.js` (replaces index.js)
- Create: `order-sync/server/routes/orders.js`
- Delete: `order-sync/server/index.js`

**Step 1: Create app.js**

```javascript
// order-sync/server/app.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Ensure directories exist
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Init database
const { initDatabase } = require('./db/init');
initDatabase();

// Routes
app.use('/api/orders', require('./routes/orders'));
app.use('/api/scan', require('./routes/scan'));
app.use('/api/export', require('./routes/export'));
app.use('/api/summary', require('./routes/summary'));

// Serve frontend
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const index = path.join(clientDist, 'index.html');
  if (fs.existsSync(index)) res.sendFile(index);
  else res.status(404).send('Frontend not built yet. Run npm run build in client/');
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error', error: err.message });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Scheduling system running at http://localhost:${PORT}`);
});
```

**Step 2: Create routes/orders.js**

Full CRUD for orders with workshop filtering, status management, and batch updates.

```javascript
// order-sync/server/routes/orders.js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// GET /api/orders?workshop=A&status=active
router.get('/', (req, res) => {
  const { workshop, status } = req.query;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (workshop) { sql += ' AND workshop = ?'; params.push(workshop); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY id ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
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
  const columns = [
    'workshop','status','supervisor','line_name','worker_count','factory_area',
    'client','order_date','third_party','country','contract','item_no',
    'product_name','version','quantity','work_type',
    'production_count','production_progress','special_notes',
    'plastic_due','material_due','carton_due','packaging_due','sticker',
    'start_date','complete_date','ship_date',
    'target_time','daily_target','days','unit_price','process_value',
    'inspection_date','month','warehouse_record','output_value','process_price','remark',
    ...Array.from({length:31}, (_,i) => `day_${i+1}`)
  ];
  const placeholders = columns.map(() => '?').join(',');
  const stmt = db.prepare(`INSERT INTO orders (${columns.join(',')}) VALUES (${placeholders})`);

  const insertMany = db.transaction((list) => {
    const ids = [];
    for (const o of list) {
      const values = columns.map(c => o[c] ?? null);
      const info = stmt.run(...values);
      ids.push(info.lastInsertRowid);
    }
    return ids;
  });

  const ids = insertMany(orders);
  res.json({ inserted: ids.length, ids });
});

// PUT /api/orders/:id
router.put('/:id', (req, res) => {
  const data = req.body;
  const keys = Object.keys(data).filter(k => k !== 'id' && k !== 'created_at');
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
  if (!ids?.length || !['active','completed','cancelled'].includes(status)) {
    return res.status(400).json({ message: 'Invalid request' });
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(status, ...ids);
  res.json({ success: true, updated: ids.length });
});

module.exports = router;
```

**Step 3: Create placeholder route files**

Create minimal placeholder files for routes referenced in app.js so the server can start:

```javascript
// order-sync/server/routes/export.js
const express = require('express');
const router = express.Router();
router.get('/', (req, res) => { res.json({ message: 'TODO' }); });
module.exports = router;
```

```javascript
// order-sync/server/routes/summary.js
const express = require('express');
const router = express.Router();
router.get('/', (req, res) => { res.json({ message: 'TODO' }); });
module.exports = router;
```

Keep existing `routes/scan.js` for now (will be rewritten in Task 5).

**Step 4: Delete old index.js**

```bash
rm /c/Users/Administrator/zouhuo-system/order-sync/server/index.js
```

**Step 5: Verify server starts**

```bash
cd /c/Users/Administrator/zouhuo-system/order-sync/server && node app.js
```

Expected: `Database initialized` + `Scheduling system running at http://localhost:8080`

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add Express server with orders CRUD API"
```

---

## Task 4: Backend — Scan service (rewrite)

**Goal:** Rewrite the scanner to cleanly parse Z drive Excel files and return structured order data.

**Files:**
- Rewrite: `order-sync/server/services/scanner.js`
- Rewrite: `order-sync/server/routes/scan.js`
- Keep: `order-sync/server/services/color-reader.js` (yellow detection, may need cleanup)

**Step 1: Rewrite scanner.js**

Core scanning logic: scan Z drive folder structure, find Excel files per client, detect yellow rows or parse all rows, map columns to standard fields.

```javascript
// order-sync/server/services/scanner.js
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SCAN_DIR = process.env.SCAN_DIR || 'Z:/各客排期';

// Column name mapping: field -> possible column headers
const FIELD_ALIASES = {
  client:       ['客名', '客户', '客户名称'],
  order_date:   ['来单日期', '下单日期', '接单日期'],
  third_party:  ['第三方客户', '第三方客户名称', '第三方', '终端客户'],
  country:      ['国家', '目的国', '国家地区'],
  contract:     ['合同', '合同号', 'PO', 'PO号', '订单号'],
  item_no:      ['货号', '产品编号', '编号', 'Item No'],
  product_name: ['产品名称', '产品名', '品名'],
  quantity:     ['数量', '订单数量', '订单数', 'QTY'],
  ship_date:    ['走货期', '出货日期', '出货期', '交期'],
  inspection:   ['验货期', '验货日期', 'QC日期'],
};

function findColumnMapping(headerRow) {
  const mapping = {};
  for (let col = 0; col < headerRow.length; col++) {
    const header = String(headerRow[col] || '').trim();
    if (!header) continue;
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some(a => header.includes(a))) {
        mapping[field] = col;
        break;
      }
    }
  }
  return mapping;
}

function excelDateToStr(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') {
    const date = new Date((val - 25569) * 86400000);
    return date.toISOString().split('T')[0];
  }
  return String(val);
}

function scanDirectory() {
  if (!fs.existsSync(SCAN_DIR)) {
    return { error: `Scan directory not found: ${SCAN_DIR}`, results: [] };
  }

  const results = [];
  const clientDirs = fs.readdirSync(SCAN_DIR).filter(d => {
    return fs.statSync(path.join(SCAN_DIR, d)).isDirectory();
  });

  for (const clientDir of clientDirs) {
    const dirPath = path.join(SCAN_DIR, clientDir);
    const files = findExcelFiles(dirPath);
    
    for (const file of files) {
      try {
        const orders = parseExcelFile(file, clientDir);
        results.push(...orders);
      } catch (e) {
        console.error(`Error parsing ${file}:`, e.message);
      }
    }
  }

  return { results, scannedAt: new Date().toISOString() };
}

function findExcelFiles(dirPath) {
  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...findExcelFiles(fullPath));
    } else if (/\.(xlsx|xls)$/i.test(entry.name) && !entry.name.startsWith('~')) {
      files.push(fullPath);
    }
  }
  // Sort by modification time, newest first
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files.slice(0, 3); // Max 3 most recent files per directory
}

function parseExcelFile(filePath, clientName) {
  const stats = fs.statSync(filePath);
  if (stats.size > 50 * 1024 * 1024) return []; // Skip files > 50MB

  const wb = XLSX.readFile(filePath, { cellDates: true });
  const orders = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (data.length < 2) continue;

    // Find header row (first row with 4+ matching fields)
    let headerIdx = -1;
    let mapping = {};
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const m = findColumnMapping(data[i]);
      if (Object.keys(m).length >= 4) {
        headerIdx = i;
        mapping = m;
        break;
      }
    }
    if (headerIdx === -1) continue;

    // Parse data rows
    for (let i = headerIdx + 1; i < data.length; i++) {
      const row = data[i];
      const order = {};
      let filledCount = 0;

      for (const [field, col] of Object.entries(mapping)) {
        const val = row[col];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          order[field] = ['order_date','ship_date','inspection'].includes(field) 
            ? excelDateToStr(val) 
            : String(val).trim();
          filledCount++;
        }
      }

      // Must have at least 4 filled fields and quantity
      if (filledCount >= 4 && order.quantity) {
        order.client = order.client || clientName;
        order.source_file = path.basename(filePath);
        order.source_sheet = sheetName;
        order.key = `${order.client}|${order.contract||''}|${order.item_no||''}|${order.quantity}`;
        orders.push(order);
      }
    }
  }

  return orders;
}

function parseUploadedFile(filePath) {
  const orders = parseExcelFile(filePath, '');
  return orders;
}

module.exports = { scanDirectory, parseUploadedFile };
```

**Step 2: Rewrite routes/scan.js**

```javascript
// order-sync/server/routes/scan.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { scanDirectory, parseUploadedFile } = require('../services/scanner');

const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

// GET /api/scan — scan Z drive
router.get('/', (req, res) => {
  try {
    const result = scanDirectory();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/scan/upload — upload and parse Excel files
router.post('/upload', upload.array('files', 10), (req, res) => {
  try {
    const allOrders = [];
    for (const file of req.files) {
      const orders = parseUploadedFile(file.path);
      allOrders.push(...orders);
      fs.unlinkSync(file.path); // Clean up
    }
    res.json({ results: allOrders });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: rewrite scan service with clean column mapping"
```

---

## Task 5: Backend — Excel export service

**Goal:** Export orders to Excel matching the template format (multi-sheet, styled).

**Files:**
- Create: `order-sync/server/services/exporter.js`
- Implement: `order-sync/server/routes/export.js`

**Step 1: Create exporter.js**

Reads the template file to understand styling, then generates a new workbook with matching format.

```javascript
// order-sync/server/services/exporter.js
const ExcelJS = require('exceljs');
const db = require('../db/connection');

// Column definitions matching the Excel template (刘方尧 sheet)
const COLUMNS = [
  { key: 'supervisor',     header: '主管',       width: 8 },
  { key: 'line_name',      header: '拉名',       width: 8 },
  { key: 'worker_count',   header: '人数',       width: 6 },
  { key: 'factory_area',   header: '厂区',       width: 10 },
  { key: 'client',         header: '客名',       width: 10 },
  { key: 'order_date',     header: '来单日期',   width: 10 },
  { key: 'third_party',    header: '第三方客户名称', width: 20 },
  { key: 'country',        header: '国家',       width: 8 },
  { key: 'contract',       header: '合同',       width: 16 },
  { key: 'item_no',        header: '货号',       width: 16 },
  { key: 'product_name',   header: '产品名称',   width: 16 },
  { key: 'version',        header: '版本',       width: 8 },
  { key: 'quantity',       header: '数量',       width: 8 },
  { key: 'work_type',      header: '做工名称',   width: 8 },
  { key: 'production_count', header: '生产数',   width: 8 },
  { key: 'production_progress', header: '生产进度', width: 8 },
  { key: 'special_notes',  header: '特别备注',   width: 16 },
  { key: 'plastic_due',    header: '胶件复期',   width: 10 },
  { key: 'material_due',   header: '来料复期',   width: 10 },
  { key: 'carton_due',     header: '纸箱复期',   width: 10 },
  { key: 'packaging_due',  header: '包材复期',   width: 10 },
  { key: 'sticker',        header: '客贴纸',     width: 8 },
  { key: 'start_date',     header: '上拉日期',   width: 10 },
  { key: 'complete_date',  header: '完成日期',   width: 10 },
  { key: 'ship_date',      header: '走货期',     width: 10 },
  { key: 'target_time',    header: '目标数生产时间', width: 10 },
  { key: 'daily_target',   header: '每天目标数', width: 10 },
  { key: 'days',           header: '天数',       width: 6 },
  { key: 'unit_price',     header: '货价',       width: 8 },
  { key: 'process_value',  header: '加工产值',   width: 10 },
  { key: 'inspection_date', header: '行Q期',     width: 8 },
  { key: 'month',          header: '月份',       width: 6 },
  { key: 'warehouse_record', header: '入库记录', width: 10 },
  { key: 'output_value',   header: '产值',       width: 10 },
  { key: 'process_price',  header: '加工价',     width: 8 },
  { key: 'remark',         header: '备注',       width: 10 },
  // Daily production columns (1号~31号)
  ...Array.from({length: 31}, (_, i) => ({
    key: `day_${i+1}`, header: `${i+1}号`, width: 5
  })),
];

const HEADER_STYLE = {
  font: { bold: true, size: 10 },
  alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  border: {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } },
};

const CELL_STYLE = {
  font: { size: 9 },
  alignment: { vertical: 'middle', wrapText: true },
  border: {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  },
};

function addOrderSheet(wb, sheetName, orders) {
  const ws = wb.addWorksheet(sheetName);

  // Set columns
  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));

  // Style header row
  ws.getRow(1).eachCell(cell => { Object.assign(cell, { style: HEADER_STYLE }); });
  ws.getRow(1).height = 30;

  // Freeze first row
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Add data rows
  for (const order of orders) {
    const row = ws.addRow(order);
    row.eachCell(cell => { Object.assign(cell, { style: CELL_STYLE }); });
  }
}

async function exportWorkbook(workshop) {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: 产值明细汇总
  const summaryData = db.prepare('SELECT * FROM summary WHERE workshop = ?').all(workshop);
  const summarySheet = wb.addWorksheet('产值明细汇总');
  // TODO: populate summary sheet based on actual summary data structure

  // Sheet 2: 排期表 (active orders)
  const activeOrders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ? ORDER BY id ASC').all(workshop, 'active');
  addOrderSheet(wb, '刘方尧', activeOrders);

  // Sheet 3: 完成订单
  const completedOrders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ? ORDER BY id ASC').all(workshop, 'completed');
  addOrderSheet(wb, '完成订单', completedOrders);

  // Sheet 4: 取消单
  const cancelledOrders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ? ORDER BY id ASC').all(workshop, 'cancelled');
  addOrderSheet(wb, '取消单', cancelledOrders);

  // Sheet 5-8: placeholder sheets
  wb.addWorksheet('Sheet9');
  wb.addWorksheet('完成成品数');
  wb.addWorksheet('外发货号');
  wb.addWorksheet('取消订单');

  return wb;
}

module.exports = { exportWorkbook };
```

**Step 2: Implement routes/export.js**

```javascript
// order-sync/server/routes/export.js
const express = require('express');
const router = express.Router();
const { exportWorkbook } = require('../services/exporter');

// GET /api/export?workshop=A
router.get('/', async (req, res) => {
  const { workshop } = req.query;
  if (!workshop) return res.status(400).json({ message: 'workshop required' });

  try {
    const wb = await exportWorkbook(workshop);
    const fileName = encodeURIComponent(`排期表_${workshop}车间_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    await wb.xlsx.write(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
```

**Step 3: Implement routes/summary.js**

```javascript
// order-sync/server/routes/summary.js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');

// GET /api/summary?workshop=A
router.get('/', (req, res) => {
  const { workshop } = req.query;
  if (!workshop) return res.status(400).json({ message: 'workshop required' });
  const rows = db.prepare('SELECT * FROM summary WHERE workshop = ?').all(workshop);
  res.json(rows);
});

// PUT /api/summary (update summary data)
router.put('/', (req, res) => {
  const data = req.body;
  if (!data.workshop) return res.status(400).json({ message: 'workshop required' });

  const existing = db.prepare('SELECT id FROM summary WHERE workshop = ? AND client = ? AND month = ? AND year = ?')
    .get(data.workshop, data.client, data.month, data.year);

  if (existing) {
    db.prepare('UPDATE summary SET value = ?, weekly_orders = ?, weekly_remaining = ?, weekly_cancelled = ?, remark = ? WHERE id = ?')
      .run(data.value, data.weekly_orders, data.weekly_remaining, data.weekly_cancelled, data.remark, existing.id);
  } else {
    db.prepare('INSERT INTO summary (workshop, line_name, worker_count, client, month, year, value, weekly_orders, weekly_remaining, weekly_cancelled, remark) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(data.workshop, data.line_name, data.worker_count, data.client, data.month, data.year, data.value, data.weekly_orders, data.weekly_remaining, data.weekly_cancelled, data.remark);
  }
  res.json({ success: true });
});

module.exports = router;
```

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add Excel export service and summary API"
```

---

## Task 6: Frontend — Project setup and workshop portal

**Goal:** Set up React frontend with workshop portal (borrowed from paiji-system).

**Files:**
- Rewrite: `order-sync/client/src/App.jsx`
- Rewrite: `order-sync/client/src/main.jsx`
- Create: `order-sync/client/src/pages/WorkshopPortal.jsx`
- Modify: `order-sync/client/vite.config.js`

**Step 1: Update vite.config.js**

```javascript
// order-sync/client/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': 'http://localhost:8080'
    }
  }
})
```

**Step 2: Create main.jsx**

```jsx
// order-sync/client/src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
```

**Step 3: Create WorkshopPortal.jsx**

Adapt from paiji-system, change labels/stats for scheduling system.

```jsx
// order-sync/client/src/pages/WorkshopPortal.jsx
import { useEffect, useState } from 'react';
import axios from 'axios';

const WORKSHOPS = [
  { key: 'A', label: 'A车间', color: '#1565c0', bg: 'linear-gradient(135deg,#1565c0,#1976d2)' },
  { key: 'B', label: 'B车间', color: '#e65100', bg: 'linear-gradient(135deg,#e65100,#f57c00)' },
  { key: 'C', label: '华登',  color: '#2e7d32', bg: 'linear-gradient(135deg,#2e7d32,#388e3c)' },
];

export default function WorkshopPortal({ onEnter }) {
  const [stats, setStats] = useState({});

  useEffect(() => {
    WORKSHOPS.forEach(async (ws) => {
      try {
        const res = await axios.get(`/api/orders?workshop=${ws.key}&status=active`);
        setStats(prev => ({ ...prev, [ws.key]: { active: res.data.length } }));
      } catch {
        setStats(prev => ({ ...prev, [ws.key]: { active: 0 } }));
      }
    });
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ fontSize: 32, fontWeight: 700, color: '#1a1a2e', marginBottom: 8 }}>
          Production Scheduling System
        </div>
        <div style={{ fontSize: 16, color: '#666' }}>兴信塑胶制品有限公司 · 请选择车间</div>
      </div>

      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', justifyContent: 'center', padding: '0 24px' }}>
        {WORKSHOPS.map(ws => {
          const s = stats[ws.key] || {};
          return (
            <div key={ws.key} style={{
              width: 280, borderRadius: 16, overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)', background: '#fff',
              transition: 'transform 0.2s, box-shadow 0.2s', cursor: 'pointer',
            }}
              onClick={() => onEnter(ws.key)}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-6px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              <div style={{ background: ws.bg, padding: '24px', color: '#fff' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{ws.label}</div>
                <div style={{ fontSize: 13, opacity: 0.85 }}>排期管理系统</div>
              </div>
              <div style={{ padding: '20px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: ws.color }}>{s.active ?? '-'}</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>进行中订单</div>
              </div>
              <div style={{ padding: '0 24px 24px' }}>
                <button onClick={() => onEnter(ws.key)} style={{
                  width: '100%', padding: '12px 0', background: ws.bg, color: '#fff',
                  border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer',
                }}>
                  进入{ws.label}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 4: Create App.jsx**

```jsx
// order-sync/client/src/App.jsx
import { useState } from 'react';
import { ConfigProvider, Layout, Button, Tag, Typography, Tabs } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import WorkshopPortal from './pages/WorkshopPortal';
import SchedulingSheet from './pages/SchedulingSheet';

const { Header, Content } = Layout;
const { Text } = Typography;

const WORKSHOP_COLORS = { A: '#1565c0', B: '#e65100', C: '#2e7d32' };
const WORKSHOP_LABELS = { A: 'A车间', B: 'B车间', C: '华登' };

const TABS = [
  { key: 'summary',   label: '产值明细汇总' },
  { key: 'active',    label: '刘方尧' },
  { key: 'completed', label: '完成订单' },
  { key: 'cancel1',   label: '取消单' },
  { key: 'sheet9',    label: 'Sheet9' },
  { key: 'finished',  label: '完成成品数' },
  { key: 'outsource', label: '外发货号' },
  { key: 'cancel2',   label: '取消订单' },
];

export default function App() {
  const [workshop, setWorkshop] = useState(() => localStorage.getItem('scheduling_workshop') || null);
  const [activeTab, setActiveTab] = useState('active');

  const handleEnter = (ws) => {
    localStorage.setItem('scheduling_workshop', ws);
    setWorkshop(ws);
  };

  const handleSwitch = () => {
    localStorage.removeItem('scheduling_workshop');
    setWorkshop(null);
  };

  if (!workshop) {
    return (
      <ConfigProvider locale={zhCN}>
        <WorkshopPortal onEnter={handleEnter} />
      </ConfigProvider>
    );
  }

  const wsColor = WORKSHOP_COLORS[workshop];

  return (
    <ConfigProvider locale={zhCN}>
      <Layout style={{ minHeight: '100vh' }}>
        <Header style={{
          background: '#fff', padding: '0 24px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: 600 }}>排期管理系统</Text>
            <Tag color={wsColor}>{WORKSHOP_LABELS[workshop]}</Tag>
          </div>
          <Button icon={<SwapOutlined />} size="small" onClick={handleSwitch}
            style={{ color: wsColor, borderColor: wsColor }}>
            切换车间
          </Button>
        </Header>
        <Content style={{ padding: 0 }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            type="card"
            items={TABS.map(t => ({
              key: t.key,
              label: t.label,
              children: <SchedulingSheet workshop={workshop} tab={t.key} />,
            }))}
            style={{ padding: '8px 16px 0' }}
          />
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
```

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add frontend workshop portal and app shell with tabs"
```

---

## Task 7: Frontend — Handsontable Excel-like sheet component

**Goal:** Create the core SchedulingSheet component using Handsontable to render Excel-like tables.

**Files:**
- Create: `order-sync/client/src/pages/SchedulingSheet.jsx`
- Create: `order-sync/client/src/constants/columns.js`

**Step 1: Create columns.js**

Define column configuration mapping to the database fields.

```javascript
// order-sync/client/src/constants/columns.js

// Main order columns (matches 刘方尧 sheet)
export const ORDER_COLUMNS = [
  { data: 'supervisor',     title: '主管',       width: 70 },
  { data: 'line_name',      title: '拉名',       width: 70 },
  { data: 'worker_count',   title: '人数',       width: 50, type: 'numeric' },
  { data: 'factory_area',   title: '厂区',       width: 80 },
  { data: 'client',         title: '客名',       width: 80 },
  { data: 'order_date',     title: '来单日期',   width: 90 },
  { data: 'third_party',    title: '第三方客户名称', width: 180 },
  { data: 'country',        title: '国家',       width: 70 },
  { data: 'contract',       title: '合同',       width: 120 },
  { data: 'item_no',        title: '货号',       width: 130 },
  { data: 'product_name',   title: '产品名称',   width: 130 },
  { data: 'version',        title: '版本',       width: 70 },
  { data: 'quantity',       title: '数量',       width: 70, type: 'numeric' },
  { data: 'work_type',      title: '做工名称',   width: 70 },
  { data: 'production_count', title: '生产数',   width: 70, type: 'numeric' },
  { data: 'production_progress', title: '生产进度', width: 70, type: 'numeric' },
  { data: 'special_notes',  title: '特别备注',   width: 150 },
  { data: 'plastic_due',    title: '胶件复期',   width: 80 },
  { data: 'material_due',   title: '来料复期',   width: 80 },
  { data: 'carton_due',     title: '纸箱复期',   width: 80 },
  { data: 'packaging_due',  title: '包材复期',   width: 80 },
  { data: 'sticker',        title: '客贴纸',     width: 60 },
  { data: 'start_date',     title: '上拉日期',   width: 90 },
  { data: 'complete_date',  title: '完成日期',   width: 90 },
  { data: 'ship_date',      title: '走货期',     width: 90 },
  { data: 'target_time',    title: '目标数生产时间', width: 90, type: 'numeric' },
  { data: 'daily_target',   title: '每天目标数', width: 80, type: 'numeric' },
  { data: 'days',           title: '天数',       width: 50, type: 'numeric' },
  { data: 'unit_price',     title: '货价',       width: 70, type: 'numeric' },
  { data: 'process_value',  title: '加工产值',   width: 90, type: 'numeric' },
  { data: 'inspection_date', title: '行Q期',     width: 70 },
  { data: 'month',          title: '月份',       width: 50, type: 'numeric' },
  { data: 'warehouse_record', title: '入库记录', width: 80 },
  { data: 'output_value',   title: '产值',       width: 80, type: 'numeric' },
  { data: 'process_price',  title: '加工价',     width: 70, type: 'numeric' },
  { data: 'remark',         title: '备注',       width: 100 },
  // Daily production columns
  ...Array.from({length: 31}, (_, i) => ({
    data: `day_${i+1}`, title: `${i+1}号`, width: 45, type: 'numeric'
  })),
];

// Completed orders sheet has slightly different column order
// For now, use the same columns — can be customized later
export const COMPLETED_COLUMNS = ORDER_COLUMNS;
```

**Step 2: Create SchedulingSheet.jsx**

```jsx
// order-sync/client/src/pages/SchedulingSheet.jsx
import { useEffect, useState, useRef, useCallback } from 'react';
import { Button, Space, message, Upload, Modal } from 'antd';
import { DownloadOutlined, ScanOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { HotTable } from '@handsontable/react';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/dist/handsontable.full.min.css';
import axios from 'axios';
import { ORDER_COLUMNS } from '../constants/columns';

registerAllModules();

const STATUS_MAP = {
  active: 'active',
  completed: 'completed',
  cancel1: 'cancelled',
  cancel2: 'cancelled',
};

export default function SchedulingSheet({ workshop, tab }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const hotRef = useRef(null);

  const fetchData = useCallback(async () => {
    // Summary and other tabs handled separately
    if (['summary', 'sheet9', 'finished', 'outsource'].includes(tab)) {
      setData([]);
      return;
    }
    setLoading(true);
    try {
      const status = STATUS_MAP[tab] || 'active';
      const res = await axios.get('/api/orders', { params: { workshop, status } });
      setData(res.data);
    } catch (e) {
      message.error('Failed to load data');
    }
    setLoading(false);
  }, [workshop, tab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Handle cell edit
  const handleAfterChange = useCallback(async (changes, source) => {
    if (source === 'loadData' || !changes) return;
    for (const [row, prop, oldVal, newVal] of changes) {
      if (oldVal === newVal) continue;
      const order = data[row];
      if (!order?.id) continue;
      try {
        await axios.put(`/api/orders/${order.id}`, { [prop]: newVal });
      } catch {
        message.error('Save failed');
      }
    }
  }, [data]);

  // Scan Z drive
  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await axios.get('/api/scan');
      const orders = res.data.results || [];
      if (orders.length === 0) {
        message.info('No new orders found');
        setScanning(false);
        return;
      }
      Modal.confirm({
        title: `Found ${orders.length} orders`,
        content: `Import all ${orders.length} scanned orders into ${workshop} workshop?`,
        onOk: async () => {
          const toInsert = orders.map(o => ({ ...o, workshop, status: 'active' }));
          await axios.post('/api/orders', toInsert);
          message.success(`Imported ${orders.length} orders`);
          fetchData();
        },
      });
    } catch (e) {
      message.error('Scan failed: ' + e.message);
    }
    setScanning(false);
  };

  // Add new empty row
  const handleAddRow = async () => {
    try {
      const res = await axios.post('/api/orders', { workshop, status: STATUS_MAP[tab] || 'active' });
      fetchData();
    } catch {
      message.error('Failed to add row');
    }
  };

  // Export Excel
  const handleExport = () => {
    window.open(`/api/export?workshop=${workshop}`, '_blank');
  };

  // Upload Excel files
  const handleUpload = async (info) => {
    const formData = new FormData();
    info.fileList.forEach(f => formData.append('files', f.originFileObj || f));
    try {
      const res = await axios.post('/api/scan/upload', formData);
      const orders = res.data.results || [];
      if (orders.length === 0) {
        message.info('No valid orders found in uploaded files');
        return;
      }
      Modal.confirm({
        title: `Parsed ${orders.length} orders from uploaded files`,
        content: `Import into ${workshop} workshop?`,
        onOk: async () => {
          const toInsert = orders.map(o => ({ ...o, workshop, status: 'active' }));
          await axios.post('/api/orders', toInsert);
          message.success(`Imported ${orders.length} orders`);
          fetchData();
        },
      });
    } catch (e) {
      message.error('Upload failed');
    }
  };

  const isOrderTab = ['active', 'completed', 'cancel1', 'cancel2'].includes(tab);

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Toolbar */}
      {isOrderTab && (
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
          <Space>
            {tab === 'active' && (
              <>
                <Button icon={<ScanOutlined />} loading={scanning} onClick={handleScan}>
                  Scan Z Drive
                </Button>
                <Upload multiple accept=".xlsx,.xls" showUploadList={false}
                  beforeUpload={() => false} onChange={handleUpload}>
                  <Button icon={<UploadOutlined />}>Upload Excel</Button>
                </Upload>
              </>
            )}
            <Button icon={<PlusOutlined />} onClick={handleAddRow}>Add Row</Button>
          </Space>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>Export Excel</Button>
        </div>
      )}

      {/* Handsontable */}
      {isOrderTab && (
        <HotTable
          ref={hotRef}
          data={data}
          columns={ORDER_COLUMNS}
          colHeaders={ORDER_COLUMNS.map(c => c.title)}
          rowHeaders={true}
          height={600}
          width="100%"
          stretchH="none"
          licenseKey="non-commercial-and-evaluation"
          afterChange={handleAfterChange}
          manualColumnResize={true}
          manualRowResize={true}
          contextMenu={['row_above', 'row_below', 'remove_row', '---------', 'copy', 'cut']}
          fixedColumnsStart={5}
          wordWrap={false}
          renderAllRows={false}
          autoRowSize={false}
          autoColumnSize={false}
        />
      )}

      {/* Placeholder for non-order tabs */}
      {!isOrderTab && (
        <div style={{ padding: 48, textAlign: 'center', color: '#999' }}>
          {tab === 'summary' ? '产值明细汇总 — Coming soon' : `${tab} — Coming soon`}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Verify frontend builds and runs**

```bash
cd /c/Users/Administrator/zouhuo-system/order-sync/client && npm run dev
```

Open http://localhost:3001 — should see workshop portal, click to enter, see tabs with Handsontable.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add Handsontable Excel-like sheet component with all tabs"
```

---

## Task 8: Integration test and polish

**Goal:** End-to-end verification: start both servers, test full flow.

**Step 1: Start backend**

```bash
cd /c/Users/Administrator/zouhuo-system/order-sync/server && node app.js
```

**Step 2: Start frontend**

```bash
cd /c/Users/Administrator/zouhuo-system/order-sync/client && npm run dev
```

**Step 3: Test the following flows manually:**

1. Open http://localhost:3001 → see workshop portal with 3 cards
2. Click "B车间" → enter main view with 8 tabs
3. On "刘方尧" tab → click "Add Row" → new empty row appears in Handsontable
4. Edit cells inline → changes save to backend
5. Click "Export Excel" → downloads .xlsx file with correct format
6. Switch tabs → "完成订单", "取消单" show their respective data

**Step 4: Fix any issues found**

**Step 5: Commit**

```bash
git add -A && git commit -m "fix: integration fixes after end-to-end testing"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Clean up + scaffolding | package.json, start.bat |
| 2 | SQLite database layer | db/connection.js, db/init.js |
| 3 | Express server + orders API | app.js, routes/orders.js |
| 4 | Scan service rewrite | services/scanner.js, routes/scan.js |
| 5 | Excel export service | services/exporter.js, routes/export.js |
| 6 | Frontend workshop portal | App.jsx, WorkshopPortal.jsx |
| 7 | Handsontable sheet component | SchedulingSheet.jsx, columns.js |
| 8 | Integration test | All files |
