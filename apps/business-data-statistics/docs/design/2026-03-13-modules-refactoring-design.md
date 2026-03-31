# 模块化重构设计：后端配置收拢到 modules/ 目录

**日期：** 2026-03-13
**方案：** 方案 B（后端统一，前端暂不动）
**目标：** 把分散在多个文件中的后端配置收拢到 `modules/balance/` 目录，为未来新增模块铺路

## 1. 背景

### 1.1 当前问题

系统未来可能扩展新的平行模块（具体模块待定）。当前配置分散在 4 个文件中，新增字段需要同步修改 4 处：

| # | 文件 | 内容 |
|---|------|------|
| 1 | `utils/dept-config.js` | 字段分类（输入/费用/计算） |
| 2 | `routes/import-export.js` | Excel 中文列名 → 英文字段映射 (COLUMN_MAP) |
| 3 | `utils/calc.js` | 计算公式 |
| 4 | `public/js/app.js` | 前端 UI 字段配置 |

### 1.2 重构目标

- 后端的 #1、#2、#3 合并到同一个目录下
- 新增字段从改 4 处降到改 2 处（`modules/balance/config.js` + `public/js/app.js`）
- 新增模块时只需复制 `modules/balance/` 目录并修改配置
- 功能和行为完全不变（纯内部重构）

## 2. 新目录结构

```
modules/
  balance/                    ← 三工结余模块
    config.js                 ← 合并：字段定义 + 费用标记 + Excel列名别名
    calc.js                   ← 计算公式（从 utils/calc.js 迁移，逻辑不变）
  index.js                    ← 模块注册表 + 兼容层（对外暴露旧接口格式）
utils/
  dept-config.js              ← 删除（被 modules/balance/config.js 替代）
  calc.js                     ← 删除（被 modules/balance/calc.js 替代）
  async-handler.js            ← 保留（与模块无关）
```

## 3. config.js 数据结构

### 3.1 核心设计：每个字段是一个对象

以前字段名散落在多个数组中，现在合并为一个对象数组，通过标记（input/expense/calc）区分角色：

