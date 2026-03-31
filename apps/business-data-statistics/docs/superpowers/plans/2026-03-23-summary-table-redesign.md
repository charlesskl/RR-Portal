# 汇总表改版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 替换现有汇总表为按日汇总（含月度合计卡）+ 按月汇总（含环比对比）双视图，并统一全系统车间命名

**Architecture:** 分两阶段：先统一车间命名（前置依赖），再改造汇总表。后端新增 `/api/summary/daily` 和 `/api/summary/monthly` 两个接口替代 `/api/summary/detail`。前端 SummaryPage 的汇总表区域全部重写，可视化看板不变。

**Tech Stack:** Express 5 + PostgreSQL + Vue 3 + Element Plus (CDN) + SheetJS

**Spec:** `docs/superpowers/specs/2026-03-23-summary-table-redesign-design.md`

---

## 文件变更总览

| 文件 | 操作 | 职责 |
|------|------|------|
| `modules/balance/config.js` | 修改 | 车间命名统一 + 装配部补华嘉 |
| `db/init.sql` | 修改 | 初始车间数据命名统一 + 补华嘉 |
| `tests/modules.test.js` | 修改 | 测试用例同步命名 |
| `public/js/app.js` L637, L2610 | 修改 | 前端区域映射和车间管理下拉 |
| `preview-short-headers.html` L282, L299-300, L331 | 修改 | 预览页面命名统一 |
| `routes/summary.js` | 修改 | 新增 daily + monthly 端点 |
| `public/js/api.js` | 修改 | 新增 API 方法 |
| `public/js/app.js` L925-1342 | 修改 | SummaryPage 组件汇总表区域重写 |
| `public/css/theme.css` | 修改 | 新增卡片样式 |

---

## 阶段一：车间命名统一

### Task 1: 修改后端车间配置 config.js

**Files:**
- Modify: `modules/balance/config.js:51,98,179`
- Modify: `tests/modules.test.js:35`

- [ ] **Step 1: 修改 config.js 三个部门的 workshops 数组**

```javascript
// L51 beer:
workshops: ['兴信A', '兴信B', '华登A', '邵阳华登'],

// L98 print:
workshops: ['兴信A', '华登A', '邵阳华登'],

// L179 assembly（补充华嘉）:
workshops: ['兴信A', '兴信B', '华登A', '华嘉', '邵阳华登'],
```

- [ ] **Step 2: 修改测试用例**

`tests/modules.test.js` L35:
```javascript
expect(config.DEPT_CONFIG.beer.workshops).toEqual(['兴信A', '兴信B', '华登A', '邵阳华登']);
```

- [ ] **Step 3: 运行测试验证**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add modules/balance/config.js tests/modules.test.js
git commit -m "fix: 统一车间命名（华登→华登A，邵阳→邵阳华登，装配部补华嘉）"
```

### Task 2: 修改 init.sql 初始数据

**Files:**
- Modify: `db/init.sql:306-321`

- [ ] **Step 1: 修改三工部门 INSERT 语句中的车间名**

将 L309-317 的 `'华登'` → `'华登A'`，`('邵阳', '邵阳', ...)` → `('邵阳华登', '湖南', ...)`，装配部补充华嘉行：

```sql
INSERT INTO workshops (name, region, department, sort_order) VALUES
  ('兴信A', '清溪', 'beer', 1),
  ('兴信B', '清溪', 'beer', 2),
  ('华登A', '清溪', 'beer', 3),
  ('邵阳华登', '湖南', 'beer', 4),
  ('兴信A', '清溪', 'print', 1),
  ('华登A', '清溪', 'print', 2),
  ('邵阳华登', '湖南', 'print', 3),
  ('兴信A', '清溪', 'assembly', 1),
  ('兴信B', '清溪', 'assembly', 2),
  ('华登A', '清溪', 'assembly', 3),
  ('华嘉', '清溪', 'assembly', 4),
  ('邵阳华登', '湖南', 'assembly', 5),
  -- 扩展部门（暂不参与三工结余汇总）
  ('兴信A', '清溪', 'fixture', 1),
  ('华登A', '清溪', 'roto_casting', 1)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: 提交**

```bash
git add db/init.sql
git commit -m "fix: init.sql 车间命名统一 + 装配部补华嘉"
```

### Task 3: 数据库执行 UPDATE（全部车间命名统一）

**Files:** 无文件变更，仅数据库操作

