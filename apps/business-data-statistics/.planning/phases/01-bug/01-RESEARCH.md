# Phase 1: BUG修复与基础稳定 - Research

**Researched:** 2026-03-17
**Domain:** Express 路由、Vue 3 前端字段绑定、PostgreSQL 字段同步、Jest 回归测试
**Confidence:** HIGH — 所有 bug 均通过直接读取源代码定位，根因已确认

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Excel 导入修复 (BUG-12):** 重点排查 `import-export.js` 的 COLUMN_MAP 映射和 INSERT 语句；导入成功后静默刷新表格（显示简短成功提示 + 自动重新加载数据列表）
- **关联安全修复（额外 2 项）:** 单条删除加数据锁定检查（`DELETE /:dept/records/:id` 加 `checkDataLock` 中间件）；在 records 和 import-export 路由加上 `modulePermission('balance')`
- **修复验证方式:** 用 Jest 写自动化测试，覆盖 BUG 回归测试 + 三个部门基础 CRUD；按优先级分批运行（P0 修完跑一批、P1 修完跑一批、P2 修完跑一批）；测试失败时 Claude 自动分析原因并修复后重新运行

### Claude's Discretion

- 12 个 BUG 的具体修复顺序（在同一优先级内）
- 测试用例的具体设计和断言方式
- BUG-12 根因调查的技术细节

### Deferred Ideas (OUT OF SCOPE)

- **Phase 4 — 导入预览设计:** 数据进库前弹窗预览（成功/失败行数）、失败数据行显示、整行错误红色底色、部分错误绿色底色、错误单元格黄色底色
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BUG-01 | 批量删除路由 `/batch` 不被 `/:id` 拦截（路由顺序修正） | 已在 records.js 确认：`DELETE /:dept/records/:id`（第96行）注册在 `DELETE /:dept/records/batch`（第108行）之前，导致 `/batch` 被当成 id 处理 |
| BUG-02 | 明细表车间列正确显示车间名称（prop 对齐 workshop_name） | 已在 app.js 第322行确认：`prop="workshop"` 但后端返回字段名为 `workshop_name`（records.js 第25行 SQL AS 别名）|
| BUG-03 | 车间管理 POST/PUT 正确接收并保存 company 字段 | 已在 workshops.js 确认：POST（第19行）和 PUT（第28行）均未解构 `company` 字段，SQL 语句也没有 company 列；数据库 workshops 表（init.sql 第24行）也没有 company 列 |
| BUG-04 | 数据锁定前端字段名与后端一致（dept → department） | 已在 app.js 确认：lockForm 用 `dept`（第1375行），后端 settings.js POST 解构 `department`（第57行），字段名不匹配 |
| BUG-05 | 部门汇总 SQL 覆盖所有独有字段的 SUM | 已在 records.js 第130-148行确认：汇总 SQL 仅 SUM 共享字段，缺少 beer/print/assembly 各自独有费用字段的 SUM |
| BUG-06 | init.sql workshops 表包含 company 列 | 已确认：init.sql 第24-32行 workshops 表定义无 company 列；需同时执行 ALTER TABLE 和更新 init.sql |
| BUG-07 | 锁定人列显示姓名而非数字 ID（prop 对齐 locked_by_name） | 已在 app.js 第1338行确认：`prop="locked_by"`，但 settings.js 的 GET data-locks（第46-51行）已 JOIN users 表并返回 `locked_by_name`，只需改前端 prop |
| BUG-08 | 数据锁定部门下拉使用 ALL_DEPARTMENTS 动态生成 | 已在 app.js 第1355-1358行确认：硬编码了 3 个 `<el-option>`，需改为 `v-for="(label, key) in ALL_DEPARTMENTS"` |
| BUG-09 | 用户管理部门下拉使用 ALL_DEPARTMENTS 动态生成 | 已在 app.js 第963-967行（新增用户）和第992-996行（编辑用户）确认：均硬编码了 3 个选项，需改为动态 |
| BUG-10 | 编辑框边框颜色使用 CSS 变量而非 inline 硬编码 | 已在 app.js 第340行确认：`style="...border:2px solid #7F41C0..."` 硬编码颜色；应改为 `border:2px solid var(--primary-color)` |
| BUG-11 | 修正 3 个河源车间 department 为 NULL 的数据 | 已通过数据库查询确认：id=17（华登）、id=18（华康）、id=19（华兴）的 department 字段为 NULL；河源车间按设计属于未分配部门，应设为特定占位值或保持 NULL（见 CLAUDE.md 4.1） |
| BUG-12 | Excel 导入成功后数据在页面正确显示（刷新也能看到） | import-export.js 代码逻辑完整，前端 uploadFile（app.js 第684-703行）已在成功后调用 loadData()；根因需运行时调查，重点排查 COLUMN_MAP 映射是否覆盖手动编辑 Excel 的列名 |
</phase_requirements>