```js
module.exports = {
  key: 'balance',
  label: '三工结余',

  // 结构字段：每条记录必有的非数据字段（日期、车间、备注）
  // 这些字段不参与计算，但需要在 COLUMN_MAP 中映射
  structuralFields: [
    { field: 'record_date', label: '日期', aliases: [] },
    { field: 'workshop_name', label: '车间', aliases: ['车间名称'] },
    { field: 'remark', label: '备注', aliases: ['备 注'] },
  ],

  // 所有部门共享的字段
  sharedFields: [
    { field: 'supervisor_count', label: '管工人数', type: 'integer', input: true, expense: false },
    { field: 'worker_count', label: '员工人数', type: 'integer', input: true, expense: false,
      aliases: ['员工人数(不包杂工)'] },
    { field: 'daily_output', label: '总产值/天', type: 'number', input: true, expense: false,
      aliases: ['产值'] },
    { field: 'worker_wage', label: '员工工资/天', type: 'number', input: true, expense: true,
      aliases: ['员工工资'] },
    { field: 'supervisor_wage', label: '管工工资/天', type: 'number', input: true, expense: true,
      aliases: ['生产管工工资'] },
    { field: 'rent', label: '房租', type: 'number', input: true, expense: true },
    { field: 'utility_fee', label: '水电费', type: 'number', input: true, expense: true },
    { field: 'tool_investment', label: '工具投资', type: 'number', input: true, expense: true },
    { field: 'equipment', label: '设备', type: 'number', input: true, expense: true },
    { field: 'renovation', label: '装修', type: 'number', input: true, expense: true },
    { field: 'misc_fee', label: '杂费', type: 'number', input: true, expense: true },
    { field: 'shipping_fee', label: '运费', type: 'number', input: true, expense: true },
    { field: 'social_insurance', label: '社保', type: 'number', input: true, expense: true,
      aliases: ['湖南社保'] },
    { field: 'tax', label: '税收', type: 'number', input: true, expense: true,
      aliases: ['湖南税收'] },
  ],

  // 共享计算字段
  sharedCalcFields: [
    { field: 'balance', label: '结余金额', type: 'number', calc: true },
    { field: 'balance_ratio', label: '结余%', type: 'ratio', calc: true },
  ],

  // 导入时需要跳过的 Excel 列名
  skipColumns: ['结余金额', '结余%'],

  departments: {
    beer: {
      tableName: 'beer_records',
      label: '啤机部',
      workshops: ['兴信A', '兴信B', '华登', '邵阳'],
      // 部门特有的共享字段别名（Excel 表头在不同部门 Excel 中叫法不同）
      sharedFieldAliases: {},
      uniqueFields: [
        // input: true, expense: false — 输入但不扣减
        { field: 'total_machines', label: '总台数', type: 'integer', input: true, expense: false },
        { field: 'running_machines', label: '开机台数', type: 'integer', input: true, expense: false },
        { field: 'misc_workers', label: '杂工人数', type: 'integer', input: true, expense: false },
        { field: 'gate_workers', label: '批水口人数', type: 'integer', input: true, expense: false },
        { field: 'run_hours', label: '开机时间', type: 'number', input: true, expense: false },
        { field: 'output_tax_incl', label: '总产值含税', type: 'number', input: true, expense: false,
          aliases: ['不含税产值（含税产值/1.13）', '不含税产值(含税产值/1.13)'] },
        // input: true, expense: true — 输入且扣减
        { field: 'misc_worker_wage', label: '杂工工资/天', type: 'number', input: true, expense: true },
        { field: 'machine_repair', label: '机器维修', type: 'number', input: true, expense: true },
        { field: 'mold_repair', label: '模具维修', type: 'number', input: true, expense: true },
        { field: 'gate_processing_fee', label: '批水口加工费', type: 'number', input: true, expense: true,
          aliases: ['批水口加工费（全包）', '批水口加工费(全包)'] },
        { field: 'assembly_gate_parts_fee', label: '装配批水口配件费', type: 'number', input: true, expense: true,
          aliases: ['装配帮啤机批水口加工配件费用', '装配帮啤机批水口配件费用'] },
        { field: 'recoverable_gate_fee', label: '可回收批水口费', type: 'number', input: true, expense: true,
          aliases: ['可回收外厂批水口加工费'] },
        { field: 'material_supplement', label: '原料补料', type: 'number', input: true, expense: true },
        { field: 'materials', label: '物料', type: 'number', input: true, expense: true },
        // calc: true — 计算字段（不可输入）
        { field: 'machine_rate', label: '开机率', type: 'ratio', calc: true,
          skipAliases: ['开机率'] },
        { field: 'avg_output_per_machine', label: '每台机平均产值', type: 'number', calc: true,
          skipAliases: ['每台机平均产值'] },
        { field: 'wage_ratio', label: '总工资占产值%', type: 'ratio', calc: true,
          skipAliases: ['总工资（包管工）占产值%', '总工资(包管工)占产值%'] },
        { field: 'mold_cost_ratio', label: '模具费用占产值比%', type: 'ratio', calc: true,
          skipAliases: ['模具费用占产值比%'] },
        { field: 'gate_cost_ratio', label: '批水口费用占产值比%', type: 'ratio', calc: true,
          skipAliases: ['批水口费用占产值比%'] },
        { field: 'avg_balance_per_machine', label: '平均每台结余', type: 'number', calc: true,
          skipAliases: ['平均每台结余'] },
      ]
    },
    print: {
      tableName: 'print_records',
      label: '印喷部',
      workshops: ['兴信A', '华登', '邵阳'],
      // 印喷 Excel 中共享字段的特殊列名
      sharedFieldAliases: {
        tool_investment: ['工具'],       // 印喷 Excel 用 '工具' 而非 '工具投资'
        shipping_fee: ['运费_1'],        // 印喷 Excel 用 '运费_1' 表示运费
      },
      uniqueFields: [
        { field: 'pad_total_machines', label: '移印机总台数', type: 'integer', input: true, expense: false,
          aliases: ['移印总台数'] },
        { field: 'pad_running_machines', label: '每天开机台数', type: 'integer', input: true, expense: false,
          aliases: ['移印开机台数'] },
        { field: 'spray_total_machines', label: '喷油机总台数', type: 'integer', input: true, expense: false,
          aliases: ['喷油总台数'] },
        { field: 'spray_running_machines', label: '每天开机台数_1', type: 'integer', input: true, expense: false },
        { field: 'misc_workers', label: '杂工人数', type: 'integer', input: true, expense: false },
        { field: 'work_hours', label: '工时', type: 'number', input: true, expense: false,
          aliases: ['工作时间'] },
        { field: 'total_hours', label: '总时间', type: 'number', input: true, expense: false,
          aliases: ['总工时'] },
        { field: 'output_tax_incl', label: '总产值含税', type: 'number', input: true, expense: false },
        { field: 'subsidy', label: '补贴', type: 'number', input: true, expense: true },
        { field: 'materials', label: '物料（原子灰、胶头、油墨、喷码溶剂）', type: 'number', input: true, expense: true,
          aliases: ['物料(原子灰、胶头、油墨、喷码溶剂)'] },
        { field: 'repair_fee', label: '维修费', type: 'number', input: true, expense: true },
        { field: 'oil_water_amount', label: '油水金额', type: 'number', input: true, expense: true },
        { field: 'no_output_wage', label: '无产值工资', type: 'number', input: true, expense: true,
          aliases: ['无产出工资'] },
        { field: 'recoverable_wage', label: '可收回工资', type: 'number', input: true, expense: false,
          aliases: ['可回收工资'] },
        { field: 'recoverable_indonesia_wage', label: '可收回印尼工资', type: 'number', input: true, expense: false,
          aliases: ['可回收印尼工资'] },
        { field: 'non_recoverable_tool_fee', label: '不可回收工具费', type: 'number', input: true, expense: true },
        { field: 'recoverable_tool_fee', label: '可收回工具费', type: 'number', input: true, expense: false,
          aliases: ['可回收工具费'] },
        { field: 'recoverable_paint', label: '可回收油漆金额', type: 'number', input: true, expense: false,
          aliases: ['可回收油漆'] },
        { field: 'dept_recoverable_wage', label: '车发部回收工资', type: 'number', input: true, expense: false,
          aliases: ['部门可回收工资'] },
        { field: 'assembly_wage_paid', label: '付装配工资', type: 'number', input: true, expense: true,
          aliases: ['装配工资代付'] },
        { field: 'office_wage', label: '做办工资', type: 'number', input: true, expense: true,
          aliases: ['办公室工资'] },
        { field: 'auto_mold_fee', label: '自动机模费', type: 'number', input: true, expense: true,
          aliases: ['自动模费'] },
        { field: 'hunan_mold_fee', label: '发湖南模费', type: 'number', input: true, expense: true,
          aliases: ['湖南模费'] },
        { field: 'indonesia_mold_fee', label: '发印尼模费', type: 'number', input: true, expense: true,
          aliases: ['印尼模费'] },
        // calc: true — 计算字段
        { field: 'pad_machine_rate', label: '移印开机率', type: 'ratio', calc: true,
          skipAliases: ['开机率'] },
        { field: 'spray_machine_rate', label: '喷油开机率', type: 'ratio', calc: true,
          skipAliases: ['开机率_1'] },
        { field: 'avg_output_per_worker', label: '员工人均产值', type: 'number', calc: true,
          skipAliases: ['员工人均产值'] },
        { field: 'wage_ratio', label: '总工资占产值%', type: 'ratio', calc: true,
          skipAliases: ['总工资占产值%'] },
        { field: 'office_wage_ratio', label: '做办工资占比%', type: 'ratio', calc: true,
          skipAliases: ['所占比例'] },
        { field: 'mold_fee_ratio', label: '模费占产值%', type: 'ratio', calc: true,
          skipAliases: ['模费占产值%', '模费占产值%_1'] },
        { field: 'total_ratio', label: '合计%', type: 'ratio', calc: true,
          skipAliases: ['发印尼模费占产值%', '合计%'] },
      ]
    },
    assembly: {
      tableName: 'assembly_records',
      label: '装配部',
      workshops: ['兴信A', '兴信B', '华登', '邵阳'],
      // 装配 Excel 中共享字段的特殊列名
      sharedFieldAliases: {
        tool_investment: ['夹具部工具投资'],  // 装配 Excel 中 '夹具部工具投资' 指的是共享的 tool_investment
      },
      uniqueFields: [
        // ★ 特殊：calc + importable — 既是计算字段又可从 Excel 导入
        // 导入时若 Excel 有此列则取导入值，否则按公式计算
        { field: 'avg_output_per_worker', label: '人均产值', type: 'number', calc: true, importable: true },
        { field: 'planned_wage_tax', label: '计划总工资含*1.13', type: 'number', input: true, expense: false,
          aliases: ['计划工资含税'] },
        { field: 'actual_wage', label: '实际总工资', type: 'number', input: true, expense: true,
          aliases: ['实际工资'] },
        { field: 'workshop_repair', label: '车间维修费', type: 'number', input: true, expense: true,
          aliases: ['车间维修'] },
        { field: 'electrical_repair', label: '机电部维修费', type: 'number', input: true, expense: true,
          aliases: ['电工维修'] },
        { field: 'workshop_materials', label: '车间物料费', type: 'number', input: true, expense: true,
          aliases: ['车间物料'] },
        { field: 'stretch_film', label: '拉伸膜', type: 'number', input: true, expense: true },
        { field: 'supplement', label: '补料', type: 'number', input: true, expense: true },
        { field: 'housing_subsidy', label: '外宿补贴', type: 'number', input: true, expense: true,
          aliases: ['住房补贴'] },
        { field: 'recoverable_electricity', label: '可回收电费', type: 'number', input: true, expense: false },
        { field: 'tape', label: '胶纸', type: 'number', input: true, expense: true,
          aliases: ['胶带'] },
        { field: 'borrowed_worker_wage', label: '外借人员工资', type: 'number', input: true, expense: true,
          aliases: ['借调工人工资'] },
        { field: 'workshop_tool_investment', label: '车间工具投资', type: 'number', input: true, expense: true },
        // calc: true — 计算字段
        { field: 'balance_minus_tape', label: '结余减胶纸', type: 'number', calc: true,
          skipAliases: ['结余减胶纸'] },
        { field: 'balance_tape_ratio', label: '减胶纸后结余占计划工资%', type: 'ratio', calc: true,
          skipAliases: ['减胶纸后结余占计划工资%'] },
        { field: 'tool_invest_ratio', label: '工具投资占计划工资%', type: 'ratio', calc: true,
          skipAliases: ['工具投资占计划工资%'] },
        { field: 'borrowed_wage_ratio', label: '外借人员工资占计划工资%', type: 'ratio', calc: true,
          skipAliases: ['外借人员工资占计划工资%'] },
      ]
    },
  }
};
```

