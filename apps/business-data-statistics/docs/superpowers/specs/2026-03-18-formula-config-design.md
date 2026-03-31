# 公式配置模块 + 车间拖拽排序 设计文档

> 日期：2026-03-18
> 状态：已确认

## 1. 需求概述

三个需求：
1. **车间管理拖拽排序** — 排序列改为拖拽手柄，支持拖拽整行调整顺序
2. **公式配置模块** — 在系统设置中新增前端界面，支持可视化配置计算公式
3. **河源车间暂不配置** — 后续用户通过车间管理自行添加

## 2. 需求 1：车间管理拖拽排序

### 2.1 交互设计

- 保留所有现有列（厂区、公司、车间名、部门、排序）
- "排序"列从数字输入改为拖拽手柄图标（≡ 三横线）
- 鼠标悬停手柄时变为抓手光标
- 按住手柄拖拽行到目标位置
- 松开后，前端重新计算所有行的 `sort_order` 值（1, 2, 3...）
- 自动调用批量更新 API 保存排序

### 2.2 技术方案

**前端：**
- 引入 SortableJS（CDN），绑定 `el-table` 的 `tbody`
- "排序"列模板改为手柄图标
- 拖拽结束回调中重新编号并调用 API

**后端：**
- 新增 `PUT /api/workshops/sort` 端点
- 接收数组 `[{id, sort_order}, ...]`，批量更新

**文件改动：**

| 文件 | 改动 |
|------|------|
| `public/index.html` | 新增 SortableJS CDN 引用 |
| `public/js/app.js` | WorkshopSettings 组件：排序列改为手柄图标 + 拖拽逻辑 |
| `routes/workshops.js` | 新增 `PUT /sort` 批量排序端点（注册在 `/:id` 之前） |
| `server.js` | 确认路由注册顺序 |

**数据库：** 不改动，已有 `sort_order` 字段。

## 3. 需求 2：公式配置模块

### 3.1 功能范围

- 费用项可勾选参与结余计算（字段分组/标签功能）
- 可自由配置数学公式（+ − × ÷ 括号）
- 支持链式计算（公式引用其他公式结果）
- 支持 `SUM(标签名)` 分组聚合函数
- 重算历史数据功能

### 3.2 页面位置与层级

- **位置：** 系统设置第 1 个标签页（在车间管理之前）
- **层级：** 模块 → 部门 → 公式列表
- **权限：** 仅统计组（stats 角色）可见和操作

### 3.3 数据库设计

#### 3.3.1 `formula_configs` — 公式配置主表

替代现有 `calc_rules` 表。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 主键 |
| module | VARCHAR(50) NOT NULL | 所属模块，如 `balance` |
| department | VARCHAR(50) NOT NULL | 所属部门，如 `beer`、`print`、`assembly` |
| field_key | VARCHAR(100) NOT NULL | 计算字段英文名，如 `balance`、`machine_rate` |
| field_label | VARCHAR(100) NOT NULL | 中文显示名，如"结余"、"开机率" |
| formula_text | TEXT NOT NULL | 公式文本，如 `{daily_output} - SUM(expense)` |
| display_format | VARCHAR(20) DEFAULT 'number' | 显示格式：`number`（数字）、`percent`（百分比）、`currency`（金额） |
| decimal_places | INT DEFAULT 2 | 小数位数（百分比默认 2 位，金额默认 2 位，普通数字默认 2 位） |
| sort_order | INT DEFAULT 0 | 计算顺序（决定链式计算的先后） |
| enabled | BOOLEAN DEFAULT true | 是否启用 |
| created_at | TIMESTAMPTZ DEFAULT NOW() | 创建时间 |
| updated_at | TIMESTAMPTZ DEFAULT NOW() | 修改时间 |

约束：`UNIQUE(module, department, field_key)`

#### 3.3.2 `field_tags` — 字段标签/分组表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 主键 |
| module | VARCHAR(50) NOT NULL | 所属模块 |
| department | VARCHAR(50) NOT NULL DEFAULT '_shared' | 所属部门（`_shared` 表示跨部门标签） |
| field_key | VARCHAR(100) NOT NULL | 字段英文名 |
| tag | VARCHAR(50) NOT NULL | 标签名，如 `expense` |

约束：`UNIQUE(module, department, field_key, tag)`

> **设计说明：** `department` 使用 `'_shared'` 代替 NULL，避免 PostgreSQL 中 NULL 值不参与唯一约束的问题。

用途：`SUM(expense)` 会查此表找出所有 `tag='expense'` 的字段自动求和。