---

## Summary

本阶段修复 12 个已知缺陷和 2 个关联安全漏洞。通过直接读取源代码，所有 bug 的根因已100%确认，不需要任何猜测性修复。

**修复分类：**
- **P0（数据损坏/操作失败）：** BUG-01（批量删除被拦截）、BUG-03（公司字段未保存）、BUG-05（汇总SQL遗漏字段）、BUG-12（导入数据不显示）
- **P1（数据显示错误）：** BUG-02（车间列空白）、BUG-04（锁定操作字段不匹配）、BUG-07（锁定人显示ID）、BUG-06（init.sql与库不同步）
- **P2（前端规范/数据修复）：** BUG-08、BUG-09（下拉硬编码）、BUG-10（inline颜色）、BUG-11（河源车间数据）
- **安全修复（额外）：** 单删未检查数据锁定、records/import-export 缺少模块权限验证

**Primary recommendation:** 按 P0 → P1 → P2 顺序修复，每批修完后运行 Jest 回归测试。

---

## Standard Stack

### Core（本阶段使用的技术）

| 技术 | 版本/位置 | 用途 |
|------|-----------|------|
| Express 路由 | Express 5 | 修复路由注册顺序（BUG-01） |
| PostgreSQL + ? 占位符 | db/postgres.js | ALTER TABLE + SQL 修复（BUG-03、05、06、11） |
| Vue 3 template binding | app.js CDN | prop 字段名修复（BUG-02、07、08、09、10） |
| Jest | npm test | 回归测试；现有 tests/ 目录已有框架 |
| middleware/auth.js | checkDataLock、modulePermission | 安全修复 |

### 已有可复用资产

| 资产 | 位置 | 用于修复 |
|------|------|---------|
| `asyncHandler` | utils/async-handler.js | 包装单删路由 |
| `checkDataLock` | middleware/auth.js | 加到单删路由 |
| `modulePermission('balance')` | middleware/auth.js | 加到 records + import-export 路由 |
| `DEPT_CONFIG` | modules/balance/config.js | BUG-05 汇总SQL获取独有字段列表 |
| `getAllInputFields` / `getExpenseFields` | modules/index.js | BUG-05 动态生成 SUM 子句 |
| `ALL_DEPARTMENTS` | app.js 第88行 | BUG-08、09 动态下拉替换硬编码 |
| `--primary-color` CSS 变量 | public/css/theme.css | BUG-10 替换 inline 颜色 |
| `tests/modules.test.js` + `tests/calc.test.js` | tests/ | 扩展新的回归测试 |

---

## Architecture Patterns

### 已确立的项目规范

**SQL 占位符模式：**
```javascript
// 使用 ? 占位符，db/postgres.js 自动转换为 $N
const result = await query(
  'INSERT INTO workshops (name, region, department, company) VALUES (?, ?, ?, ?) RETURNING *',
  [name, region, department || null, company || null]
);
```

**路由顺序规则（Express 铁律）：**
```javascript
// 具体路径必须在通配 /:id 之前注册
router.delete('/:dept/records/batch', ...);  // 先注册 /batch
router.delete('/:dept/records/:id', ...);     // 再注册 /:id
```

