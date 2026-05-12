# 喷油部系统 v2 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在已交付的 v1 (核价表/分拉/收支表) 基础上,实现「标准价表驱动核价 + 订单排产 + 每日录入 + 收支表月视图」四大能力,用自动化减少主管手输。

**Architecture:** Node/Express/SQLite + React/antd 的 v1 架构不变;新增 5 张表(wage_standards / technique_line_defaults / production_orders / order_schedule_lines / daily_records);lines 加 UV 种子;dispatches 弃用不删;`buildLedger` 聚合源从 dispatches+target_qty 估算改为 daily_records 实际数据;前端新增 2 菜单页(标准价表 / 排产 / 每日录入),核价表和收支表扩展。

**Tech Stack:** Node 25 + Express 4 + better-sqlite3 12 + exceljs + xlsx + multer(已装);React 19 + Vite 8 + antd 5 + react-router-dom 6 + axios + dayjs;Luckysheet CDN。

**项目根目录:** `C:\Users\Administrator\penyou-system\`

**设计文档:** `docs/plans/2026-04-21-penyou-v2-design.md`

**Git user:** `-c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com"`

**当前状态(开工前):** v1 已全功能,master 分支干净,21 个产品在 DB。

---

## 里程碑 1:数据层 + 种子

### Task 1.1:新 schema + UV 拉 + 默认映射种子

**Files:**
- Modify: `server/db/init.sql` (追加 5 张新表)
- Modify: `server/db/seed.js` (加 UV 拉 + technique_line_defaults 种子)
- Modify: `server/db/index.js` (如需 ALTER 现有表,加到 addColumnIfMissing)

**Step 1:** 在 `server/db/init.sql` 末尾追加:

```sql
CREATE TABLE IF NOT EXISTS wage_standards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  technique TEXT NOT NULL,
  worker_count INTEGER NOT NULL,
  unit_wage REAL NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(technique, worker_count)
);
CREATE INDEX IF NOT EXISTS idx_wage_standards_tech ON wage_standards(technique);

CREATE TABLE IF NOT EXISTS technique_line_defaults (
  technique TEXT PRIMARY KEY,
  line_id INTEGER,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(line_id) REFERENCES lines(id)
);

CREATE TABLE IF NOT EXISTS production_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_name TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  total_qty INTEGER NOT NULL,
  start_date DATE NOT NULL,
  remarks TEXT,
  deleted INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_orders_start_date ON production_orders(start_date);

CREATE TABLE IF NOT EXISTS order_schedule_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_process_id INTEGER NOT NULL,
  line_id INTEGER,
  qty INTEGER NOT NULL,
  daily_capacity INTEGER NOT NULL,
  est_days INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  started_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY(order_id) REFERENCES production_orders(id),
  FOREIGN KEY(product_process_id) REFERENCES product_processes(id),
  FOREIGN KEY(line_id) REFERENCES lines(id),
  UNIQUE(order_id, product_process_id)
);
CREATE INDEX IF NOT EXISTS idx_schedule_order ON order_schedule_lines(order_id);

CREATE TABLE IF NOT EXISTS daily_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date DATE NOT NULL,
  line_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_process_id INTEGER NOT NULL,
  produced_qty INTEGER NOT NULL,
  worker_count INTEGER NOT NULL,
  remarks TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(line_id) REFERENCES lines(id),
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(product_process_id) REFERENCES product_processes(id),
  UNIQUE(record_date, line_id, product_process_id)
);
CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_records(record_date);
CREATE INDEX IF NOT EXISTS idx_daily_date_line ON daily_records(record_date, line_id);
```

**Step 2:** 扩 `server/db/seed.js`:

```js
const LINES = [
  { name: '宋沛霖手喷', sort_order: 1 },
  { name: '宋沛霖自动', sort_order: 2 },
  { name: '胡旗移印',   sort_order: 3 },
  { name: 'UV',         sort_order: 4 },
];

// 工序 → 默认拉名(用 name 查 id 填入)。NULL 表示主管手选
const LINE_DEFAULTS = [
  { technique: '喷油',     line_name: null },
  { technique: '移印',     line_name: '胡旗移印' },
  { technique: 'UV',       line_name: 'UV' },
  { technique: '散枪',     line_name: '宋沛霖手喷' },
  { technique: '洗货',     line_name: '宋沛霖手喷' },
  { technique: '洗油',     line_name: '宋沛霖手喷' },
  { technique: '2印',      line_name: '胡旗移印' },
  { technique: '1印',      line_name: '胡旗移印' },
  { technique: '4印',      line_name: '胡旗移印' },
  { technique: '2夹',      line_name: '宋沛霖手喷' },
  { technique: '2边',      line_name: '宋沛霖手喷' },
  { technique: '1边',      line_name: '宋沛霖手喷' },
  { technique: '1夹',      line_name: '宋沛霖手喷' },
  { technique: '自动机',   line_name: '宋沛霖自动' },
];

function seedLines(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO lines(name, sort_order) VALUES (?, ?)');
  for (const l of LINES) insert.run(l.name, l.sort_order);
}

function seedLineDefaults(db) {
  const getLineId = db.prepare('SELECT id FROM lines WHERE name = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO technique_line_defaults(technique, line_id) VALUES (?, ?)'
  );
  for (const d of LINE_DEFAULTS) {
    const line = d.line_name ? getLineId.get(d.line_name) : null;
    insert.run(d.technique, line ? line.id : null);
  }
}

module.exports = { seedLines, seedLineDefaults, LINES, LINE_DEFAULTS };
```

**Step 3:** 在 `server/db/index.js` 调 seedLineDefaults:

```js
const { seedLines, seedLineDefaults } = require('./seed');
seedLines(db);
seedLineDefaults(db);
```

**Step 4:** 删 DB,重启验证 schema + 种子数据:

```bash
cmd //c "taskkill /F /IM node.exe"
rm -f server/db/penyou.db server/db/penyou.db-shm server/db/penyou.db-wal
cd server && node app.js &
sleep 2
cd server && node -e "const db=require('./db');const tables=db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all().map(t=>t.name);console.log('tables:',tables.join(', '));console.log('lines:',db.prepare('SELECT * FROM lines ORDER BY sort_order').all());console.log('defaults:',db.prepare('SELECT td.technique, l.name AS line FROM technique_line_defaults td LEFT JOIN lines l ON l.id=td.line_id').all());"
```

期望:
- tables 含 `wage_standards, technique_line_defaults, production_orders, order_schedule_lines, daily_records` + v1 的表
- lines 有 4 条:宋沛霖手喷/宋沛霖自动/胡旗移印/UV
- defaults 有 14 条,其中「喷油」的 line 是 null

**Step 5:** 杀 node,先导一次 Excel 恢复数据(继续测试用):

```bash
cmd //c "taskkill /F /IM node.exe"
```

**Step 6:** 提交

```bash
git add server/db/init.sql server/db/seed.js server/db/index.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(v2): add 5 new tables, UV line seed, technique_line_defaults seed"
```

---

## 里程碑 2:标准价表后端 + 页面

### Task 2.1:wage_standards API + suggest-from-history TDD

**Files:**
- Create: `server/routes/wage-standards.js`
- Create: `server/tests/wage-standards.test.js`
- Modify: `server/app.js` (挂载)

**Step 1:** 写失败测试 `server/tests/wage-standards.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { upsertStandard, suggestFromHistory, listStandards } = require('../routes/wage-standards');

function setup() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf-8'));
  db.pragma('foreign_keys = ON');
  const { lastInsertRowid: pid } = db.prepare("INSERT INTO products(code,name) VALUES ('T','t')").run();
  // 种 5 条历史工序数据:喷油 1 人 不同工价
  const stmt = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)");
  for (const w of [0.05, 0.06, 0.08, 0.10, 0.12]) stmt.run(pid,'x','喷油',1000,1,w);
  // 喷油 4 人 两条
  for (const w of [0.30, 0.40]) stmt.run(pid,'x','喷油',1000,4,w);
  // 移印 1 人 一条
  stmt.run(pid,'x','移印',5000,1,0.036);
  return db;
}

test('upsertStandard 插入新行 / 更新已存在', () => {
  const db = setup();
  upsertStandard(db, { technique: '喷油', worker_count: 1, unit_wage: 0.08 });
  let r = db.prepare("SELECT * FROM wage_standards WHERE technique='喷油' AND worker_count=1").get();
  assert.strictEqual(r.unit_wage, 0.08);
  // update
  upsertStandard(db, { technique: '喷油', worker_count: 1, unit_wage: 0.09 });
  r = db.prepare("SELECT * FROM wage_standards WHERE technique='喷油' AND worker_count=1").get();
  assert.strictEqual(r.unit_wage, 0.09);
});

test('suggestFromHistory 用中位数填空格,不覆盖已有', () => {
  const db = setup();
  // 预先写一条「喷油 1人」= 0.20(用户手设),不应被覆盖
  upsertStandard(db, { technique: '喷油', worker_count: 1, unit_wage: 0.20 });
  const added = suggestFromHistory(db);
  // 应新增: 喷油 4人 中位数 = (0.30+0.40)/2 = 0.35; 移印 1人 = 0.036
  assert.strictEqual(added, 2);
  const byTech = db.prepare('SELECT technique, worker_count, unit_wage FROM wage_standards ORDER BY technique, worker_count').all();
  const spray4 = byTech.find(r => r.technique === '喷油' && r.worker_count === 4);
  assert.ok(spray4);
  assert.strictEqual(spray4.unit_wage, 0.35);
  const spray1 = byTech.find(r => r.technique === '喷油' && r.worker_count === 1);
  assert.strictEqual(spray1.unit_wage, 0.20); // not overwritten
  const print1 = byTech.find(r => r.technique === '移印' && r.worker_count === 1);
  assert.strictEqual(print1.unit_wage, 0.036);
});
```

**Step 2:** 跑 `cd server && npm test` → 期望 fail。

**Step 3:** 实现 `server/routes/wage-standards.js`:

```js
const express = require('express');
const db = require('../db');
const router = express.Router();

function median(arr) {
  const s = [...arr].sort((a,b) => a-b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n-1)/2] : (s[n/2-1] + s[n/2]) / 2;
}

function upsertStandard(dbi, { technique, worker_count, unit_wage }) {
  dbi.prepare(`
    INSERT INTO wage_standards(technique, worker_count, unit_wage, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(technique, worker_count)
    DO UPDATE SET unit_wage=excluded.unit_wage, updated_at=CURRENT_TIMESTAMP
  `).run(technique, worker_count, unit_wage);
}

function listStandards(dbi) {
  return dbi.prepare('SELECT * FROM wage_standards ORDER BY technique, worker_count').all();
}

function suggestFromHistory(dbi) {
  // 按 (technique, worker_count) 分组,取中位数
  const groups = dbi.prepare(`
    SELECT technique, worker_count, unit_wage
    FROM product_processes
    WHERE deleted=0 AND technique IS NOT NULL AND technique != ''
      AND worker_count > 0 AND unit_wage > 0
  `).all();
  const bucket = new Map();
  for (const g of groups) {
    const k = `${g.technique}|${g.worker_count}`;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(g.unit_wage);
  }
  const existsStmt = dbi.prepare('SELECT 1 FROM wage_standards WHERE technique=? AND worker_count=?');
  const insertStmt = dbi.prepare('INSERT INTO wage_standards(technique, worker_count, unit_wage) VALUES (?,?,?)');
  let added = 0;
  for (const [k, wages] of bucket) {
    const [technique, wc] = k.split('|');
    const worker_count = Number(wc);
    if (existsStmt.get(technique, worker_count)) continue;
    const med = Math.round(median(wages) * 10000) / 10000;
    insertStmt.run(technique, worker_count, med);
    added++;
  }
  return added;
}

router.get('/', (_req, res) => res.json(listStandards(db)));

router.post('/', (req, res) => {
  const { technique, worker_count, unit_wage } = req.body;
  if (!technique || !worker_count || unit_wage == null)
    return res.status(400).json({ error: 'technique, worker_count, unit_wage required' });
  upsertStandard(db, { technique, worker_count: Number(worker_count), unit_wage: Number(unit_wage) });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM wage_standards WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/suggest-from-history', (_req, res) => {
  const added = suggestFromHistory(db);
  res.json({ ok: true, added });
});

module.exports = router;
Object.assign(module.exports, { upsertStandard, listStandards, suggestFromHistory });
```

**Step 4:** `server/app.js` 挂载 `app.use('/api/wage-standards', require('./routes/wage-standards'));`

**Step 5:** 跑 `npm test` → 全绿。

**Step 6:** 提交:

```bash
git add server/routes/wage-standards.js server/tests/wage-standards.test.js server/app.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(v2): wage-standards api with median-based suggest-from-history"
```

---

### Task 2.2:line-defaults API

**Files:**
- Create: `server/routes/line-defaults.js`
- Modify: `server/app.js`

**Step 1:** 创建路由:

```js
const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (_req, res) => {
  res.json(db.prepare(`
    SELECT td.technique, td.line_id, l.name AS line_name
    FROM technique_line_defaults td
    LEFT JOIN lines l ON l.id = td.line_id
    ORDER BY td.technique
  `).all());
});

router.put('/:technique', (req, res) => {
  const { line_id } = req.body; // 允许 null
  db.prepare(`
    INSERT INTO technique_line_defaults(technique, line_id, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(technique)
    DO UPDATE SET line_id=excluded.line_id, updated_at=CURRENT_TIMESTAMP
  `).run(req.params.technique, line_id || null);
  res.json({ ok: true });
});

module.exports = router;
```

**Step 2:** `app.js` 挂载:`app.use('/api/line-defaults', require('./routes/line-defaults'));`

**Step 3:** curl 验证:

```bash
cmd //c "taskkill /F /IM node.exe"
cd server && node app.js &
sleep 2
curl -s http://localhost:3100/api/line-defaults | head -c 300
curl -s -X PUT http://localhost:3100/api/line-defaults/喷油 -H "Content-Type: application/json" -d '{"line_id":1}'
curl -s "http://localhost:3100/api/line-defaults" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);const x=a.find(r=>r.technique==='喷油');console.log('喷油 line:',x.line_name)})"
cmd //c "taskkill /F /IM node.exe"
```

期望:初次拿到 14 条含 null;PUT 后喷油 line_name = 宋沛霖手喷。

**Step 4:** 提交:

```bash
git add server/routes/line-defaults.js server/app.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(v2): line-defaults api"
```

---

### Task 2.3:/wage-standards 前端页

**Files:**
- Create: `client/src/pages/WageStandards.jsx`
- Modify: `client/src/App.jsx` (菜单+路由)

**Step 1:** 创建 `WageStandards.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Table, Button, Space, InputNumber, Input, Popconfirm, message } from 'antd';
import api from '../api';

export default function WageStandards() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setList((await api.get('/wage-standards')).data); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onSave = async (row) => {
    await api.post('/wage-standards', row);
    message.success('已保存');
    load();
  };

  const onDelete = async (id) => {
    await api.delete(`/wage-standards/${id}`);
    load();
  };

  const onSuggest = async () => {
    const { data } = await api.post('/wage-standards/suggest-from-history');
    message.success(`已从历史新增 ${data.added} 条`);
    load();
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>标准价表</h2>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => setList([...list, { technique: '', worker_count: 1, unit_wage: 0, _new: true }])}>
          + 新增
        </Button>
        <Button type="primary" onClick={onSuggest}>从历史推导</Button>
      </Space>
      <Table
        rowKey={r => r.id || `new-${r.technique}-${r.worker_count}`}
        loading={loading}
        dataSource={list}
        pagination={false}
        columns={[
          { title: '工序', dataIndex: 'technique', render: (v, row, i) =>
            <Input value={v} onChange={e => { list[i].technique = e.target.value; setList([...list]); }} style={{ width: 120 }} /> },
          { title: '人数', dataIndex: 'worker_count', width: 100, render: (v, row, i) =>
            <InputNumber min={1} value={v} onChange={val => { list[i].worker_count = val; setList([...list]); }} /> },
          { title: '建议工价', dataIndex: 'unit_wage', width: 120, render: (v, row, i) =>
            <InputNumber min={0} step={0.001} value={v} onChange={val => { list[i].unit_wage = val; setList([...list]); }} /> },
          { title: '操作', width: 180, render: (_, row) => (
            <Space>
              <Button size="small" type="primary" onClick={() => onSave(row)}>保存</Button>
              {row.id && (
                <Popconfirm title="删除?" onConfirm={() => onDelete(row.id)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              )}
            </Space>
          )},
        ]}
      />
    </div>
  );
}
```

**Step 2:** 改 `client/src/App.jsx`:

菜单 items 保持 3 项(核价表/分拉/收支表),先不砍 `/dispatch`,新增 `/wage-standards` 作为第 4 项;路由表同步。import `WageStandards`。

具体:

```jsx
import WageStandards from './pages/WageStandards';
import { AppstoreOutlined, ForkOutlined, TableOutlined, DollarOutlined } from '@ant-design/icons';

const items = [
  { key: '/products', icon: <AppstoreOutlined />, label: <Link to="/products">核价表</Link> },
  { key: '/wage-standards', icon: <DollarOutlined />, label: <Link to="/wage-standards">标准价表</Link> },
  { key: '/dispatch', icon: <ForkOutlined />, label: <Link to="/dispatch">分拉</Link> },
  { key: '/ledger', icon: <TableOutlined />, label: <Link to="/ledger">收支表</Link> },
];
// Routes 加: <Route path="/wage-standards" element={<WageStandards />} />
```

**Step 3:** 启动前后端,浏览器验证:
```bash
# 后端应该还在;如果没在,起一下
cd server && node app.js &
cd client && npm run dev &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/wage-standards
```
期望 200。浏览器打开应看到空表,点「从历史推导」后数据涌现。

**Step 4:** 提交:

```bash
cmd //c "taskkill /F /IM node.exe"
git add client/src/pages/WageStandards.jsx client/src/App.jsx
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(v2): wage-standards page with suggest + edit"
```

---

## 里程碑 3:核价表扩展

### Task 3.1:新建/编辑产品弹窗自动填工价 + 汇总块

**Files:**
- Modify: `client/src/pages/Products.jsx`

**Step 1:** 读现有 `ProcessRow` 组件,添加:
1. 在 `worker_count` InputNumber onBlur 时调 `GET /api/wage-standards`,客户端过滤出匹配 `(technique, worker_count)` 的行,命中自动 `form.setFieldValue` 填 unit_wage(若当前为空或 0)
2. 为了减少请求,用 React state 缓存整张表在 Products 页顶部 useEffect 里取一次

**Step 2:** 弹窗底部加汇总块(Form.useWatch 监听 processes 数组):

```jsx
function ProcessSummary({ form }) {
  const processes = Form.useWatch('processes', form) || [];
  let totalUnitWage = 0, totalCalc = 0, totalPaint = 0, totalFinal = 0;
  for (const p of processes) {
    const q = Number(p.target_qty) || 0;
    const w = Number(p.unit_wage) || 0;
    const calc = w * 2.1;
    const paint = calc * 0.35;
    totalUnitWage += w * q;
    totalCalc += calc * q;
    totalPaint += paint * q;
    totalFinal += (calc + paint) * q;
  }
  const ratio = totalFinal > 0 ? (totalPaint / totalFinal) : 0;
  return (
    <div style={{ marginTop: 16, padding: 12, background: '#fafafa', borderRadius: 4 }}>
      <b>汇总:</b>
      <span style={{ marginLeft: 16 }}>总工价:{totalUnitWage.toFixed(2)}</span>
      <span style={{ marginLeft: 16 }}>总核价:{totalCalc.toFixed(2)}</span>
      <span style={{ marginLeft: 16 }}>总油漆价:{totalPaint.toFixed(2)}</span>
      <span style={{ marginLeft: 16 }}>总核价合:{totalFinal.toFixed(2)}</span>
      <span style={{ marginLeft: 16, color: '#cf1322' }}>
        油漆占比:{(ratio * 100).toFixed(2)}%
      </span>
    </div>
  );
}
```

把 `<ProcessSummary form={form} />` 放在 `<Form.List name="processes">` 之后、`</Form>` 之前。

**Step 3:** 在 ProcessRow 里:

```jsx
function ProcessRow({ name, rest, remove, form, wageStandards }) {
  const wage = Form.useWatch(['processes', name, 'unit_wage'], form) || 0;
  const p = previewPrices(wage);
  const tryAutoFill = () => {
    const t = form.getFieldValue(['processes', name, 'technique']);
    const wc = form.getFieldValue(['processes', name, 'worker_count']);
    const cur = form.getFieldValue(['processes', name, 'unit_wage']);
    if ((cur == null || cur === 0) && t && wc) {
      const hit = wageStandards.find(s => s.technique === t && s.worker_count === Number(wc));
      if (hit) form.setFieldValue(['processes', name, 'unit_wage'], hit.unit_wage);
    }
  };
  // ... 在 technique / worker_count 的 onBlur 调 tryAutoFill()
}
```

外层 Products 组件加 state:

```jsx
const [wageStandards, setWageStandards] = useState([]);
useEffect(() => { api.get('/wage-standards').then(r => setWageStandards(r.data)); }, []);
```

把 `wageStandards` 通过 prop 传进 `ProcessRow`。

**Step 4:** 前端 HMR 自动更新;打开新建弹窗,输工序「移印」人数 1 → 离焦 → 工价自动 0.036(如果标准表有)。

**Step 5:** 提交:

```bash
git add client/src/pages/Products.jsx
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(v2): products page auto-fills unit_wage from standards, shows summary"
```

---

## 里程碑 4:订单 + 排产

### Task 4.1:订单+排产展开 TDD

**Files:**
- Create: `server/routes/orders.js`
- Create: `server/tests/orders.test.js`
- Modify: `server/app.js`

**Step 1:** 失败测试:

```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { createOrder, getOrder } = require('../routes/orders');
const { seedLines, seedLineDefaults } = require('../db/seed');

function setup() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf-8'));
  db.pragma('foreign_keys = ON');
  seedLines(db);
  seedLineDefaults(db);
  const { lastInsertRowid: pid } = db.prepare("INSERT INTO products(code,name,quote_price) VALUES ('T','t',1.5)").run();
  db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid,'车轮','喷油',500,4,0.4);
  db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid,'身','移印',1000,1,0.05);
  db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid,'眼','UV',400,1,0.1);
  return { db, pid };
}

test('createOrder 展开每道工序为 schedule_line,默认拉按 line_defaults,est_days/end_date 算对', () => {
  const { db, pid } = setup();
  const oid = createOrder(db, { order_name: 'O1', product_id: pid, total_qty: 1500, start_date: '2026-05-01', remarks: '' });
  const lines = db.prepare('SELECT * FROM order_schedule_lines WHERE order_id=? ORDER BY id').all(oid);
  assert.strictEqual(lines.length, 3);
  // 车轮喷油:line_id = null(喷油默认空)
  assert.strictEqual(lines[0].line_id, null);
  assert.strictEqual(lines[0].qty, 1500);
  assert.strictEqual(lines[0].daily_capacity, 500);
  assert.strictEqual(lines[0].est_days, 3);        // ceil(1500/500)
  assert.strictEqual(lines[0].end_date, '2026-05-03'); // 05-01 + 2 = 05-03
  // 身移印:line 是胡旗移印
  const printLine = db.prepare("SELECT id FROM lines WHERE name='胡旗移印'").get();
  assert.strictEqual(lines[1].line_id, printLine.id);
  assert.strictEqual(lines[1].est_days, 2);         // ceil(1500/1000)
  // 眼 UV:line 是 UV
  const uvLine = db.prepare("SELECT id FROM lines WHERE name='UV'").get();
  assert.strictEqual(lines[2].line_id, uvLine.id);
  assert.strictEqual(lines[2].est_days, 4);         // ceil(1500/400)
});

test('getOrder 返回 order + lines JOIN product_process + line_name', () => {
  const { db, pid } = setup();
  const oid = createOrder(db, { order_name: 'O1', product_id: pid, total_qty: 500, start_date: '2026-05-01' });
  const o = getOrder(db, oid);
  assert.strictEqual(o.order_name, 'O1');
  assert.strictEqual(o.schedule_lines.length, 3);
  assert.ok(o.schedule_lines[0].part_name); // 有 part_name
});
```

**Step 2:** 跑测试 fail。

**Step 3:** 实现 `server/routes/orders.js`:

```js
const express = require('express');
const db = require('../db');
const router = express.Router();

function ceilDiv(a, b) { return b > 0 ? Math.ceil(a / b) : 0; }
function addDays(yyyymmdd, days) {
  const d = new Date(yyyymmdd + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function createOrder(dbi, { order_name, product_id, total_qty, start_date, remarks }) {
  const defaultsStmt = dbi.prepare('SELECT line_id FROM technique_line_defaults WHERE technique=?');
  return dbi.transaction(() => {
    const { lastInsertRowid: oid } = dbi.prepare(
      'INSERT INTO production_orders(order_name, product_id, total_qty, start_date, remarks) VALUES (?,?,?,?,?)'
    ).run(order_name, product_id, total_qty, start_date, remarks || '');
    const procs = dbi.prepare(
      'SELECT * FROM product_processes WHERE product_id=? AND deleted=0 ORDER BY id'
    ).all(product_id);
    const insertLine = dbi.prepare(`
      INSERT INTO order_schedule_lines
      (order_id, product_process_id, line_id, qty, daily_capacity, est_days, start_date, end_date)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    for (const pp of procs) {
      const def = defaultsStmt.get(pp.technique);
      const line_id = def ? def.line_id : null;
      const capacity = pp.target_qty || 1;
      const est_days = ceilDiv(total_qty, capacity);
      const end_date = addDays(start_date, Math.max(est_days - 1, 0));
      insertLine.run(oid, pp.id, line_id, total_qty, capacity, est_days, start_date, end_date);
    }
    return oid;
  })();
}