- [ ] **Step 1: 执行 SQL 统一所有车间命名**

告知用户依次执行（注意：数据库中清溪和湖南的车间可能已被迁移脚本改过，用 IF EXISTS 思路，只改还没改的）：

```sql
-- 清溪：华登 → 华登A（如果还有旧名称）
UPDATE workshops SET name = '华登A' WHERE name = '华登' AND region = '清溪';

-- 湖南：邵阳 → 邵阳华登，region 从 '邵阳' 改为 '湖南'
UPDATE workshops SET name = '邵阳华登', region = '湖南' WHERE name = '邵阳' AND region = '邵阳';

-- 河源：华登 → 河源华登
UPDATE workshops SET name = '河源华登' WHERE name = '华登' AND region = '河源';

-- 装配部补华嘉（如果不存在）
INSERT INTO workshops (name, region, department, sort_order)
VALUES ('华嘉', '清溪', 'assembly', 4)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: 验证**

```sql
SELECT id, name, region, department FROM workshops WHERE name LIKE '%华登%' ORDER BY region, department;
```

Expected: 清溪的都是"华登A"，湖南的是"邵阳华登"，河源的是"河源华登"。

### Task 4: 修改前端引用

**Files:**
- Modify: `public/js/app.js:637,2610`
- Modify: `preview-short-headers.html:282,299-300,331`

- [ ] **Step 1: 修改 app.js L637 区域映射**

```javascript
// 旧: const regionKey = row.region === '湖南' ? '邵阳' : row.region;
// 新: 车间名已自带地区前缀，region 值统一后不再需要映射，直接使用
const regionKey = row.region;
```

- [ ] **Step 2: 修改 app.js L2610 河源车间列表**

```javascript
'河源': ['河源华登', '华康A', '华康B', '华康C', '小部门', '华兴']
```

- [ ] **Step 3: 修改 preview-short-headers.html**

L282:
```javascript
html += `...${['兴信A','兴信B','华登A','邵阳华登','兴信A'][r]}...</td>`;
```

L299-300:
```javascript
? [{name:'兴信A',region:'清溪'},{name:'华登A',region:'清溪'},{name:'邵阳华登',region:'湖南'}]
: [{name:'兴信A',region:'清溪'},{name:'兴信B',region:'清溪'},{name:'华登A',region:'清溪'},{name:'邵阳华登',region:'湖南'}];
```

L331:
```javascript
const syWs = workshops.filter(w => w.region === '湖南').map(w => wsData[w.name]);
```

- [ ] **Step 4: 启动服务验证明细表车间下拉菜单显示正确**

Run: `npm start`（或 PM2 restart）
验证：明细表页面的车间下拉显示"华登A"而非"华登"，"邵阳华登"而非"邵阳"

- [ ] **Step 5: 提交**

```bash
git add public/js/app.js preview-short-headers.html
git commit -m "fix: 前端车间命名统一（华登A/邵阳华登/河源华登）"
```

---

## 阶段二：汇总表改版

### Task 5: 新增后端 API — /api/summary/daily

**Files:**
- Modify: `routes/summary.js`（在文件末尾 `module.exports` 前新增路由）

- [ ] **Step 1: 在 summary.js 中新增 daily 端点**

在 `module.exports = router;` 之前添加：

```javascript
// GET /api/summary/daily?dept=beer&month=2026-03
// 返回按日汇总数据：月度合计 + 每日卡片
router.get('/daily', authenticate, asyncHandler(async (req, res) => {
  const { dept, month } = req.query;
  if (!dept || !DEPT_CONFIG[dept]) return res.status(400).json({ error: '无效部门' });
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: '无效月份格式，应为 YYYY-MM' });

  const config = DEPT_CONFIG[dept];
  const tableName = config.tableName;
  const expenseFields = getExpenseFields(dept);

  // 构建费用合计表达式
  const expenseSumExpr = expenseFields.length > 0
    ? expenseFields.map(f => `COALESCE(${f}, 0)`).join(' + ')
    : '0';

  // 构建 SELECT 字段列表：所有 expense 字段 + daily_output
  const allFields = ['daily_output', ...expenseFields];
  const selectFields = allFields.map(f => `COALESCE(r.${f}, 0) AS ${f}`).join(', ');
  const sumFields = allFields.map(f => `SUM(COALESCE(r.${f}, 0)) AS ${f}`).join(', ');

  // 解析月份为日期范围
  const [year, mon] = month.split('-').map(Number);
  const startDate = `${year}-${String(mon).padStart(2, '0')}-01`;
  const endDate = mon === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(mon + 1).padStart(2, '0')}-01`;

  // 1. 月度合计（按车间分组）
  const monthlySQL = `
    SELECT w.name AS workshop_name,
      ${sumFields},
      ${expenseFields.length > 0 ? expenseFields.map(f => `SUM(COALESCE(r.${f}, 0))`).join(' + ') : '0'} AS total_expense
    FROM ${tableName} r
    JOIN workshops w ON r.workshop_id = w.id
    WHERE r.record_date >= ? AND r.record_date < ?
    GROUP BY w.name, w.sort_order
    ORDER BY w.sort_order
  `;
  const monthlyRows = await getAll(monthlySQL, [startDate, endDate]);

  // 计算每行的 balance 和 balance_ratio
  for (const row of monthlyRows) {
    row.balance = (row.daily_output || 0) - (row.total_expense || 0);
    row.balance_ratio = row.daily_output > 0 ? row.balance / row.daily_output : 0;
  }

  // 月度合计行
  const monthlyTotal = {};
  allFields.forEach(f => { monthlyTotal[f] = monthlyRows.reduce((sum, r) => sum + (Number(r[f]) || 0), 0); });
  monthlyTotal.total_expense = monthlyRows.reduce((sum, r) => sum + (Number(r.total_expense) || 0), 0);
  monthlyTotal.balance = (monthlyTotal.daily_output || 0) - (monthlyTotal.total_expense || 0);
  monthlyTotal.balance_ratio = monthlyTotal.daily_output > 0 ? monthlyTotal.balance / monthlyTotal.daily_output : 0;

  // 2. 每日明细（按日期+车间）
  const dailySQL = `
    SELECT r.record_date, w.name AS workshop_name,
      ${selectFields},
      ${expenseFields.length > 0 ? expenseFields.map(f => `COALESCE(r.${f}, 0)`).join(' + ') : '0'} AS total_expense
    FROM ${tableName} r
    JOIN workshops w ON r.workshop_id = w.id
    WHERE r.record_date >= ? AND r.record_date < ?
    ORDER BY r.record_date DESC, w.sort_order
  `;
  const dailyRows = await getAll(dailySQL, [startDate, endDate]);

  // 按日期分组
  const dailyMap = {};
  for (const row of dailyRows) {
    row.balance = (row.daily_output || 0) - (row.total_expense || 0);
    row.balance_ratio = row.daily_output > 0 ? row.balance / row.daily_output : 0;

    const dateStr = typeof row.record_date === 'string'
      ? row.record_date.slice(0, 10)
      : row.record_date.toISOString().slice(0, 10);

    if (!dailyMap[dateStr]) dailyMap[dateStr] = [];
    dailyMap[dateStr].push(row);
  }

  // 构建每日卡片数据（含合计行）
  const daily = Object.entries(dailyMap).map(([date, workshops]) => {
    const total = {};
    allFields.forEach(f => { total[f] = workshops.reduce((sum, r) => sum + (Number(r[f]) || 0), 0); });
    total.total_expense = workshops.reduce((sum, r) => sum + (Number(r.total_expense) || 0), 0);
    total.balance = (total.daily_output || 0) - (total.total_expense || 0);
    total.balance_ratio = total.daily_output > 0 ? total.balance / total.daily_output : 0;

    // 获取星期
    const d = new Date(date + 'T00:00:00');
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    return { date, weekday: weekdays[d.getDay()], workshops, total };
  });

  // 返回费用字段列表（供前端动态建列）
  // 使用 getExportLabelMap 获取字段→中文标签映射（需在文件顶部 import）
  // 在 summary.js 顶部的 require 中追加: const { ..., getExportLabelMap } = require('../modules');
  const labelMap = getExportLabelMap('balance');
  const columns = allFields.map(f => ({
    field: f,
    label: labelMap[f] || f
  }));

  res.json({
    columns,
    monthly: { workshops: monthlyRows, total: monthlyTotal },
    daily
  });
}));
```

