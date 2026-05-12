# 喷油部系统 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为喷油部搭建一个局域网 Web 系统,替代现有 Excel 流程,包含核价表、工人、工单、计件、报表五大模块。

**Architecture:** Node.js + Express 后端提供 REST API,better-sqlite3 本地单文件数据库,React + Vite 前端,生产环境由 Express 静态托管前端打包产物。核价表 Excel 可一键导入,工单自动展开工序,计件按日批量录入,工资自动计算。

**Tech Stack:**
- 后端: Node.js 18+, Express 4, better-sqlite3, exceljs, cors
- 前端: React 18, Vite 5, react-router-dom 6, axios, antd 5
- 测试: 内置 `node:test` + `assert` (无额外依赖)
- 部署: start.bat 一键启动,局域网访问

**项目根目录:** `C:\Users\Administrator\penyou-system\`

**设计文档:** `docs/plans/2026-04-16-penyou-system-design.md`

---

## 里程碑 1:项目骨架 + 数据库

### Task 1.1:后端项目初始化

**Files:**
- Create: `server/package.json`
- Create: `server/app.js`
- Create: `server/.gitignore`

**Step 1:** 创建 `server/package.json`

```json
{
  "name": "penyou-server",
  "version": "0.1.0",
  "main": "app.js",
  "scripts": {
    "start": "node app.js",
    "dev": "node --watch app.js",
    "test": "node --test tests/"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "cors": "^2.8.5",
    "exceljs": "^4.4.0",
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1"
  }
}
```

**Step 2:** 创建 `server/app.js`(骨架,仅 health 路由)

```js
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// 生产环境静态托管前端
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

