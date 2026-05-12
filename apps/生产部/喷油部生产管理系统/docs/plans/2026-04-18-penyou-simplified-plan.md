# 喷油部系统 · 简化版实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 基于 `2026-04-18-penyou-simplified-design.md`,在已有骨架上增减,交付「核价表 + 分拉 + 收支表(Luckysheet 可编辑)」三页系统,支持导出 xls 到桌面。

**Architecture:** 在已搭好的 Node/Express/SQLite + React/antd 上做增量改造:砍旧功能(工人/工单/计件/报表占位页)、加新表(lines/dispatches/ledger_edits)、重写 Excel 导入(支持 5 个 sheet)、加分拉页和收支表页(Luckysheet 从 CDN)。

**Tech Stack:** Node 25 + Express 4 + better-sqlite3 12 + exceljs + xlsx(SheetJS) + multer(已装);React 19 + Vite 8 + antd + react-router-dom + axios + dayjs;Luckysheet CDN。

**项目根目录:** `C:\Users\Administrator\penyou-system\`

**设计文档:** `docs/plans/2026-04-18-penyou-simplified-design.md`

**Git user:** 提交时用 `-c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com"`(本仓库未设全局身份)

**已完成状态(开工前):**
- 里程碑 1 全部(骨架/DB/前端/start.bat)
- 里程碑 2 全部(pricing/products CRUD/Excel 导入 Sheet 1)
- 里程碑 4.1 (layout+路由) 和 4.2 (Products 页) —— Products 页保留,其它 4 个占位页将在本计划 Task 1.1 删除

---

## 里程碑 1:清理旧范围 + 新表

### Task 1.1:前端菜单精简为 3 项,删 4 个占位页

**Files:**
- Modify: `client/src/App.jsx`(菜单 5 项 → 3 项)
- Delete: `client/src/pages/Workers.jsx`
- Delete: `client/src/pages/WorkOrders.jsx`
- Delete: `client/src/pages/ProductionEntry.jsx`
- Delete: `client/src/pages/Reports.jsx`

**Step 1:** 改 `client/src/App.jsx` 菜单

把 `items` 数组替换为:

```jsx
const items = [
  { key: '/products', icon: <AppstoreOutlined />, label: <Link to="/products">核价表</Link> },
  { key: '/dispatch', icon: <ForkOutlined />, label: <Link to="/dispatch">分拉</Link> },
  { key: '/ledger', icon: <TableOutlined />, label: <Link to="/ledger">收支表</Link> },
];
```

顶部 import 改为:
```jsx
import { AppstoreOutlined, ForkOutlined, TableOutlined } from '@ant-design/icons';
import Products from './pages/Products';
import Dispatch from './pages/Dispatch';
import Ledger from './pages/Ledger';
```

`<Routes>` 里也改为 3 条:
```jsx
<Route path="/" element={<Navigate to="/products" replace />} />
<Route path="/products" element={<Products />} />
<Route path="/dispatch" element={<Dispatch />} />
<Route path="/ledger" element={<Ledger />} />
```

**Step 2:** 创建 `client/src/pages/Dispatch.jsx` 和 `client/src/pages/Ledger.jsx` 占位(避免 import 报错):

```jsx
// Dispatch.jsx
import { Empty } from 'antd';
export default function Dispatch() {
  return <div><h2>分拉</h2><Empty description="待实现" /></div>;
}

// Ledger.jsx
import { Empty } from 'antd';
export default function Ledger() {
  return <div><h2>收支表</h2><Empty description="待实现" /></div>;
}
```

**Step 3:** 删 4 个文件

```bash
cd C:/Users/Administrator/penyou-system
rm client/src/pages/Workers.jsx
rm client/src/pages/WorkOrders.jsx
rm client/src/pages/ProductionEntry.jsx
rm client/src/pages/Reports.jsx
```

**Step 4:** 启动前端验证 3 项菜单都能跳转,不报错

```bash
cd client && npm run dev
# 浏览器开 http://localhost:5173 → 点 3 个菜单 → 不报错
```

**Step 5:** 提交

```bash
git add client/src/App.jsx client/src/pages/
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "refactor: trim menu to 3 items, drop workers/orders/production/reports pages"
```

---

### Task 1.2:加 lines / dispatches / ledger_edits 表,种子 3 条拉

**Files:**
- Modify: `server/db/init.sql`(追加 3 张表 + 删 3 张旧表)
- Create: `server/db/seed.js`(种子数据脚本,幂等)
- Modify: `server/db/index.js`(启动时调 seed)

**Step 1:** 改 `server/db/init.sql`

**删掉** `workers`、`work_orders`、`production_records` 三张表的 CREATE 语句 + 对应索引。

追加:

```sql
CREATE TABLE IF NOT EXISTS lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_date DATE NOT NULL,
  product_id INTEGER NOT NULL,
  product_process_id INTEGER NOT NULL,
  line_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(product_process_id) REFERENCES product_processes(id),
  FOREIGN KEY(line_id) REFERENCES lines(id),
  UNIQUE(dispatch_date, product_process_id)
);
CREATE INDEX IF NOT EXISTS idx_dispatches_date ON dispatches(dispatch_date);
CREATE INDEX IF NOT EXISTS idx_dispatches_product ON dispatches(dispatch_date, product_id);

CREATE TABLE IF NOT EXISTS ledger_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_date DATE NOT NULL,
  line_id INTEGER NOT NULL,
  product_id INTEGER,
  column_key TEXT NOT NULL,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(line_id) REFERENCES lines(id),
  FOREIGN KEY(product_id) REFERENCES products(id),
  UNIQUE(ledger_date, line_id, product_id, column_key)
);
CREATE INDEX IF NOT EXISTS idx_ledger_edits_date ON ledger_edits(ledger_date);
```

**Step 2:** 创建 `server/db/seed.js`

```js
const LINES = [
  { name: '宋沛霖手喷', sort_order: 1 },
  { name: '宋沛霖自动', sort_order: 2 },
  { name: '胡旗移印', sort_order: 3 },
];

function seedLines(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO lines(name, sort_order) VALUES (?, ?)');
  for (const l of LINES) insert.run(l.name, l.sort_order);
}

module.exports = { seedLines, LINES };
```

**Step 3:** 改 `server/db/index.js` 在最后调 seed

```js
const { seedLines } = require('./seed');
seedLines(db);
```

**Step 4:** 删本地 dev DB(schema 变了),重启验证

```bash
rm server/db/penyou.db server/db/penyou.db-shm server/db/penyou.db-wal
cd server && node app.js &
sleep 2
curl http://localhost:3100/api/health
# 用 sqlite 查表:
node -e "const db=require('./db'); console.log(db.prepare('SELECT name FROM sqlite_master WHERE type=\"table\" ORDER BY name').all())"
# 期望: products, product_processes, lines, dispatches, ledger_edits, sqlite_sequence
node -e "const db=require('./db'); console.log(db.prepare('SELECT * FROM lines ORDER BY sort_order').all())"
# 期望: 3 条:宋沛霖手喷/宋沛霖自动/胡旗移印
```

