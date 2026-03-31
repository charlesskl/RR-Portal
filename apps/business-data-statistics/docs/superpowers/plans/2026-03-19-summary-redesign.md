# 大车间汇总模块重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将"三工汇总"重构为"结余收支汇总 > 大车间汇总"，包含可视化看板（ECharts）和汇总表（分Tab页签）两种视图。

**Architecture:** 后端新增 2 个 API（dashboard + detail），前端重构 SummaryPage 组件为双视图模式（看板/表格），导航菜单改为父子结构。ECharts 通过 CDN 引入。

**Tech Stack:** Express 5, PostgreSQL, Vue 3 (CDN), Element Plus (CDN), ECharts 5.5.0 (CDN), SheetJS

**Spec:** `docs/superpowers/specs/2026-03-19-summary-redesign-design.md`

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `public/index.html` | Modify | 添加 ECharts CDN |
| `routes/summary.js` | Modify | 新增 `/dashboard` 和 `/detail` 路由 |
| `public/js/api.js` | Modify | 添加 dashboard/detail API 封装函数 |
| `public/js/app.js` | Modify | 导航菜单改造 + SummaryPage 组件重构 |
| `public/css/theme.css` | Modify | 看板样式（卡片、图表容器） |

---

## Task 1: 添加 ECharts CDN

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: 在 index.html 中添加 ECharts CDN**

在 SheetJS 的 `<script>` 标签之后添加：
```html
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
```

位置：在 `xlsx.full.min.js` 之后、`sortablejs` 之前。

- [ ] **Step 2: 验证**

浏览器打开系统，在控制台输入 `typeof echarts`，应返回 `"object"`。

- [ ] **Step 3: Commit**
```bash
git add public/index.html
git commit -m "feat: 添加 ECharts CDN 用于大车间汇总看板"
```

---

## Task 2: 后端 — Dashboard API

**Files:**
- Modify: `routes/summary.js`

**参考：** `modules/index.js` 中的 `DEPT_CONFIG`, `getExpenseFields`, `SHARED_EXPENSE_FIELDS`；`modules/balance/config.js` 中各部门的 `uniqueFields`。

- [ ] **Step 1: 添加费用分类映射常量**

在 `routes/summary.js` 顶部，`router` 声明之后添加：

```javascript
// 费用分类映射（用于堆叠图）
const EXPENSE_CATEGORIES = {
  wage: ['worker_wage', 'supervisor_wage', 'misc_worker_wage', 'no_output_wage', 'assembly_wage_paid', 'office_wage', 'actual_wage', 'borrowed_worker_wage'],
  rent_utility: ['rent', 'utility_fee'],
  insurance_tax: ['social_insurance', 'tax', 'hunan_social_insurance', 'hunan_tax'],
  repair_material: ['tool_investment', 'equipment', 'renovation', 'machine_repair', 'mold_repair', 'materials', 'material_supplement', 'repair_fee', 'oil_water_amount', 'non_recoverable_tool_fee', 'workshop_repair', 'electrical_repair', 'workshop_materials', 'stretch_film', 'tape', 'supplement', 'workshop_tool_investment', 'fixture_tool_investment'],
  process_mold: ['gate_processing_fee', 'assembly_gate_parts_fee', 'auto_mold_fee', 'hunan_mold_fee', 'indonesia_mold_fee'],
  other: ['misc_fee', 'shipping_fee', 'subsidy']
};
```

- [ ] **Step 2: 添加 GET /api/summary/dashboard 路由**

在现有 `/overview` 路由之后添加。此路由需要：
1. 接收 `year`（必填）和 `month`（可选）参数
2. 对三个部门分别查询，返回 cards（汇总卡片）、departments（部门对比）、monthly_trend（月度趋势）、expense_breakdown（费用构成）