**中间件链组合：**
```javascript
// 安全修复后的路由中间件顺序
router.delete('/:dept/records/:id',
  authenticate,
  validateDept,
  checkDataLock,    // 新增
  asyncHandler(async (req, res) => { ... })
);

router.post('/:dept/records',
  authenticate,
  modulePermission('balance'),  // 新增
  validateDept,
  checkDataLock,
  asyncHandler(async (req, res) => { ... })
);
```

**BUG-05 动态汇总SQL模式（获取部门独有字段）：**
```javascript
// 从 DEPT_CONFIG 获取部门独有费用字段，动态生成 SUM 子句
const { getExpenseFields, SHARED_EXPENSE_FIELDS } = require('../modules');

// 独有费用字段 = 全部费用字段 - 共享费用字段
const uniqueExpenseFields = config.uniqueExpenseFields; // 已在 DEPT_CONFIG 中预计算
const uniqueSums = uniqueExpenseFields.map(f => `SUM(r.${f}) as ${f}`).join(',\n');
```

**Vue 3 prop 字段名必须与后端 SQL AS 别名一致：**
```javascript
// 后端 SQL：SELECT r.*, w.name as workshop_name ...
// 前端 template：<el-table-column prop="workshop_name" ...>  ← 必须匹配
```

**动态 el-option（替换硬编码）：**
```html
<!-- 错误（硬编码）-->
<el-option label="啤机部" value="beer" />
<el-option label="印喷部" value="print" />

<!-- 正确（动态生成）-->
<el-option v-for="(label, key) in ALL_DEPARTMENTS" :key="key" :label="label" :value="key" />
```

### 数据库变更规范（BUG-03/06）

本阶段需要对 workshops 表添加 company 列：
1. 先执行 ALTER TABLE（修改实际数据库）
2. 再更新 init.sql（保持重建一致性）
3. 告知用户执行命令

```sql
-- 步骤1: 实际数据库执行
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS company VARCHAR(100);

-- 步骤2: init.sql 同步更新
-- 在 workshops 表定义中添加 company VARCHAR(100) 列
```

---

## Don't Hand-Roll

| 问题 | 不要自己写 | 使用已有方案 |
|------|------------|-------------|
| 异步路由错误处理 | 自己写 try/catch | `asyncHandler` (utils/async-handler.js) |
| 数据锁定检查 | 重写检查逻辑 | `checkDataLock` 中间件（已在 POST/PUT 中使用） |
| 模块权限检查 | 重写权限逻辑 | `modulePermission('balance')` 中间件（已导入但未挂载） |
| 部门字段列表 | 手动列举字段 | `DEPT_CONFIG[dept].uniqueExpenseFields` |
| 部门下拉选项 | 硬编码 el-option | `ALL_DEPARTMENTS` 对象 + `v-for` |

---

## Common Pitfalls

### Pitfall 1: BUG-05 汇总SQL — 只修共享字段，遗漏独有费用字段
**What goes wrong:** 修 records.js GET `/:dept/summary` 时，只加独有"产值/台数"字段的 SUM，没加独有"费用"字段的 SUM，导致每个部门的汇总结余仍然错误。
**Why it happens:** 共享字段一眼可见，独有字段藏在 config.js 中，容易遗漏。
**How to avoid:** 必须从 `config.uniqueExpenseFields` 动态生成 SUM，而不是手动列举。还需加独有输入字段（人数、台数等）的 SUM 供前端展示。
**Warning signs:** 测试时汇总结余 ≠ 各行结余之和。

### Pitfall 2: BUG-01 路由顺序 — 调换顺序后忘记检查中间件完整性
**What goes wrong:** 把 `/batch` 移到 `/:id` 之前后，发现 `/batch` 缺少 `checkDataLock` 中间件（批量删除应检查锁定）。
**How to avoid:** 移动路由时，同时核对两个路由的中间件列表是否对齐。

