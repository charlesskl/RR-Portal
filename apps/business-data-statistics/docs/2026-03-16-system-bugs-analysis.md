# 系统功能缺陷分析文档

> 排查日期：2026-03-16
> 排查方法：以 CLAUDE.md 9 条开发规则为基准，逐条对照现有代码

---

## 一、问题总览

共发现 **11 个问题**：P0 × 3、P1 × 4、P2 × 4

| # | 违反规则 | 严重度 | 模块 | 问题摘要 |
|---|---------|--------|------|---------|
| 1 | 7.6 路由顺序 | **P0** | 批量删除 | `/batch` 被 `/:id` 拦截，报 integer 语法错误 |
| 2 | 7.2 字段名 | **P0** | 数据表格 | 车间列 `prop="workshop"` vs 后端返回 `workshop_name` |
| 3 | 7.2 字段名 | **P0** | 车间管理 | 后端 POST/PUT 没接收 `company` 字段 |
| 4 | 7.2 字段名 | **P1** | 数据锁定 | 前端发 `dept`，后端收 `department` |
| 5 | 7.4 SQL覆盖 | **P1** | 部门汇总 | `/:dept/summary` 只 SUM 共享字段，缺独有字段 |
| 6 | 7.5 DB同步 | **P1** | 建表脚本 | init.sql workshops 表缺 company 列 |
| 7 | 7.1 全栈完整 | **P1** | 数据锁定 | 锁定人列显示数字 ID 而非姓名 |
| 8 | 7.7 不硬编码 | **P2** | 数据锁定 | 部门下拉硬编码 3 个 el-option |
| 9 | 7.7 不硬编码 | **P2** | 用户管理 | 新增/编辑用户的部门下拉硬编码 |
| 10 | 8 CSS规范 | **P2** | 编辑框 | app.js 第340行 inline style 硬编码 `#7F41C0` |
| 11 | — | **P2** | 车间数据 | 3个车间 department 为 NULL |

---

## 二、按 9 条规则逐条检查

### 规则 7.1 — 全栈完整性：禁止半成品

**检查结果：** 发现 1 个问题

**BUG #7：数据锁定 — 锁定人列显示数字 ID**

- **位置：** `public/js/app.js` 第 1338 行
- **现状：** `<el-table-column prop="locked_by" label="锁定人" />`
- **后端：** `routes/settings.js` GET /data-locks 的 SQL 有 `LEFT JOIN users u ON dl.locked_by = u.id`，返回了 `u.name as locked_by_name`
- **问题：** 前端绑定 `locked_by`（数字 ID），没用 `locked_by_name`（姓名）
- **影响：** 锁定人列显示 `1` 而不是 `系统管理员`

其他功能（登录、新增、导入、导出、审计日志、备份）全栈链路完整，无 TODO 或假数据。✅

---

### 规则 7.2 — 前后端字段名必须一一核对

**检查结果：** 发现 3 个问题（系统最高频 bug 类型，和 CLAUDE.md 说的一致）

**BUG #2：车间列空白**

- **位置：** `public/js/app.js` 第 322 行
- **前端：** `<el-table-column prop="workshop" />`
- **后端：** `SELECT w.name as workshop_name` → 返回字段名 `workshop_name`
- **结果：** prop 对不上，车间列永远空白

**BUG #3：车间管理 company 不保存**

- **位置：** `routes/workshops.js` 第 18-34 行
- **前端发送：** `{ name, company, region, department, sort_order }`
- **后端解构：** `const { name, region, department, sort_order } = req.body` ← 漏了 company
- **数据库：** workshops 表已有 company 列
- **结果：** 前端填了公司信息，保存后丢失

**BUG #4：数据锁定字段名不匹配**

- **位置：** `public/js/app.js` 第 1375 行 + `routes/settings.js`
- **前端：** `lockForm: { lock_month: '', dept: '' }` → 发送 `{ dept: 'beer' }`
- **后端：** `const { department, lock_month } = req.body` → 期望 `department`
- **结果：** department 存为 NULL，锁定可能不生效

---

### 规则 7.3 — 新增/修改字段必须同步 4 处

**检查结果：** 无新增遗漏 ✅

company 字段是车间表属性，不涉及三工结余的 4 处同步。三工结余字段的 4 处同步（init.sql、config.js、COLUMN_MAP、app.js）在之前的修复中已完成。

---

### 规则 7.4 — SQL 必须覆盖部门独有字段

**检查结果：** 发现 1 个问题

**BUG #5：部门级汇总 SQL 只 SUM 共享字段**