- [ ] **Step 2: 用浏览器或 curl 测试**

```bash
curl "http://localhost:6001/api/summary/daily?dept=beer&month=2026-03" -H "Authorization: Bearer <token>"
```

Expected: 返回 JSON 包含 `columns`、`monthly`（workshops 数组 + total）、`daily`（日期卡片数组）

- [ ] **Step 3: 提交**

```bash
git add routes/summary.js
git commit -m "feat: 新增 /api/summary/daily 按日汇总接口"
```

### Task 6: 新增后端 API — /api/summary/monthly

**Files:**
- Modify: `routes/summary.js`（在 daily 路由之后、module.exports 之前）

- [ ] **Step 1: 在 summary.js 中新增 monthly 端点**

```javascript
// GET /api/summary/monthly?month=2026-03
// 返回三部门月度汇总 + 环比对比
router.get('/monthly', authenticate, asyncHandler(async (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: '无效月份格式' });

  const [year, mon] = month.split('-').map(Number);
  const startDate = `${year}-${String(mon).padStart(2, '0')}-01`;
  const endDate = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;

  // 上月范围
  const prevMon = mon === 1 ? 12 : mon - 1;
  const prevYear = mon === 1 ? year - 1 : year;
  const prevStart = `${prevYear}-${String(prevMon).padStart(2, '0')}-01`;
  const prevEnd = startDate; // 本月1号即上月结束

  // 共有费用中要单独展示的字段
  const shownSharedFields = ['worker_wage', 'supervisor_wage', 'rent', 'utility_fee', 'social_insurance', 'tax'];
  // 归入"其他费用"的共有字段
  const otherSharedFields = ['tool_investment', 'equipment', 'renovation', 'misc_fee', 'shipping_fee'];

  const departments = [];
  const prevDepartments = [];

  for (const [dept, config] of Object.entries(DEPT_CONFIG)) {
    const tableName = config.tableName;
    const expenseFields = getExpenseFields(dept);
    const uniqueExpenseFields = expenseFields.filter(f => !shownSharedFields.includes(f) && !otherSharedFields.includes(f));

    // 构建"其他费用"表达式 = 独有费用 + otherSharedFields
    const otherFields = [...otherSharedFields.filter(f => expenseFields.includes(f)), ...uniqueExpenseFields];
    const otherExpr = otherFields.length > 0
      ? otherFields.map(f => `SUM(COALESCE(${f}, 0))`).join(' + ')
      : '0';

    const sql = `
      SELECT
        SUM(COALESCE(daily_output, 0)) AS daily_output,
        ${shownSharedFields.map(f => `SUM(COALESCE(${f}, 0)) AS ${f}`).join(', ')},
        ${otherExpr} AS other_expense,
        ${expenseFields.map(f => `SUM(COALESCE(${f}, 0))`).join(' + ')} AS total_expense
      FROM ${tableName} r
      JOIN workshops w ON r.workshop_id = w.id
      WHERE r.record_date >= ? AND r.record_date < ?
    `;

    // 本月（SUM 无匹配行时返回单行 NULL，用默认值防御）
    const [curr = {}] = await getAll(sql, [startDate, endDate]);
    curr.balance = (curr.daily_output || 0) - (curr.total_expense || 0);
    curr.balance_ratio = curr.daily_output > 0 ? curr.balance / curr.daily_output : 0;
    curr.dept = dept;
    curr.label = config.label;
    departments.push(curr);

    // 上月
    const [prev = {}] = await getAll(sql, [prevStart, prevEnd]);
    prev.balance = (prev.daily_output || 0) - (prev.total_expense || 0);
    prev.balance_ratio = prev.daily_output > 0 ? prev.balance / prev.daily_output : 0;
    prev.dept = dept;
    prev.label = config.label;
    prevDepartments.push(prev);
  }

  // 计算合计行
  const calcTotal = (depts) => {
    const t = { dept: 'total', label: '三工合计' };
    const numKeys = ['daily_output', ...shownSharedFields, 'other_expense', 'total_expense', 'balance'];
    numKeys.forEach(k => { t[k] = depts.reduce((sum, d) => sum + (Number(d[k]) || 0), 0); });
    t.balance_ratio = t.daily_output > 0 ? t.balance / t.daily_output : 0;
    return t;
  };

  const currentTotal = calcTotal(departments);
  const prevTotal = calcTotal(prevDepartments);

  // 计算环比
  const calcComparison = (curr, prev) => {
    const pctChange = (c, p) => p > 0 ? (c - p) / p : null;
    return {
      dept: curr.dept,
      label: curr.label,
      output_change: (curr.daily_output || 0) - (prev.daily_output || 0),
      output_change_pct: pctChange(curr.daily_output, prev.daily_output),
      expense_change: (curr.total_expense || 0) - (prev.total_expense || 0),
      expense_change_pct: pctChange(curr.total_expense, prev.total_expense),
      balance_change: (curr.balance || 0) - (prev.balance || 0),
      balance_change_pct: pctChange(curr.balance, prev.balance),
      ratio_change: (curr.balance_ratio || 0) - (prev.balance_ratio || 0),
      prev_balance: prev.balance || 0,
      curr_balance: curr.balance || 0
    };
  };

  const comparison = departments.map((d, i) => calcComparison(d, prevDepartments[i]));
  comparison.push(calcComparison(currentTotal, prevTotal));

  res.json({
    current: {
      departments,
      total: currentTotal
    },
    comparison: {
      departments: comparison,
      prev_month: `${prevYear}-${String(prevMon).padStart(2, '0')}`
    }
  });
}));
```