#### 3.3.3 `field_registry` — 字段注册表

`modules/balance/config.js` 的数据库版本，支持前端管理字段。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PRIMARY KEY | 主键 |
| module | VARCHAR(50) NOT NULL | 所属模块 |
| department | VARCHAR(50) NOT NULL DEFAULT '_shared' | 所属部门（`_shared` 表示共享字段） |
| field_key | VARCHAR(100) NOT NULL | 英文字段名 |
| field_label | VARCHAR(100) NOT NULL | 中文显示名 |
| field_type | VARCHAR(20) NOT NULL | `input` / `expense` / `calc` |
| data_type | VARCHAR(20) DEFAULT 'number' | 数据类型：`integer`（整数）、`number`（小数）、`ratio`（比例） |
| aliases | TEXT | Excel 导入时的中文别名，JSON 数组格式，如 `["日产值","当日产值"]` |
| importable | BOOLEAN DEFAULT true | 是否可从 Excel 导入（计算字段通常为 false，但有例外） |
| sort_order | INT DEFAULT 0 | 显示顺序 |

约束：`UNIQUE(module, department, field_key)`

> **设计说明：** 同 `field_tags`，`department` 用 `'_shared'` 代替 NULL。`aliases` 字段用于自动生成 Excel 导入的 COLUMN_MAP，迁移时从 `config.js` 的 `aliases` 和 `skipAliases` 提取。`importable` 用于标记计算字段是否可导入（如装配部的 `avg_output_per_worker` 虽是计算字段但可导入）。

#### 3.3.4 旧表处理

- `calc_rules` → 被 `formula_configs` 替代
- `expense_items` → 被 `field_tags` + `field_registry` 替代
- **迁移步骤：** 先创建新表并导入数据 → 验证数据完整性 → 更新 `routes/settings.js` 中引用旧表的 API 端点（`GET/PUT /expense-items` 和 `GET/PUT /calc-rules`）改为查询新表或移除 → 最后删除旧表

> **注意：** 现有 `routes/settings.js` 中的 `/expense-items` 和 `/calc-rules` API 端点查询旧表，必须在删除旧表之前将这些端点更新为使用新表或彻底移除，否则会导致 500 错误。

### 3.4 公式编辑器 UI 设计

#### 3.4.1 公式列表页

- **顶部选择栏：** 模块下拉选择 + 部门切换按钮（标签式） + "新增公式"按钮
- **主体：** 公式卡片列表
  - 每张卡片显示：拖拽手柄（≡）、公式名称、启用状态、英文字段名
  - 卡片内容：可视化公式展示（彩色药片 + 运算符） + 文本公式预览
  - 操作按钮：编辑、禁用/启用、删除
  - 卡片可拖拽排序（调整计算顺序）

#### 3.4.2 公式编辑弹窗

**基本信息区：**
- 公式名称（中文输入）
- 字段名（英文，存入数据库的字段名）
- 显示格式下拉（数字 / 百分比 / 金额）
- 小数位数（数字输入，默认 2）

**模式切换：**
- 可视化模式（默认） / 文本模式，按钮组切换

**可视化编辑区：**
- 紫色虚线框内显示当前公式
- 字段显示为彩色药片（可删除 ✕）
- 运算符显示为紫色圆形图标

**运算符按钮行：**
- `+` `−` `×` `÷` `(` `)` `SUM()`

**字段选择面板（搜索 + 分组折叠 + 彩色药片）：**
- 顶部搜索框，输入关键字过滤字段
- 按分组折叠显示：
  - 共享输入（绿色底 `#e8f5e9`，边框 `#c8e6c9`）
  - 费用（橙色底 `#fff3e0`，边框 `#ffe0b2`）
  - 部门独有（蓝色底 `#e3f2fd`）
  - 计算字段/可引用（青绿底 `#e0f2f1`）
- 每组标题栏有各自背景色，右侧显示字段数量
- 点击字段药片直接插入公式编辑区

**文本预览区：**
- 底部显示文本公式（`{field_key} / {field_key}`）
- 文本模式下可直接编辑，输入 `{` 触发中文字段名自动补全

**底部按钮：** 取消 / 保存公式

#### 3.4.3 颜色规范

以下颜色为公式配置模块专用的 UI 辅助色，已获用户确认：