**Step 5:** 杀 server,提交

```bash
taskkill //F //IM node.exe
git add server/db/init.sql server/db/seed.js server/db/index.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat: drop unused tables, add lines/dispatches/ledger_edits + seed 3 lines"
```

---

## 里程碑 2:Excel 导入重写 — 支持全部 5 个 sheet

### Task 2.1:TDD header 识别 helper

**Files:**
- Create: `server/lib/xlsx-headers.js`
- Create: `server/tests/xlsx-headers.test.js`

**Step 1:** 写失败测试 `server/tests/xlsx-headers.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const { detectColumns } = require('../lib/xlsx-headers');

test('识别标准表头(6款狗仔):货号|货名|工序|...', () => {
  const header = ['货号', '货名', '工序', '目标数', '人数', '工价', '核价', '油漆价', '总核价', '报价', '备注'];
  const cols = detectColumns(header);
  assert.strictEqual(cols.code, 0);
  assert.strictEqual(cols.name, 1);
  assert.strictEqual(cols.part_name, 2);
  assert.strictEqual(cols.target_qty, 3);
  assert.strictEqual(cols.worker_count, 4);
  assert.strictEqual(cols.unit_wage, 5);
  assert.strictEqual(cols.quote_price, 9);
});

test('识别含位置+工序分离列(E73814泡泡壶):图片|货号|位置|工序|...', () => {
  const header = ['图片', '货号', '位置', '工序', '目标数', '人数', '工价', '核价', '油漆价', '总核价', '报价', '备注'];
  const cols = detectColumns(header);
  assert.strictEqual(cols.code, 1);
  assert.strictEqual(cols.part_name, 2);
  assert.strictEqual(cols.technique, 3);
  assert.strictEqual(cols.target_qty, 4);
});

test('识别无货号列(47600 货柜车):图片|位置|工序|...', () => {
  const header = ['图片', '位置', '工序', '目标数', '人数', '工价', '核价', '油漆价', '总核价', '报价', '备注'];
  const cols = detectColumns(header);
  assert.strictEqual(cols.code, undefined);
  assert.strictEqual(cols.part_name, 1);
  assert.strictEqual(cols.technique, 2);
});

test('识别「工序」列名当 part_name(47101收割机无「位置」列)', () => {
  const header = ['货号', '货名', '工序', '目标数', '人数', '工价', '核价', '油漆价', '总核价', '报价', '备注'];
  const cols = detectColumns(header);
  assert.strictEqual(cols.part_name, 2);
  assert.strictEqual(cols.technique, undefined);
});
```

**Step 2:** 跑测试确认失败

```bash
cd server && npm test
# 期望: Cannot find module '../lib/xlsx-headers'
```

**Step 3:** 实现 `server/lib/xlsx-headers.js`

```js
// 把表头行数组识别成列索引映射
// 规则:
//  - 「货号」→ code
//  - 「货名」→ name(独立列)
//  - 「位置」→ part_name(优先)
//  - 「工序」→ 若已有 part_name,则当 technique;否则当 part_name
//  - 「工艺」→ technique
//  - 「目标数」「人数」「工价」「核价」「油漆价」「总核价」「报价」「备注」→ 同名字段
function detectColumns(headerRow) {
  const cols = {};
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '').trim();
    if (!h) continue;
    if (h.includes('货号')) cols.code = i;
    else if (h.includes('货名')) cols.name = i;
    else if (h.includes('位置')) cols.part_name = i;
    else if (h.includes('工艺')) cols.technique = i;
    else if (h.includes('工序')) {
      if (cols.part_name === undefined) cols.part_name = i;
      else if (cols.technique === undefined) cols.technique = i;
    }
    else if (h.includes('目标数')) cols.target_qty = i;
    else if (h.includes('人数')) cols.worker_count = i;
    else if (h.includes('工价')) cols.unit_wage = i;
    else if (h.includes('总核价')) cols.total_price = i;
    else if (h.includes('油漆价')) cols.paint_price = i;
    else if (h.includes('核价')) cols.calc_price = i;
    else if (h.includes('报价')) cols.quote_price = i;
    else if (h.includes('备注')) cols.remarks = i;
  }
  return cols;
}

module.exports = { detectColumns };
```

**Step 4:** 跑测试通过

```bash
npm test
# 期望: 所有测试(含 pricing/importer/headers)pass
```

**Step 5:** 提交

```bash
git add server/lib/xlsx-headers.js server/tests/xlsx-headers.test.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat: header-driven column detector for pricing sheets"
```

---

### Task 2.2:改造 parsePricingSheet 用 header detector + sheet 名兜底

**Files:**
- Modify: `server/services/pricing-importer.js`(重写)
- Modify: `server/tests/pricing-importer.test.js`(加覆盖其它 sheet 的断言)

**Step 1:** 扩展 `server/tests/pricing-importer.test.js`,在末尾追加:

```js
test('导入全部 5 个 sheet(不止 Sheet 1)', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  // Sheet 1 有 3 货号(73622/73635/73636),其它 sheet 至少各 1
  const codes = products.map(p => p.code);
  assert.ok(codes.includes('73622'), '应含 73622');
  assert.ok(codes.includes('47101'), '应含 47101(收割机)');
  assert.ok(codes.includes('E73814'), '应含 E73814(泡泡壶)');
});

test('收割机:47101 货号独立列,多行不同货名,聚合为单产品', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  const harvester = products.find(p => p.code === '47101');
  assert.ok(harvester);
  assert.ok(harvester.processes.length >= 10, '应有多道工序');
  // 某道工序是「联合收割机右身 · 喷油」
  const p1 = harvester.processes.find(x => x.part_name.includes('联合收割机右身'));
  assert.ok(p1);
  assert.strictEqual(p1.technique, '喷油');
});

test('泡泡壶:E73814 有独立「位置」列,part_name 取位置列', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  const bubble = products.find(p => p.code === 'E73814');
  assert.ok(bubble);
  const proc = bubble.processes.find(x => x.part_name === '泡泡壶壶身');
  assert.ok(proc);
  assert.strictEqual(proc.technique, '移印');
});

test('跳过小计/合计行(part_name 为空 或 文字是「合计」)', async () => {
  const file = path.join(__dirname, 'fixtures', 'pricing-sample.xlsx');
  const products = await parsePricingSheet(file);
  for (const p of products) {
    for (const proc of p.processes) {
      assert.ok(proc.part_name, '工序应有 part_name');
      assert.ok(!/^合计$/.test(proc.part_name.trim()), '不应是合计行');
    }
  }
});
```