### 3.2 字段标记和别名系统

**字段标记：**

| 标记 | 含义 | 示例 |
|------|------|------|
| `input: true` | 用户可输入的字段 | 员工人数、房租 |
| `expense: true` | 参与结余扣减的费用项 | 房租、工资（expense 必须同时是 input） |
| `calc: true` | 公式计算字段，不可输入 | 开机率、结余% |
| `calc: true, importable: true` | 计算字段，但 Excel 导入时可覆盖 | 装配部的人均产值 |

**别名系统：**

| 属性 | 含义 | 示例 |
|------|------|------|
| `label` | 字段主名称，自动作为导入别名 | `'房租'` → `rent` |
| `aliases` | 同一字段在 Excel 中的其他列名 | `['湖南社保']` → `social_insurance` |
| `skipAliases` | 计算字段在 Excel 中的列名，导入时跳过 | `['开机率']` → `_skip_calc` |

**部门特有的共享字段别名（`sharedFieldAliases`）：**

不同部门的 Excel 表头对同一个共享字段可能叫法不同。例如：
- 印喷 Excel 用 `'工具'` 指代共享字段 `tool_investment`（其他部门叫 `'工具投资'`）
- 装配 Excel 用 `'夹具部工具投资'` 指代共享字段 `tool_investment`

