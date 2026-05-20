# 多车间隔离 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把单车间「喷油部系统 v2」扩展为「3 车间(湖南/兴信/华登)逻辑隔离」,数据按车间分组,所有现有功能保持不变。

**Architecture:** 单 SQLite 数据库,业务表加 `workshop_id` 列;后端中间件强制要求 `workshop_id` query 参数;前端 axios 拦截器自动注入 localStorage 里的当前车间;新增首页(3 张卡片)+ Header「换车间」按钮。现有 5 个菜单页 0 改动。

**Tech Stack:** Node 25 + Express 4 + better-sqlite3 12;React 19 + Vite 8 + antd 5 + axios + react-router-dom 6 + dayjs。

**项目根目录:** `C:\Users\Administrator\penyou-system\`

**设计文档:** `docs/plans/2026-04-29-multi-workshop-design.md`

**Git user:** `-c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com"`

**当前状态(开工前):** v2 全功能可用,master 分支干净。21 个产品 + 若干订单/录入数据归到「兴信」。

---

## 里程碑 1:数据层 + 迁移

### Task 1.1:`workshops` 表 + 种子 + 给业务表加 workshop_id

**Files:**
- Modify: `server/db/init.sql`(顶部追加 `workshops` 表)
- Modify: `server/db/seed.js`(加 `WORKSHOPS` 常量 + `seedWorkshops` 函数,导出)
- Modify: `server/db/index.js`(调用 seedWorkshops + 加迁移 ALTER + UPDATE)

**Step 1:** 在 `server/db/init.sql` **最前面**(其它表之前,因为后续表会 FK 到它)加:

```sql
CREATE TABLE IF NOT EXISTS workshops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0,
  color TEXT DEFAULT ''
);
```

**Step 2:** 改 `server/db/seed.js`,加常量和种子函数:

```js
const WORKSHOPS = [
  { id: 1, name: '湖南', sort_order: 1, color: '#1677ff' },
  { id: 2, name: '兴信', sort_order: 2, color: '#fa8c16' },
  { id: 3, name: '华登', sort_order: 3, color: '#52c41a' },
];

function seedWorkshops(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO workshops(id, name, sort_order, color) VALUES (?, ?, ?, ?)'
  );
  for (const w of WORKSHOPS) insert.run(w.id, w.name, w.sort_order, w.color);
}
```

把 `seedWorkshops, WORKSHOPS` 加到 `module.exports`。

**Step 3:** 改 `server/db/index.js`:

在 `db.exec(INIT_SQL)` 之后,在调 seedLines 之前,先调 `seedWorkshops`:

```js
const { seedLines, seedLineDefaults, seedWorkshops } = require('./seed');
seedWorkshops(db);  // 必须先,因为后续 update 用到 workshop_id=2
seedLines(db);
seedLineDefaults(db);
```

紧跟着 `addColumnIfMissing` 调用,加 7 张表的 workshop_id 列 + UPDATE 兜底:

```js
addColumnIfMissing('lines', 'workshop_id', 'INTEGER');
addColumnIfMissing('products', 'workshop_id', 'INTEGER');
addColumnIfMissing('wage_standards', 'workshop_id', 'INTEGER');
addColumnIfMissing('technique_line_defaults', 'workshop_id', 'INTEGER');
addColumnIfMissing('production_orders', 'workshop_id', 'INTEGER');
addColumnIfMissing('daily_records', 'workshop_id', 'INTEGER');
addColumnIfMissing('ledger_edits', 'workshop_id', 'INTEGER');

for (const t of ['lines','products','wage_standards','technique_line_defaults',
                 'production_orders','daily_records','ledger_edits']) {
  db.exec(`UPDATE ${t} SET workshop_id=2 WHERE workshop_id IS NULL`);
}
```

**Step 4:** 验证(必须先杀 node + 删 DB 才能干净测):

```bash
cmd //c "taskkill /F /IM node.exe"
cd C:/Users/Administrator/penyou-system/server && node app.js &
sleep 2
node -e "const db=require('./db'); console.log('workshops:', db.prepare('SELECT * FROM workshops ORDER BY sort_order').all()); console.log('products with workshop:', db.prepare('SELECT id, code, workshop_id FROM products LIMIT 3').all());"
cmd //c "taskkill /F /IM node.exe"
```

期望:
- workshops 3 条:湖南/兴信/华登
- products 表所有行 workshop_id 都是 2

**Step 5:** 提交

```bash
cd C:/Users/Administrator/penyou-system
git add server/db/init.sql server/db/seed.js server/db/index.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(workshop): add workshops table + seed + migration adds workshop_id columns"
```

---

### Task 1.2:重建 lines 表 UNIQUE(workshop_id, name) + 给湖南/华登 各种 4 条同名拉