**Step 2:** 跑测试确认新加的 4 个失败

```bash
cd server && npm test
# 期望: 跑到新测试时失败(现有实现只导 Sheet 1)
```

**Step 3:** 重写 `server/services/pricing-importer.js`

```js
const ExcelJS = require('exceljs');
const { detectColumns } = require('../lib/xlsx-headers');

// 从 sheet 名前缀提数字/字母 code,例如 "47600 货柜车" → "47600","E73814泡泡壶" → "E73814"
function codeFromSheetName(sheetName) {
  const m = sheetName.match(/^([A-Za-z]?\d+[A-Za-z]?\d*)/);
  return m ? m[1] : null;
}

function rowCellVal(cell) {
  const v = cell.value;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') {
    if (v.result !== undefined) return v.result;
    if (v.text !== undefined) return v.text;
    return JSON.stringify(v);
  }
  return v;
}

function findHeaderRow(sheet) {
  // 扫前 5 行,任意单元格含「货号」「位置」「工序」均视为表头行
  for (let r = 1; r <= Math.min(sheet.rowCount, 5); r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= sheet.columnCount; c++) {
      const v = String(rowCellVal(row.getCell(c)) || '');
      if (v.includes('货号') || v.includes('位置') || v === '工序') return r;
    }
  }
  return -1;
}

function headerArray(sheet, headerRowIdx) {
  const row = sheet.getRow(headerRowIdx);
  const arr = [];
  for (let c = 1; c <= sheet.columnCount; c++) arr.push(rowCellVal(row.getCell(c)));
  return arr;
}

function parseCodeAndName(cellRaw, cols, row) {
  // 三种情况:
  // 1. cols.code 和 cols.name 都存在 → 分别取两格
  // 2. 只有 cols.code,cell 内容是 "73622\n布鲁伊爸爸杯" 样式 → split
  // 3. 只有 cols.code,cell 是纯 code → code 是自己,name 需要从别处(或暂空)
  // 4. cols.code 不存在 → 返回 null(由 sheet 名兜底)
  if (cols.code === undefined) return null;

  const codeCellIdx = cols.code + 1;
  const raw = rowCellVal(row.getCell(codeCellIdx));
  if (!raw) return null;
  const text = String(raw);

  if (cols.name !== undefined) {
    // 情况 1:分离列
    const nameRaw = rowCellVal(row.getCell(cols.name + 1));
    // 但情况 1 的 Sheet 1 实际数据 cell1 = "73622\n布鲁伊爸爸杯",cell2 = 部位名
    // 所以先判断 cell1 是否包含换行:有换行就走情况 2
    if (/[\r\n]/.test(text)) {
      const parts = text.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) return { code: parts[0], name: parts.slice(1).join(' ') };
    }
    return { code: String(text).trim(), name: nameRaw ? String(nameRaw).trim() : '' };
  }

  // 情况 2:code 单列但多行文本
  if (/[\r\n]/.test(text)) {
    const parts = text.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { code: parts[0], name: parts.slice(1).join(' ') };
  }

  return { code: String(text).trim(), name: '' };
}

async function parsePricingSheet(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const productsMap = new Map();

  wb.eachSheet((sheet) => {
    const headerRowIdx = findHeaderRow(sheet);
    if (headerRowIdx < 0) return;

    const header = headerArray(sheet, headerRowIdx);
    const cols = detectColumns(header);
    if (cols.part_name === undefined) return; // 没法识别到工序列,跳过

    const fallbackCode = codeFromSheetName(sheet.name);
    const fallbackName = sheet.name.replace(/^[A-Za-z]?\d+[A-Za-z]?\d*\s*/, '').trim();

    for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);

      // 尝试获取 code / name
      let idPair = parseCodeAndName(row.getCell(1).value, cols, row);
      if (!idPair && fallbackCode) idPair = { code: fallbackCode, name: fallbackName };
      if (!idPair || !idPair.code) continue;

      const partRaw = rowCellVal(row.getCell(cols.part_name + 1));
      if (!partRaw) continue;
      const part_name = String(partRaw).trim();
      if (!part_name || /^合计$/.test(part_name) || /^小计$/.test(part_name)) continue;

      const technique = cols.technique !== undefined
        ? (rowCellVal(row.getCell(cols.technique + 1)) || '') : '';
      const target_qty = cols.target_qty !== undefined
        ? rowCellVal(row.getCell(cols.target_qty + 1)) : null;
      const worker_count = cols.worker_count !== undefined
        ? rowCellVal(row.getCell(cols.worker_count + 1)) : null;
      const unit_wage = cols.unit_wage !== undefined
        ? rowCellVal(row.getCell(cols.unit_wage + 1)) : null;
      const quote_price = cols.quote_price !== undefined
        ? rowCellVal(row.getCell(cols.quote_price + 1)) : null;

      const key = idPair.code;
      if (!productsMap.has(key)) {
        productsMap.set(key, {
          code: idPair.code,
          name: idPair.name || fallbackName || '',
          quote_price: Number(quote_price) || 0,
          processes: [],
        });
      }
      const product = productsMap.get(key);
      if (!product.name && idPair.name) product.name = idPair.name;
      if (!product.quote_price && quote_price) product.quote_price = Number(quote_price) || 0;

      product.processes.push({
        part_name,
        technique: technique ? String(technique).trim() : '',
        target_qty: Number(target_qty) || 0,
        worker_count: Number(worker_count) || 1,
        unit_wage: Number(unit_wage) || 0,
        remarks: '',
      });
    }
  });

  return [...productsMap.values()];
}

module.exports = { parsePricingSheet };
```

**Step 4:** 跑测试全部通过

```bash
npm test
# 期望: 含 pricing.test + pricing-importer.test + xlsx-headers.test 全 pass
```

**Step 5:** 手动跑一次 import 看结果

```bash
# 清 DB + 重启 server
rm server/db/penyou.db*
cd server && node app.js &
sleep 2
curl -X POST http://localhost:3100/api/products/import \
  -F "file=@C:/Users/Administrator/Desktop/兴信(发印尼）喷油核价.xlsx"
# 期望: imported 应 > 3(多个 sheet 都进了)
curl http://localhost:3100/api/products | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('total:',a.length);a.forEach(p=>console.log(' -',p.code,p.name,'procs='+p.process_count))})"
```

**Step 6:** 杀 server,提交

```bash
taskkill //F //IM node.exe
git add server/services/pricing-importer.js server/tests/pricing-importer.test.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat: pricing importer handles all 5 sheet layouts via header detection"
```

---

## 里程碑 3:分拉 API + 页面

### Task 3.1:GET /api/lines

**Files:**
- Create: `server/routes/lines.js`
- Modify: `server/app.js`(挂载)