```javascript
// GET /api/summary/dashboard?year=2026&month=3
router.get('/dashboard', authenticate, asyncHandler(async (req, res) => {
  const { year, month } = req.query;
  if (!year) return res.status(400).json({ success: false, message: '缺少 year 参数' });

  const yearNum = parseInt(year);
  const monthNum = month ? parseInt(month) : null;

  // === 1. 卡片数据 + 部门对比 ===
  const departments = [];
  let totalOutput = 0, totalExpense = 0, totalBalance = 0;

  for (const [dept, config] of Object.entries(DEPT_CONFIG)) {
    const expenseFields = getExpenseFields(dept);
    const expenseSumExpr = expenseFields.map(f => `COALESCE(${f}, 0)`).join(' + ');

    let sql = `SELECT SUM(daily_output) as output, SUM(${expenseSumExpr}) as expense, SUM(balance) as balance
               FROM ${config.tableName}
               WHERE EXTRACT(YEAR FROM record_date) = ?`;
    const params = [yearNum];
    if (monthNum) { sql += ` AND EXTRACT(MONTH FROM record_date) = ?`; params.push(monthNum); }

    const rows = await getAll(sql, params);
    const r = rows[0] || {};
    const output = parseFloat(r.output) || 0;
    const expense = parseFloat(r.expense) || 0;
    const balance = parseFloat(r.balance) || 0;
    departments.push({
      dept, label: config.label, output, expense, balance,
      ratio: output > 0 ? balance / output : 0
    });
    totalOutput += output;
    totalExpense += expense;
    totalBalance += balance;
  }

  const cards = {
    total_output: totalOutput,
    total_expense: totalExpense,
    total_balance: totalBalance,
    avg_ratio: totalOutput > 0 ? totalBalance / totalOutput : 0
  };

  // === 2. 月度趋势（该年每月每个部门的结余率）===
  // 每个部门一条 SQL，GROUP BY 月份，总共 3 条查询
  const trendMap = {}; // { '2026-01': { beer_ratio: 0, ... } }
  for (let m = 1; m <= 12; m++) {
    trendMap[`${yearNum}-${String(m).padStart(2, '0')}`] = {};
  }
  for (const [dept, config] of Object.entries(DEPT_CONFIG)) {
    const sql = `SELECT EXTRACT(MONTH FROM record_date)::int as m,
                 SUM(daily_output) as output, SUM(balance) as balance
                 FROM ${config.tableName}
                 WHERE EXTRACT(YEAR FROM record_date) = ?
                 GROUP BY EXTRACT(MONTH FROM record_date)`;
    const rows = await getAll(sql, [yearNum]);
    for (const r of rows) {
      const key = `${yearNum}-${String(r.m).padStart(2, '0')}`;
      const output = parseFloat(r.output) || 0;
      const balance = parseFloat(r.balance) || 0;
      if (trendMap[key]) trendMap[key][`${dept}_ratio`] = output > 0 ? balance / output : 0;
    }
  }
  const monthlyTrend = Object.entries(trendMap).sort().map(([month, data]) => ({
    month, beer_ratio: 0, print_ratio: 0, assembly_ratio: 0, ...data
  }));

  // === 3. 费用构成（该年每月按分类汇总，三部门合计）===
  // 每个部门一条 SQL，GROUP BY 月份，总共 3 条查询
  const breakdownMap = {};
  for (let m = 1; m <= 12; m++) {
    const key = `${yearNum}-${String(m).padStart(2, '0')}`;
    breakdownMap[key] = {};
    for (const cat of Object.keys(EXPENSE_CATEGORIES)) breakdownMap[key][cat] = 0;
  }
  for (const [dept, config] of Object.entries(DEPT_CONFIG)) {
    const allExpense = getExpenseFields(dept);
    const selectClauses = allExpense.map(f => `SUM(COALESCE(${f}, 0)) as ${f}`).join(', ');
    const sql = `SELECT EXTRACT(MONTH FROM record_date)::int as m, ${selectClauses}
                 FROM ${config.tableName}
                 WHERE EXTRACT(YEAR FROM record_date) = ?
                 GROUP BY EXTRACT(MONTH FROM record_date)`;
    const rows = await getAll(sql, [yearNum]);
    for (const r of rows) {
      const key = `${yearNum}-${String(r.m).padStart(2, '0')}`;
      if (!breakdownMap[key]) continue;
      for (const [cat, fields] of Object.entries(EXPENSE_CATEGORIES)) {
        for (const f of fields) {
          if (r[f] !== undefined) breakdownMap[key][cat] += parseFloat(r[f]) || 0;
        }
      }
    }
  }
  const expenseBreakdown = Object.entries(breakdownMap).sort().map(([month, data]) => ({ month, ...data }));

  res.json({ success: true, data: { cards, departments, monthly_trend: monthlyTrend, expense_breakdown: expenseBreakdown } });
}));
```