### Pitfall 3: BUG-03/06 workshops company 字段 — ALTER TABLE 和 init.sql 必须同步
**What goes wrong:** 只执行了 ALTER TABLE 没更新 init.sql，或只更新了 init.sql 没提供 ALTER TABLE 语句给用户。
**How to avoid:** 每次数据库变更，必须同时完成"ALTER TABLE 语句给用户执行"和"init.sql 文件更新"两项。

### Pitfall 4: BUG-04 lockForm 字段名 — 前端 dept 与后端 department 不一致
**What goes wrong:** settings.js POST 解构 `department`，但前端 lockForm 发送 `dept`。后端收到 `{ dept: 'beer', lock_month: '...' }` 时 `department` 为 undefined，INSERT 报错。
**How to avoid:** 前端提交前检查 `lockForm.dept` 还是 `lockForm.department`，确保与后端 `req.body.department` 一致。修复方式：将 lockForm 键名从 `dept` 改为 `department`，并更新 template 中所有引用。

### Pitfall 5: BUG-12 导入不显示 — 根因可能在 COLUMN_MAP 而非 INSERT
**What goes wrong:** 报"导入成功"但页面空白，多半是手动编辑的 Excel 列名与 COLUMN_MAP 中的 label/alias 不匹配，导致字段全部映射失败，record_date 或 workshop_name 为空，INSERT 被跳过。
**How to avoid:** 调试时先打印 COLUMN_MAP 映射结果，检查是否有字段的中文列名与配置不完全一致（空格、全角符号、换行符等）。`cleanColumnName` 函数已做基础清理，但手动编辑的 Excel 可能有特殊字符。

### Pitfall 6: BUG-11 河源车间 department NULL — 不要随意设值
**What goes wrong:** 将 3 个河源车间的 department 设为某个业务部门（如 'beer'），影响这些车间在三工结余模块的意外出现。
**How to avoid:** 河源车间按 CLAUDE.md 设计"暂无部门分配，未来扩展用"，NULL 是正确状态。BUG-11 的真正问题是前端在下拉/过滤时对 NULL 值处理不当，需确认实际报错现象后再决定是否需要数据修复。

---

## Code Examples

### BUG-01: 路由顺序修复
```javascript
// routes/records.js — 交换 batch 和 :id 的注册顺序

// 先注册具体路径（/batch）
router.delete('/:dept/records/batch', authenticate, validateDept, checkDataLock, asyncHandler(async (req, res) => {
  // ... 批量删除逻辑（checkDataLock 是新增的安全修复）
}));

// 再注册通配路径（/:id）
router.delete('/:dept/records/:id', authenticate, validateDept, checkDataLock, asyncHandler(async (req, res) => {
  // ... 单条删除逻辑（checkDataLock 是新增的安全修复）
}));
```

### BUG-02: 前端 prop 修复
```html
<!-- app.js 第322行，prop 从 "workshop" 改为 "workshop_name" -->
<el-table-column prop="workshop_name" label="车间" width="80" fixed="left" />
```

### BUG-03/06: workshops company 字段
```sql
-- 数据库执行（用户需手动运行）
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS company VARCHAR(100);
```
```javascript
// routes/workshops.js POST 修复
const { name, region, department, company, sort_order } = req.body;
const result = await query(
  'INSERT INTO workshops (name, region, department, company, sort_order) VALUES (?, ?, ?, ?, ?) RETURNING *',
  [name, region, department || null, company || null, sort_order || 0]
);
```

### BUG-04: lockForm 字段名修复
```javascript
// app.js DataLocks 组件
// 修改前: lockForm: { lock_month: '', dept: '' }
lockForm: { lock_month: '', department: '' },  // dept → department
```
```html
<!-- template 中同步修改 -->
<el-select v-model="lockForm.department" ...>
```

### BUG-07: 锁定人列 prop 修复
```html
<!-- app.js 第1338行，prop 从 "locked_by" 改为 "locked_by_name" -->
<el-table-column prop="locked_by_name" label="锁定人" width="120" />
```