**Step 1:** 创建 `server/routes/lines.js`

```js
const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM lines ORDER BY sort_order').all());
});

module.exports = router;
```

**Step 2:** `server/app.js` 追加:

```js
app.use('/api/lines', require('./routes/lines'));
```

**Step 3:** 验证

```bash
cd server && node app.js &
sleep 2
curl http://localhost:3100/api/lines
# 期望: 3 条 JSON
taskkill //F //IM node.exe
```

**Step 4:** 提交

```bash
git add server/routes/lines.js server/app.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat: GET /api/lines"
```

---

### Task 3.2:TDD POST /api/dispatches 批量保存

**Files:**
- Create: `server/routes/dispatches.js`
- Create: `server/tests/dispatches.test.js`
- Modify: `server/app.js`

**Step 1:** 写失败测试 `server/tests/dispatches.test.js`

```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function setupDb() {
  const db = new Database(':memory:');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf-8');
  db.exec(sql);
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO lines(id,name,sort_order) VALUES (1,'宋沛霖手喷',1),(2,'宋沛霖自动',2),(3,'胡旗移印',3)").run();
  const { lastInsertRowid: pid } = db.prepare("INSERT INTO products(code,name) VALUES ('TEST','测试')").run();
  const p1 = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)")
    .run(pid, '耳朵', '喷油', 1000, 1, 0.1);
  const p2 = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)")
    .run(pid, '身', '移印', 2000, 2, 0.05);
  return { db, pid, procIds: [p1.lastInsertRowid, p2.lastInsertRowid] };
}

// 抽出纯函数以便单测(实际路由里引用同一个函数)
const { saveDispatches, listDispatches } = require('../routes/dispatches');

test('保存分拉:先删旧再插新(同日期同货号覆盖)', () => {
  const { db, pid, procIds } = setupDb();
  saveDispatches(db, {
    date: '2026-04-18',
    product_id: pid,
    items: [
      { product_process_id: procIds[0], line_id: 1 },
      { product_process_id: procIds[1], line_id: 3 },
    ],
  });
  let rows = db.prepare('SELECT * FROM dispatches WHERE dispatch_date=? AND product_id=?').all('2026-04-18', pid);
  assert.strictEqual(rows.length, 2);

  // 覆盖保存
  saveDispatches(db, {
    date: '2026-04-18',
    product_id: pid,
    items: [{ product_process_id: procIds[0], line_id: 2 }],
  });
  rows = db.prepare('SELECT * FROM dispatches WHERE dispatch_date=? AND product_id=?').all('2026-04-18', pid);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].line_id, 2);
});

test('列表返回 join 出 part_name 和 line.name', () => {
  const { db, pid, procIds } = setupDb();
  saveDispatches(db, {
    date: '2026-04-18',
    product_id: pid,
    items: [{ product_process_id: procIds[0], line_id: 1 }],
  });
  const rows = listDispatches(db, { date: '2026-04-18', product_id: pid });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].part_name, '耳朵');
  assert.strictEqual(rows[0].line_name, '宋沛霖手喷');
});
```

**Step 2:** 跑测试确认失败

```bash
cd server && npm test
# 期望: Cannot find module '../routes/dispatches'
```

**Step 3:** 实现 `server/routes/dispatches.js`

```js
const express = require('express');
const db = require('../db');
const router = express.Router();

function saveDispatches(dbi, { date, product_id, items }) {
  const tx = dbi.transaction(() => {
    dbi.prepare('DELETE FROM dispatches WHERE dispatch_date=? AND product_id=?').run(date, product_id);
    const ins = dbi.prepare(
      'INSERT INTO dispatches(dispatch_date, product_id, product_process_id, line_id) VALUES (?,?,?,?)'
    );
    for (const it of items || []) ins.run(date, product_id, it.product_process_id, it.line_id);
  });
  tx();
}

function listDispatches(dbi, { date, product_id }) {
  const params = [];
  let where = '1=1';
  if (date) { where += ' AND d.dispatch_date=?'; params.push(date); }
  if (product_id) { where += ' AND d.product_id=?'; params.push(product_id); }
  return dbi.prepare(`
    SELECT d.*, pp.part_name, pp.technique, pp.target_qty, pp.unit_wage,
           l.name AS line_name
    FROM dispatches d
    JOIN product_processes pp ON pp.id = d.product_process_id
    JOIN lines l ON l.id = d.line_id
    WHERE ${where}
    ORDER BY d.id
  `).all(...params);
}

router.get('/', (req, res) => {
  const { date, product_id } = req.query;
  res.json(listDispatches(db, { date, product_id: product_id ? Number(product_id) : null }));
});

router.post('/', (req, res) => {
  const { date, product_id, items } = req.body;
  if (!date || !product_id) return res.status(400).json({ error: 'date and product_id required' });
  saveDispatches(db, { date, product_id, items: items || [] });
  res.json({ ok: true });
});

module.exports = router;
module.exports.saveDispatches = saveDispatches;
module.exports.listDispatches = listDispatches;
```

**Step 4:** `server/app.js` 挂载

```js
app.use('/api/dispatches', require('./routes/dispatches'));
```

**Step 5:** 跑测试通过 + 手工 curl 验证

```bash
cd server && npm test
# 期望: 全 pass

# 手工
rm server/db/penyou.db*
node app.js &
sleep 2
# 先导一批核价数据
curl -X POST http://localhost:3100/api/products/import \
  -F "file=@C:/Users/Administrator/Desktop/兴信(发印尼）喷油核价.xlsx"
# 查个货号详情拿工序 ID
curl http://localhost:3100/api/products/1
# 保存分拉
curl -X POST http://localhost:3100/api/dispatches \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-04-18","product_id":1,"items":[{"product_process_id":1,"line_id":1},{"product_process_id":2,"line_id":3}]}'
# 查回
curl "http://localhost:3100/api/dispatches?date=2026-04-18&product_id=1"
taskkill //F //IM node.exe
```

**Step 6:** 提交

```bash
git add server/routes/dispatches.js server/tests/dispatches.test.js server/app.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat: dispatches save/list api with tests"
```

---

### Task 3.3:前端 Dispatch 分拉页

**Files:**
- Modify: `client/src/pages/Dispatch.jsx`(把占位替换为完整页面)

**Step 1:** 重写 `client/src/pages/Dispatch.jsx`

页面结构(功能具体实现见下方代码,UI 用 antd):

- 顶部:`DatePicker`(默认今天)+ `Select` 搜索货号(调 `/api/products?q=`,显示 `code - name`)
- 选中货号后:调 `/api/products/:id` 拿详情 + 调 `/api/dispatches?date=&product_id=` 拿已有分拉,合并显示
- 工序表格列:部位 / 工艺 / 目标数 / 工价 / 核价 / **分到哪条拉**(Select,选 `line_id`)
- 底部:「保存分拉」按钮 → `POST /api/dispatches`