- [ ] **Step 3: 验证 API**

```bash
curl "http://localhost:6001/api/summary/dashboard?year=2026&month=3" -H "Authorization: Bearer <token>"
```

确认返回 JSON 包含 cards、departments、monthly_trend（12个月）、expense_breakdown（12个月）。

- [ ] **Step 4: Commit**
```bash
git add routes/summary.js
git commit -m "feat: 添加 /api/summary/dashboard 看板数据接口"
```

---

## Task 3: 后端 — Detail API（汇总表数据）

**Files:**
- Modify: `routes/summary.js`

**参考：** 现有的 `/:dept/summary` 路由（`routes/records.js:124-169`）已实现按车间 GROUP BY 的查询，可参考其 SQL 模式。

- [ ] **Step 1: 添加 GET /api/summary/detail 路由**

在 dashboard 路由之后添加。需要处理两种模式：总览（无 dept 参数）和部门明细（有 dept 参数）。

```javascript
// GET /api/summary/detail?dept=beer&start_date=2026-03-01&end_date=2026-03-31
router.get('/detail', authenticate, asyncHandler(async (req, res) => {
  const { dept, start_date, end_date } = req.query;
  const balanceConfig = require('../modules/balance/config');

  // 日期条件构建辅助函数
  const buildDateWhere = (alias, params) => {
    let where = '';
    if (start_date) { where += ` AND ${alias}record_date >= ?`; params.push(start_date); }
    if (end_date) { where += ` AND ${alias}record_date <= ?`; params.push(end_date); }
    return where;
  };

  if (!dept) {
    // === 总览模式：返回三部门的所有字段汇总 ===
    const deptResults = [];
    const totalAcc = {};

    for (const [dKey, config] of Object.entries(DEPT_CONFIG)) {
      const sharedExpFields = balanceConfig.sharedFields.filter(f => f.expense).map(f => f.field);
      const uniqueExpFields = config.uniqueExpenseFields;
      const allExpFields = [...sharedExpFields, ...uniqueExpFields];

      // 查询所有需要的字段
      const allFields = ['daily_output', 'supervisor_count', 'worker_count', ...allExpFields, 'balance'];
      const selectClauses = allFields.map(f => `SUM(COALESCE(${f}, 0)) as ${f}`).join(', ');
      const params = [];
      let sql = `SELECT ${selectClauses} FROM ${config.tableName} WHERE 1=1`;
      sql += buildDateWhere('', params);

      const rows = await getAll(sql, params);
      const r = rows[0] || {};
      const output = parseFloat(r.daily_output) || 0;
      const balance = parseFloat(r.balance) || 0;

      // 构建该部门所有字段的值
      const fieldValues = {};
      for (const f of allFields) {
        fieldValues[f] = parseFloat(r[f]) || 0;
        // 累加到 totalAcc
        totalAcc[f] = (totalAcc[f] || 0) + (parseFloat(r[f]) || 0);
      }

      // 构建行数据（总览表的每一行）
      const deptRows = [];
      // 产值
      deptRows.push({ category: '产值', field: 'daily_output', label: '总产值', value: output });
      // 人员
      deptRows.push({ category: '人员', field: 'supervisor_count', label: '管工人数', value: parseFloat(r.supervisor_count) || 0 });
      deptRows.push({ category: '人员', field: 'worker_count', label: '员工人数', value: parseFloat(r.worker_count) || 0 });
      // 共有费用
      for (const sf of balanceConfig.sharedFields) {
        if (sf.expense) {
          deptRows.push({ category: '共有', field: sf.field, label: sf.label.replace('/天', ''), value: parseFloat(r[sf.field]) || 0 });
        }
      }
      // 独有费用
      const deptConf = balanceConfig.departments[dKey];
      for (const uf of deptConf.uniqueFields) {
        if (uf.expense) {
          deptRows.push({ category: '独有', field: uf.field, label: uf.label, value: parseFloat(r[uf.field]) || 0 });
        }
      }

      deptResults.push({ dept: dKey, label: config.label, rows: deptRows, balance, balance_ratio: output > 0 ? balance / output : 0 });
    }

    // 构建总览行结构：统一行 + 各部门值
    const allRows = [];
    // 收集所有行的 field 列表（去重保序）
    const rowDefs = [];
    // 先加产值和人员（共有）
    rowDefs.push({ category: '产值', field: 'daily_output', label: '总产值' });
    rowDefs.push({ category: '人员', field: 'supervisor_count', label: '管工人数' });
    rowDefs.push({ category: '人员', field: 'worker_count', label: '员工人数' });
    // 共有费用
    for (const sf of balanceConfig.sharedFields) {
      if (sf.expense) rowDefs.push({ category: '共有', field: sf.field, label: sf.label.replace('/天', '') });
    }
    // 各部门独有费用
    for (const [dKey, deptConf] of Object.entries(balanceConfig.departments)) {
      for (const uf of deptConf.uniqueFields) {
        if (uf.expense) rowDefs.push({ category: DEPT_CONFIG[dKey].label.replace('部', '') + '独有', field: uf.field, label: uf.label, dept: dKey });
      }
    }

    for (const rd of rowDefs) {
      const row = { category: rd.category, field: rd.field, label: rd.label };
      let rowTotal = 0;
      for (const dr of deptResults) {
        // 部门独有字段只在对应部门显示值，其他部门显示 null（前端渲染为"—"）
        if (rd.dept && rd.dept !== dr.dept) {
          row[dr.dept] = null;
        } else {
          const found = dr.rows.find(r => r.field === rd.field);
          if (found) { row[dr.dept] = found.value; rowTotal += found.value; }
          else { row[dr.dept] = null; }
        }
      }
      row.total = rowTotal;
      allRows.push(row);
    }

    // 费用总计行（共有+独有，独有行的 category 含"独有"字样）
    const expTotalRow = { category: '合计', field: '_expense_total', label: '费用总计' };
    let grandExpTotal = 0;
    for (const dr of deptResults) {
      const deptExp = dr.rows.filter(r => r.category === '共有' || r.category === '独有')
        .reduce((s, r) => s + r.value, 0);
      expTotalRow[dr.dept] = deptExp;
      grandExpTotal += deptExp;
    }
    expTotalRow.total = grandExpTotal;
    allRows.push(expTotalRow);

    // 结余行
    const balanceRow = { category: '结余', field: 'balance', label: '结余' };
    const ratioRow = { category: '结余', field: 'balance_ratio', label: '结余率' };
    let grandBalance = 0, grandOutput = 0;
    for (const dr of deptResults) {
      balanceRow[dr.dept] = dr.balance;
      grandBalance += dr.balance;
      const deptOutput = dr.rows.find(r => r.field === 'daily_output')?.value || 0;
      grandOutput += deptOutput;
      ratioRow[dr.dept] = dr.balance_ratio;
    }
    balanceRow.total = grandBalance;
    ratioRow.total = grandOutput > 0 ? grandBalance / grandOutput : 0;
    allRows.push(balanceRow);
    allRows.push(ratioRow);

    res.json({ success: true, data: { mode: 'overview', rows: allRows, departments: ['beer', 'print', 'assembly'] } });

  } else {
    // === 部门明细模式 ===
    const config = DEPT_CONFIG[dept];
    if (!config) return res.status(400).json({ success: false, message: '未知部门: ' + dept });
    const deptConf = balanceConfig.departments[dept];

    // 构建需要查询的字段列表
    const queryFields = ['daily_output', 'supervisor_count', 'worker_count'];
    for (const sf of balanceConfig.sharedFields) { if (sf.expense) queryFields.push(sf.field); }
    for (const uf of deptConf.uniqueFields) { if (uf.expense) queryFields.push(uf.field); }
    queryFields.push('balance');

    const selectClauses = queryFields.map(f => `SUM(COALESCE(r.${f}, 0)) as ${f}`).join(', ');
    const params = [];
    let sql = `SELECT w.name as workshop_name, ${selectClauses}
               FROM ${config.tableName} r LEFT JOIN workshops w ON r.workshop_id = w.id
               WHERE 1=1`;
    sql += buildDateWhere('r.', params);
    sql += ` GROUP BY w.id, w.name, w.sort_order ORDER BY w.sort_order`;

    const dbRows = await getAll(sql, params);
    const workshops = dbRows.map(r => r.workshop_name);

    // 构建行数据
    const rows = [];
    // 产值
    rows.push({ category: '产值', field: 'daily_output', label: '总产值',
      values: Object.fromEntries(dbRows.map(r => [r.workshop_name, parseFloat(r.daily_output) || 0])),
      total: dbRows.reduce((s, r) => s + (parseFloat(r.daily_output) || 0), 0) });
    // 人员
    for (const f of ['supervisor_count', 'worker_count']) {
      const label = f === 'supervisor_count' ? '管工人数' : '员工人数';
      rows.push({ category: '人员', field: f, label,
        values: Object.fromEntries(dbRows.map(r => [r.workshop_name, parseFloat(r[f]) || 0])),
        total: dbRows.reduce((s, r) => s + (parseFloat(r[f]) || 0), 0) });
    }
    // 共有费用
    for (const sf of balanceConfig.sharedFields) {
      if (!sf.expense) continue;
      rows.push({ category: '共有', field: sf.field, label: sf.label.replace('/天', ''),
        values: Object.fromEntries(dbRows.map(r => [r.workshop_name, parseFloat(r[sf.field]) || 0])),
        total: dbRows.reduce((s, r) => s + (parseFloat(r[sf.field]) || 0), 0) });
    }
    // 独有费用
    for (const uf of deptConf.uniqueFields) {
      if (!uf.expense) continue;
      rows.push({ category: '独有', field: uf.field, label: uf.label,
        values: Object.fromEntries(dbRows.map(r => [r.workshop_name, parseFloat(r[uf.field]) || 0])),
        total: dbRows.reduce((s, r) => s + (parseFloat(r[uf.field]) || 0), 0) });
    }

    // 费用总计
    const expenseTotal = {};
    for (const ws of workshops) {
      expenseTotal[ws] = rows.filter(r => r.category === '共有' || r.category === '独有')
        .reduce((s, r) => s + (r.values[ws] || 0), 0);
    }
    expenseTotal.total = Object.values(expenseTotal).reduce((s, v) => s + v, 0);

    // 结余
    const balance = {};
    const balanceRatio = {};
    for (const r of dbRows) {
      balance[r.workshop_name] = parseFloat(r.balance) || 0;
      const wsOutput = parseFloat(r.daily_output) || 0;
      balanceRatio[r.workshop_name] = wsOutput > 0 ? (parseFloat(r.balance) || 0) / wsOutput : 0;
    }
    balance.total = dbRows.reduce((s, r) => s + (parseFloat(r.balance) || 0), 0);
    const totalOut = dbRows.reduce((s, r) => s + (parseFloat(r.daily_output) || 0), 0);
    balanceRatio.total = totalOut > 0 ? balance.total / totalOut : 0;

    res.json({ success: true, data: { mode: 'detail', dept, workshops, rows, expense_total: expenseTotal, balance, balance_ratio: balanceRatio } });
  }
}));
```