**Files:**
- Modify: `server/db/index.js`(加 lines 表迁移 + seedLinesPerWorkshop)
- Modify: `server/db/seed.js`(加 seedLinesPerWorkshop)

**Step 1:** 在 `server/db/seed.js` 加常量 + 函数:

```js
const PER_WORKSHOP_LINES = [
  { name: '手喷', sort_order: 1 },
  { name: '自动', sort_order: 2 },
  { name: '移印', sort_order: 3 },
  { name: 'UV',   sort_order: 4 },
];

function seedLinesPerWorkshop(db) {
  // 给湖南(1)和华登(3)各 4 条同名拉。兴信(2)的 4 条已存在,不动。
  const insert = db.prepare(
    'INSERT OR IGNORE INTO lines(name, sort_order, workshop_id) VALUES (?, ?, ?)'
  );
  for (const wid of [1, 3]) {
    for (const l of PER_WORKSHOP_LINES) insert.run(l.name, l.sort_order, wid);
  }
}
```

加 `seedLinesPerWorkshop` 到导出。

**Step 2:** 改 `server/db/index.js`,在 lines UNIQUE 重建逻辑之前先种入数据。但因为旧 UNIQUE(name) 会拒绝同名拉(不同 workshop 也算重复),要先重建 UNIQUE 再种入。

加迁移函数 `migrateLinesUniqueConstraint(db)`:

```js
function migrateLinesUniqueConstraint(db) {
  // 检查 lines 表是否已经是 UNIQUE(workshop_id, name)
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lines'").all();
  const hasComposite = indexes.some(i => i.name.includes('workshop_id'));
  if (hasComposite) return; // 已迁移

  db.exec(`
    BEGIN TRANSACTION;
    CREATE TABLE lines_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      workshop_id INTEGER NOT NULL DEFAULT 2,
      UNIQUE(workshop_id, name)
    );
    INSERT INTO lines_new(id, name, sort_order, workshop_id)
      SELECT id, name, sort_order, COALESCE(workshop_id, 2) FROM lines;
    DROP TABLE lines;
    ALTER TABLE lines_new RENAME TO lines;
    COMMIT;
  `);
}
```

在 index.js 里:

```js
// addColumnIfMissing 之后,UPDATE 之后
migrateLinesUniqueConstraint(db);
seedLinesPerWorkshop(db);
```

**Step 3:** 验证:

```bash
cmd //c "taskkill /F /IM node.exe"
cd C:/Users/Administrator/penyou-system/server && node app.js &
sleep 2
node -e "const db=require('./db'); const r=db.prepare('SELECT l.name AS line, w.name AS workshop FROM lines l JOIN workshops w ON w.id=l.workshop_id ORDER BY w.sort_order, l.sort_order').all(); console.log('total lines:', r.length); r.forEach(x => console.log(' ', x.workshop, '·', x.line));"
cmd //c "taskkill /F /IM node.exe"
```

期望:**12 条**:
- 湖南 · 手喷/自动/移印/UV
- 兴信 · 宋沛霖手喷/宋沛霖自动/胡旗移印/UV
- 华登 · 手喷/自动/移印/UV

**Step 4:** 提交

```bash
git add server/db/index.js server/db/seed.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(workshop): rebuild lines UNIQUE(workshop_id,name) + seed 8 new lines for 湖南/华登"
```

---

### Task 1.3:重建 technique_line_defaults 主键 + 给湖南/华登 种入默认映射

**Files:**
- Modify: `server/db/index.js`(加 migrateLineDefaultsConstraint + seedLineDefaultsPerWorkshop)
- Modify: `server/db/seed.js`(扩 seedLineDefaults 支持多 workshop)

**Step 1:** 改 `server/db/seed.js` 把现有 seedLineDefaults 改造成 per-workshop 版本:

```js
function seedLineDefaultsForWorkshop(db, workshopId) {
  const getLineId = db.prepare('SELECT id FROM lines WHERE workshop_id=? AND name=?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO technique_line_defaults(workshop_id, technique, line_id) VALUES (?, ?, ?)'
  );
  // 名字映射:在湖南/华登 LINE_DEFAULTS 里的「胡旗移印」→ 该车间的「移印」;
  // 「宋沛霖手喷」→「手喷」;「宋沛霖自动」→「自动」
  function mapLineName(originalName, wid) {
    if (wid === 2) return originalName; // 兴信用原名
    return originalName
      .replace('宋沛霖手喷', '手喷')
      .replace('宋沛霖自动', '自动')
      .replace('胡旗移印', '移印');
  }
  for (const d of LINE_DEFAULTS) {
    const lineName = d.line_name ? mapLineName(d.line_name, workshopId) : null;
    const line = lineName ? getLineId.get(workshopId, lineName) : null;
    insert.run(workshopId, d.technique, line ? line.id : null);
  }
}

function seedLineDefaults(db) {
  for (const wid of [1, 2, 3]) seedLineDefaultsForWorkshop(db, wid);
}
```