```jsx
import { useEffect, useState } from 'react';
import { DatePicker, Select, Table, Button, Space, message } from 'antd';
import dayjs from 'dayjs';
import api from '../api';

export default function Dispatch() {
  const [date, setDate] = useState(dayjs());
  const [productOptions, setProductOptions] = useState([]);
  const [productId, setProductId] = useState(null);
  const [productName, setProductName] = useState('');
  const [processes, setProcesses] = useState([]);
  const [assignments, setAssignments] = useState({}); // { process_id: line_id }
  const [lines, setLines] = useState([]);

  useEffect(() => {
    api.get('/lines').then(r => setLines(r.data));
  }, []);

  const searchProducts = async (q) => {
    const { data } = await api.get('/products', { params: { q } });
    setProductOptions(data.map(p => ({ value: p.id, label: `${p.code} - ${p.name}` })));
  };

  const loadProduct = async (id) => {
    if (!id) { setProcesses([]); setAssignments({}); return; }
    const [detail, disp] = await Promise.all([
      api.get(`/products/${id}`),
      api.get('/dispatches', { params: { date: date.format('YYYY-MM-DD'), product_id: id } }),
    ]);
    setProductName(`${detail.data.code} - ${detail.data.name}`);
    setProcesses(detail.data.processes);
    const map = {};
    for (const d of disp.data) map[d.product_process_id] = d.line_id;
    setAssignments(map);
  };

  useEffect(() => { if (productId) loadProduct(productId); }, [productId, date]);

  const onSave = async () => {
    const items = Object.entries(assignments)
      .filter(([, v]) => v)
      .map(([k, v]) => ({ product_process_id: Number(k), line_id: v }));
    if (!productId) return message.warning('请先选货号');
    await api.post('/dispatches', { date: date.format('YYYY-MM-DD'), product_id: productId, items });
    message.success(`已保存 ${items.length} 条分拉`);
  };

  const lineOptions = lines.map(l => ({ value: l.id, label: l.name }));

  const columns = [
    { title: '部位', dataIndex: 'part_name', width: 140 },
    { title: '工艺', dataIndex: 'technique', width: 80 },
    { title: '目标数', dataIndex: 'target_qty', width: 80, align: 'right' },
    { title: '人数', dataIndex: 'worker_count', width: 60, align: 'right' },
    { title: '工价', dataIndex: 'unit_wage', width: 100, align: 'right', render: v => Number(v).toFixed(4) },
    { title: '总核价', dataIndex: 'total_price', width: 100, align: 'right', render: v => Number(v).toFixed(4) },
    {
      title: '分到哪条拉', width: 180,
      render: (_, row) => (
        <Select
          style={{ width: 160 }}
          placeholder="选拉"
          value={assignments[row.id]}
          onChange={v => setAssignments(prev => ({ ...prev, [row.id]: v }))}
          options={lineOptions}
          allowClear
        />
      ),
    },
  ];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>分拉</h2>
      <Space style={{ marginBottom: 16 }} wrap>
        日期:
        <DatePicker value={date} onChange={d => setDate(d || dayjs())} allowClear={false} />
        货号:
        <Select
          style={{ width: 360 }}
          showSearch
          placeholder="输入货号或货名搜索"
          filterOption={false}
          onSearch={searchProducts}
          onChange={v => setProductId(v)}
          options={productOptions}
          allowClear
        />
        {productName && <b>当前:{productName}</b>}
      </Space>

      <Table
        rowKey="id"
        dataSource={processes}
        columns={columns}
        pagination={false}
        size="middle"
      />

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Button type="primary" disabled={!productId} onClick={onSave}>保存分拉</Button>
      </div>
    </div>
  );
}
```

**Step 2:** 验证(浏览器)

```bash
# 开前后端
cd server && node app.js &
cd ../client && npm run dev &
```

手工验证步骤:
1. 浏览器进 `http://localhost:5173/dispatch`
2. 日期默认今天
3. 货号搜索框输入「73622」→ 选到布鲁伊爸爸杯
4. 工序列表出来 35 条
5. 任选几条给不同拉 → 点保存 → 看 message 成功
6. 刷新页面 → 保存的分拉回显

**Step 3:** 提交

```bash
taskkill //F //IM node.exe
git add client/src/pages/Dispatch.jsx
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat: dispatch page — lookup by code, assign process to line"
```

---

## 里程碑 4:收支表后端聚合 + 手填 + 导出

### Task 4.1:TDD 收支表聚合函数(纯函数)

**Files:**
- Create: `server/lib/ledger.js`
- Create: `server/tests/ledger.test.js`

**说明:** 给定数据库连接 + 日期,返回 `{ columns, rows }`:
- `columns` 是 32 列定义(key + label + editable + computed 规则)
- `rows` 是每个「已分拉货号 × 3 拉」的一行,含自动算的值和手填值合并

**Step 1:** 写失败测试

```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { buildLedger, LEDGER_COLUMNS } = require('../lib/ledger');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf-8'));
  db.prepare("INSERT INTO lines(id,name,sort_order) VALUES (1,'宋沛霖手喷',1),(2,'宋沛霖自动',2),(3,'胡旗移印',3)").run();
  const { lastInsertRowid: pid } = db.prepare("INSERT INTO products(code,name,quote_price) VALUES ('73622','布鲁伊爸爸杯',2.22)").run();
  const p1 = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid, '耳朵', '喷油', 1000, 1, 0.1);
  const p2 = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid, '身', '移印', 2000, 2, 0.05);
  db.prepare('INSERT INTO dispatches(dispatch_date,product_id,product_process_id,line_id) VALUES (?,?,?,?)').run('2026-04-18', pid, p1.lastInsertRowid, 1);
  db.prepare('INSERT INTO dispatches(dispatch_date,product_id,product_process_id,line_id) VALUES (?,?,?,?)').run('2026-04-18', pid, p2.lastInsertRowid, 3);
  return { db, pid };
}

test('聚合:每个已分拉货号生成 3 行(每条拉一行),未分拉的行值全 0', () => {
  const { db, pid } = setupDb();
  const { rows } = buildLedger(db, '2026-04-18');
  // 1 货号 × 3 拉 = 3 行
  assert.strictEqual(rows.length, 3);
  const handSpray = rows.find(r => r.line_name === '宋沛霖手喷' && r.product_id === pid);
  assert.ok(handSpray);
  // 耳朵分给了宋沛霖手喷:1000×2.22=2220 产值,1000×0.1=100 工资
  assert.strictEqual(handSpray.values.total_output, 2220);
  assert.strictEqual(handSpray.values.worker_wage_total, 100);
  const autoLine = rows.find(r => r.line_name === '宋沛霖自动' && r.product_id === pid);
  // 没分工序 → 产值/工资 0
  assert.strictEqual(autoLine.values.total_output, 0);
});

test('工时固定 11,总时间=员工人数×11,员工人均产值=产值/员工人数', () => {
  const { db, pid } = setupDb();
  // 先手填宋沛霖手喷 员工人数 39
  db.prepare("INSERT INTO ledger_edits(ledger_date,line_id,product_id,column_key,value) VALUES (?,?,?,?,?)")
    .run('2026-04-18', 1, pid, 'employee_count', '39');
  const { rows } = buildLedger(db, '2026-04-18');
  const handSpray = rows.find(r => r.line_name === '宋沛霖手喷' && r.product_id === pid);
  assert.strictEqual(handSpray.values.work_hours, 11);
  assert.strictEqual(handSpray.values.total_time, 39 * 11);
  assert.strictEqual(handSpray.values.per_employee_output, Math.round((2220 / 39) * 100) / 100);
});

test('columns 定义包含 32 列,editable/computed 正确标注', () => {
  assert.strictEqual(LEDGER_COLUMNS.length, 32);
  const dateCol = LEDGER_COLUMNS.find(c => c.key === 'date');
  assert.strictEqual(dateCol.computed, true);
  const rentCol = LEDGER_COLUMNS.find(c => c.key === 'rent');
  assert.strictEqual(rentCol.editable, true);
});
```