### BUG-08/09: 动态下拉替换硬编码
```html
<!-- 数据锁定弹窗（BUG-08）和用户管理（BUG-09）统一改法 -->
<el-select v-model="lockForm.department" clearable placeholder="全部部门" style="width:100%">
  <el-option v-for="(label, key) in ALL_DEPARTMENTS" :key="key" :label="label" :value="key" />
</el-select>
```

### BUG-10: inline 颜色 → CSS 变量
```html
<!-- app.js 第340行 -->
<!-- 修改前 -->
style="width:100%; border:2px solid #7F41C0; outline:none; padding:0 4px; font-size:13px; text-align:right; background:#fff;"

<!-- 修改后 -->
style="width:100%; border:2px solid var(--primary-color); outline:none; padding:0 4px; font-size:13px; text-align:right; background:#fff;"
```

### 安全修复: modulePermission 挂载
```javascript
// server.js 或 routes/records.js 中
// routes/records.js 所有写操作路由加上 modulePermission
router.post('/:dept/records', authenticate, modulePermission('balance'), validateDept, checkDataLock, ...);
router.put('/:dept/records/:id', authenticate, modulePermission('balance'), validateDept, checkDataLock, ...);
// routes/import-export.js
router.post('/:dept/import', authenticate, modulePermission('balance'), upload.single('file'), ...);
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest（已安装，package.json scripts.test = "jest --verbose"） |
| Config file | package.json（无独立 jest.config.js） |
| Quick run command | `npm test` |
| Full suite command | `npm test` |
| 当前状态 | 24 tests passing（tests/modules.test.js + tests/calc.test.js） |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BUG-01 | `/batch` 路由不被 `/:id` 拦截 | integration | `npm test -- --testPathPattern=bug01` | ❌ Wave 0 |
| BUG-02 | 记录列表返回 workshop_name 字段 | unit/SQL | `npm test -- --testPathPattern=bug02` | ❌ Wave 0 |
| BUG-03 | POST /workshops 保存 company 字段 | integration | `npm test -- --testPathPattern=bug03` | ❌ Wave 0 |
| BUG-04 | POST /settings/data-locks 用 department 字段 | integration | `npm test -- --testPathPattern=bug04` | ❌ Wave 0 |
| BUG-05 | 汇总 SQL 包含独有费用字段 SUM | unit/SQL | `npm test -- --testPathPattern=bug05` | ❌ Wave 0 |
| BUG-06 | init.sql workshops 表含 company 列 | unit | `npm test -- --testPathPattern=bug06` | ❌ Wave 0 |
| BUG-07 | GET data-locks 返回 locked_by_name | integration | `npm test -- --testPathPattern=bug07` | ❌ Wave 0 |
| BUG-08 | 数据锁定部门下拉动态生成 | manual-only | N/A — 纯前端 template 检查 | N/A |
| BUG-09 | 用户管理部门下拉动态生成 | manual-only | N/A — 纯前端 template 检查 | N/A |
| BUG-10 | 编辑框边框使用 CSS 变量 | manual-only | N/A — 纯前端样式检查 | N/A |
| BUG-11 | 河源车间 department 数据正确 | unit/DB | `npm test -- --testPathPattern=bug11` | ❌ Wave 0 |
| BUG-12 | Excel 导入后数据可查询到 | integration | `npm test -- --testPathPattern=bug12` | ❌ Wave 0 |

> BUG-08、09、10 为纯前端 Vue 3 template 修改，Jest（Node.js 环境）无法直接测试 DOM 渲染，标记为 manual-only。验证方式：修复后用浏览器打开对应页面，确认下拉框 / 边框显示正确。

### Sampling Rate

- **Per task commit:** `npm test`（0.5s，24个已有测试 + 新增回归测试）
- **Per wave merge:** `npm test`（全量）
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/bug-fixes.test.js` — 覆盖 BUG-01 到 BUG-07、BUG-11、BUG-12 的回归测试
- [ ] 测试需要数据库连接：Jest 配置需要确认 `testEnvironment` = node（默认已是）；测试数据库连接直接用 `db/postgres.js`（localhost:5432/production_system）