- [ ] **Step 2: 测试**

```bash
curl "http://localhost:6001/api/summary/monthly?month=2026-03" -H "Authorization: Bearer <token>"
```

Expected: 返回 JSON 包含 `current`（departments + total）和 `comparison`（环比数据）

- [ ] **Step 3: 提交**

```bash
git add routes/summary.js
git commit -m "feat: 新增 /api/summary/monthly 按月汇总+环比接口"
```

### Task 7: 新增前端 API 方法

**Files:**
- Modify: `public/js/api.js:75-77`

- [ ] **Step 1: 在 api.js 的大车间汇总区域新增两个方法**

在 `getSummaryDetail` 后面添加：
```javascript
getSummaryDaily(params) { return this.get('/summary/daily', params); },
getSummaryMonthly(params) { return this.get('/summary/monthly', params); },
```

- [ ] **Step 2: 提交**

```bash
git add public/js/api.js
git commit -m "feat: api.js 新增 getSummaryDaily/getSummaryMonthly"
```

### Task 8: 新增 CSS 样式

**Files:**
- Modify: `public/css/theme.css`（在现有 summary 样式块末尾追加）

- [ ] **Step 1: 在 theme.css 中追加新的卡片样式**

在文件末尾或现有 `.summary-detail-table` 样式块之后追加：