**Step 2:** 跑测试失败 → 实现 `server/lib/ledger.js`

```js
// 收支表列定义。每列标注 key / label / editable / computed。
// computed 的列由 buildLedger 根据核价+分拉+手填算出;editable 的列取自 ledger_edits。
const LEDGER_COLUMNS = [
  { key: 'date',                   label: '日期',                  computed: true },
  { key: 'line_name',              label: '拉名',                  computed: true },
  { key: 'machine_total',          label: '机台数',                editable: true },
  { key: 'machine_on',             label: '每天开机数',            editable: true },
  { key: 'machine_rate',           label: '开机率',                computed: true },
  { key: 'foreman_count',          label: '管工人数',              editable: true },
  { key: 'helper_count',           label: '杂工',                  editable: true },
  { key: 'employee_count',         label: '员工人数(不含杂工)',   editable: true },
  { key: 'work_hours',             label: '工时',                  computed: true }, // 固定 11
  { key: 'total_time',             label: '总时间',                computed: true },
  { key: 'total_output',           label: '总产值/天',             computed: true },
  { key: 'per_employee_output',    label: '员工人均产值',          computed: true },
  { key: 'worker_wage_total',      label: '员工总工资',            computed: true },
  { key: 'foreman_wage',           label: '管工工资',              editable: true },
  { key: 'wage_pct_of_output',     label: '总工资占产值%',         computed: true },
  { key: 'equipment_invest',       label: '设备投资',              editable: true },
  { key: 'tool_unrecoverable',     label: '不可回收工具费',        editable: true },
  { key: 'tool_recoverable',       label: '可收回工具费',          editable: true },
  { key: 'rent',                   label: '房租/26天算',           editable: true },
  { key: 'utilities',              label: '水电费',                editable: true },
  { key: 'material',               label: '物料(原子灰/胶头/油墨/溶剂)', editable: true },
  { key: 'misc',                   label: '杂费(口罩/手套)',      editable: true },
  { key: 'maintenance',            label: '维修费',                editable: true },
  { key: 'subsidy',                label: '补贴',                  editable: true },
  { key: 'actual_material_cost',   label: '实际用原料金额',        editable: true },
  { key: 'no_output_wage',         label: '无产值工资',            editable: true },
  { key: 'recoverable_wage',       label: '可收回工资',            editable: true },
  { key: 'indonesia_wage',         label: '可收回印尼工资/0.88',   editable: true },
  { key: 'recoverable_paint',      label: '可回收油漆金额',        editable: true },
  { key: 'processing_fee',         label: '加工费',                editable: true },
  { key: 'balance',                label: '结余金额',              computed: true },
  { key: 'balance_pct',            label: '结余%',                 computed: true },
];

const WORK_HOURS = 11;
const EDITABLE_COST_KEYS = [
  'equipment_invest', 'tool_unrecoverable', 'tool_recoverable', 'rent', 'utilities',
  'material', 'misc', 'maintenance', 'actual_material_cost', 'no_output_wage',
  'recoverable_wage', 'indonesia_wage', 'recoverable_paint', 'processing_fee',
  'foreman_wage',
];

function num(v) { return Number(v) || 0; }
function round2(v) { return Math.round(v * 100) / 100; }

function buildLedger(db, date) {
  // 1. 该日期已分拉的「货号 × 拉」组合(一个货号可能只分到 1-3 条拉)
  //    但收支表每货号显示 3 行(即便某条拉没分到工序,也要有一行,产值=0)
  const products = db.prepare(`
    SELECT DISTINCT p.id, p.code, p.name, p.quote_price
    FROM dispatches d JOIN products p ON p.id = d.product_id
    WHERE d.dispatch_date = ?
    ORDER BY p.id
  `).all(date);

  const lines = db.prepare('SELECT * FROM lines ORDER BY sort_order').all();

  // 2. 每个 (product, line) 组合,算 Σ(目标数×报价) 和 Σ(目标数×工价)
  const aggStmt = db.prepare(`
    SELECT
      COALESCE(SUM(pp.target_qty * p.quote_price), 0) AS total_output,
      COALESCE(SUM(pp.target_qty * pp.unit_wage), 0) AS worker_wage_total
    FROM dispatches d
    JOIN product_processes pp ON pp.id = d.product_process_id
    JOIN products p ON p.id = d.product_id
    WHERE d.dispatch_date = ? AND d.product_id = ? AND d.line_id = ?
  `);

  // 3. 手填数据:按 (date, line_id, product_id, column_key) 取
  const edits = db.prepare(
    'SELECT * FROM ledger_edits WHERE ledger_date = ?'
  ).all(date);
  const editMap = new Map();
  for (const e of edits) {
    const k = `${e.line_id}|${e.product_id || 0}|${e.column_key}`;
    editMap.set(k, e.value);
  }
  const getEdit = (lineId, productId, columnKey) =>
    editMap.get(`${lineId}|${productId || 0}|${columnKey}`);

  const rows = [];
  for (const prod of products) {
    for (const line of lines) {
      const agg = aggStmt.get(date, prod.id, line.id);
      const emp = num(getEdit(line.id, prod.id, 'employee_count'));
      const machineTotal = num(getEdit(line.id, prod.id, 'machine_total'));
      const machineOn = num(getEdit(line.id, prod.id, 'machine_on'));
      const totalOutput = round2(agg.total_output);
      const workerWageTotal = round2(agg.worker_wage_total);
      const totalTime = emp * WORK_HOURS;
      const perEmp = emp > 0 ? round2(totalOutput / emp) : 0;
      const machineRate = machineTotal > 0 ? round2(machineOn / machineTotal) : 0;
      const wagePct = totalOutput > 0 ? round2(workerWageTotal / totalOutput) : 0;
      const costSum = EDITABLE_COST_KEYS.reduce(
        (s, k) => s + num(getEdit(line.id, prod.id, k)), 0
      );
      const balance = round2(totalOutput - workerWageTotal - costSum);
      const balancePct = totalOutput > 0 ? round2(balance / totalOutput) : 0;

      const values = {
        date,
        line_name: line.name,
        machine_total: getEdit(line.id, prod.id, 'machine_total') || '',
        machine_on: getEdit(line.id, prod.id, 'machine_on') || '',
        machine_rate: machineRate,
        foreman_count: getEdit(line.id, prod.id, 'foreman_count') || '',
        helper_count: getEdit(line.id, prod.id, 'helper_count') || '',
        employee_count: getEdit(line.id, prod.id, 'employee_count') || '',
        work_hours: WORK_HOURS,
        total_time: totalTime,
        total_output: totalOutput,
        per_employee_output: perEmp,
        worker_wage_total: workerWageTotal,
        foreman_wage: getEdit(line.id, prod.id, 'foreman_wage') || '',
        wage_pct_of_output: wagePct,
        balance,
        balance_pct: balancePct,
      };
      // 其它 editable 列直接填手填值
      for (const col of LEDGER_COLUMNS) {
        if (col.editable && values[col.key] === undefined) {
          values[col.key] = getEdit(line.id, prod.id, col.key) || '';
        }
      }
      rows.push({
        product_id: prod.id,
        product_code: prod.code,
        product_name: prod.name,
        line_id: line.id,
        line_name: line.name,
        values,
      });
    }
  }

  return { columns: LEDGER_COLUMNS, rows };
}

module.exports = { buildLedger, LEDGER_COLUMNS, WORK_HOURS };
```