| 元素 | 颜色 | 说明 |
|------|------|------|
| 分组标题-共享输入 | 背景 `#f5f0fa`，边框 `#e0d4f0` | 用户确认 |
| 分组标题-费用 | 背景 `#fdf0f0`，边框 `#f0d4d4` | 用户确认 |
| 分组标题-部门独有 | 背景 `#f0f8ff` | 用户确认 |
| 分组标题-计算字段 | 背景 `#f0faf5` | 用户确认 |
| 字段药片-输入 | 背景 `#e8f5e9`，边框 `#c8e6c9` | 用户确认 |
| 字段药片-费用 | 背景 `#fff3e0`，边框 `#ffe0b2` | 用户确认 |
| 字段药片-计算 | 背景 `#e3f2fd`，边框 `#90caf9` | 用户确认 |
| 运算符圆形 | 背景 `#7F41C0`（深晶紫），文字白色 | 全局主色 |
| 模式切换-激活 | 背景 `#7F41C0`（深晶紫），文字白色 | 全局主色 |
| 新增公式按钮 | 背景 `#57B894`（青柠绿），文字白色 | 全局确认色 |
| 保存按钮 | 背景 `#7F41C0`（深晶紫），文字白色 | 全局主色 |
| 删除文字 | `#E88EA0`（豆沙粉） | 全局警告色 |

### 3.5 公式解析器（formula-parser.js）

前后端共用的 JavaScript 模块，负责将公式文本解析为计算结果。

#### 3.5.1 共享策略

项目无构建工具（CDN 前端），采用以下方式共享解析器：
- **源文件位置：** `shared/formula-parser.js`
- **后端引用：** 直接 `require('./shared/formula-parser')`
- **前端引用：** `server.js` 中将 `/shared` 目录配置为静态资源，`index.html` 通过 `<script src="/shared/formula-parser.js">` 引入
- **代码风格：** 使用 UMD 模式（同时支持 `module.exports` 和全局变量），不依赖 Node.js 专有 API

> 不再在 `public/js/` 下维护单独副本，避免两份代码不同步。

#### 3.5.2 表达式求值库

使用 **`expr-eval`** 库（CDN + npm）作为安全表达式解析器：
- 不使用 `eval()` / `new Function()`，避免代码注入风险
- 支持四则运算 + 括号 + 自定义变量
- 轻量无依赖，约 15KB
- CDN: `https://cdn.jsdelivr.net/npm/expr-eval/dist/bundle.min.js`
- 后端: `npm install expr-eval`

#### 3.5.3 输入

- `formulaText`: 公式文本字符串，如 `{daily_output} - SUM(expense)`
- `data`: 一行记录的所有字段值对象，如 `{ daily_output: 10000, worker_wage: 3000, ... }`
- `tags`: 字段标签映射，如 `{ expense: ['worker_wage', 'supervisor_wage', ...] }`
- `prevResults`: 已计算的前序公式结果，如 `{ balance: 5000 }`（链式计算用）

#### 3.5.4 处理流程

1. **展开 SUM()** — 将 `SUM(expense)` 替换为 `(worker_wage + supervisor_wage + ...)`
2. **替换字段引用** — 将 `{daily_output}` 替换为实际数值
3. **合并前序结果** — 将 `{balance}` 替换为已计算的结果值
4. **安全求值** — 使用 `expr-eval` 库解析和计算表达式
5. **精度处理** — 按 `decimal_places` 配置四舍五入
6. **错误处理** — 除以零返回 0，字段缺失返回 null 并标记警告

#### 3.5.5 百分比/比例处理约定

- 公式计算结果始终为**原始小数值**（如 0.25 表示 25%）
- `display_format: 'percent'` 仅影响**前端显示**时乘以 100 并加 `%` 号
- 数据库存储和公式引用始终使用原始小数值

#### 3.5.6 公式验证（保存时）

- 字段名是否存在于 `field_registry`
- 括号是否匹配
- 是否有循环引用（A 依赖 B，B 又依赖 A）
- `SUM()` 内的标签名是否存在于 `field_tags`

#### 3.5.7 链式计算

按 `sort_order` 顺序依次计算每个公式，将结果合并到 `prevResults` 中供后续公式引用。如果检测到依赖的前序公式尚未计算，提示用户调整排序。

### 3.6 前后端数据流

```
录入数据 → 前端 formula-parser.js 实时计算 → 灰色斜体"预估值"显示
    ↓ 保存
后端接收原始数据 → 读取 formula_configs → formula-parser.js 计算 → 存入数据库
    ↓ 返回
前端刷新 → 正式值替换预估值
```

- 前端预览：灰色/斜体标注"预估"，辅助参考
- 后端计算：最终权威值，存入数据库
- 前后端使用**同一个 shared/formula-parser.js**，同一份公式配置