这些部门特有别名放在 `departments.xxx.sharedFieldAliases` 中，兼容层生成 COLUMN_MAP 时合并。

**`importable` 标记说明：**

装配部的 `avg_output_per_worker`（人均产值）比较特殊：
- 它是计算字段（`calc: true`），正常情况下由公式推导
- 但在 Excel 导入时，`'人均产值'` 列的值应导入到该字段（`importable: true`）
- 兼容层处理：`importable: true` 的计算字段，其 label 生成普通映射（非 `_skip_calc`）

### 3.3 structuralFields 说明

`structuralFields` 定义每条记录必有的非数据字段（日期、车间、备注）。它们：
- 不参与任何计算
- 不出现在 `input/expense/calc` 字段列表中
- 但需要在 COLUMN_MAP 中映射（Excel 导入时识别这些列）
- `remark` 会被 `getAllInputFields()` 自动追加到末尾（保持现有行为）

### 3.4 从对象数组推导出旧格式

兼容层通过 filter + map 推导：

```
structuralFields          →  COLUMN_MAP 中的 record_date/workshop_name/remark 映射
input: true 的字段        →  uniqueInputFields 数组
expense: true 的字段      →  uniqueExpenseFields 数组
calc: true 的字段         →  uniqueCalcFields 数组
所有 aliases              →  COLUMN_MAP 对象
所有 skipAliases          →  COLUMN_MAP 中的 '_skip_calc' 条目
sharedFieldAliases        →  COLUMN_MAP 对象（按部门合并）
importable 的 calc 字段   →  COLUMN_MAP 中的普通映射（非 _skip_calc）
```