**Step 3:** 跑测试通过

**Step 4:** 提交

```bash
cd server && npm test
git add server/lib/ledger.js server/tests/ledger.test.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat: ledger aggregation lib with tests"
```

---

### Task 4.2:GET /api/ledger + POST /api/ledger/edits

**Files:**
- Create: `server/routes/ledger.js`
- Modify: `server/app.js`

**Step 1:** 创建 `server/routes/ledger.js`

```js
const express = require('express');
const db = require('../db');
const { buildLedger } = require('../lib/ledger');
const router = express.Router();

router.get('/', (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date required' });
  res.json(buildLedger(db, date));
});

router.post('/edits', (req, res) => {
  const { date, line_id, product_id, column_key, value } = req.body;
  if (!date || !line_id || !column_key)
    return res.status(400).json({ error: 'date, line_id, column_key required' });
  db.prepare(`
    INSERT INTO ledger_edits (ledger_date, line_id, product_id, column_key, value, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(ledger_date, line_id, product_id, column_key)
    DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
  `).run(date, line_id, product_id || null, column_key, value == null ? null : String(value));
  res.json({ ok: true });
});

module.exports = router;
```

**⚠️ UNIQUE 约束问题:** SQLite 的 UNIQUE 把 NULL 视为不同值,所以当 `product_id` 为 NULL 时,`ON CONFLICT` 不会命中。我们的场景里 `product_id` 必给(每行都绑货号),所以不用担心。但定义上写清楚。

**Step 2:** `server/app.js` 挂载

```js
app.use('/api/ledger', require('./routes/ledger'));
```

**Step 3:** 验证

```bash
cd server && node app.js &
sleep 2
curl "http://localhost:3100/api/ledger?date=2026-04-18"
# 期望: {columns: [...32 项], rows: [...]}
curl -X POST http://localhost:3100/api/ledger/edits \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-04-18","line_id":1,"product_id":1,"column_key":"employee_count","value":"39"}'
# 期望: {"ok":true}
curl "http://localhost:3100/api/ledger?date=2026-04-18"
# 期望: 该行 values.employee_count = "39", total_time = 429, per_employee_output 有值
taskkill //F //IM node.exe
```

**Step 4:** 提交

```bash
git add server/routes/ledger.js server/app.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat: GET /api/ledger + POST /api/ledger/edits"
```

---

### Task 4.3:GET /api/ledger/export — 导出 xls

**Files:**
- Modify: `server/routes/ledger.js`

**Step 1:** 在 `server/routes/ledger.js` 追加:

```js
const ExcelJS = require('exceljs');

router.get('/export', async (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date required' });
  const { columns, rows } = buildLedger(db, date);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('收支表');

  // 表头
  ws.addRow(columns.map(c => c.label));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } };

  // 数据:按货号分组,每货号 3 行
  let lastCode = null;
  for (const row of rows) {
    const displayCode = row.product_code !== lastCode ? row.product_code : '';
    const values = columns.map((c, idx) => {
      // 第 1 列显示货号(每货号首行),其它按 values[key]
      if (idx === 0 && displayCode) return `${displayCode} ${row.product_name}`;
      if (idx === 0) return '';
      return row.values[c.key] ?? '';
    });
    ws.addRow(values);
    lastCode = row.product_code;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="核价分拉-${date.replace(/-/g,'')}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});
```

**Step 2:** 验证

```bash
cd server && node app.js &
sleep 2
curl -OJ "http://localhost:3100/api/ledger/export?date=2026-04-18"
# 期望: 下载到当前目录,文件名 核价分拉-20260418.xlsx
# 打开 Excel 看:表头 32 列,数据行按货号分组,能填的列有值
taskkill //F //IM node.exe
```

**Step 3:** 提交

```bash
git add server/routes/ledger.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat: GET /api/ledger/export — xlsx download"
```

---

## 里程碑 5:收支表前端(Luckysheet)

### Task 5.1:Luckysheet CDN 接入

**Files:**
- Modify: `client/index.html`

**Step 1:** 参考 order-sync 的 `LuckysheetEditor.jsx` 看它怎么加载的。实际 order-sync 的 index.html 应该有 `<script src="https://cdn.jsdelivr.net/npm/luckysheet..."></script>` 之类。

查看:`cat C:/Users/Administrator/zouhuo-system/order-sync/client/index.html`(找 luckysheet 的 CDN),照抄到 penyou 的 `client/index.html` 的 `<head>`。

一般需要:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/plugins/css/pluginsCss.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/plugins/plugins.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/css/luckysheet.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/assets/iconfont/iconfont.css" />
<script src="https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/plugins/js/plugin.js"></script>
<script src="https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/luckysheet.umd.js"></script>
```

**Step 2:** 刷新浏览器验证 `window.luckysheet` 不为 undefined

```js
// 浏览器控制台
typeof luckysheet
// 期望: "object"
```

**Step 3:** 提交

```bash
git add client/index.html
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "chore: load luckysheet from cdn"
```

---

### Task 5.2:Ledger 页面 — Luckysheet 渲染

**Files:**
- Modify: `client/src/pages/Ledger.jsx`

**说明:** 参考 `order-sync/client/src/pages/LuckysheetEditor.jsx` 的模式,把 `/api/ledger?date=` 返回的 columns+rows 转成 celldata 喂给 Luckysheet。computed 列浅蓝底只读,editable 列白底可编辑。

**Step 1:** 重写 `client/src/pages/Ledger.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import { DatePicker, Button, Space, message } from 'antd';
import dayjs from 'dayjs';
import api from '../api';

const getLuckysheet = () => window.luckysheet;

function buildCelldata(columns, rows) {
  const celldata = [];
  // 表头
  columns.forEach((col, c) => {
    celldata.push({
      r: 0, c,
      v: { v: col.label, ct: { t: 's' }, bg: '#FFFDE7', bl: 1, ht: 0, vt: 0 },
    });
  });
  // 数据行
  rows.forEach((row, ri) => {
    const r = ri + 1;
    columns.forEach((col, c) => {
      const val = row.values[col.key];
      const isEditable = !!col.editable;
      const cellValue = {
        v: val ?? '',
        m: val == null ? '' : String(val),
        ct: { t: typeof val === 'number' ? 'n' : 's' },
      };
      if (!isEditable) cellValue.bg = '#E6F4FF';
      celldata.push({ r, c, v: cellValue });
    });
  });
  return celldata;
}

export default function Ledger() {
  const [date, setDate] = useState(dayjs());
  const [data, setData] = useState({ columns: [], rows: [] });
  const containerRef = useRef(null);
  const lsRef = useRef(null);

  const load = async (d) => {
    const { data } = await api.get('/ledger', { params: { date: d.format('YYYY-MM-DD') } });
    setData(data);
  };

  useEffect(() => { load(date); }, []);

  useEffect(() => {
    if (!data.columns.length) return;
    const luckysheet = getLuckysheet();
    if (!luckysheet) { message.error('Luckysheet 未加载'); return; }

    const celldata = buildCelldata(data.columns, data.rows);
    luckysheet.create({
      container: 'luckysheet-container',
      showtoolbar: false,
      showinfobar: false,
      showstatisticBar: false,
      sheetFormulaBar: false,
      enableAddRow: false,
      enableAddBackTop: false,
      data: [{
        name: '收支表',
        celldata,
        row: Math.max(data.rows.length + 2, 30),
        column: data.columns.length,
        config: {
          columnlen: data.columns.reduce((acc, _, i) => ({ ...acc, [i]: 110 }), {}),
        },
      }],
      hook: {
        cellUpdated(r, c, _oldVal, newVal) {
          if (r === 0) return; // 表头不动
          const col = data.columns[c];
          if (!col || !col.editable) return;
          const row = data.rows[r - 1];
          if (!row) return;
          const value = newVal && newVal.v != null ? newVal.v : '';
          api.post('/ledger/edits', {
            date: date.format('YYYY-MM-DD'),
            line_id: row.line_id,
            product_id: row.product_id,
            column_key: col.key,
            value,
          }).catch(e => message.error('保存失败: ' + e.message));
        },
      },
    });
    lsRef.current = luckysheet;
  }, [data]);

  useEffect(() => { load(date); }, [date]);

  const onExport = () => {
    const url = `/api/ledger/export?date=${date.format('YYYY-MM-DD')}`;
    window.open(url, '_blank');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)' }}>
      <Space style={{ marginBottom: 12 }}>
        日期:<DatePicker value={date} onChange={d => setDate(d || dayjs())} allowClear={false} />
        <Button onClick={() => load(date)}>刷新</Button>
        <Button type="primary" onClick={onExport}>导出 xlsx</Button>
      </Space>
      <div id="luckysheet-container" ref={containerRef} style={{ flex: 1, border: '1px solid #ddd' }} />
    </div>
  );
}
```

**Step 2:** 浏览器验证

```bash
# 开前后端(backend 应该还在跑)
cd client && npm run dev
```

1. 进 `http://localhost:5173/ledger`
2. Luckysheet 网格出来,32 列表头
3. 若没分拉数据,用 Dispatch 页先分两条工序保存
4. 回到 Ledger 页,看到数据行,computed 列浅蓝底
5. 在白底格子里改个数(如 employee_count),退格 → 刷新 → 数据还在
6. 点导出,下载 xlsx,Excel 打开确认内容一致