```css
/* ===== 按日汇总 - 卡片样式 ===== */
.daily-summary-section { padding: 0; }

/* 月度合计卡 */
.monthly-total-card {
  background: #fff;
  border: 2px solid #3D8361;
  border-radius: 10px;
  margin-bottom: 20px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(61,131,97,0.15);
}
.monthly-total-card .card-header {
  background: linear-gradient(135deg, #3D8361, #2d6b4e);
  color: #fff;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.monthly-total-card .card-header .card-title { font-weight: 700; font-size: 16px; }
.monthly-total-card .card-header .card-subtitle { margin-left: 10px; font-size: 12px; opacity: 0.85; }
.monthly-total-card .card-header .card-stats { font-size: 13px; opacity: 0.95; }
.monthly-total-card .card-header .card-stats span.val { font-weight: 700; }

/* 日期卡片 */
.daily-card {
  background: #fff;
  border: 1px solid #E0E0E0;
  border-radius: 10px;
  margin-bottom: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.daily-card .card-header {
  background: linear-gradient(135deg, #D391DD, #c080cc);
  color: #fff;
  padding: 9px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.daily-card .card-header .card-date { font-weight: 700; font-size: 14px; }
.daily-card .card-header .card-weekday { margin-left: 8px; font-size: 12px; opacity: 0.9; }
.daily-card .card-header .card-stats { font-size: 12px; opacity: 0.95; }

/* 卡片内表格 */
.card-table-wrap { overflow-x: auto; }
.card-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  min-width: 900px;
}
.card-table th {
  padding: 7px 8px;
  text-align: right;
  font-weight: 600;
  border-bottom: 1px solid #e0e0e0;
  white-space: nowrap;
}
.card-table th:first-child { text-align: left; padding-left: 10px; }
.card-table td { padding: 5px 8px; text-align: right; }
.card-table td:first-child { text-align: left; padding-left: 10px; font-weight: 500; }
.card-table tbody tr { border-bottom: 1px solid #f0f0f0; }
.card-table tbody tr:nth-child(even) { background: #F9F9F9; }

/* 月度卡表头/合计行 */
.monthly-total-card .card-table th { color: #3D8361; background: #edf7f2; border-bottom-color: #d0e4da; }
.monthly-total-card .card-table tr.total-row { background: #edf7f2; font-weight: 700; border-top: 2px solid #3D8361; }
.monthly-total-card .card-table tr.total-row td:first-child { color: #3D8361; }

/* 日期卡表头/合计行 */
.daily-card .card-table th { color: #7F41C0; background: #f9f0fb; border-bottom-color: #e8d5ed; }
.daily-card .card-table tr.total-row { background: #f9f0fb; font-weight: 700; border-top: 1px solid #D391DD; }
.daily-card .card-table tr.total-row td:first-child { color: #7F41C0; }

/* sticky 车间列 */
.card-table th.sticky-col,
.card-table td.sticky-col {
  position: sticky;
  left: 0;
  z-index: 1;
}
.card-table th.sticky-col { background: inherit; }
.card-table td.sticky-col { background: inherit; }
.card-table tbody tr:nth-child(even) td.sticky-col { background: #F9F9F9; }
.card-table tr.total-row td.sticky-col { background: inherit; }

/* 分隔线 */
.daily-divider {
  border-top: 2px dashed #E0E0E0;
  margin: 8px 0 16px;
  position: relative;
  text-align: center;
}
.daily-divider span {
  position: relative;
  top: -10px;
  background: #FFFCEF;
  padding: 0 12px;
  font-size: 11px;
  color: #999;
}

/* 结余颜色 */
.val-positive { color: #3D8361; font-weight: 600; }
.val-negative { color: #E88EA0; font-weight: 600; }
.expense-val { color: #E88EA0; }

/* ===== 按月汇总 ===== */
.monthly-section-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 10px;
  padding-bottom: 6px;
}
.monthly-section-title.primary { color: #7F41C0; border-bottom: 2px solid #7F41C0; }
.monthly-section-title.info { color: #5B9BD5; border-bottom: 2px solid #5B9BD5; }

.monthly-summary-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #E0E0E0;
  margin-bottom: 20px;
}
.monthly-summary-table th {
  padding: 10px 10px;
  text-align: right;
  font-weight: 600;
  color: #fff;
}
.monthly-summary-table th:first-child { text-align: left; padding-left: 12px; }
.monthly-summary-table thead.primary th { background: #7F41C0; }
.monthly-summary-table thead.info th { background: #5B9BD5; }
.monthly-summary-table td { padding: 8px 10px; text-align: right; }
.monthly-summary-table td:first-child { text-align: left; padding-left: 12px; font-weight: 600; }
.monthly-summary-table tbody tr { border-bottom: 1px solid #f0f0f0; }
.monthly-summary-table tbody tr:nth-child(even) { background: #F9F9F9; }
.monthly-summary-table tr.grand-total-primary {
  background: #f5f0fa;
  font-weight: 700;
  border-top: 2px solid #7F41C0;
}
.monthly-summary-table tr.grand-total-primary td:first-child { color: #7F41C0; }
.monthly-summary-table tr.grand-total-info {
  background: #EBF3FB;
  font-weight: 700;
  border-top: 2px solid #5B9BD5;
}
.monthly-summary-table tr.grand-total-info td:first-child { color: #5B9BD5; }

/* 部门按钮组 */
.dept-btn-group { display: flex; gap: 6px; }
.dept-btn {
  padding: 3px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}
.dept-btn.active { background: #7F41C0; color: #fff; }
.dept-btn:not(.active) { background: #e8e8e8; color: #666; }
.dept-btn:not(.active):hover { background: #d0d0d0; }

/* 子标签栏 */
.summary-sub-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
.summary-sub-tab {
  padding: 6px 18px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}
.summary-sub-tab.active { background: #7F41C0; color: #fff; font-weight: 600; }
.summary-sub-tab:not(.active) { background: #e0e0e0; color: #666; }
.summary-sub-tab:not(.active):hover { background: #d0d0d0; }
```