**注意：** `getColumnMap(moduleKey)` 不按部门区分——它合并所有部门的别名到同一个 map。这与当前 COLUMN_MAP 行为一致（一个全局 map，所有部门共用）。部门特有别名不会冲突，因为不同部门的 Excel 列名不同。

## 4. modules/index.js 兼容层

### 4.1 职责

- 加载所有模块的 config
- 对外导出与旧 `utils/dept-config.js` 完全兼容的接口
- 提供 `getColumnMap(moduleKey)` 生成 COLUMN_MAP
- 提供 `validateConfig()` 启动校验

### 4.2 导出接口

```js
module.exports = {
  // === 兼容旧接口（让路由文件只改 require 路径）===
  DEPT_CONFIG,                  // { beer: { tableName, label, ... }, print: ..., assembly: ... }
  SHARED_INPUT_FIELDS,          // ['supervisor_count', 'worker_count', ...]
  SHARED_CALC_FIELDS,           // ['balance', 'balance_ratio']
  SHARED_EXPENSE_FIELDS,        // ['worker_wage', 'supervisor_wage', ...]
  getAllInputFields(dept),      // [...shared, ...unique input fields, 'remark']
  getAllFields(dept),           // [...shared, ...shared calc, ...unique, ...unique calc, 'remark']
  getExpenseFields(dept),       // [...shared expense, ...unique expense]

  // === 新接口 ===
  MODULES,                      // { balance: { key, label, departments } }
  getColumnMap(moduleKey),      // 生成 COLUMN_MAP 对象
  getModuleConfig(moduleKey, dept),  // 获取某模块某部门的完整配置
  validateConfig(),             // 启动校验
};
```