const PORT = process.env.PORT || 3100;
app.listen(PORT, '0.0.0.0', () => console.log(`penyou-server on http://0.0.0.0:${PORT}`));
```

**Step 3:** 创建 `server/.gitignore`

```
node_modules/
db/*.db
db/*.db-journal
uploads/
```

**Step 4:** 安装依赖 & 验证

```bash
cd C:/Users/Administrator/penyou-system/server
npm install
node app.js &
curl http://localhost:3100/api/health
# 期望输出: {"ok":true,"time":"..."}
```

**Step 5:** 提交

```bash
git add server/package.json server/package-lock.json server/app.js server/.gitignore
git commit -m "feat: init server skeleton with express + health route"
```

---

### Task 1.2:数据库初始化

**Files:**
- Create: `server/db/init.sql`
- Create: `server/db/index.js`

**Step 1:** 创建 `server/db/init.sql`

```sql
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  quote_price REAL DEFAULT 0,
  remarks TEXT,
  deleted INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);

CREATE TABLE IF NOT EXISTS product_processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  part_name TEXT NOT NULL,
  technique TEXT,
  target_qty INTEGER DEFAULT 0,
  worker_count INTEGER DEFAULT 1,
  unit_wage REAL DEFAULT 0,
  calc_price REAL DEFAULT 0,
  paint_price REAL DEFAULT 0,
  total_price REAL DEFAULT 0,
  remarks TEXT,
  deleted INTEGER DEFAULT 0,
  FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_processes_product ON product_processes(product_id);

CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  name TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  customer TEXT,
  due_date DATE,
  status TEXT DEFAULT '待做',
  remarks TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);

CREATE TABLE IF NOT EXISTS production_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date DATE NOT NULL,
  worker_id INTEGER NOT NULL,
  work_order_id INTEGER NOT NULL,
  product_process_id INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  unit_wage REAL NOT NULL,
  total_wage REAL NOT NULL,
  remarks TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(worker_id) REFERENCES workers(id),
  FOREIGN KEY(work_order_id) REFERENCES work_orders(id),
  FOREIGN KEY(product_process_id) REFERENCES product_processes(id)
);
CREATE INDEX IF NOT EXISTS idx_prod_date ON production_records(work_date);
CREATE INDEX IF NOT EXISTS idx_prod_worker ON production_records(worker_id);
```

**Step 2:** 创建 `server/db/index.js`

```js
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'penyou.db');
const INIT_SQL = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf-8');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(INIT_SQL);

module.exports = db;
```

**Step 3:** 在 `app.js` 顶部加入 `require('./db')` 触发初始化,重启验证 `db/penyou.db` 文件被创建。

**Step 4:** 提交

```bash
git add server/db/ server/app.js
git commit -m "feat: init sqlite schema with 5 core tables"
```

---

### Task 1.3:前端项目初始化

**Files:**
- Create: `client/*` (Vite + React 模板)

**Step 1:** 用 Vite 创建前端

```bash
cd C:/Users/Administrator/penyou-system
npm create vite@latest client -- --template react
cd client
npm install
npm install react-router-dom axios antd dayjs
```

**Step 2:** 修改 `client/vite.config.js`,加代理

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3100'
    }
  }
});
```

**Step 3:** 改 `client/src/App.jsx` 为占位路由(首页显示 "喷油部系统")

**Step 4:** 启动验证

```bash
cd client && npm run dev
# 浏览器访问 http://localhost:5173 看到首页
```

**Step 5:** 提交

```bash
git add client/ -- ':!client/node_modules'
# 确保有 client/.gitignore 排除 node_modules 和 dist
git commit -m "feat: init vite+react client with antd"
```

---

### Task 1.4:一键启动脚本

**Files:**
- Create: `start.bat`
- Create: `README.md`

**Step 1:** 创建 `start.bat`

```bat
@echo off
chcp 65001 >nul
cd /d %~dp0

echo [1/2] 启动后端...
start "penyou-server" cmd /k "cd server && npm start"

timeout /t 2 /nobreak >nul

echo [2/2] 启动前端...
start "penyou-client" cmd /k "cd client && npm run dev"

echo.
echo 访问: http://localhost:5173
echo 局域网访问: http://<本机IP>:5173
pause
```

**Step 2:** 双击 `start.bat`,确认两个窗口启动,浏览器访问 5173 和 3100 均正常。

**Step 3:** 提交

```bash
git add start.bat
git commit -m "chore: add one-click start.bat"
```

---

## 里程碑 2:产品与核价 API(含 Excel 导入)

### Task 2.1:定价计算工具函数 + 单测

**Files:**
- Create: `server/lib/pricing.js`
- Create: `server/tests/pricing.test.js`

**Step 1:** 写失败测试 `server/tests/pricing.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { calcPrices } = require('../lib/pricing');

test('核价 = 工价 × 2.1', () => {
  const r = calcPrices({ unit_wage: 0.03 });
  assert.strictEqual(Number(r.calc_price.toFixed(4)), 0.063);
});

test('油漆价 = 核价 × 0.35', () => {
  const r = calcPrices({ unit_wage: 0.03 });
  assert.strictEqual(Number(r.paint_price.toFixed(5)), 0.02205);
});

test('总核价 = 核价 + 油漆价', () => {
  const r = calcPrices({ unit_wage: 0.03 });
  assert.strictEqual(Number(r.total_price.toFixed(5)), 0.08505);
});

test('工价为 0 时全部为 0', () => {
  const r = calcPrices({ unit_wage: 0 });
  assert.strictEqual(r.calc_price, 0);
  assert.strictEqual(r.paint_price, 0);
  assert.strictEqual(r.total_price, 0);
});
```

**Step 2:** 跑测试确认失败

```bash
cd server && npm test
# 期望: Cannot find module '../lib/pricing'
```

**Step 3:** 实现 `server/lib/pricing.js`

```js
const CALC_RATIO = 2.1;
const PAINT_RATIO = 0.35;

function calcPrices({ unit_wage }) {
  const calc_price = Number(unit_wage) * CALC_RATIO;
  const paint_price = calc_price * PAINT_RATIO;
  const total_price = calc_price + paint_price;
  return { calc_price, paint_price, total_price };
}

module.exports = { calcPrices, CALC_RATIO, PAINT_RATIO };
```

**Step 4:** 跑测试通过。提交

```bash
git add server/lib/pricing.js server/tests/pricing.test.js
git commit -m "feat: pricing calc helper with tests"
```

---

### Task 2.2:产品 & 工序 CRUD API

**Files:**
- Create: `server/routes/products.js`
- Modify: `server/app.js`(挂载路由)

**Step 1:** 写路由 `server/routes/products.js`

包含:
- `GET /api/products` — 列表(支持 `?q=货号或货名`)
- `GET /api/products/:id` — 详情 + 工序列表
- `POST /api/products` — 创建(body: `{code,name,quote_price,remarks,processes:[...]}`,processes 每项传 unit_wage,后端用 calcPrices 算出 calc/paint/total)
- `PUT /api/products/:id` — 更新(含工序,简单策略:软删除旧工序,全量新建)
- `DELETE /api/products/:id` — 软删除(`deleted=1`)

```js
const express = require('express');
const db = require('../db');
const { calcPrices } = require('../lib/pricing');

const router = express.Router();

router.get('/', (req, res) => {
  const q = req.query.q || '';
  const rows = db.prepare(`
    SELECT * FROM products
    WHERE deleted = 0 AND (code LIKE ? OR name LIKE ?)
    ORDER BY id DESC
  `).all(`%${q}%`, `%${q}%`);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id=? AND deleted=0').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'not found' });
  const processes = db.prepare('SELECT * FROM product_processes WHERE product_id=? AND deleted=0 ORDER BY id').all(req.params.id);
  res.json({ ...product, processes });
});

router.post('/', (req, res) => {
  const { code, name, quote_price = 0, remarks = '', processes = [] } = req.body;
  const tx = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO products(code,name,quote_price,remarks) VALUES (?,?,?,?)'
    ).run(code, name, quote_price, remarks);
    const insertProc = db.prepare(`
      INSERT INTO product_processes
      (product_id,part_name,technique,target_qty,worker_count,unit_wage,calc_price,paint_price,total_price,remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    for (const p of processes) {
      const { calc_price, paint_price, total_price } = calcPrices({ unit_wage: p.unit_wage || 0 });
      insertProc.run(
        lastInsertRowid, p.part_name, p.technique || '', p.target_qty || 0,
        p.worker_count || 1, p.unit_wage || 0, calc_price, paint_price, total_price, p.remarks || ''
      );
    }
    return lastInsertRowid;
  });
  const id = tx();
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const { code, name, quote_price, remarks, processes = [] } = req.body;
  const tx = db.transaction(() => {
    db.prepare('UPDATE products SET code=?,name=?,quote_price=?,remarks=? WHERE id=?')
      .run(code, name, quote_price, remarks, req.params.id);
    db.prepare('UPDATE product_processes SET deleted=1 WHERE product_id=?').run(req.params.id);
    const insertProc = db.prepare(`
      INSERT INTO product_processes
      (product_id,part_name,technique,target_qty,worker_count,unit_wage,calc_price,paint_price,total_price,remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    for (const p of processes) {
      const { calc_price, paint_price, total_price } = calcPrices({ unit_wage: p.unit_wage || 0 });
      insertProc.run(
        req.params.id, p.part_name, p.technique || '', p.target_qty || 0,
        p.worker_count || 1, p.unit_wage || 0, calc_price, paint_price, total_price, p.remarks || ''
      );
    }
  });
  tx();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE products SET deleted=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
```

**Step 2:** `app.js` 加 `app.use('/api/products', require('./routes/products'));`

**Step 3:** 用 curl 验证

```bash
curl -X POST http://localhost:3100/api/products \
  -H "Content-Type: application/json" \
  -d '{"code":"73622","name":"布鲁伊爸爸杯","quote_price":2.22,"processes":[{"part_name":"耳朵","technique":"2印","target_qty":6000,"worker_count":1,"unit_wage":0.03}]}'

curl http://localhost:3100/api/products
curl http://localhost:3100/api/products/1
```

**Step 4:** 提交

```bash
git add server/routes/products.js server/app.js
git commit -m "feat: product & process CRUD api"
```

---

### Task 2.3:核价表 Excel 导入

**Files:**
- Create: `server/services/pricing-importer.js`
- Create: `server/tests/pricing-importer.test.js`
- Modify: `server/routes/products.js`(加 `POST /api/products/import`)

**Excel 格式参考:** `C:/Users/Administrator/Desktop/兴信(发印尼）喷油核价.xlsx`

表头: `货号 | 货名 | 工序 | 工艺 | 目标数 | 人数 | 工价 | 核价 | 油漆价 | 总核价 | 报价 | 备注`

**说明:**
- 实际表头在第 2 行,第 1 行是合并大标题
- **货号 + 货名** 常为同一单元格多行文本(如 `73622\n布鲁伊爸爸杯`),需拆分
- 货号相同的多行构成同一产品的多道工序
- 某些行是小计行(工序列为空,核价/总核价列是合计),导入时跳过

**Step 1:** 写测试用例(用一个最小 xlsx fixture)

```js
// server/tests/pricing-importer.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parsePricingSheet } = require('../services/pricing-importer');

test('解析核价表,按货号聚合产品+工序', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  assert.ok(products.length >= 1);
  const bluey = products.find(p => p.name.includes('布鲁伊'));
  assert.ok(bluey);
  assert.strictEqual(bluey.code, '73622');
  assert.ok(bluey.processes.length >= 1);
  const ear = bluey.processes.find(x => x.part_name === '耳朵');
  assert.strictEqual(ear.technique, '2印');
  assert.strictEqual(ear.unit_wage, 0.03);
});

test('跳过小计行(无工序名)', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  for (const p of products) {
    for (const proc of p.processes) {
      assert.ok(proc.part_name && proc.part_name.length > 0);
    }
  }
});
```

**Step 2:** 准备 fixture

```bash
mkdir -p server/tests/fixtures
cp "C:/Users/Administrator/Desktop/兴信(发印尼）喷油核价.xlsx" server/tests/fixtures/pricing-sample.xlsx
```

**Step 3:** 跑测试确认失败

**Step 4:** 实现 `server/services/pricing-importer.js`

```js
const ExcelJS = require('exceljs');

async function parsePricingSheet(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const productsMap = new Map();

  wb.eachSheet((sheet) => {
    let headerRowIdx = -1;
    for (let r = 1; r <= Math.min(sheet.rowCount, 5); r++) {
      const cell = sheet.getRow(r).getCell(1).value;
      if (cell && String(cell).includes('货号')) { headerRowIdx = r; break; }
    }
    if (headerRowIdx < 0) return;

    for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const raw = row.getCell(1).value;
      if (!raw) continue;
      const text = typeof raw === 'object' && raw.text ? raw.text : String(raw);
      const parts = text.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const code = parts[0];
      const name = parts.slice(1).join(' ');

      const getCell = (c) => {
        const v = row.getCell(c).value;
        if (v === null || v === undefined || v === '') return null;
        if (typeof v === 'object') return v.result !== undefined ? v.result : v.text;
        return v;
      };

      const part_name = getCell(2);
      const technique = getCell(3);
      const target_qty = getCell(4);
      const worker_count = getCell(5);
      const unit_wage = getCell(6);
      const quote_price = getCell(10);

      if (!part_name) continue; // skip 小计行

      if (!productsMap.has(code)) {
        productsMap.set(code, { code, name, quote_price: Number(quote_price) || 0, processes: [] });
      }
      const product = productsMap.get(code);
      if (quote_price && !product.quote_price) product.quote_price = Number(quote_price);

      product.processes.push({
        part_name: String(part_name).trim(),
        technique: technique ? String(technique).trim() : '',
        target_qty: Number(target_qty) || 0,
        worker_count: Number(worker_count) || 1,
        unit_wage: Number(unit_wage) || 0,
        remarks: ''
      });
    }
  });

  return [...productsMap.values()];
}

module.exports = { parsePricingSheet };
```

**Step 5:** 跑测试通过

**Step 6:** 加导入路由 `server/routes/products.js`

```js
const multer = require('multer');
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });
const { parsePricingSheet } = require('../services/pricing-importer');

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    const products = await parsePricingSheet(req.file.path);
    const tx = db.transaction(() => {
      const insertP = db.prepare('INSERT INTO products(code,name,quote_price) VALUES (?,?,?)');
      const insertProc = db.prepare(`
        INSERT INTO product_processes
        (product_id,part_name,technique,target_qty,worker_count,unit_wage,calc_price,paint_price,total_price)
        VALUES (?,?,?,?,?,?,?,?,?)
      `);
      let count = 0;
      for (const p of products) {
        const { lastInsertRowid } = insertP.run(p.code, p.name, p.quote_price);
        for (const proc of p.processes) {
          const { calc_price, paint_price, total_price } = calcPrices({ unit_wage: proc.unit_wage });
          insertProc.run(lastInsertRowid, proc.part_name, proc.technique, proc.target_qty, proc.worker_count, proc.unit_wage, calc_price, paint_price, total_price);
        }
        count++;
      }
      return count;
    });
    const count = tx();
    res.json({ ok: true, imported: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

**Step 7:** curl 测试导入

```bash
curl -X POST http://localhost:3100/api/products/import \
  -F "file=@C:/Users/Administrator/Desktop/兴信(发印尼）喷油核价.xlsx"
# 期望: {"ok":true,"imported":N}
```

**Step 8:** 提交

```bash
git add server/services/pricing-importer.js server/tests/ server/routes/products.js
git commit -m "feat: import pricing excel into products + processes"
```

---

## 里程碑 3:工人 / 工单 / 计件 API

### Task 3.1:工人 CRUD

**Files:** `server/routes/workers.js`, `app.js`

简单列表 + 增改删(停用)。参考 Task 2.2 结构,提供:
- `GET /api/workers?active=1` — 列表
- `POST /api/workers` — 新建
- `PUT /api/workers/:id` — 改
- `DELETE /api/workers/:id` — 软停用(`active=0`)

curl 验证 → 提交 `feat: workers crud`。

---

### Task 3.2:工单 CRUD + 工单号生成

**Files:** `server/routes/work-orders.js`, `server/lib/order-no.js`, `server/tests/order-no.test.js`

**工单号规则:** `WO + YYYYMMDD + 3位序号`(当日第几单)

**Step 1-4:** TDD `order-no.js` 的 `nextOrderNo(db, date)` 函数 — 查当天已有多少单,序号 +1。

**Step 5:** 工单路由
- `GET /api/work-orders?status=&q=` — 列表,返回时 JOIN 产品名
- `GET /api/work-orders/:id` — 详情 + 产品工序清单(用于计件录入时选择)+ 已录入的计件汇总
- `POST /api/work-orders` — 创建(自动生成 order_no)
- `PUT /api/work-orders/:id` — 改基本信息/状态
- `DELETE /api/work-orders/:id` — 硬删(仅无计件记录时允许)

**Step 6:** curl 验证 → 提交 `feat: work orders crud`

---

### Task 3.3:计件录入 API

**Files:** `server/routes/production.js`, `server/lib/wage.js`, `server/tests/wage.test.js`

**Step 1-4:** TDD `wage.js`
```js
function calcWage(qty, unit_wage) { return Number(qty) * Number(unit_wage); }
```
测试:正常值、0、小数。

**Step 5:** 路由
- `POST /api/production` — **批量录入**(body: `{records: [{work_date, worker_id, work_order_id, product_process_id, qty, remarks}]}`),后端查 `product_processes.unit_wage` 作为 unit_wage 快照,算 total_wage
- `GET /api/production?worker_id=&date_from=&date_to=&work_order_id=` — 查询明细
- `DELETE /api/production/:id` — 删除某条

**Step 6:** 提交 `feat: production records with wage calc`

---

### Task 3.4:工资/产量报表 API

**Files:** `server/routes/reports.js`

- `GET /api/reports/wages?date_from=&date_to=&worker_id=` — 按工人汇总: `worker_id, name, total_qty, total_wage`,附明细
- `GET /api/reports/work-order/:id` — 按工单汇总:每道工序已完成数 / 剩余数 / 累计工资
- `GET /api/reports/export/wages.xlsx?date_from=&date_to=` — 用 exceljs 生成工资汇总表并下载

提交 `feat: reports api with excel export`

---

## 里程碑 4:前端页面

### Task 4.1:布局 + 路由骨架

**Files:** `client/src/App.jsx`, `client/src/api.js`, `client/src/pages/*.jsx`

**Step 1:** 创建 `client/src/api.js`

```js
import axios from 'axios';
const api = axios.create({ baseURL: '/api' });
export default api;
```

**Step 2:** 用 antd 的 `Layout + Menu` 做左侧导航,5 个菜单项对应 5 个页面,每个页面先写占位 `<h2>` 即可:
- `/products` 核价表管理
- `/workers` 工人名册
- `/work-orders` 工单
- `/production` 计件录入
- `/reports` 报表

**Step 3:** 启动验证:每个菜单项切换页面。

提交 `feat: client layout with 5 routes`

---

### Task 4.2:核价表管理页

**Files:** `client/src/pages/Products.jsx`

- 顶部:搜索框 + 「新建」按钮 + 「导入 Excel」按钮(调 `POST /api/products/import`)
- antd Table 列表(货号/货名/报价/工序数/操作)
- 展开行显示工序列表(Table 嵌套)
- 新建/编辑弹窗:表单 + 工序动态行(antd Form.List),保存时 POST/PUT

提交 `feat: products page with excel import`

---

### Task 4.3:工人名册页

**Files:** `client/src/pages/Workers.jsx`

简单的 Table + Modal 表单,字段:工号、姓名、状态。

提交 `feat: workers page`

---

### Task 4.4:工单管理页

**Files:** `client/src/pages/WorkOrders.jsx`

- Table 列表(工单号/产品/数量/客户/交期/状态/操作),按状态 Tag 着色
- 新建弹窗:产品下拉(搜索货号/货名)、数量、客户、交期、备注;保存后显示工单号
- 点击行展开:显示工序清单 + 该工单已录计件汇总(调 `/api/work-orders/:id`)

提交 `feat: work orders page`

---

### Task 4.5:计件录入页

**Files:** `client/src/pages/ProductionEntry.jsx`

- 顶部:日期选择(默认今天)、工人选择、工单选择
- 选择工单后,自动加载该产品的工序清单,展示为表格,每行一个可填 "件数" 的输入框
- 底部「保存」按钮:批量 POST `/api/production`
- 下方展示当日已录入的明细(可删除)

提交 `feat: production entry page`

---

### Task 4.6:报表页

**Files:** `client/src/pages/Reports.jsx`

- Tab 1:工资报表 — 日期范围、工人筛选 → 汇总表 + 明细 + 「导出 Excel」按钮
- Tab 2:工单进度 — 搜索工单 → 显示每道工序完成进度条 + 累计工资

提交 `feat: reports page with excel export`

---

## 里程碑 5:部署与联调

### Task 5.1:前端生产构建 + Express 托管

```bash
cd client && npm run build
# 产出 client/dist/
```

启动 `server` 后访问 `http://localhost:3100/` 应该直接看到前端页面(因 `app.js` 已配静态托管)。

---

### Task 5.2:局域网部署验证

1. 查主管电脑 IP:`ipconfig`
2. 防火墙放行 3100 端口
3. 另一台电脑浏览器访问 `http://<主管IP>:3100/`,跑一遍:导入核价表 → 新建工单 → 录入计件 → 看报表
4. 修 bug → 提交 → 本次任务完成

提交 `chore: LAN deployment verified`

---

## 完成标准

- [ ] 双击 start.bat 一键启动,前后端运行正常
- [ ] 可从 `兴信(发印尼）喷油核价.xlsx` 一键导入核价表
- [ ] 可手动新建产品/工序,数据入库
- [ ] 可创建工单,工单号自动生成
- [ ] 可按日批量录入工人计件,自动算工资
- [ ] 报表页可按日期 + 工人查工资,可导出 Excel
- [ ] 局域网其他电脑可访问并正常使用
- [ ] 所有 `node:test` 单测通过