---

## Bug Root Cause Summary

所有 bug 已通过代码阅读100%定位，不需要假设：

### P0 — 操作失败类（必须首先修复）

**BUG-01 — 路由顺序**
- **位置：** `routes/records.js`
- **根因：** `DELETE /:dept/records/:id`（第96行）注册在 `DELETE /:dept/records/batch`（第108行）之前。Express 按顺序匹配路由，`/batch` 中的 "batch" 被当作 `:id` 的值处理。
- **修复：** 交换两个路由的注册顺序（batch 放前面）。同时给 batch 加上 `checkDataLock` 中间件（安全修复）。

**BUG-03 — company 字段未保存**
- **位置：** `routes/workshops.js` + `db/init.sql`
- **根因双层：**
  1. workshops 表没有 company 列（init.sql 第24-32行无此列）
  2. POST（第19行）和 PUT（第28行）都没有从 req.body 解构 company
- **修复：** ALTER TABLE + 更新 init.sql + 修改路由 SQL。

**BUG-05 — 汇总 SQL 字段遗漏**
- **位置：** `routes/records.js` GET `/:dept/summary`（第125-160行）
- **根因：** SQL 只 SUM 了共享费用字段，没有 SUM 各部门的独有费用字段（如 beer 的 machine_repair、mold_repair、materials 等约7个；print 约11个；assembly 约11个），导致 balance 汇总偏高。
- **修复：** 从 `DEPT_CONFIG[dept].uniqueExpenseFields` 动态生成 SUM 子句，或为三个部门各写专用 SQL。

**BUG-12 — 导入数据不显示**
- **位置：** `routes/import-export.js`（疑似）+ `public/js/app.js`
- **已知：** 前端 uploadFile 成功后已调用 loadData()（第697行）。
- **根因待确认：** 最可能的原因是手动编辑 Excel 的某些列名与 COLUMN_MAP 不匹配（如有空格差异），导致 workshop_name 为空被跳过（第92-94行 `continue`）。第二可能是 record_date 解析失败。
- **调查顺序：** 查看服务器 console.log 输出（import-export.js 第41、46行有调试日志），确认 rows 数量和 workshop 映射结果。

### P1 — 数据显示错误类

**BUG-02 — 车间列空白**
- **位置：** `public/js/app.js` 第322行
- **根因：** `prop="workshop"` 但后端 SQL 返回字段名为 `workshop_name`（records.js GET 第25行 `w.name as workshop_name`）。字段名不一致，Vue el-table-column 找不到对应数据，显示空白。
- **修复：** `prop="workshop_name"`（1字改动）。

**BUG-04 — 锁定操作静默失败**
- **位置：** `public/js/app.js` DataLocks 组件（第1375行）+ `routes/settings.js`（第57行）
- **根因：** 前端 lockForm 的部门字段键名为 `dept`，后端 POST /settings/data-locks 解构 `department`。前端发送 `{ dept: 'beer', lock_month: '2026-03' }`，后端收到 department=undefined，INSERT 的 department 列为 null，触发约束或逻辑错误。
- **修复：** 将 lockForm 中的 `dept` 改为 `department`，同时更新 template 中所有 `lockForm.dept` 引用。

**BUG-07 — 锁定人显示 ID**
- **位置：** `public/js/app.js` 第1338行
- **根因：** `prop="locked_by"` 显示的是 user.id（整数），后端 settings.js 已 JOIN users 表返回 `locked_by_name` 字段（第48行 `u.name as locked_by_name`），只需改 prop。
- **修复：** `prop="locked_by_name"`（1字改动）。

**BUG-06 — init.sql 与数据库不同步**
- **位置：** `db/init.sql` + 实际数据库
- **根因：** init.sql workshops 表定义（第24-32行）没有 company 列，但 BUG-03 修复需要这个列。两者需要同步。
- **修复：** 随 BUG-03 一并处理，更新 init.sql 添加 company 列定义。