## 5. calc.js 迁移

### 5.1 文件位置变化

`utils/calc.js` → `modules/balance/calc.js`

### 5.2 代码变化

- 计算逻辑完全不变
- require 路径从 `require('./dept-config')` 改为 `require('../index')`（或直接从 config 中获取费用字段列表）

## 6. 路由文件改动

### 6.1 records.js

```diff
- const { DEPT_CONFIG, getAllInputFields } = require('../utils/dept-config');
- const { calculateRecord } = require('../utils/calc');
+ const { DEPT_CONFIG, getAllInputFields } = require('../modules');
+ const { calculateRecord } = require('../modules/balance/calc');
```

其余代码不变。

### 6.2 import-export.js

```diff
- const { DEPT_CONFIG, getAllInputFields } = require('../utils/dept-config');
- const { calculateRecord } = require('../utils/calc');
+ const { DEPT_CONFIG, getAllInputFields, getColumnMap } = require('../modules');
+ const { calculateRecord } = require('../modules/balance/calc');

- // 中文列名 → 英文字段名映射（基于实际Excel表头）
- const COLUMN_MAP = {
-   '日期': 'record_date',
-   '车间': 'workshop_name',
-   ... (100+ 行)
- };
+ // 从模块配置自动生成
+ const COLUMN_MAP = getColumnMap('balance');
```

REVERSE_COLUMN_MAP 的生成逻辑保持不变（已在模块外，从 COLUMN_MAP 推导）。

### 6.3 summary.js

```diff
- const { DEPT_CONFIG } = require('../utils/dept-config');
+ const { DEPT_CONFIG } = require('../modules');
```

### 6.4 server.js

```diff
- const { validateConfig } = require('./utils/dept-config');
+ const { validateConfig } = require('./modules');
```

## 7. 测试

### 7.1 现有测试迁移

```diff
- const { calculateRecord } = require('../utils/calc');
+ const { calculateRecord } = require('../modules/balance/calc');
```

测试用例不变，跑通即证明计算逻辑无误。

### 7.2 新增兼容性测试

新增 `tests/modules.test.js`，验证兼容层输出与旧配置完全一致：

- `DEPT_CONFIG` 结构正确（包含 tableName, label, uniqueInputFields 等）
- `getAllInputFields('beer')` 返回正确的字段数组
- `getExpenseFields('beer')` 返回正确的费用字段数组
- `getColumnMap('balance')` 包含所有原 COLUMN_MAP 的映射
- `validateConfig()` 不抛错

## 8. 删除的文件

| 文件 | 替代 |
|------|------|
| `utils/dept-config.js` | `modules/balance/config.js` + `modules/index.js` |
| `utils/calc.js` | `modules/balance/calc.js` |

## 9. 不动的文件

| 文件 | 原因 |
|------|------|
| `public/js/app.js` | 前端不动（方案 B 核心约束） |
| `public/css/theme.css` | 样式无关 |
| `db/init.sql` | 数据库不变 |
| `utils/async-handler.js` | 与模块无关 |
| `routes/auth.js` | 不依赖 DEPT_CONFIG |
| `routes/users.js` | 不依赖 DEPT_CONFIG |
| `routes/workshops.js` | 不依赖 DEPT_CONFIG |
| `routes/settings.js` | 不依赖 DEPT_CONFIG |
| `routes/audit-logs.js` | 不依赖 DEPT_CONFIG |
| `routes/backup.js` | 不依赖 DEPT_CONFIG |

## 10. 未来扩展路径

新增模块时（具体模块待用户确认，以下为结构示例）：

1. 创建 `modules/<模块名>/config.js`（定义字段和别名）
2. 创建 `modules/<模块名>/calc.js`（定义计算公式）
3. 在 `modules/index.js` 注册新模块
4. 数据库新建对应的表
5. 前端 `app.js` 添加对应的 UI 配置（等做了 API 下发后这步也可省略）