`module.exports` 加 `seedLineDefaultsForWorkshop`。

**Step 2:** 在 `server/db/index.js` 加迁移 `migrateLineDefaultsConstraint`:

```js
function migrateLineDefaultsConstraint(db) {
  // 检查主键是否已是 (workshop_id, technique)
  const cols = db.prepare("PRAGMA table_info(technique_line_defaults)").all();
  const wsCol = cols.find(c => c.name === 'workshop_id');
  // pk=2 表示参与复合主键(SQLite PRAGMA 在复合 PK 下 pk 字段表示位置)
  if (wsCol && wsCol.pk > 0) return; // 已迁移

  db.exec(`
    BEGIN TRANSACTION;
    CREATE TABLE technique_line_defaults_new (
      workshop_id INTEGER NOT NULL,
      technique TEXT NOT NULL,
      line_id INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(workshop_id, technique),
      FOREIGN KEY(line_id) REFERENCES lines(id)
    );
    INSERT INTO technique_line_defaults_new(workshop_id, technique, line_id, updated_at)
      SELECT COALESCE(workshop_id, 2), technique, line_id, updated_at FROM technique_line_defaults;
    DROP TABLE technique_line_defaults;
    ALTER TABLE technique_line_defaults_new RENAME TO technique_line_defaults;
    COMMIT;
  `);
}
```

在 index.js 调用顺序:

```js
migrateLineDefaultsConstraint(db);
// seedLineDefaults 已经在前面调用,但旧的会跳过(INSERT OR IGNORE)。重复调一次以补上湖南/华登:
seedLineDefaults(db);
```

**Step 3:** 验证:

```bash
cmd //c "taskkill /F /IM node.exe"
cd C:/Users/Administrator/penyou-system/server && node app.js &
sleep 2
node -e "const db=require('./db'); const r=db.prepare('SELECT w.name AS workshop, td.technique, l.name AS line FROM technique_line_defaults td JOIN workshops w ON w.id=td.workshop_id LEFT JOIN lines l ON l.id=td.line_id ORDER BY w.sort_order, td.technique').all(); console.log('total defaults:', r.length); console.log('湖南 sample:', r.filter(x=>x.workshop==='湖南').slice(0,5)); console.log('华登 sample:', r.filter(x=>x.workshop==='华登').slice(0,5));"
cmd //c "taskkill /F /IM node.exe"
```

期望:
- 共 42 条(每车间 14 条 × 3 车间)
- 湖南/华登 的「移印」映射到本车间的「移印」拉,「喷油」line_id 是 null,等等

**Step 4:** 提交

```bash
git add server/db/index.js server/db/seed.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(workshop): rebuild technique_line_defaults PK to (workshop_id, technique) + seed all 3 workshops"
```

---

## 里程碑 2:后端中间件 + 路由改造

### Task 2.1:新加 workshops API + requireWorkshop 中间件

**Files:**
- Create: `server/routes/workshops.js`
- Create: `server/middleware/require-workshop.js`
- Modify: `server/app.js`(挂载 workshops 路由)

**Step 1:** 创建 `server/middleware/require-workshop.js`:

```js
function requireWorkshop(req, res, next) {
  const id = Number(req.query.workshop_id);
  if (!id) return res.status(400).json({ error: 'workshop_id required' });
  req.workshopId = id;
  next();
}
module.exports = { requireWorkshop };
```

**Step 2:** 创建 `server/routes/workshops.js`:

```js
const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM workshops ORDER BY sort_order').all());
});

router.get('/:id/stats', (req, res) => {
  const id = Number(req.params.id);
  // 待排订单数 = 当月还没全部完工的订单
  const month = new Date().toISOString().slice(0, 7);
  const pending = db.prepare(`
    SELECT COUNT(*) AS n FROM production_orders po
    WHERE po.deleted=0 AND po.workshop_id=?
      AND strftime('%Y-%m', po.start_date) = ?
      AND (SELECT COUNT(*) FROM order_schedule_lines WHERE order_id=po.id AND completed_at IS NULL) > 0
  `).get(id, month).n;
  const machineCount = db.prepare('SELECT COUNT(*) AS n FROM lines WHERE workshop_id=?').get(id).n;
  // 当月产值 = sum(daily_records.produced_qty * products.quote_price)
  const monthly = db.prepare(`
    SELECT COALESCE(SUM(dr.produced_qty * p.quote_price), 0) AS v
    FROM daily_records dr
    JOIN products p ON p.id = dr.product_id
    WHERE dr.workshop_id=? AND strftime('%Y-%m', dr.record_date) = ?
  `).get(id, month).v;
  res.json({ pending_orders: pending, machine_count: machineCount, monthly_output: Number(monthly) });
});

module.exports = router;
```