- [ ] **Step 2: 提交**

```bash
git add public/css/theme.css
git commit -m "feat: 新增汇总表卡片和按月对比样式"
```

### Task 9: 重写前端 SummaryPage 汇总表区域

**Files:**
- Modify: `public/js/app.js:1008-1342`（汇总表 template + data + methods）

这是最大的改动，替换 `v-if="mainTab === 'table'"` 内部的全部内容，以及相关 data 和 methods。

- [ ] **Step 1: 替换汇总表 template（L1008-1103）**

将 `<!-- ========== 汇总表 ========== -->` 到 `</div>` 之间的全部内容替换为新的双视图模板。新模板包含：

**按日汇总视图：**
- 子标签栏（按日汇总 / 按月汇总）
- 筛选栏（部门按钮组 + 月份 + 跳转日期 + 导出）
- 月度合计卡（橄榄绿，v-if="dailyData.monthly"）
- 虚线分隔
- 日期卡片列表（浅雾紫，v-for="card in dailyData.daily"）

**按月汇总视图：**
- 筛选栏（月份 + 导出）
- 本月三工汇总表（紫色表头）
- 环比变化表（蓝色表头）

由于此 template 较长（约200行），实现时需要仔细按设计文档构建，关键点：
- 表格列通过 `dailyColumns` computed 属性动态生成
- 车间列 th/td 加 `class="sticky-col"`
- 结余值用 `:class` 绑定 `val-positive` / `val-negative`
- 日期卡片用 `:id="'daily-' + card.date"` 用于跳转定位