- [ ] **Step 2: 验证总览 API**
```bash
curl "http://localhost:6001/api/summary/detail?start_date=2026-03-01&end_date=2026-03-31" -H "Authorization: Bearer <token>"
```
确认返回 mode=overview，rows 包含产值/人员/共有费用/各部门独有费用/费用总计/结余/结余率。

- [ ] **Step 3: 验证部门明细 API**
```bash
curl "http://localhost:6001/api/summary/detail?dept=beer&start_date=2026-03-01&end_date=2026-03-31" -H "Authorization: Bearer <token>"
```
确认返回 mode=detail，workshops 列表正确，rows 包含所有费用字段。

- [ ] **Step 4: Commit**
```bash
git add routes/summary.js
git commit -m "feat: 添加 /api/summary/detail 汇总表数据接口"
```

---

## Task 4: 前端 — 导航菜单改造

**Files:**
- Modify: `public/js/app.js`（菜单模板区域约 2483-2513 行，BREADCRUMB_MAP 约 2456-2464 行）

- [ ] **Step 1: 修改 BREADCRUMB_MAP**

找到 `BREADCRUMB_MAP` 对象，修改 `/summary` 的面包屑：
```javascript
// 旧：'/summary': '三工结余 / 三工汇总',
// 新：
'/summary': '结余收支汇总 / 大车间汇总',
```