### 3.7 安全机制

| 机制 | 说明 |
|------|------|
| 权限控制 | 仅统计组（stats 角色）可访问公式配置 |
| 公式验证 | 保存前检查字段存在性、循环引用、括号匹配 |
| 修改日志 | 每次改公式记录到审计日志（who/when/what） |
| 预览测试 | 保存前可输入测试数据验证公式结果 |
| 历史数据隔离 | 修改公式只影响之后的新录入/编辑数据 |

### 3.8 重算历史数据

- 公式列表页增加"重算历史"按钮
- 选择：时间范围 + 部门
- 操作前弹出确认框警告
- **执行策略：** 分批处理，每批 500 条记录，在同一个数据库事务中执行。如果某批失败则整体回滚
- **超时保护：** 超过 10000 条记录时提示用户分次操作（按月份拆分）
- 操作记入审计日志（记录时间范围、部门、受影响行数）

### 3.9 数据迁移策略

1. 新建迁移脚本 `db/migrate-formulas.js`
2. 从 `modules/balance/config.js` 读取所有字段定义 → 写入 `field_registry`（包含 `aliases`、`data_type`、`importable` 等完整信息）
3. 从 `modules/balance/calc.js` 提取所有公式 → 写入 `formula_configs`
4. 从字段的 `expense: true` 标记 → 写入 `field_tags`（tag = 'expense'）
5. 脚本幂等设计（`INSERT ... ON CONFLICT DO NOTHING`）
6. 更新 `routes/settings.js` 中的 `/expense-items` 和 `/calc-rules` 端点改为查询新表
7. 验证新表数据完整性后，删除旧表 `calc_rules` 和 `expense_items`
8. `calc.js` 改为从数据库读公式 + 调用 `formula-parser.js`
9. `config.js` 保留为参考备份

### 3.10 API 设计

> **路由注册顺序：** 所有具名路径（`/sort`、`/validate`、`/test`、`/recalculate`）必须注册在通配路径（`/:id`）**之前**，遵循项目铁律 7.6。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings/formulas?module=&department=` | 获取公式列表 |
| POST | `/api/settings/formulas` | 新增公式 |
| PUT | `/api/settings/formulas/sort` | 批量更新公式排序 |
| POST | `/api/settings/formulas/validate` | 验证公式（保存前调用） |
| POST | `/api/settings/formulas/test` | 测试公式（输入测试数据返回结果） |
| POST | `/api/settings/formulas/recalculate` | 重算历史数据 |
| PUT | `/api/settings/formulas/:id` | 修改公式 |
| DELETE | `/api/settings/formulas/:id` | 删除公式 |
| GET | `/api/settings/field-registry?module=&department=` | 获取字段注册表（只读） |
| GET | `/api/settings/field-tags?module=&department=` | 获取字段标签 |
| PUT | `/api/settings/field-tags` | 更新字段标签 |

> `field_registry` 当前为只读（由迁移脚本和未来的字段管理功能维护），本期不提供 CRUD API。

### 3.11 文件改动清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `shared/formula-parser.js` | 新建 | 公式解析器，UMD 模式，前后端共用 |
| `db/init.sql` | 修改 | 新增 3 张表，更新旧表定义 |
| `db/migrate-formulas.js` | 新建 | 迁移脚本，将硬编码公式导入数据库 |
| `routes/settings.js` | 修改 | 新增公式配置 CRUD + 验证 + 测试 + 重算 API；更新旧端点 |
| `routes/records.js` | 修改 | 保存记录时调用新解析器 |
| `modules/balance/calc.js` | 修改 | 改为从数据库读公式 + 调用解析器 |
| `modules/balance/config.js` | 保留 | 作为迁移来源和参考备份 |
| `public/js/app.js` | 修改 | 新增 FormulaConfig 组件 + 录入时实时预览 |
| `public/js/api.js` | 修改 | 新增公式配置相关 API 封装 |
| `public/index.html` | 修改 | 引入 SortableJS CDN + expr-eval CDN + `/shared/formula-parser.js` |
| `server.js` | 修改 | 注册新路由、`/shared` 静态资源配置 |
| `routes/workshops.js` | 修改 | 新增批量排序端点 |

## 4. 需求 3：河源车间

暂不配置。后续用户通过车间管理界面自行添加车间记录（分配到部门、设排序）。不涉及特殊公式或字段变更。

## 5. 后续待讨论

- 系统设置和用户管理模块的整体布局优化（用户已记录，待当前需求完成后讨论）