function getOrder(dbi, id) {
  const o = dbi.prepare(`
    SELECT po.*, p.code AS product_code, p.name AS product_name
    FROM production_orders po JOIN products p ON p.id=po.product_id
    WHERE po.id=? AND po.deleted=0
  `).get(id);
  if (!o) return null;
  const schedule_lines = dbi.prepare(`
    SELECT osl.*, pp.part_name, pp.technique, pp.target_qty, pp.unit_wage, l.name AS line_name
    FROM order_schedule_lines osl
    JOIN product_processes pp ON pp.id = osl.product_process_id
    LEFT JOIN lines l ON l.id = osl.line_id
    WHERE osl.order_id = ?
    ORDER BY osl.id
  `).all(id);
  return { ...o, schedule_lines };
}

function listOrders(dbi, { month, q }) {
  const params = [];
  let where = 'po.deleted = 0';
  if (month) { where += " AND strftime('%Y-%m', po.start_date) = ?"; params.push(month); }
  if (q) { where += ' AND (po.order_name LIKE ? OR p.code LIKE ? OR p.name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  return dbi.prepare(`
    SELECT po.*, p.code AS product_code, p.name AS product_name,
      (SELECT COUNT(*) FROM order_schedule_lines WHERE order_id=po.id) AS line_count,
      (SELECT COUNT(*) FROM order_schedule_lines WHERE order_id=po.id AND completed_at IS NOT NULL) AS completed_count
    FROM production_orders po JOIN products p ON p.id=po.product_id
    WHERE ${where}
    ORDER BY po.start_date DESC, po.id DESC
  `).all(...params);
}

function updateScheduleLine(dbi, slId, patch) {
  const cur = dbi.prepare('SELECT * FROM order_schedule_lines WHERE id=?').get(slId);
  if (!cur) return;
  const qty = patch.qty ?? cur.qty;
  const daily_capacity = patch.daily_capacity ?? cur.daily_capacity;
  const start_date = patch.start_date ?? cur.start_date;
  const est_days = ceilDiv(qty, daily_capacity);
  const end_date = addDays(start_date, Math.max(est_days - 1, 0));
  const line_id = patch.line_id !== undefined ? patch.line_id : cur.line_id;
  dbi.prepare(`
    UPDATE order_schedule_lines
    SET line_id=?, qty=?, daily_capacity=?, est_days=?, start_date=?, end_date=?
    WHERE id=?
  `).run(line_id, qty, daily_capacity, est_days, start_date, end_date, slId);
}

router.get('/', (req, res) => res.json(listOrders(db, { month: req.query.month, q: req.query.q })));
router.get('/:id', (req, res) => {
  const o = getOrder(db, req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
});
router.post('/', (req, res) => {
  const { order_name, product_id, total_qty, start_date, remarks } = req.body;
  if (!order_name || !product_id || !total_qty || !start_date)
    return res.status(400).json({ error: 'order_name, product_id, total_qty, start_date required' });
  const id = createOrder(db, { order_name, product_id, total_qty: Number(total_qty), start_date, remarks });
  res.json({ id });
});
router.put('/:id/schedule-lines/:slId', (req, res) => {
  updateScheduleLine(db, Number(req.params.slId), req.body || {});
  res.json({ ok: true });
});
router.post('/:id/schedule-lines/:slId/start', (req, res) => {
  db.prepare("UPDATE order_schedule_lines SET started_at=CURRENT_TIMESTAMP WHERE id=? AND started_at IS NULL").run(req.params.slId);
  res.json({ ok: true });
});
router.post('/:id/schedule-lines/:slId/complete', (req, res) => {
  db.prepare("UPDATE order_schedule_lines SET completed_at=CURRENT_TIMESTAMP WHERE id=? AND started_at IS NOT NULL AND completed_at IS NULL").run(req.params.slId);
  res.json({ ok: true });
});
router.post('/:id/schedule-lines/:slId/reset', (req, res) => {
  db.prepare("UPDATE order_schedule_lines SET started_at=NULL, completed_at=NULL WHERE id=?").run(req.params.slId);
  res.json({ ok: true });
});
router.delete('/:id', (req, res) => {
  db.prepare('UPDATE production_orders SET deleted=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
Object.assign(module.exports, { createOrder, getOrder, listOrders, updateScheduleLine });
```

**Step 4:** 挂载 `app.use('/api/orders', require('./routes/orders'));`

**Step 5:** 跑测试绿 + curl 冒烟:
```bash
cmd //c "taskkill /F /IM node.exe"
rm -f server/db/penyou.db*
cd server && node app.js &
sleep 2
curl -s -X POST http://localhost:3100/api/products/import -F "file=@C:/Users/Administrator/Desktop/兴信(发印尼）喷油核价.xlsx" > /dev/null
# 找 E73907 id 和它的工序数
PID=$(curl -s "http://localhost:3100/api/products?q=E73907" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);process.stdout.write(a[0].id+'')})")
curl -s -X POST http://localhost:3100/api/orders -H "Content-Type: application/json" -d "{\"order_name\":\"E73907 首批\",\"product_id\":$PID,\"total_qty\":5000,\"start_date\":\"2026-05-01\"}"
curl -s "http://localhost:3100/api/orders" | head -c 500
cmd //c "taskkill /F /IM node.exe"
```

**Step 6:** 提交:

```bash
git add server/routes/orders.js server/tests/orders.test.js server/app.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.duanlei10@users.noreply.github.com" \
  commit -m "feat(v2): orders api with schedule-line auto-expansion and clock-in"
```

---

### Task 4.2:/orders 前端页

**Files:**
- Create: `client/src/pages/Orders.jsx`
- Modify: `client/src/App.jsx`

**Step 1:** 创建 Orders.jsx,两个 Tab:「新建订单」「订单列表」。

**新建订单 Tab:** 表单 + 产品选择 + 数量 + 起始日期 + 备注 + 提交;提交成功后 message + 切到列表 Tab。

**订单列表 Tab:** 月份 DatePicker(picker='month') + 搜索框 + Table;每行展开看 schedule_lines(一个嵌套 Table);每 schedule_line 有「改拉(Select)」「开始/完成/重置」「调产能/改起始日」按钮。月度汇总条目:`当月总产值 = Σ(订单.total_qty × 产品.quote_price)`。

代码骨架(自己按 antd 补全):

```jsx
import { useEffect, useState } from 'react';
import { Tabs, Form, Input, InputNumber, DatePicker, Button, Select, Table, Space, Tag, message, Popconfirm } from 'antd';
import { PlayCircleOutlined, CheckCircleOutlined, RedoOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../api';

// CreateOrderTab: 表单 + api.post('/orders') + 成功后 onCreated(id)
// OrdersListTab:
//   - DatePicker picker='month'
//   - 搜索
//   - api.get('/orders?month=YYYY-MM&q=')
//   - expandable.expandedRowRender: 渲染 schedule_lines 嵌套表
//   - 顶部汇总: Σ(total_qty × quote_price)
```

(具体 JSX 略,subagent 参照现有 Dispatch.jsx 模式实现。)

**Step 2:** App.jsx 菜单加 `/orders`(放在 `/wage-standards` 后,替换 `/dispatch`):

```jsx
{ key: '/orders', icon: <ProfileOutlined />, label: <Link to="/orders">排产</Link> },
```

import `Orders`、加路由。原 Dispatch 菜单先留着(为了过渡),本 milestone 末尾 7.1 再删。

**Step 3:** 浏览器验证:打开 `/orders` → 新建订单成功 → 列表页出现并能展开 → 改拉 / 调产能 / 打卡 全能走通。

**Step 4:** 提交:

```bash
git add client/src/pages/Orders.jsx client/src/App.jsx
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(v2): orders page with create/list + schedule-line edit + clock-in"
```

---

## 里程碑 5:每日录入

### Task 5.1:daily_records API

**Files:**
- Create: `server/routes/daily-records.js`
- Create: `server/tests/daily-records.test.js`
- Modify: `server/app.js`

**Step 1:** 失败测试(upsert 语义 + join 返回):

```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { upsertRecord, listByDate } = require('../routes/daily-records');
const { seedLines } = require('../db/seed');

function setup() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf-8'));
  db.pragma('foreign_keys = ON');
  seedLines(db);
  const { lastInsertRowid: pid } = db.prepare("INSERT INTO products(code,name,quote_price) VALUES ('T','t',1.5)").run();
  const ppid = db.prepare("INSERT INTO product_processes(product_id,part_name,technique,target_qty,worker_count,unit_wage) VALUES (?,?,?,?,?,?)").run(pid,'耳','喷油',1000,1,0.1).lastInsertRowid;
  return { db, pid, ppid };
}

test('upsert:同(date,line,process)更新而非插入', () => {
  const { db, pid, ppid } = setup();
  upsertRecord(db, { record_date: '2026-04-21', line_id: 1, product_id: pid, product_process_id: ppid, produced_qty: 100, worker_count: 2 });
  upsertRecord(db, { record_date: '2026-04-21', line_id: 1, product_id: pid, product_process_id: ppid, produced_qty: 250, worker_count: 3 });
  const all = db.prepare('SELECT * FROM daily_records').all();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].produced_qty, 250);
  assert.strictEqual(all[0].worker_count, 3);
});

test('listByDate 含 line_name / product_code / part_name / unit_wage / quote_price', () => {
  const { db, pid, ppid } = setup();
  upsertRecord(db, { record_date: '2026-04-21', line_id: 1, product_id: pid, product_process_id: ppid, produced_qty: 100, worker_count: 2 });
  const rows = listByDate(db, '2026-04-21');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].line_name, '宋沛霖手喷');
  assert.strictEqual(rows[0].product_code, 'T');
  assert.strictEqual(rows[0].part_name, '耳');
  assert.strictEqual(rows[0].unit_wage, 0.1);
  assert.strictEqual(rows[0].quote_price, 1.5);
});
```

**Step 2:** 实现:

```js
const express = require('express');
const db = require('../db');
const router = express.Router();

function upsertRecord(dbi, r) {
  dbi.prepare(`
    INSERT INTO daily_records(record_date, line_id, product_id, product_process_id, produced_qty, worker_count, remarks, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(record_date, line_id, product_process_id)
    DO UPDATE SET produced_qty=excluded.produced_qty, worker_count=excluded.worker_count, remarks=excluded.remarks
  `).run(r.record_date, r.line_id, r.product_id, r.product_process_id, r.produced_qty, r.worker_count, r.remarks || '');
}

function listByDate(dbi, date) {
  return dbi.prepare(`
    SELECT dr.*, l.name AS line_name, p.code AS product_code, p.name AS product_name,
           pp.part_name, pp.technique, pp.unit_wage, p.quote_price
    FROM daily_records dr
    JOIN lines l ON l.id = dr.line_id
    JOIN products p ON p.id = dr.product_id
    JOIN product_processes pp ON pp.id = dr.product_process_id
    WHERE dr.record_date = ?
    ORDER BY dr.id
  `).all(date);
}

router.get('/', (req, res) => {
  if (!req.query.date) return res.status(400).json({ error: 'date required' });
  res.json(listByDate(db, req.query.date));
});
router.post('/', (req, res) => {
  const { record_date, line_id, product_id, product_process_id, produced_qty, worker_count } = req.body;
  if (!record_date || !line_id || !product_id || !product_process_id || produced_qty == null || worker_count == null)
    return res.status(400).json({ error: 'all fields required' });
  upsertRecord(db, req.body);
  res.json({ ok: true });
});
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM daily_records WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
Object.assign(module.exports, { upsertRecord, listByDate });
```

**Step 3:** 挂载 app.js。

**Step 4:** 跑测试绿。提交 `feat(v2): daily-records upsert api with joined listByDate`。

---

### Task 5.2:/daily-records 前端页

**Files:**
- Create: `client/src/pages/DailyRecords.jsx`
- Modify: `client/src/App.jsx`

**Step 1:** 创建 DailyRecords.jsx:顶部日期 + 可编辑 Table,每行 `拉 Select | 货号 Select(搜索) | 工序 Select(货号联动) | 生产数 InputNumber | 人数 InputNumber | 备注 Input | 删`;改动 debounce 500ms 调 `POST /api/daily-records`。

**右上角汇总**:`已录 N 条 | 今日产值 ¥XX | 今日工资 ¥YY`,每次保存后重算。

**Step 2:** 菜单加 `/daily-records`(FormOutlined 图标),routes 补上。

**Step 3:** 浏览器测:选一天,录一行 E73907 拉 3 工序 生产数 500 人数 3 → 保存 → 刷新页面仍在 → 产值 = 500 × 1.25 = 625,工资 = 500 × 0.18 = 90。

**Step 4:** 提交 `feat(v2): daily-records page with inline edit + autosave`。

---

## 里程碑 6:收支表改造 + 月视图

### Task 6.1:buildLedger 改用 daily_records

**Files:**
- Modify: `server/lib/ledger.js`
- Modify: `server/tests/ledger.test.js` (更新老 test,用 daily_records)

**Step 1:** 改 `buildLedger`:不再查 dispatches,改查 daily_records:

```js
const aggStmt = db.prepare(`
  SELECT
    COALESCE(SUM(dr.produced_qty * p.quote_price), 0) AS total_output,
    COALESCE(SUM(dr.produced_qty * pp.unit_wage), 0) AS worker_wage_total
  FROM daily_records dr
  JOIN products p ON p.id = dr.product_id
  JOIN product_processes pp ON pp.id = dr.product_process_id
  WHERE dr.record_date = ? AND dr.product_id = ? AND dr.line_id = ?
`);

// products 列表改为:
const products = db.prepare(`
  SELECT DISTINCT p.id, p.code, p.name, p.quote_price
  FROM daily_records dr JOIN products p ON p.id = dr.product_id
  WHERE dr.record_date = ?
  ORDER BY p.id
`).all(date);
```

**Step 2:** 更新 `ledger.test.js` 的 setup(用 daily_records 代替 dispatches),跑测试绿。

**Step 3:** 提交:

```bash
git add server/lib/ledger.js server/tests/ledger.test.js
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit -m "feat(v2): buildLedger now aggregates from daily_records (actual production)"
```

---

### Task 6.2:月度汇总 API

**Files:**
- Modify: `server/routes/ledger.js`

**Step 1:** 追加路由:

```js
router.get('/monthly', (req, res) => {
  const month = req.query.month; // YYYY-MM
  if (!month) return res.status(400).json({ error: 'month required' });
  const byLine = db.prepare(`
    SELECT l.name AS line_name,
      COALESCE(SUM(dr.produced_qty * p.quote_price), 0) AS total_output,
      COALESCE(SUM(dr.produced_qty * pp.unit_wage), 0) AS total_wage,
      COUNT(DISTINCT dr.record_date) AS worker_days
    FROM daily_records dr
    JOIN lines l ON l.id = dr.line_id
    JOIN products p ON p.id = dr.product_id
    JOIN product_processes pp ON pp.id = dr.product_process_id
    WHERE strftime('%Y-%m', dr.record_date) = ?
    GROUP BY l.id, l.name
    ORDER BY l.sort_order
  `).all(month);
  const byProduct = db.prepare(`
    SELECT p.code, p.name,
      COALESCE(SUM(dr.produced_qty * p.quote_price), 0) AS total_output,
      COUNT(DISTINCT dr.record_date) AS days
    FROM daily_records dr
    JOIN products p ON p.id = dr.product_id
    WHERE strftime('%Y-%m', dr.record_date) = ?
    GROUP BY p.id, p.code, p.name
    ORDER BY total_output DESC
  `).all(month);
  const totalOutput = byLine.reduce((s, r) => s + Number(r.total_output), 0);
  res.json({ month, total_output: totalOutput, by_line: byLine, by_product: byProduct });
});
```

**Step 2:** curl 验证:

```bash
cmd //c "taskkill /F /IM node.exe"
cd server && node app.js &
sleep 2
curl -s "http://localhost:3100/api/ledger/monthly?month=2026-04" | head -c 400
cmd //c "taskkill /F /IM node.exe"
```

**Step 3:** 提交 `feat(v2): GET /api/ledger/monthly with by-line and by-product summaries`。

---

### Task 6.3:/ledger 加月视图 tab

**Files:**
- Modify: `client/src/pages/Ledger.jsx`

**Step 1:** 在 Ledger.jsx 顶部用 antd Tabs 切换「日视图 (Luckysheet)」「月视图 (月度汇总)」。

**月视图:** DatePicker picker='month' + 2 张 antd Table(按拉汇总 / 按货号汇总)+ 顶部总产值卡片。

**Step 2:** 浏览器验证。

**Step 3:** 提交 `feat(v2): ledger page with monthly summary tab`。

---

## 里程碑 7:菜单定型 + 清理

### Task 7.1:菜单调整,分拉 → 排产,砍冗余

**Files:**
- Modify: `client/src/App.jsx`

**Step 1:** 最终菜单 5 项,顺序:核价表 / 标准价表 / 排产 / 每日录入 / 收支表。

删掉 `/dispatch` 菜单项和路由,删掉 import Dispatch。但 **保留 `client/src/pages/Dispatch.jsx` 文件** 1 个版本(以防需要回滚,下一 commit 再删)。

**Step 2:** 浏览器扫 5 个菜单,每个都能打开不报错。

**Step 3:** 提交 `refactor(v2): finalize menu to 5 items, drop /dispatch route`。

---

### Task 7.2:清 Dispatch.jsx,清 /api/dispatches 前端引用

**Files:**
- Delete: `client/src/pages/Dispatch.jsx`
- (后端 `server/routes/dispatches.js` 保留,数据也保留)

**Step 1:** `rm client/src/pages/Dispatch.jsx`,确保无 import 引用它。

**Step 2:** grep `client/src` 确认无 `/api/dispatches` 字符串:`grep -r "/api/dispatches" client/src && echo "FOUND!" || echo "CLEAN"`。

**Step 3:** 浏览器再次扫 5 菜单。

**Step 4:** 提交 `chore(v2): remove deprecated Dispatch.jsx; backend /api/dispatches kept`。

---

### Task 7.3:e2e 端到端验收

**Files:** 无

**Step 1:** 清 dev DB + 导入:
```bash
cmd //c "taskkill /F /IM node.exe"
rm -f server/db/penyou.db*
cd server && node app.js &
cd client && npm run dev &
sleep 5
```

浏览器走一遍:
- [ ] `/products` 导入 Excel → 20+ 个产品(不再用的中文代码不应出现)
- [ ] `/wage-standards` → 空 → 「从历史推导」→ 出一张建议表,能改能保存
- [ ] 回 `/products` 新建一个产品,工序填「移印/人数 1」→ 离焦,工价自动填 0.036(如果标准表有)
- [ ] `/orders` 新建订单「测试/E73907/数量 5000/起始日 2026-05-01」→ 列表里出现订单 → 展开看工序 → 喷油行 line 为空,主管下拉选 → 调某行产能 → 打卡开始/完成
- [ ] `/daily-records` 选日期 → 录一行(拉/货号/工序/生产数/人数)→ 刷新页面仍在
- [ ] `/ledger` 选同一日期 → 产值/工资按实际生产数出来 → 切月视图看 按拉/按货号汇总
- [ ] 导出 xlsx 能下载并打开

**Step 2:** 全通过:

```bash
cmd //c "taskkill /F /IM node.exe"
git -c user.name="duanlei10" -c user.email="duanlei10@users.noreply.github.com" \
  commit --allow-empty -m "chore(v2): e2e verified — 5 new tables, 5 pages, daily→ledger flow"
```

---

## 完成标准

- [ ] 5 张新表建好,UV 拉就位,默认映射 14 条种子进了 DB
- [ ] 标准价表可「从历史推导」+ 手动改,且保存后能在新建产品时命中自动填工价
- [ ] 核价表弹窗底部显示汇总(总工价/总核价/总油漆价/总核价合/油漆占比红字)
- [ ] 新建订单展开成排产单:喷油行 line_id 为空,其它按默认;est_days/end_date 算对
- [ ] 排产单支持改拉/改产能/打卡开始/打卡完成/重置
- [ ] 每日录入页按拉×货号×工序录,debounce 自动保存
- [ ] 收支表日视图产值/工资来自 daily_records(不再估算)
- [ ] 收支表月视图显示当月产值按拉、按货号汇总
- [ ] 所有 `npm test` 绿(加了 wage-standards / orders / daily-records / ledger 的测试)
- [ ] 5 菜单项:核价表 / 标准价表 / 排产 / 每日录入 / 收支表