- [ ] **Step 2: 修改左侧导航模板**

找到三工汇总的菜单项（`@click="navigate('/summary')"` 那行），将其替换为父子菜单结构：

将原来的：
```html
<a class="menu-item" :class="{ active: currentRoute === '/summary' }" @click="navigate('/summary')">
  <span class="icon">📋</span>
  <span v-show="!sidebarCollapsed">三工汇总</span>
</a>
```

替换为：
```html
<div class="menu-group">
  <a class="menu-item" :class="{ active: currentRoute === '/summary' }" @click="summaryExpanded = !summaryExpanded">
    <span class="icon">📊</span>
    <span v-show="!sidebarCollapsed">结余收支汇总</span>
    <span v-show="!sidebarCollapsed" style="margin-left:auto; font-size:10px;">{{ summaryExpanded ? '▼' : '▶' }}</span>
  </a>
  <template v-if="summaryExpanded && !sidebarCollapsed">
    <a class="menu-item sub-item" :class="{ active: currentRoute === '/summary' }" @click="navigate('/summary')">
      <span class="icon">📋</span>
      大车间汇总
    </a>
  </template>
</div>
```

- [ ] **Step 3: 在主应用 data 中添加 summaryExpanded 状态**

找到主应用的 `data()` 函数，添加：
```javascript
summaryExpanded: true,  // 默认展开
```

