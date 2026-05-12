# 多车间隔离 设计文档(2026-04-29)

> v2 已有的「核价表 / 标准价表 / 排产 / 每日录入 / 收支表」运行良好,现需扩展为「3 车间数据完全隔离」。本文档延续 `2026-04-21-penyou-v2-design.md` 设计。

## 一、背景

- 兴信塑胶制品有限公司 实际有 3 个生产车间:**湖南 / 兴信 / 华登**
- 每个车间数据独立运转(订单、产品核价、人工标准、每日录入、收支表)
- 不互通,但页面结构一致
- 参考用户提供的 「AI 注塑啤机排产系统」截图样式 —— 首页 3 张大卡片,选择后进入对应车间

## 二、范围

**包含:**
- 加 `workshops` 表 + 种子(湖南/兴信/华登)
- 给业务表加 `workshop_id` 列,实现逻辑隔离
- 重建 `lines` 表的 UNIQUE 约束(`(workshop_id, name)`)
- 重建 `technique_line_defaults` 主键(复合 `workshop_id + technique`)
- 后端所有路由加 `requireWorkshop` 中间件 + 全部 query 加 `WHERE workshop_id=?`
- 新前端首页(3 卡片车间选择器)+ axios 拦截器自动注入 workshop_id
- 主系统 Header 显示当前车间 + 「换车间」按钮

**不包含:**
- 跨车间汇总(以后再说)
- 用户/权限(任何人能进任何车间)
- 车间 CRUD 界面(3 个固定,改名直接改 DB)
- 历史数据按标记重新分配(全部归兴信)

## 三、数据模型

### 新表 `workshops`
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT UNIQUE | 湖南 / 兴信 / 华登 |
| sort_order | INTEGER | 显示顺序(1/2/3) |
| color | TEXT | 卡片颜色 |

**种子(3 条):**
```js
{ id: 1, name: '湖南', sort_order: 1, color: '#1677ff' },
{ id: 2, name: '兴信', sort_order: 2, color: '#fa8c16' },
{ id: 3, name: '华登', sort_order: 3, color: '#52c41a' },
```

### 现有表加 `workshop_id INTEGER NOT NULL` 列

| 表 | 加 workshop_id? | 备注 |
|---|---|---|
| `lines` | ✅ | 兴信现有 4 条;湖南/华登 各种入 4 条同名;重建 UNIQUE |
| `products` | ✅ | 21 个全归兴信(workshop_id=2) |
| `product_processes` | ❌ | 跟着 product 走,JOIN 间接 |
| `wage_standards` | ✅ | 私有 |
| `technique_line_defaults` | ✅ | 私有,主键改复合 (workshop_id, technique) |
| `production_orders` | ✅ | 私有 |
| `order_schedule_lines` | ❌ | 跟着 order 走 |
| `daily_records` | ✅ | 私有 |
| `ledger_edits` | ✅ | 私有 |
| `dispatches` (废表) | ❌ | 弃用,不动 |

### lines 种子扩充(4 → 12)

| workshop_id | line name | sort_order |
|---|---|---|
| 1 (湖南) | 手喷 | 1 |
| 1 (湖南) | 自动 | 2 |
| 1 (湖南) | 移印 | 3 |
| 1 (湖南) | UV | 4 |
| 2 (兴信) | 宋沛霖手喷 | 1(已存在) |
| 2 (兴信) | 宋沛霖自动 | 2(已存在) |
| 2 (兴信) | 胡旗移印 | 3(已存在) |
| 2 (兴信) | UV | 4(已存在) |
| 3 (华登) | 手喷 | 1 |
| 3 (华登) | 自动 | 2 |
| 3 (华登) | 移印 | 3 |
| 3 (华登) | UV | 4 |

### technique_line_defaults 种子改造

原 14 条只属于「兴信」(workshop_id=2)。给湖南、华登 各种入对应 14 条(line_id 指向各自车间的同名拉)。

## 四、API 改造

### 新路由

- `GET /api/workshops` — 列表(公共,不需要 workshop_id)
- `GET /api/workshops/:id/stats` — 该车间统计:`{ pending_orders, machine_count, monthly_output }`(公共)

### 中间件

```js
function requireWorkshop(req, res, next) {
  const id = Number(req.query.workshop_id);
  if (!id) return res.status(400).json({ error: 'workshop_id required' });
  req.workshopId = id;
  next();
}
```

挂在所有业务路由上:
```js
app.use('/api/products',         requireWorkshop, require('./routes/products'));
app.use('/api/lines',            requireWorkshop, require('./routes/lines'));
app.use('/api/wage-standards',   requireWorkshop, require('./routes/wage-standards'));
app.use('/api/line-defaults',    requireWorkshop, require('./routes/line-defaults'));
app.use('/api/orders',           requireWorkshop, require('./routes/orders'));
app.use('/api/daily-records',    requireWorkshop, require('./routes/daily-records'));
app.use('/api/ledger',           requireWorkshop, require('./routes/ledger'));
```

`/api/health`, `/api/workshops*`, `/api/dispatches`(已弃用) 不挂中间件。

### 路由改造

每个路由内部:
- SELECT 加 `WHERE workshop_id = ?`
- INSERT 写入 `req.workshopId`
- UPDATE/DELETE 校验 `workshop_id = req.workshopId`