- [ ] **Step 2: 替换 data 属性（L1120-1123）**

删除旧属性：
```javascript
// 删除:
tableMonth: ...,
tableTab: 'overview',
tableData: {}
```

新增属性：
```javascript
// 汇总表 - 子视图切换
tableView: 'daily',  // 'daily' | 'monthly'
// 按日汇总
dailyDept: 'beer',
dailyMonth: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'),
dailyJumpDate: null,
dailyLoading: false,
dailyData: { columns: [], monthly: null, daily: [] },
// 按月汇总
monthlyMonth: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'),
monthlyLoading: false,
monthlyData: { current: null, comparison: null },
```

- [ ] **Step 2.5: 新增 computed 属性**

在 SummaryPage 组件的 `data()` 和 `mounted()` 之间添加 `computed` 块：

```javascript
computed: {
  // 按日汇总的动态列定义（从后端返回的 columns 构建）
  dailyColumns() {
    return this.dailyData.columns || [];
  },
  // 部门配置（用于部门按钮渲染）
  deptList() {
    return [
      { key: 'beer', label: '啤机部' },
      { key: 'print', label: '印喷部' },
      { key: 'assembly', label: '装配部' }
    ];
  }
},
```

- [ ] **Step 3: 替换 methods（L1263-1340）**

删除旧方法：`switchTableTab`、`loadTableData`、`handleTableExport`

新增方法：