- [ ] **Step 4: 验证**

刷新页面，确认：
- 左侧导航显示"结余收支汇总"父菜单，点击可折叠/展开
- 展开后显示"大车间汇总"子菜单
- 点击"大车间汇总"路由到 `/summary`，面包屑显示"结余收支汇总 / 大车间汇总"

- [ ] **Step 5: Commit**
```bash
git add public/js/app.js
git commit -m "feat: 导航菜单改造 — 三工汇总改为结余收支汇总>大车间汇总"
```

---

## Task 5: 前端 — 看板样式

**Files:**
- Modify: `public/css/theme.css`

- [ ] **Step 1: 添加看板样式**

在 `theme.css` 文件末尾（登录页样式之前）添加：

```css
/* ===== 大车间汇总看板 ===== */
.dashboard-cards { display: flex; gap: 12px; margin-bottom: 16px; }
.kpi-card {
  flex: 1; background: #fff; border-radius: 8px; padding: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08); border-top: 3px solid #7F41C0;
}
.kpi-card .kpi-label { font-size: 12px; color: #999; margin-bottom: 4px; }
.kpi-card .kpi-value { font-size: 24px; font-weight: 700; color: #333; }
.kpi-card.card-expense { border-top-color: #E88EA0; }
.kpi-card.card-balance { border-top-color: #57B894; }
.kpi-card.card-ratio { border-top-color: #5B9BD5; }

.chart-row { display: flex; gap: 12px; margin-bottom: 16px; }
.chart-box {
  background: #fff; border-radius: 8px; padding: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08); flex: 1;
}
.chart-box.w60 { flex: 6; }
.chart-box.w40 { flex: 4; }
.chart-title {
  font-size: 14px; font-weight: 600; color: #333;
  margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px;
}

/* 汇总表样式 */
.summary-tab-bar { display: flex; gap: 0; margin-bottom: 0; }
.summary-tab-btn {
  padding: 8px 20px; background: #e0e0e0; border: none; cursor: pointer;
  font-size: 13px; color: #666; transition: all 0.2s;
}
.summary-tab-btn.active { background: #7F41C0; color: #fff; font-weight: 600; }
.summary-tab-btn:first-child { border-radius: 6px 0 0 0; }
.summary-tab-btn:last-child { border-radius: 0 6px 0 0; }
.summary-tab-btn:hover:not(.active) { background: #d0d0d0; }
```

- [ ] **Step 2: Commit**
```bash
git add public/css/theme.css
git commit -m "feat: 添加大车间汇总看板和汇总表CSS样式"
```