具体:
- `GET /api/products` SELECT WHERE deleted=0 AND workshop_id=?
- `POST /api/products` INSERT 含 workshop_id
- `POST /api/products/import` 导入条目都带 workshop_id
- `GET /api/lines` WHERE workshop_id=? ORDER BY sort_order
- `GET/POST /api/wage-standards` 全部加 workshop_id
- `POST /api/wage-standards/suggest-from-history` 只从当前车间历史推导
- `GET /api/line-defaults` WHERE workshop_id=? (主键已变复合)
- `PUT /api/line-defaults/:technique` upsert 用 workshop_id + technique
- `GET /api/orders` 加车间过滤
- `GET /api/orders/active` 加车间过滤
- `POST /api/orders` createOrder 透传 workshop_id
- `GET/POST /api/daily-records` 加车间过滤
- `GET /api/ledger` buildLedger(db, date, workshop_id)
- `POST /api/ledger/edits` 加 workshop_id
- `GET /api/ledger/export` 加车间过滤
- `GET /api/ledger/monthly` 加车间过滤

## 五、前端改造

### 新首页 `/`(`WorkshopHome.jsx`)

```jsx
// 居中布局,大标题 + 公司名 + 3 张卡片
// 卡片:车间名(白字大字) + 待排订单数 / 机台数 / 当月产值 + 「进入 X」按钮
// 卡片背景按 color 着色
// 数据来自 GET /api/workshops + GET /api/workshops/:id/stats
// 点击「进入」:
//   localStorage.setItem('workshop_id', id);
//   localStorage.setItem('workshop_name', name);
//   navigate('/products');
```

### 主系统改造

**`App.jsx`:**
- 路由守卫:进任何菜单页前检查 `localStorage.workshop_id`,没有就 `<Navigate to="/" />`
- Header 改:左侧 logo + 「**喷油部 · {workshop_name} 车间**」+ 右侧「换车间」按钮

**`api.js`:**
```js
const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use(config => {
  const id = localStorage.getItem('workshop_id');
  if (id) config.params = { ...config.params, workshop_id: id };
  return config;
});
export default api;
```

**「换车间」按钮:** 清 localStorage 后跳 `/`。

### 现有 5 个菜单页 — **零改动**(只要 api.js 拦截器注入了 workshop_id 就自动按车间过滤)

## 六、迁移策略(`server/db/index.js` 启动时幂等执行)

```js
// 1. workshops 种子(seed.js 加 seedWorkshops)
seedWorkshops(db);

// 2. 给现有表加 workshop_id(默认 NULL),用 addColumnIfMissing
addColumnIfMissing('lines', 'workshop_id', 'INTEGER');
addColumnIfMissing('products', 'workshop_id', 'INTEGER');
addColumnIfMissing('wage_standards', 'workshop_id', 'INTEGER');
addColumnIfMissing('technique_line_defaults', 'workshop_id', 'INTEGER');
addColumnIfMissing('production_orders', 'workshop_id', 'INTEGER');
addColumnIfMissing('daily_records', 'workshop_id', 'INTEGER');
addColumnIfMissing('ledger_edits', 'workshop_id', 'INTEGER');

// 3. 现有数据全归兴信(id=2)
['lines', 'products', 'wage_standards', 'technique_line_defaults',
 'production_orders', 'daily_records', 'ledger_edits'].forEach(t => {
  db.exec(`UPDATE ${t} SET workshop_id = 2 WHERE workshop_id IS NULL`);
});

// 4. 重建 lines UNIQUE(原 UNIQUE(name) → UNIQUE(workshop_id, name))
//    检查 sqlite_master 看是否已经是新结构;不是则迁移
//    用 CREATE TABLE lines_new + INSERT SELECT + DROP + RENAME
//    包含完整字段:id, name, sort_order, workshop_id

// 5. 重建 technique_line_defaults 主键(原 PK technique → PK (workshop_id, technique))
//    类似步骤

// 6. 给 湖南 / 华登 各预建 4 条 lines + 14 条 line_defaults
//    seedLinesPerWorkshop(db) — 用 INSERT OR IGNORE
```

迁移脚本必须**幂等**(可重复跑不出错)。

## 七、测试改造

- 现有 28 个 test 在 setup() 里加 `seedWorkshops(db)`,所有 INSERT 用 workshop_id=2(兴信)
- 新增 test:
  - GET /api/workshops 返回 3 条
  - GET /api/workshops/:id/stats 数据正确
  - 同名工序在不同 workshop 不冲突(insert lines 同名不同 workshop)
  - buildLedger(db, date, workshop_id=2) 不返回 workshop_id=1 的数据(车间数据不污染)

## 八、成功标准

- [ ] 浏览器 `http://<ip>:5173/` 显示 3 张车间卡片
- [ ] 点「进入兴信」→ 看到现有 21 个产品(完全保留)
- [ ] 点「进入湖南」→ 空白核价表,有 4 条预建拉(手喷/自动/移印/UV)
- [ ] 在湖南建一个产品 → 切到兴信看不到
- [ ] 标准价表/订单/录入/收支表 各车间互不影响
- [ ] Header 显示「喷油部 · {当前车间} 车间」+ 换车间按钮
- [ ] 所有 npm test 绿