**Step 3:** 提交

```bash
git add client/src/pages/Ledger.jsx
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat: ledger page with luckysheet — view/edit computed+manual cells, export"
```

---

## 里程碑 6:端到端验证

### Task 6.1:跑一遍完整流程

**Step 1:** 清空 DB,从头走一次

```bash
rm server/db/penyou.db*
```

开前后端:`start.bat`

**Step 2:** 验收清单(浏览器操作)

- [ ] 进「核价表」→ 点「导入 Excel」→ 选桌面的兴信核价.xlsx → 成功提示,列表显示 ≥3 个产品(含 73622、47101、E73814 等多 sheet)
- [ ] 进「分拉」→ 日期今天 → 搜「73622」→ 工序列表 35 条 → 给前 5 条选拉(任意分) → 保存成功
- [ ] 刷新分拉页,选项回显
- [ ] 进「收支表」→ Luckysheet 出现,表头 32 列,73622 的 3 行数据:宋沛霖手喷/宋沛霖自动/胡旗移印;分到的那条拉 有总产值/工资
- [ ] 在 employee_count 格子填 39 → 退格 → 总时间/人均产值自动变(可能需要刷新)
- [ ] 点「导出 xlsx」→ 下载文件 → Excel 打开内容匹配

**Step 3:** 若都 ok,做一次 chore commit 记录验收通过

```bash
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit --allow-empty -m "chore: e2e verified — import, dispatch, ledger edit, export"
```

---

## 完成标准

- [ ] Excel 导入能把 5 个 sheet 全部入库(不止 Sheet 1)
- [ ] 分拉页按货号查到工序清单,每行下拉选拉,保存成功并回显
- [ ] 收支表页打开当日数据,每个已分拉货号 3 行(3 条拉),能算的列自动填,其它列浏览器里可编辑,编辑后刷新还在
- [ ] 导出的 xlsx 表头 32 列,和网页一致
- [ ] 所有 `node:test` 单测通过(pricing / importer / xlsx-headers / dispatches / ledger)
- [ ] 左侧菜单只有 3 项(核价表 / 分拉 / 收支表)