**Step 3:** `server/app.js`,在所有现有 `app.use('/api/...')` **之前** 挂 workshops(因为 workshops 不需要 requireWorkshop 中间件):

```js
app.use('/api/workshops', require('./routes/workshops'));
// ↓ 后续业务路由,Task 2.2 给它们加 requireWorkshop
app.use('/api/products', require('./routes/products'));
// ...
```

**Step 4:** 验证:

```bash
cmd //c "taskkill /F /IM node.exe"
cd C:/Users/Administrator/penyou-system/server && node app.js &
sleep 2
curl -s http://localhost:3100/api/workshops
echo ""
curl -s http://localhost:3100/api/workshops/2/stats
echo ""
cmd //c "taskkill /F /IM node.exe"
```

期望:
- /api/workshops 返回 3 条
- /api/workshops/2/stats 返回 `{pending_orders, machine_count, monthly_output}` 三个数

**Step 5:** 提交

```bash
git add server/routes/workshops.js server/middleware/require-workshop.js server/app.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(workshop): add /api/workshops + /api/workshops/:id/stats + requireWorkshop middleware"
```

---

### Task 2.2:挂中间件 + 改造 products 路由

**Files:**
- Modify: `server/app.js`(给业务路由挂 requireWorkshop)
- Modify: `server/routes/products.js`(SQL 加 workshop_id)

**Step 1:** 改 `server/app.js`,挂中间件:

```js
const { requireWorkshop } = require('./middleware/require-workshop');

app.use('/api/workshops', require('./routes/workshops')); // 公共
app.use('/api/products',         requireWorkshop, require('./routes/products'));
app.use('/api/lines',            requireWorkshop, require('./routes/lines'));
app.use('/api/dispatches',                        require('./routes/dispatches')); // 弃用,不挂
app.use('/api/ledger',           requireWorkshop, require('./routes/ledger'));
app.use('/api/wage-standards',   requireWorkshop, require('./routes/wage-standards'));
app.use('/api/line-defaults',    requireWorkshop, require('./routes/line-defaults'));
app.use('/api/orders',           requireWorkshop, require('./routes/orders'));
app.use('/api/daily-records',    requireWorkshop, require('./routes/daily-records'));
```

**Step 2:** 改 `server/routes/products.js`,所有 SQL 加 workshop 过滤(用 `req.workshopId`):

```js
// GET /
router.get('/', (req, res) => {
  const q = req.query.q || '';
  const rows = db.prepare(`
    SELECT p.*, (
      SELECT COUNT(*) FROM product_processes pp WHERE pp.product_id=p.id AND pp.deleted=0
    ) AS process_count
    FROM products p
    WHERE p.deleted=0 AND p.workshop_id=? AND (p.code LIKE ? OR p.name LIKE ?)
    ORDER BY p.id DESC
  `).all(req.workshopId, `%${q}%`, `%${q}%`);
  res.json(rows);
});

// GET /:id — 加 workshop 校验
router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id=? AND deleted=0 AND workshop_id=?')
    .get(req.params.id, req.workshopId);
  if (!product) return res.status(404).json({ error: 'not found' });
  // ... processes 不变
});

// POST / — INSERT 带 workshop_id
router.post('/', (req, res) => {
  // ... INSERT INTO products(code,name,quote_price,remarks,workshop_id) VALUES (?,?,?,?,?)
  //     运行 .run(code, name, quote_price, remarks, req.workshopId)
});

// PUT /:id — UPDATE 加 workshop 校验
router.put('/:id', (req, res) => {
  // ... UPDATE products SET ... WHERE id=? AND workshop_id=?
  //     .run(..., req.params.id, req.workshopId)
});

// DELETE /:id — UPDATE 加 workshop 校验
router.delete('/:id', (req, res) => {
  db.prepare('UPDATE products SET deleted=1 WHERE id=? AND workshop_id=?')
    .run(req.params.id, req.workshopId);
  res.json({ ok: true });
});

// POST /import — 导入 + INSERT 带 workshop_id
router.post('/import', upload.single('file'), async (req, res) => {
  // existsStmt 加 workshop_id 过滤
  const existsStmt = db.prepare('SELECT id FROM products WHERE code=? AND deleted=0 AND workshop_id=?');
  // ... existsStmt.get(p.code, req.workshopId)
  // insertP 加 workshop_id:
  // INSERT INTO products(code,name,quote_price,workshop_id) VALUES (?,?,?,?)
  //   .run(p.code, p.name, p.quote_price, req.workshopId)
});
```

**Step 3:** 验证:

```bash
cmd //c "taskkill /F /IM node.exe"
cd C:/Users/Administrator/penyou-system/server && node app.js &
sleep 2

# 没传 workshop_id 应 400
curl -s -o /dev/null -w "no-ws: %{http_code}\n" http://localhost:3100/api/products

# 传 workshop_id=2(兴信)应有数据
curl -s "http://localhost:3100/api/products?workshop_id=2" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('xinxin products:', a.length)})"

# 传 workshop_id=1(湖南)应 0 条
curl -s "http://localhost:3100/api/products?workshop_id=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('hunan products:', a.length)})"

cmd //c "taskkill /F /IM node.exe"
```

期望:
- no-ws: 400
- xinxin products: 21
- hunan products: 0

**Step 4:** 提交

```bash
git add server/app.js server/routes/products.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(workshop): products api filtered by workshop_id"
```

---

### Task 2.3:改造 lines / wage-standards / line-defaults 路由

**Files:**
- Modify: `server/routes/lines.js`
- Modify: `server/routes/wage-standards.js`
- Modify: `server/routes/line-defaults.js`

**Step 1:** `server/routes/lines.js`:
```js
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM lines WHERE workshop_id=? ORDER BY sort_order')
    .all(req.workshopId));
});
```

**Step 2:** `server/routes/wage-standards.js`:
- 所有 SELECT 加 `WHERE workshop_id=?`
- INSERT 加 workshop_id
- `suggestFromHistory` 接收 workshop_id:`SELECT ... FROM product_processes WHERE deleted=0 AND product_id IN (SELECT id FROM products WHERE workshop_id=?)`
- POST `/suggest-from-history` 调 `suggestFromHistory(db, req.workshopId)`

具体改 listStandards / upsertStandard / suggestFromHistory 三个 helper 加 workshopId 入参。