- **位置：** `routes/records.js` 第 124-160 行
- **现状：** GET `/:dept/summary` 只 SUM 了 15 个共享字段
- **缺失：** 各部门全部独有字段的 SUM，例如：
  - 啤机部缺：machine_repair, mold_repair, materials, material_supplement, misc_worker_wage, gate_processing_fee, assembly_gate_parts_fee, recoverable_gate_fee
  - 印喷部缺：repair_fee, materials, oil_water_amount, subsidy, no_output_wage, office_wage, auto_mold_fee, hunan_mold_fee, indonesia_mold_fee 等
  - 装配部缺：actual_wage, workshop_repair, electrical_repair, workshop_materials, stretch_film, tape 等
- **结果：** 底部合计栏中，所有独有字段列的汇总为空

---

### 规则 7.5 — 数据库变更双向同步

**检查结果：** 发现 1 个问题

**BUG #6：init.sql workshops 表缺 company 列**

- **位置：** `db/init.sql` 第 24-32 行
- **实际数据库：** workshops 表已有 company 列（通过 ALTER TABLE 添加）
- **init.sql：** 建表语句中没有 company
- **自检失败：** 用 init.sql 重建新数据库 → company 列会丢失

---

### 规则 7.6 — Express 路由顺序

**检查结果：** 发现 1 个问题

**BUG #1：批量删除路由被 /:id 拦截**

- **位置：** `routes/records.js`
- **现状路由注册顺序：**
  ```
  第 95 行：DELETE /:dept/records/:id    ← 先注册（通配）
  第 107行：DELETE /:dept/records/batch  ← 后注册（具体）
  ```
- **请求 `DELETE /api/print/records/batch`：** Express 先匹配到 `/:id`，把 `"batch"` 当作 id
- **PostgreSQL 报：** `无效的类型 integer 输入语法: "batch"`

---

### 规则 7.7 — 前端配置不硬编码

**检查结果：** 发现 2 个问题

**BUG #8：数据锁定部门下拉硬编码**

- **位置：** `public/js/app.js` 第 1355-1359 行
- **现状：**
  ```html
  <el-option label="啤机部" value="beer" />
  <el-option label="印喷部" value="print" />
  <el-option label="装配部" value="assembly" />
  ```
- **data 中已引入 `ALL_DEPARTMENTS`（第 1376 行），但模板没使用**

**BUG #9：用户管理部门下拉硬编码**

- **位置：** `public/js/app.js` 约第 928-932 行（新增）和第 958-962 行（编辑）
- **同样硬编码了 3 个 el-option，应使用 ALL_DEPARTMENTS 动态生成**

---

### 规则 7.8 — 修改前端注意事项

**检查结果：** 无违反 ✅

- 7.8a: app.js 修改前有读取完整文件 ✅
- 7.8b: 前端 DEPT_CONFIG 和后端 config.js 的字段定义保持同步 ✅
- 7.8c: 所有 API 调用都经过 api.js 封装，无直接 axios 调用 ✅（已搜索确认）

---

### 规则 8 — CSS 规范

**检查结果：** 发现 1 个问题

**BUG #10：app.js 行内样式硬编码颜色**

- **位置：** `public/js/app.js` 第 340 行
- **现状：** `style="... border:2px solid #7F41C0 ..."` — 编辑框边框颜色硬编码在行内样式中
- **应该：** 使用 CSS 类或 CSS 变量 `var(--primary)`，而不是 inline style 写死十六进制

---

## 三、数据库现状

| 项目 | 状态 |
|------|------|
| workshops 表 company 列 | ✅ 实际库有，❌ init.sql 没有 |
| workshops 数据 | 19 条，其中 3 条 department=NULL（id=17华登, 18华康, 19华兴，河源厂区） |
| beer_records | 0 条 |
| print_records | 18 条（日期 2026-03-08） |
| assembly_records | 0 条 |

---

## 四、修复计划

### 第一批：P0（不修不能用）

| # | 修复 | 文件 | 改动 |
|---|------|------|------|
| 1 | batch 路由移到 /:id 前面 | routes/records.js | 移动代码块 |
| 2 | 车间列 prop → workshop_name | public/js/app.js | 1 处 |
| 3 | workshops POST/PUT 加 company | routes/workshops.js | 2 处 |

### 第二批：P1（功能缺陷）

| # | 修复 | 文件 | 改动 |
|---|------|------|------|
| 4 | lockForm.dept → department | public/js/app.js | 3 处 |
| 5 | 部门汇总动态 SUM 全字段 | routes/records.js | 重写 SQL |
| 6 | init.sql 加 workshops.company | db/init.sql | 1 行 |
| 7 | 锁定人列 prop → locked_by_name | public/js/app.js | 1 处 |

### 第三批：P2（优化）

| # | 修复 | 文件 | 改动 |
|---|------|------|------|
| 8 | 数据锁定部门下拉改动态 | public/js/app.js | 3 行 |
| 9 | 用户管理部门下拉改动态 | public/js/app.js | 6 行 |
| 10 | 编辑框颜色改 CSS 类 | app.js + theme.css | 2 处 |
| 11 | 修正 3 个 NULL department 车间 | 数据库 UPDATE | 3 条 SQL |