---

## Task 6: 前端 — API 封装 + SummaryPage 组件重构（可视化看板）

**Files:**
- Modify: `public/js/api.js`（添加新 API 封装函数）
- Modify: `public/js/app.js`（SummaryPage 组件，约 761-950 行）

此 Task 是最大的改动。将现有 SummaryPage 完全重写为双视图模式。

- [ ] **Step 0: 在 api.js 中添加 API 封装函数**

在 `api.js` 的 API 对象中添加：
```javascript
getSummaryDashboard: (params) => API.get('/summary/dashboard', params),
getSummaryDetail: (params) => API.get('/summary/detail', params),
```

- [ ] **Step 1: 重写 SummaryPage 模板和 data**

找到 `const SummaryPage = {` 开始，到组件结束 `};`，整体替换。由于代码量大，分段实现。先写模板骨架和 data：

模板结构：
```
顶部Tab切换（可视化看板 | 汇总表）
├─ 可视化看板 v-if="mainTab === 'dashboard'"
│  ├─ 筛选栏（年份+月份）
│  ├─ 4个指标卡片
│  ├─ 图表行（柱状图60% + 折线图40%）
│  └─ 堆叠图（全宽）
└─ 汇总表 v-else
   ├─ 筛选栏（月份+导出）
   ├─ 子Tab（总览/啤机/印喷/装配）
   └─ 表格内容
```

data 需包含：`mainTab`（'dashboard'/'table'）、`dashYear`、`dashMonth`、`dashData`（API返回的看板数据）、`tableMonth`、`tableTab`（'overview'/'beer'/'print'/'assembly'）、`tableData`（表格数据）、`loading`。

- [ ] **Step 2: 实现看板数据加载和 ECharts 初始化**

methods 中添加：
- `loadDashboard()`：调用 `/api/summary/dashboard`
- `initCharts()`：在 `$nextTick` 中用 `echarts.init()` 初始化三个图表
- `updateCharts()`：根据 `dashData` 更新图表数据
- `handleResize()`：调用所有图表实例的 `resize()`

watch 监听 `dashYear` 和 `dashMonth` 变化时调用 `loadDashboard()`。

mounted 中监听 sidebar collapse 事件（通过 window resize 或 MutationObserver）。

beforeUnmount 中销毁 ECharts 实例。

- [ ] **Step 3: 实现看板模板**

包含：年份/月份选择器、4个 kpi-card、3个 chart-box（div 容器，ECharts 渲染到这里）。

ECharts 配置（三个图表的 option 骨架）：

**柱状图（部门对比）：**
```javascript
{
  color: ['#7F41C0', '#E88EA0', '#57B894'],
  tooltip: { trigger: 'axis', valueFormatter: v => '¥' + (v/10000).toFixed(1) + '万' },
  legend: { data: ['产值', '费用', '结余'] },
  xAxis: { type: 'category', data: ['啤机部', '印喷部', '装配部'] },
  yAxis: { type: 'value', axisLabel: { formatter: v => (v/10000) + '万' } },
  series: [
    { name: '产值', type: 'bar', data: [/*from dashData.departments*/] },
    { name: '费用', type: 'bar', data: [] },
    { name: '结余', type: 'bar', data: [] }
  ]
}
```

**折线图（月度结余率趋势）：**
```javascript
{
  color: ['#7F41C0', '#5B9BD5', '#57B894'],
  tooltip: { trigger: 'axis', valueFormatter: v => (v*100).toFixed(1) + '%' },
  legend: { data: ['啤机部', '印喷部', '装配部'] },
  xAxis: { type: 'category', data: ['1月','2月',...'12月'] },
  yAxis: { type: 'value', axisLabel: { formatter: v => (v*100) + '%' } },
  series: [
    { name: '啤机部', type: 'line', smooth: true, data: [/*from monthly_trend beer_ratio*/] },
    { name: '印喷部', type: 'line', smooth: true, data: [] },
    { name: '装配部', type: 'line', smooth: true, data: [] }
  ]
}
```