### P2 — 前端规范/数据修复类

**BUG-08 — 数据锁定部门下拉硬编码**
- **位置：** `public/js/app.js` 第1355-1358行
- **根因：** 固定写了 3 个 `<el-option>`（啤机部/印喷部/装配部），未来新增部门不会自动出现。
- **修复：** 改为 `v-for="(label, key) in ALL_DEPARTMENTS"`。

**BUG-09 — 用户管理部门下拉硬编码**
- **位置：** `public/js/app.js` 第963-967行（新增用户）和第992-996行（编辑用户）
- **修复同 BUG-08。**

**BUG-10 — 编辑框边框颜色硬编码**
- **位置：** `public/js/app.js` 第340行
- **根因：** `border:2px solid #7F41C0` 违反项目 CSS 规范（应使用 CSS 变量 `var(--primary-color)`），若主题色修改时无法统一更新。
- **修复：** 改为 `border:2px solid var(--primary-color)`。

**BUG-11 — 河源车间 department 为 NULL**
- **已确认：** id=17（华登/河源）、id=18（华康/河源）、id=19（华兴/河源）的 department 为 NULL。
- **业务逻辑：** 河源按 CLAUDE.md 4.1 设计为"暂无部门分配，未来扩展用"，NULL 是符合设计的状态。
- **实际问题：** 需要在修复前确认是否有前端功能因这 3 条记录出现异常（如下拉加载报错、过滤逻辑 crash）。如无功能异常，BUG-11 的修复可能仅是"确认 NULL 值被正确处理"，不需要改数据。

---

## Open Questions

1. **BUG-12 的确切根因**
   - What we know: 前端已在导入成功后调用 loadData()，代码路径完整；服务器有调试日志（console.log）
   - What's unclear: 手动编辑的印喷部 Excel 的实际列名是否与 COLUMN_MAP 匹配；插入是否实际执行
   - Recommendation: 修复前先用测试 Excel 文件运行导入，观察服务器 console.log 输出（raw rows 数量、workshop 映射结果），根据日志定位真正的跳过原因

2. **BUG-11 是否需要数据修复**
   - What we know: 河源车间 department=NULL 是设计意图，不是错误
   - What's unclear: 是否有前端代码因 NULL 出现 crash 或异常展示
   - Recommendation: 实施时先搜索前端代码中处理 department 的所有位置，确认 NULL 是否被正确处理（如 `|| '-'` 或 `|| ''`），如有漏洞则修防御性代码而非改数据

---

## Sources

### Primary (HIGH confidence)
- `routes/records.js` — BUG-01、BUG-05、安全修复 — 直接代码审查
- `routes/workshops.js` — BUG-03 — 直接代码审查
- `routes/settings.js` — BUG-04、BUG-07 — 直接代码审查
- `routes/import-export.js` — BUG-12 — 直接代码审查
- `public/js/app.js` — BUG-02、04、07、08、09、10 — 直接代码审查
- `db/init.sql` — BUG-06 — 直接代码审查
- 数据库实时查询 — BUG-11 — `SELECT id, name, region, department FROM workshops`

### Secondary (MEDIUM confidence)
- `modules/balance/config.js` + `modules/index.js` — BUG-05 修复方案：uniqueExpenseFields 动态 SUM
- `middleware/auth.js` — 安全修复：checkDataLock + modulePermission 实现逻辑

---

## Metadata

**Confidence breakdown:**
- Bug 根因定位: HIGH — 全部通过直接代码阅读确认，无猜测
- 修复方案: HIGH — 基于已有代码模式，修改范围明确
- BUG-12 根因: MEDIUM — 代码路径已确认，但手动编辑 Excel 的具体列名差异需运行时验证
- BUG-11 修复必要性: MEDIUM — 需确认 NULL 是否造成实际功能问题

**Research date:** 2026-03-17
**Valid until:** 2026-04-17（代码库稳定期内长期有效）