**Step 3:** `server/routes/line-defaults.js`:
```js
router.get('/', (req, res) => {
  res.json(db.prepare(`
    SELECT td.workshop_id, td.technique, td.line_id, l.name AS line_name
    FROM technique_line_defaults td
    LEFT JOIN lines l ON l.id = td.line_id
    WHERE td.workshop_id = ?
    ORDER BY td.technique
  `).all(req.workshopId));
});

router.put('/:technique', (req, res) => {
  const { line_id } = req.body;
  db.prepare(`
    INSERT INTO technique_line_defaults(workshop_id, technique, line_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(workshop_id, technique)
    DO UPDATE SET line_id=excluded.line_id, updated_at=CURRENT_TIMESTAMP
  `).run(req.workshopId, req.params.technique, line_id || null);
  res.json({ ok: true });
});
```

**Step 4:** 验证(curl 加 workshop_id 都 OK,每车间数据隔离):

```bash
cmd //c "taskkill /F /IM node.exe"
cd C:/Users/Administrator/penyou-system/server && node app.js &
sleep 2
curl -s "http://localhost:3100/api/lines?workshop_id=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('湖南 lines:', a.map(l=>l.name).join(', '))})"
curl -s "http://localhost:3100/api/lines?workshop_id=2" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('兴信 lines:', a.map(l=>l.name).join(', '))})"
curl -s "http://localhost:3100/api/lines?workshop_id=3" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('华登 lines:', a.map(l=>l.name).join(', '))})"
curl -s "http://localhost:3100/api/line-defaults?workshop_id=1" | head -c 200
cmd //c "taskkill /F /IM node.exe"
```

期望:
- 湖南 lines: 手喷, 自动, 移印, UV
- 兴信 lines: 宋沛霖手喷, 宋沛霖自动, 胡旗移印, UV
- 华登 lines: 手喷, 自动, 移印, UV
- 湖南 line-defaults 14 条

**Step 5:** 提交

```bash
git add server/routes/lines.js server/routes/wage-standards.js server/routes/line-defaults.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(workshop): lines/wage-standards/line-defaults filtered by workshop_id"
```

---

### Task 2.4:改造 orders 路由(订单+排产+active)

**Files:**
- Modify: `server/routes/orders.js`

**Step 1:** 改 `createOrder(db, payload)` 接收 workshop_id 入参,INSERT 时带:

```js
function createOrder(dbi, { order_name, product_id, total_qty, start_date, remarks, workshop_id }) {
  const defaultsStmt = dbi.prepare(
    'SELECT line_id FROM technique_line_defaults WHERE workshop_id=? AND technique=?'
  );
  return dbi.transaction(() => {
    const { lastInsertRowid: oid } = dbi.prepare(
      'INSERT INTO production_orders(order_name, product_id, total_qty, start_date, remarks, workshop_id) VALUES (?,?,?,?,?,?)'
    ).run(order_name, product_id, total_qty, start_date, remarks || '', workshop_id);
    // ... product_processes 已有 workshop 隔离(通过 product_id),不变
    // 但 def 查询要加 workshop_id:
    for (const pp of procs) {
      const def = defaultsStmt.get(workshop_id, pp.technique);
      // ...
    }
  })();
}
```

**Step 2:** `getOrder` / `listOrders` / `listActiveScheduleLines` 都加 workshop_id 过滤。

`updateScheduleLine` 不需要(通过 order 间接)。打卡路由也不需要(slId 全局唯一)。

**Step 3:** 路由改造:

```js
router.get('/', (req, res) => res.json(listOrders(db, {
  workshop_id: req.workshopId,
  month: req.query.month, q: req.query.q
})));

router.get('/active', (req, res) => {
  res.json(listActiveScheduleLines(db, req.query.date, req.workshopId));
});

router.get('/:id', (req, res) => {
  const o = getOrder(db, req.params.id, req.workshopId);
  // ...
});

router.post('/', (req, res) => {
  const id = createOrder(db, { ...req.body, workshop_id: req.workshopId });
  res.json({ id });
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE production_orders SET deleted=1 WHERE id=? AND workshop_id=?')
    .run(req.params.id, req.workshopId);
  res.json({ ok: true });
});
```

**Step 4:** 验证 + 提交:

```bash
cmd //c "taskkill /F /IM node.exe"
cd C:/Users/Administrator/penyou-system/server && node app.js &
sleep 2
curl -s "http://localhost:3100/api/orders?workshop_id=2&month=2026-04" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('xinxin orders:', a.length)})"
curl -s "http://localhost:3100/api/orders?workshop_id=1&month=2026-04" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('hunan orders:', a.length)})"
cmd //c "taskkill /F /IM node.exe"

cd C:/Users/Administrator/penyou-system
git add server/routes/orders.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(workshop): orders api filtered by workshop_id"
```

期望:xinxin orders ≥ 0(看你 v2 测过几个),hunan orders 0。

---

### Task 2.5:改造 daily-records / ledger 路由

**Files:**
- Modify: `server/routes/daily-records.js`
- Modify: `server/lib/ledger.js`(buildLedger 加 workshop_id 入参)
- Modify: `server/routes/ledger.js`

**Step 1:** `daily-records.js`:
- `upsertRecord(db, r, workshop_id)` INSERT 加 workshop_id
- `listByDate(db, date, workshop_id)` SELECT 加 `WHERE dr.workshop_id=?`
- 路由调用透传 `req.workshopId`

**Step 2:** `lib/ledger.js`:
- `buildLedger(db, date, workshop_id)`:
  - products 子查询加 `AND p.workshop_id = ?`
  - aggStmt 加 `AND dr.workshop_id = ?`
  - lines 查询加 `WHERE workshop_id = ?`
  - editMap 来源加 `WHERE ledger_date=? AND workshop_id=?`

**Step 3:** `routes/ledger.js`:
- `GET /` 调 `buildLedger(db, date, req.workshopId)`
- `POST /edits` INSERT 加 workshop_id
- `GET /export` 调 buildLedger(workshop_id)
- `GET /monthly` SQL 加 `AND p.workshop_id=?` / `AND dr.workshop_id=?`

**Step 4:** 验证(只关心后端响应正常):

```bash
cmd //c "taskkill /F /IM node.exe"
cd C:/Users/Administrator/penyou-system/server && node app.js &
sleep 2
curl -s "http://localhost:3100/api/daily-records?date=2026-04-21&workshop_id=2" | head -c 200
echo ""
curl -s "http://localhost:3100/api/ledger?date=2026-04-21&workshop_id=2" | head -c 200
echo ""
curl -s "http://localhost:3100/api/ledger/monthly?month=2026-04&workshop_id=2" | head -c 200
echo ""
cmd //c "taskkill /F /IM node.exe"
```

**Step 5:** 提交

```bash
git add server/routes/daily-records.js server/lib/ledger.js server/routes/ledger.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(workshop): daily-records/ledger filtered by workshop_id"
```

---

### Task 2.6:更新所有 server/tests/

**Files:**
- Modify: `server/tests/wage-standards.test.js`
- Modify: `server/tests/orders.test.js`
- Modify: `server/tests/daily-records.test.js`
- Modify: `server/tests/ledger.test.js`
- Modify: `server/tests/dispatches.test.js`
- Modify: `server/tests/pricing-importer.test.js`(如有调用 helper 的话)

**Step 1:** 每个 setup() 函数:
- 先调 `seedWorkshops(db)`
- INSERT 数据时全部带 `workshop_id=2`
- 调用 helper 时(如 `upsertRecord`、`createOrder`)带 `workshop_id=2`

**Step 2:** 跑测试:

```bash
cd C:/Users/Administrator/penyou-system/server && npm test
```

期望:全部 28+ 测试 PASS。

**Step 3:** 提交

```bash
cd C:/Users/Administrator/penyou-system
git add server/tests/
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "test(workshop): update all tests to seed workshops + use workshop_id=2"
```

---

## 里程碑 3:前端首页 + 主系统改造

### Task 3.1:axios 拦截器 + 路由守卫 + Header

**Files:**
- Modify: `client/src/api.js`
- Modify: `client/src/App.jsx`

**Step 1:** 改 `client/src/api.js`:

```js
import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const id = localStorage.getItem('workshop_id');
  if (id && !config.url.startsWith('/workshops')) {
    config.params = { ...config.params, workshop_id: id };
  }
  return config;
});

export default api;
```

`/api/workshops` 路径不注入 workshop_id(因为它本身就是公共)。

**Step 2:** 改 `client/src/App.jsx`:

加路由守卫 + Header 改造:

```jsx
import { Layout, Menu, Button, Space } from 'antd';
import { Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { ... } from '@ant-design/icons';

function RequireWorkshop({ children }) {
  const wid = localStorage.getItem('workshop_id');
  if (!wid) return <Navigate to="/" replace />;
  return children;
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const workshopName = localStorage.getItem('workshop_name') || '';

  // 首页路由不渲染主 Layout
  if (location.pathname === '/' || location.pathname === '/home') {
    return <Routes><Route path="*" element={<WorkshopHome />} /></Routes>;
  }

  const onChangeWorkshop = () => {
    localStorage.removeItem('workshop_id');
    localStorage.removeItem('workshop_name');
    navigate('/');
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>
          喷油部 · {workshopName} 车间
        </span>
        <Space>
          <Button onClick={onChangeWorkshop}>换车间</Button>
        </Space>
      </Header>
      <Layout>
        <Sider width={200} style={{ background: '#fff' }}>
          <Menu mode="inline" selectedKeys={[selectedKey]} items={items} />
        </Sider>
        <Layout style={{ padding: 24 }}>
          <Content style={{ background: '#fff', padding: 24 }}>
            <Routes>
              <Route path="/products" element={<RequireWorkshop><Products /></RequireWorkshop>} />
              <Route path="/wage-standards" element={<RequireWorkshop><WageStandards /></RequireWorkshop>} />
              <Route path="/orders" element={<RequireWorkshop><Orders /></RequireWorkshop>} />
              <Route path="/daily-records" element={<RequireWorkshop><DailyRecords /></RequireWorkshop>} />
              <Route path="/ledger" element={<RequireWorkshop><Ledger /></RequireWorkshop>} />
            </Routes>
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
}
```

import 加 `WorkshopHome`。Routes 默认 `/` 改为 `<WorkshopHome />`(不在主 Layout 里)。

**Step 3:** 提交(暂时还有 import 错误,等 Task 3.2 创建 WorkshopHome 后能跑;先单独提交 api.js 拦截器):

```bash
cd C:/Users/Administrator/penyou-system
git add client/src/api.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(workshop): axios interceptor injects workshop_id from localStorage"
```

App.jsx 暂不提交(等 Task 3.2 一起)。

---

### Task 3.2:WorkshopHome.jsx 首页 + App.jsx 完整集成

**Files:**
- Create: `client/src/pages/WorkshopHome.jsx`
- Modify: `client/src/App.jsx`(完成 Task 3.1 起的改动)

**Step 1:** 创建 `client/src/pages/WorkshopHome.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Card, Button, Spin } from 'antd';
import { ShopOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export default function WorkshopHome() {
  const [list, setList] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const { data: workshops } = await api.get('/workshops');
      setList(workshops);
      const all = await Promise.all(workshops.map(w => api.get(`/workshops/${w.id}/stats`)));
      const m = {};
      workshops.forEach((w, i) => { m[w.id] = all[i].data; });
      setStats(m);
      setLoading(false);
    })();
  }, []);

  const onEnter = (w) => {
    localStorage.setItem('workshop_id', String(w.id));
    localStorage.setItem('workshop_name', w.name);
    navigate('/products');
  };

  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin /></div>;

  return (
    <div style={{ minHeight: '100vh', background: '#f5f7fa', padding: '60px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: 36, marginBottom: 8 }}>
          <ShopOutlined style={{ marginRight: 12, color: '#1677ff' }} />
          喷油部生产管理系统
        </h1>
        <p style={{ color: '#666', marginBottom: 48 }}>
          兴信塑胶制品有限公司 · 请选择车间
        </p>
        <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
          {list.map(w => {
            const s = stats[w.id] || {};
            return (
              <Card key={w.id} style={{ width: 320, overflow: 'hidden' }} bodyStyle={{ padding: 0 }}>
                <div style={{ background: w.color, color: '#fff', padding: '24px 20px' }}>
                  <h2 style={{ color: '#fff', margin: 0, fontSize: 28 }}>{w.name}</h2>
                  <p style={{ color: '#fff', opacity: 0.85, marginTop: 4 }}>注塑啤机排产系统</p>
                </div>
                <div style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 16 }}>
                    <Stat label="待排订单" value={s.pending_orders} />
                    <Stat label="机台数" value={s.machine_count} />
                  </div>
                  <div style={{ textAlign: 'center', color: '#888', marginBottom: 12 }}>
                    本月产值 <b style={{ color: '#cf1322', fontSize: 18 }}>¥{Number(s.monthly_output || 0).toFixed(2)}</b>
                  </div>
                  <Button type="primary" block size="large" onClick={() => onEnter(w)}
                    style={{ background: w.color, borderColor: w.color }}>
                    进入 {w.name}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
        <p style={{ marginTop: 48, color: '#999', fontSize: 13 }}>
          数据按车间独立隔离 · 局域网内任意设备均可访问
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 600, color: '#262626' }}>{value ?? '-'}</div>
      <div style={{ color: '#999', fontSize: 12 }}>{label}</div>
    </div>
  );
}
```

**Step 2:** 完整 `client/src/App.jsx`(整合 Task 3.1 起的改动):

完整重写 App.jsx,确保首页路由 `/` 渲染 WorkshopHome(不带 Layout),其它路由都包 RequireWorkshop。具体见 Task 3.1 Step 2 的代码。

**Step 3:** 启动验证:

```bash
cmd //c "taskkill /F /IM node.exe"
cd C:/Users/Administrator/penyou-system/server && node app.js &
cd C:/Users/Administrator/penyou-system/client && npm run dev &
sleep 5

# 首页
curl -s -o /dev/null -m 3 -w "/ %{http_code}\n" http://localhost:5173/
# /api/workshops 不带 workshop_id 不需要(公共)
curl -s "http://localhost:5173/api/workshops" | head -c 200

# 主页面(localStorage 没设时,虽然 React 会 redirect,但 SPA 都返 index.html)
curl -s -o /dev/null -m 3 -w "/products %{http_code}\n" http://localhost:5173/products

cmd //c "taskkill /F /IM node.exe"
```

**Step 4:** 提交

```bash
cd C:/Users/Administrator/penyou-system
git add client/src/pages/WorkshopHome.jsx client/src/App.jsx
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(workshop): homepage with 3 cards + route guard + change-workshop button"
```

---

## 里程碑 4:e2e 验收

### Task 4.1:浏览器走一遍

**Step 1:** 启动:

```bash
cmd //c "taskkill /F /IM node.exe"
cd C:/Users/Administrator/penyou-system/server && node app.js &
cd C:/Users/Administrator/penyou-system/client && npm run dev &
sleep 5
```

**Step 2:** 验收清单:

- [ ] 浏览器开 `http://localhost:5173/` → 看到 3 张卡片(湖南/兴信/华登),颜色蓝/橙/绿
- [ ] 兴信卡片 待排订单/机台数/月产值 显示数字(其它两张可能是 0)
- [ ] 点「进入兴信」→ 进入主系统;Header 显示「喷油部 · 兴信 车间」
- [ ] 核价表 → 21 个产品都在
- [ ] 点「换车间」→ 回首页 → 进湖南
- [ ] 湖南的核价表 → 空白(0 产品);标准价表 → 空白;排产 → 空白;每日录入 → 空白;收支表 → 空白
- [ ] 在湖南建一个产品「TEST 测试」 → 切换到兴信看,**没有**这个产品
- [ ] 去湖南标准价表点「从历史推导」→ 0 条添加(湖南还没历史)
- [ ] 去兴信标准价表点「从历史推导」→ 多条添加
- [ ] 退出再进:刷新页面后,localStorage 仍记着兴信,直接进主系统;清 localStorage 回首页

**Step 3:** 全通过 → 空 commit:

```bash
cmd //c "taskkill /F /IM node.exe"
cd C:/Users/Administrator/penyou-system
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit --allow-empty -m "chore(workshop): e2e verified — 3 workshops isolated, data independent"
```

---

## 完成标准

- [ ] workshops 表 + 3 条种子,湖南/兴信/华登 各 4 条拉,各 14 条工序→拉默认映射
- [ ] 现有 21 产品 + 标准价 + 订单 + 录入 + 收支 全归兴信(workshop_id=2)
- [ ] 后端所有路由(workshops/health 除外)返回 400 当无 workshop_id
- [ ] 前端首页 3 卡片,选完进入对应车间
- [ ] Header 显示当前车间名 + 「换车间」按钮
- [ ] 不同车间数据完全隔离(湖南建产品兴信看不到)
- [ ] 所有 28+ npm test 绿(setup 加 seedWorkshops + workshop_id=2)
- [ ] 主系统 5 个菜单页 0 改动(纯靠 axios 拦截器自动注入)