**堆叠图（费用构成）：**
```javascript
{
  color: ['#7F41C0', '#9B6DC6', '#5B9BD5', '#57B894', '#E88EA0', '#FFB74D'],
  tooltip: { trigger: 'axis', valueFormatter: v => '¥' + (v/10000).toFixed(1) + '万' },
  legend: { data: ['工资', '房租水电', '社保税收', '维修物料', '加工模费', '其他'] },
  xAxis: { type: 'category', data: ['1月','2月',...'12月'] },
  yAxis: { type: 'value', axisLabel: { formatter: v => (v/10000) + '万' } },
  series: [
    { name: '工资', type: 'bar', stack: 'expense', data: [/*from expense_breakdown.wage*/] },
    { name: '房租水电', type: 'bar', stack: 'expense', data: [] },
    { name: '社保税收', type: 'bar', stack: 'expense', data: [] },
    { name: '维修物料', type: 'bar', stack: 'expense', data: [] },
    { name: '加工模费', type: 'bar', stack: 'expense', data: [] },
    { name: '其他', type: 'bar', stack: 'expense', data: [] }
  ]
}
```

- [ ] **Step 4: 验证看板**

刷新页面，切换到"可视化看板"Tab：
- 4个卡片显示数据
- 柱状图显示三部门对比
- 折线图显示月度趋势
- 堆叠图显示费用构成
- 切换年/月，数据和图表更新

- [ ] **Step 5: Commit**
```bash
git add public/js/app.js
git commit -m "feat: SummaryPage 可视化看板 — ECharts 图表+指标卡片"
```

---

## Task 7: 前端 — SummaryPage 汇总表视图

**Files:**
- Modify: `public/js/app.js`（SummaryPage 组件，在 Task 6 基础上继续）

- [ ] **Step 1: 实现汇总表数据加载**

methods 中添加：
- `loadTableData()`：根据 `tableTab` 调用 `/api/summary/detail`（总览不传 dept，部门传 dept）
- `formatTableAmount(val)`：格式化金额（复用已有的 `formatAmount`）

watch 监听 `tableTab` 和 `tableMonth` 变化时调用 `loadTableData()`。

- [ ] **Step 2: 实现总览Tab模板**

使用原生 `<table>` 渲染（因为行结构复杂，包含 rowspan 和条件样式，el-table 不合适）。

模板逻辑：遍历 `tableData.rows`，根据 `row.category` 渲染分类颜色条，根据 `row[dept]` 是否为 null 显示"—"。

- [ ] **Step 3: 实现部门明细Tab模板**

同样使用原生 `<table>`。列从 `tableData.workshops` 动态生成，行从 `tableData.rows` 渲染。末尾添加费用总计、结余、结余率行。

- [ ] **Step 4: 实现导出功能**

methods 中添加 `handleTableExport()`：
- 总览模式：将 rows 转为 Excel 行，列头为 [分类, 项目, 啤机部, 印喷部, 装配部, 合计]
- 部门模式：列头为 [分类, 项目, ...workshops, 合计]

使用 SheetJS（已有 CDN）生成并下载。

- [ ] **Step 5: 验证汇总表**

刷新页面，切换到"汇总表"Tab：
- 总览显示所有费用项（共有+各部门独有），格式与 mockup 一致
- 切换到啤机/印喷/装配Tab，显示按车间分列的完整明细
- 导出 Excel 功能正常

- [ ] **Step 6: Commit**
```bash
git add public/js/app.js
git commit -m "feat: SummaryPage 汇总表 — 总览+部门明细+Excel导出"
```

---

## Task 8: 集成验证与收尾

**Files:**
- 所有已修改文件

- [ ] **Step 1: 端到端测试**

完整测试流程：
1. 登录系统
2. 点击"结余收支汇总 > 大车间汇总"
3. 看板视图：切换年/月，验证卡片和图表数据更新
4. 汇总表视图：检查总览所有费用项显示正确，"—"显示在正确位置
5. 切换各部门Tab，验证车间列和费用项完整
6. 导出 Excel 验证
7. 侧边栏折叠/展开，图表自动 resize
8. 无数据月份的空状态显示

- [ ] **Step 2: 修复发现的问题**

根据测试结果修复 bug。

- [ ] **Step 3: Final Commit**
```bash
git add -A
git commit -m "feat: 大车间汇总模块完成 — 可视化看板+汇总表"
```