```javascript
// ===== 汇总表子视图切换 =====
switchTableView(view) {
  this.tableView = view;
  if (view === 'daily') {
    this.loadDailyData();
  } else {
    this.loadMonthlyData();
  }
},

// ===== 按日汇总 =====
switchDailyDept(dept) {
  this.dailyDept = dept;
  this.loadDailyData();
},

async loadDailyData() {
  if (!this.dailyMonth) return;
  this.dailyLoading = true;
  try {
    const res = await API.getSummaryDaily({ dept: this.dailyDept, month: this.dailyMonth });
    this.dailyData = res.data;
  } catch (err) {
    ElementPlus.ElMessage.error('加载按日汇总失败: ' + (err.message || '未知错误'));
  } finally {
    this.dailyLoading = false;
  }
},

jumpToDate(date) {
  if (!date) return;
  const dateStr = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  const el = document.getElementById('daily-' + dateStr);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    ElementPlus.ElMessage.warning('该日期无数据');
  }
},

// ===== 按月汇总 =====
async loadMonthlyData() {
  if (!this.monthlyMonth) return;
  this.monthlyLoading = true;
  try {
    const res = await API.getSummaryMonthly({ month: this.monthlyMonth });
    this.monthlyData = res.data;
  } catch (err) {
    ElementPlus.ElMessage.error('加载按月汇总失败: ' + (err.message || '未知错误'));
  } finally {
    this.monthlyLoading = false;
  }
},

// ===== 环比格式化 =====
fmtChange(val, pct) {
  if (val === null || val === undefined) return '—';
  const arrow = val >= 0 ? '↑' : '↓';
  const absVal = Math.abs(val).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const pctStr = pct !== null && pct !== undefined ? ` (${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%)` : '';
  return `${arrow} ${absVal}${pctStr}`;
},

// 环比颜色：产值/结余增↑是有利(绿)，费用增↑是不利(粉)
changeClass(val, inverse) {
  if (val === null || val === undefined || val === 0) return '';
  if (inverse) return val > 0 ? 'val-negative' : 'val-positive';
  return val >= 0 ? 'val-positive' : 'val-negative';
},

// ===== 导出 =====
handleTableExport() {
  try {
    if (this.tableView === 'daily') {
      this.exportDaily();
    } else {
      this.exportMonthly();
    }
  } catch (err) {
    ElementPlus.ElMessage.error('导出失败: ' + (err.message || '未知错误'));
  }
},

exportDaily() {
  const data = this.dailyData;
  if (!data.monthly) { ElementPlus.ElMessage.warning('无数据可导出'); return; }
  const cols = data.columns || [];
  const rows = [];
  // 月度合计
  for (const ws of data.monthly.workshops) {
    const row = { '类型': '月度合计', '日期': this.dailyMonth, '车间': ws.workshop_name };
    cols.forEach(c => { row[c.label] = ws[c.field] ?? ''; });
    row['费用合计'] = ws.total_expense ?? '';
    row['结余'] = ws.balance ?? '';
    row['结余率'] = ws.balance_ratio != null ? (ws.balance_ratio * 100).toFixed(1) + '%' : '';
    rows.push(row);
  }
  // 每日明细
  for (const card of data.daily) {
    for (const ws of card.workshops) {
      const row = { '类型': '每日', '日期': card.date, '车间': ws.workshop_name };
      cols.forEach(c => { row[c.label] = ws[c.field] ?? ''; });
      row['费用合计'] = ws.total_expense ?? '';
      row['结余'] = ws.balance ?? '';
      row['结余率'] = ws.balance_ratio != null ? (ws.balance_ratio * 100).toFixed(1) + '%' : '';
      rows.push(row);
    }
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  const deptLabel = { beer: '啤机部', print: '印喷部', assembly: '装配部' }[this.dailyDept];
  XLSX.utils.book_append_sheet(wb, ws, deptLabel);
  XLSX.writeFile(wb, `按日汇总_${deptLabel}_${this.dailyMonth}.xlsx`);
  ElementPlus.ElMessage.success('导出成功');
},

exportMonthly() {
  const data = this.monthlyData;
  if (!data.current) { ElementPlus.ElMessage.warning('无数据可导出'); return; }
  const rows = [];
  // 本月汇总
  const allDepts = [...data.current.departments, data.current.total];
  for (const d of allDepts) {
    rows.push({
      '部门': d.label, '总产值': d.daily_output,
      '员工工资': d.worker_wage, '管工工资': d.supervisor_wage,
      '房租': d.rent, '水电费': d.utility_fee,
      '社保': d.social_insurance, '税收': d.tax,
      '其他费用': d.other_expense, '费用合计': d.total_expense,
      '结余': d.balance,
      '结余率': d.balance_ratio != null ? (d.balance_ratio * 100).toFixed(1) + '%' : ''
    });
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '按月汇总');
  XLSX.writeFile(wb, `按月汇总_${this.monthlyMonth}.xlsx`);
  ElementPlus.ElMessage.success('导出成功');
},
```

- [ ] **Step 4: 修改 switchMainTab 方法**

将 L1173-1174 的 `loadTableData()` 改为：
```javascript
} else if (tab === 'table') {
  if (this.tableView === 'daily') {
    this.loadDailyData();
  } else {
    this.loadMonthlyData();
  }
}
```

- [ ] **Step 5: 启动服务，完整验证**

1. 打开汇总表 → 按日汇总标签 → 选啤机部 → 确认月度合计卡和日期卡片都正确渲染
2. 切换印喷部/装配部 → 确认列数变化（费用字段不同）
3. 使用跳转日期 → 确认自动滚动
4. 切换到按月汇总 → 确认三部门表格和环比变化表
5. 测试导出 Excel

- [ ] **Step 6: 提交**

```bash
git add public/js/app.js
git commit -m "feat: 重写汇总表 — 按日汇总卡片+按月汇总环比双视图"
```

### Task 10: 清理旧代码

**Files:**
- Modify: `routes/summary.js` — 可选：标记 `/detail` 和 `/overview` 为 deprecated
- Modify: `public/css/theme.css` — 如有旧的 `.summary-tab-bar` 等样式可删除

- [ ] **Step 1: 在旧路由上方加注释标记 deprecated**

```javascript
// DEPRECATED: 被 /daily + /monthly 替代，保留兼容
router.get('/detail', ...);
router.get('/overview', ...);
```

- [ ] **Step 2: 运行完整测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add routes/summary.js public/css/theme.css
git commit -m "chore: 标记旧汇总接口为 deprecated"
```
