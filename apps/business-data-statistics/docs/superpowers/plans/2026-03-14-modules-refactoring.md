# Modules 目录重构实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把后端配置从 `utils/dept-config.js` + `utils/calc.js` + `routes/import-export.js` 中的 COLUMN_MAP 收拢到 `modules/balance/` 目录，对外接口不变。

**Architecture:** 新建 `modules/balance/config.js`（字段定义）和 `modules/balance/calc.js`（计算逻辑），由 `modules/index.js` 兼容层对外暴露与旧 `utils/dept-config.js` 完全一致的接口。路由文件只改 require 路径。

**Tech Stack:** Node.js / Express / Jest

**Spec:** `docs/design/2026-03-13-modules-refactoring-design.md`

---

## Chunk 1: 核心模块文件 + 兼容性测试

### Task 1: 创建 modules/balance/config.js

**Files:**
- Create: `modules/balance/config.js`

- [ ] **Step 1: 创建 config.js 文件**

```js
// modules/balance/config.js
// 三工结余模块的字段定义：每个字段是一个对象，通过标记区分角色

module.exports = {
  key: 'balance',
  label: '三工结余',

  // 结构字段：每条记录必有的非数据字段（日期、车间、备注）
  // 不参与计算，但需要在 COLUMN_MAP 中映射
  structuralFields: [
    { field: 'record_date', label: '日期', aliases: [] },
    { field: 'workshop_name', label: '车间', aliases: ['车间名称'] },
    { field: 'remark', label: '备注', aliases: ['备 注'] },
  ],

  // 所有部门共享的输入字段
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

  // 导入时需要跳过的 Excel 列名（不属于任何字段的 label/alias）
  skipColumns: ['结余金额', '结余%'],

  departments: {
    beer: {
      tableName: 'beer_records',
      label: '啤机部',
      workshops: ['兴信A', '兴信B', '华登', '邵阳'],
      sharedFieldAliases: {},
      uniqueFields: [
        { field: 'total_machines', label: '总台数', type: 'integer', input: true, expense: false },
        { field: 'running_machines', label: '开机台数', type: 'integer', input: true, expense: false },
        { field: 'misc_workers', label: '杂工人数', type: 'integer', input: true, expense: false },
        { field: 'gate_workers', label: '批水口人数', type: 'integer', input: true, expense: false },
        { field: 'run_hours', label: '开机时间', type: 'number', input: true, expense: false },
        { field: 'output_tax_incl', label: '总产值含税', type: 'number', input: true, expense: false,
          aliases: ['不含税产值（含税产值/1.13）', '不含税产值(含税产值/1.13)'] },
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
      sharedFieldAliases: {
        tool_investment: ['工具'],
        shipping_fee: ['运费_1'],
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
      sharedFieldAliases: {
        tool_investment: ['夹具部工具投资'],
      },
      uniqueFields: [
        // calc + importable：既是计算字段又可从 Excel 导入
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

- [ ] **Step 2: 提交**

```bash
git add modules/balance/config.js
git commit -m "feat(modules): add balance config with tagged field objects"
```

---

### Task 2: 创建 modules/index.js 兼容层

**Files:**
- Create: `modules/index.js`

- [ ] **Step 1: 创建 index.js 兼容层**

```js
// modules/index.js
// 模块注册表 + 兼容层：从新配置格式推导出旧接口格式
const balanceConfig = require('./balance/config');

// === 从新配置推导旧格式 ===

// 共享输入字段名数组
const SHARED_INPUT_FIELDS = balanceConfig.sharedFields
  .filter(f => f.input)
  .map(f => f.field);

// 共享费用字段名数组
const SHARED_EXPENSE_FIELDS = balanceConfig.sharedFields
  .filter(f => f.expense)
  .map(f => f.field);

// 共享计算字段名数组
const SHARED_CALC_FIELDS = balanceConfig.sharedCalcFields
  .map(f => f.field);

// 构建 DEPT_CONFIG（与旧 utils/dept-config.js 格式完全兼容）
const DEPT_CONFIG = {};
for (const [dept, deptConf] of Object.entries(balanceConfig.departments)) {
  DEPT_CONFIG[dept] = {
    tableName: deptConf.tableName,
    label: deptConf.label,
    workshops: deptConf.workshops,
    uniqueInputFields: deptConf.uniqueFields
      .filter(f => f.input)
      .map(f => f.field),
    uniqueCalcFields: deptConf.uniqueFields
      .filter(f => f.calc)
      .map(f => f.field),
    uniqueExpenseFields: deptConf.uniqueFields
      .filter(f => f.expense)
      .map(f => f.field),
  };
}

// === 兼容旧接口的函数 ===

function getAllInputFields(dept) {
  return [...SHARED_INPUT_FIELDS, ...DEPT_CONFIG[dept].uniqueInputFields, 'remark'];
}

function getAllFields(dept) {
  return [
    ...SHARED_INPUT_FIELDS, ...SHARED_CALC_FIELDS,
    ...DEPT_CONFIG[dept].uniqueInputFields,
    ...DEPT_CONFIG[dept].uniqueCalcFields,
    'remark'
  ];
}

function getExpenseFields(dept) {
  return [...SHARED_EXPENSE_FIELDS, ...DEPT_CONFIG[dept].uniqueExpenseFields];
}

// === 新接口：生成 COLUMN_MAP ===

function getColumnMap(moduleKey) {
  const config = MODULES[moduleKey];
  if (!config) throw new Error(`[getColumnMap] 未知模块: ${moduleKey}`);
  const map = {};

  // 辅助函数：添加映射（label 和 aliases），先到先得
  function addMapping(label, field, aliases) {
    if (!map[label]) map[label] = field;
    if (aliases) {
      for (const alias of aliases) {
        if (!map[alias]) map[alias] = field;
      }
    }
  }

  // 1. 结构字段
  for (const sf of config.structuralFields) {
    addMapping(sf.label, sf.field, sf.aliases);
  }

  // 2. 共享输入字段
  for (const f of config.sharedFields) {
    addMapping(f.label, f.field, f.aliases);
  }

  // 3. skipColumns（全局跳过的列名）
  for (const col of config.skipColumns) {
    if (!map[col]) map[col] = '_skip_calc';
  }

  // 4. 各部门的独有字段 + sharedFieldAliases
  for (const [dept, deptConf] of Object.entries(config.departments)) {
    // 部门特有的共享字段别名
    if (deptConf.sharedFieldAliases) {
      for (const [field, aliases] of Object.entries(deptConf.sharedFieldAliases)) {
        for (const alias of aliases) {
          if (!map[alias]) map[alias] = field;
        }
      }
    }

    // 部门独有字段
    for (const f of deptConf.uniqueFields) {
      if (f.calc) {
        // importable 的计算字段：生成普通映射（可导入）
        if (f.importable) {
          addMapping(f.label, f.field, f.aliases);
        }
        // skipAliases：导入时跳过
        if (f.skipAliases) {
          for (const alias of f.skipAliases) {
            if (!map[alias]) map[alias] = '_skip_calc';
          }
        }
      } else {
        // 输入字段：label + aliases 都映射到字段名
        addMapping(f.label, f.field, f.aliases);
      }
    }
  }

  return map;
}

// === 启动校验 ===

function validateConfig() {
  for (const [dept, config] of Object.entries(DEPT_CONFIG)) {
    const allInput = new Set([...SHARED_INPUT_FIELDS, ...config.uniqueInputFields]);
    const allExpense = [...SHARED_EXPENSE_FIELDS, ...config.uniqueExpenseFields];

    // 校验1：所有费用字段必须存在于输入字段中
    const missingInInput = allExpense.filter(f => !allInput.has(f));
    if (missingInInput.length > 0) {
      throw new Error(`[配置校验失败] ${config.label}(${dept}): 费用字段 [${missingInInput.join(', ')}] 不在输入字段中，结余计算将出错`);
    }

    // 校验2：费用字段不能出现在计算字段中
    const calcSet = new Set(config.uniqueCalcFields);
    const expenseInCalc = allExpense.filter(f => calcSet.has(f));
    if (expenseInCalc.length > 0) {
      throw new Error(`[配置校验失败] ${config.label}(${dept}): 费用字段 [${expenseInCalc.join(', ')}] 同时出现在计算字段中，这会导致循环依赖`);
    }
  }
  console.log('[配置校验] 所有部门费用字段配置校验通过');
}

// === 模块注册表 ===

const MODULES = {
  balance: balanceConfig,
};

module.exports = {
  // 兼容旧接口
  DEPT_CONFIG,
  SHARED_INPUT_FIELDS,
  SHARED_CALC_FIELDS,
  SHARED_EXPENSE_FIELDS,
  getAllInputFields,
  getAllFields,
  getExpenseFields,
  validateConfig,
  // 新接口
  MODULES,
  getColumnMap,
};
```

- [ ] **Step 2: 提交**

```bash
git add modules/index.js
git commit -m "feat(modules): add index.js compatibility layer"
```

---

### Task 3: 编写兼容性测试

**Files:**
- Create: `tests/modules.test.js`
- Read: `utils/dept-config.js` (旧配置，用于对比)
- Read: `routes/import-export.js` (旧 COLUMN_MAP，用于对比)

- [ ] **Step 1: 编写测试文件**

测试验证新模块输出与旧配置完全一致。

```js
// tests/modules.test.js
// 兼容性测试：验证 modules/ 推导出的接口与旧 utils/dept-config.js 一致

const oldConfig = require('../utils/dept-config');
const newConfig = require('../modules');

describe('modules/ 兼容层', () => {

  describe('SHARED 常量', () => {
    test('SHARED_INPUT_FIELDS 与旧配置一致', () => {
      expect(newConfig.SHARED_INPUT_FIELDS).toEqual(oldConfig.SHARED_INPUT_FIELDS);
    });

    test('SHARED_EXPENSE_FIELDS 与旧配置一致', () => {
      expect(newConfig.SHARED_EXPENSE_FIELDS).toEqual(oldConfig.SHARED_EXPENSE_FIELDS);
    });

    test('SHARED_CALC_FIELDS 与旧配置一致', () => {
      expect(newConfig.SHARED_CALC_FIELDS).toEqual(oldConfig.SHARED_CALC_FIELDS);
    });
  });

  describe('DEPT_CONFIG 结构', () => {
    const depts = ['beer', 'print', 'assembly'];

    test.each(depts)('%s: tableName 和 label 一致', (dept) => {
      expect(newConfig.DEPT_CONFIG[dept].tableName).toBe(oldConfig.DEPT_CONFIG[dept].tableName);
      expect(newConfig.DEPT_CONFIG[dept].label).toBe(oldConfig.DEPT_CONFIG[dept].label);
    });

    test.each(depts)('%s: workshops 一致', (dept) => {
      expect(newConfig.DEPT_CONFIG[dept].workshops).toEqual(oldConfig.DEPT_CONFIG[dept].workshops);
    });

    test.each(depts)('%s: uniqueInputFields 一致', (dept) => {
      expect(newConfig.DEPT_CONFIG[dept].uniqueInputFields).toEqual(oldConfig.DEPT_CONFIG[dept].uniqueInputFields);
    });

    test.each(depts)('%s: uniqueCalcFields 一致', (dept) => {
      expect(newConfig.DEPT_CONFIG[dept].uniqueCalcFields).toEqual(oldConfig.DEPT_CONFIG[dept].uniqueCalcFields);
    });

    test.each(depts)('%s: uniqueExpenseFields 一致', (dept) => {
      expect(newConfig.DEPT_CONFIG[dept].uniqueExpenseFields).toEqual(oldConfig.DEPT_CONFIG[dept].uniqueExpenseFields);
    });
  });

  describe('函数接口', () => {
    const depts = ['beer', 'print', 'assembly'];

    test.each(depts)('getAllInputFields(%s) 一致', (dept) => {
      expect(newConfig.getAllInputFields(dept)).toEqual(oldConfig.getAllInputFields(dept));
    });

    test.each(depts)('getAllFields(%s) 一致', (dept) => {
      expect(newConfig.getAllFields(dept)).toEqual(oldConfig.getAllFields(dept));
    });

    test.each(depts)('getExpenseFields(%s) 一致', (dept) => {
      expect(newConfig.getExpenseFields(dept)).toEqual(oldConfig.getExpenseFields(dept));
    });
  });

  describe('validateConfig', () => {
    test('校验通过不抛错', () => {
      expect(() => newConfig.validateConfig()).not.toThrow();
    });
  });

  describe('getColumnMap', () => {
    test('生成的 COLUMN_MAP 是旧 COLUMN_MAP 的超集', () => {
      // 旧 COLUMN_MAP 中的每个映射都必须在新 map 中存在且值相同
      // 新 map 可能多出一些由 label 自动生成的映射（如 '装配批水口配件费'），这是允许的
      const newMap = newConfig.getColumnMap('balance');

      // 手动构建旧 COLUMN_MAP 的关键映射进行验证
      const criticalMappings = {
        '日期': 'record_date',
        '车间': 'workshop_name',
        '车间名称': 'workshop_name',
        '备注': 'remark',
        '备 注': 'remark',
        '管工人数': 'supervisor_count',
        '员工人数': 'worker_count',
        '员工人数(不包杂工)': 'worker_count',
        '总产值/天': 'daily_output',
        '产值': 'daily_output',
        '员工工资/天': 'worker_wage',
        '员工工资': 'worker_wage',
        '管工工资/天': 'supervisor_wage',
        '生产管工工资': 'supervisor_wage',
        '社保': 'social_insurance',
        '湖南社保': 'social_insurance',
        '税收': 'tax',
        '湖南税收': 'tax',
        '结余金额': '_skip_calc',
        '结余%': '_skip_calc',
        // 啤机
        '总台数': 'total_machines',
        '不含税产值（含税产值/1.13）': 'output_tax_incl',
        '批水口加工费（全包）': 'gate_processing_fee',
        '装配帮啤机批水口加工配件费用': 'assembly_gate_parts_fee',
        '可回收外厂批水口加工费': 'recoverable_gate_fee',
        '开机率': '_skip_calc',
        '平均每台结余': '_skip_calc',
        // 印喷
        '移印机总台数': 'pad_total_machines',
        '工具': 'tool_investment',
        '运费_1': 'shipping_fee',
        '物料（原子灰、胶头、油墨、喷码溶剂）': 'materials',
        '员工人均产值': '_skip_calc',
        // 装配
        '人均产值': 'avg_output_per_worker',
        '夹具部工具投资': 'tool_investment',
        '车间工具投资': 'workshop_tool_investment',
        '结余减胶纸': '_skip_calc',
      };

      for (const [cn, en] of Object.entries(criticalMappings)) {
        expect(newMap[cn]).toBe(en);
      }
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认全部通过**

```bash
npx jest tests/modules.test.js --verbose
```

Expected: 所有测试 PASS

- [ ] **Step 3: 提交**

```bash
git add tests/modules.test.js
git commit -m "test(modules): add compatibility tests for new config layer"
```

---

## Chunk 2: 迁移 calc.js + 切换路由 require + 清理

### Task 4: 迁移 calc.js 到 modules/balance/

**Files:**
- Create: `modules/balance/calc.js`
- Read: `utils/calc.js` (迁移源)

- [ ] **Step 1: 创建 modules/balance/calc.js**

计算逻辑等价，require 路径改为从 modules/index 导入。部门计算中增加了显式 parseFloat 防护，结果与原代码数值一致。

```js
// modules/balance/calc.js
// 三工结余模块的计算公式（从 utils/calc.js 迁移，逻辑等价，增加了 parseFloat 防护）
const { DEPT_CONFIG, SHARED_EXPENSE_FIELDS } = require('../index');

function calculateRecord(dept, record) {
  const result = { ...record };
  const config = DEPT_CONFIG[dept];
  if (!config) return result;

  // 计算结余 = 日产值 - 所有费用
  const expenseFields = [...SHARED_EXPENSE_FIELDS, ...config.uniqueExpenseFields];
  const totalExpense = expenseFields.reduce((sum, field) => sum + (parseFloat(result[field]) || 0), 0);
  const dailyOutput = parseFloat(result.daily_output) || 0;

  result.balance = dailyOutput - totalExpense;
  result.balance_ratio = dailyOutput > 0 ? result.balance / dailyOutput : 0;

  // 部门独有计算
  if (dept === 'beer') {
    const total = parseFloat(result.total_machines) || 0;
    const running = parseFloat(result.running_machines) || 0;
    result.machine_rate = total > 0 ? running / total : 0;
    result.avg_output_per_machine = running > 0 ? dailyOutput / running : 0;
    result.wage_ratio = dailyOutput > 0 ? ((parseFloat(result.worker_wage) || 0) + (parseFloat(result.supervisor_wage) || 0) + (parseFloat(result.misc_worker_wage) || 0)) / dailyOutput : 0;
    result.mold_cost_ratio = dailyOutput > 0 ? (parseFloat(result.mold_repair) || 0) / dailyOutput : 0;
    result.gate_cost_ratio = dailyOutput > 0 ? (parseFloat(result.gate_processing_fee) || 0) / dailyOutput : 0;
    result.avg_balance_per_machine = running > 0 ? result.balance / running : 0;
  } else if (dept === 'print') {
    const padTotal = parseFloat(result.pad_total_machines) || 0;
    const padRunning = parseFloat(result.pad_running_machines) || 0;
    const sprayTotal = parseFloat(result.spray_total_machines) || 0;
    const sprayRunning = parseFloat(result.spray_running_machines) || 0;
    result.pad_machine_rate = padTotal > 0 ? padRunning / padTotal : 0;
    result.spray_machine_rate = sprayTotal > 0 ? sprayRunning / sprayTotal : 0;
    result.avg_output_per_worker = (parseFloat(result.worker_count) || 0) > 0 ? dailyOutput / parseFloat(result.worker_count) : 0;
    result.wage_ratio = dailyOutput > 0 ? ((parseFloat(result.worker_wage) || 0) + (parseFloat(result.supervisor_wage) || 0)) / dailyOutput : 0;
    result.office_wage_ratio = dailyOutput > 0 ? (parseFloat(result.office_wage) || 0) / dailyOutput : 0;
    result.mold_fee_ratio = dailyOutput > 0 ? (parseFloat(result.auto_mold_fee) || 0) / dailyOutput : 0;
    result.total_ratio = result.balance_ratio;
  } else if (dept === 'assembly') {
    const workerCount = parseFloat(result.worker_count) || 0;
    const plannedWage = parseFloat(result.planned_wage_tax) || 0;
    result.avg_output_per_worker = workerCount > 0 ? dailyOutput / workerCount : 0;
    result.balance_minus_tape = result.balance - (parseFloat(result.tape) || 0);
    result.balance_tape_ratio = plannedWage > 0 ? result.balance_minus_tape / plannedWage : 0;
    result.tool_invest_ratio = plannedWage > 0 ? (parseFloat(result.tool_investment) || 0) / plannedWage : 0;
    result.borrowed_wage_ratio = plannedWage > 0 ? (parseFloat(result.borrowed_worker_wage) || 0) / plannedWage : 0;
  }

  return result;
}

module.exports = { calculateRecord };
```

- [ ] **Step 2: 运行旧的计算测试，验证新 calc.js 计算结果一致**

先临时修改 `tests/calc.test.js` 的 require 路径指向新文件：

```js
// 将第 1 行从：
// const { calculateRecord } = require('../utils/calc');
// 改为：
const { calculateRecord } = require('../modules/balance/calc');
```

```bash
npx jest tests/calc.test.js --verbose
```

Expected: 所有原有测试 PASS

- [ ] **Step 3: 提交**

```bash
git add modules/balance/calc.js tests/calc.test.js
git commit -m "feat(modules): migrate calc.js to modules/balance/, update test require"
```

---

### Task 5: 切换所有路由文件的 require 路径

**Files:**
- Modify: `routes/records.js:6-7` (两行 require)
- Modify: `routes/import-export.js:7-8` (两行 require) + 删除 COLUMN_MAP 定义
- Modify: `routes/summary.js:5` (一行 require)
- Modify: `server.js:6` (一行 require)

- [ ] **Step 1: 修改 routes/records.js**

```diff
- const { DEPT_CONFIG, getAllInputFields } = require('../utils/dept-config');
- const { calculateRecord } = require('../utils/calc');
+ const { DEPT_CONFIG, getAllInputFields } = require('../modules');
+ const { calculateRecord } = require('../modules/balance/calc');
```

- [ ] **Step 2: 修改 routes/import-export.js**

```diff
- const { DEPT_CONFIG, getAllInputFields } = require('../utils/dept-config');
- const { calculateRecord } = require('../utils/calc');
+ const { DEPT_CONFIG, getAllInputFields, getColumnMap } = require('../modules');
+ const { calculateRecord } = require('../modules/balance/calc');
```

同时删除文件中的 COLUMN_MAP 定义（大约第 20-114 行的整个 `const COLUMN_MAP = { ... };`），替换为：

```js
// 从模块配置自动生成 COLUMN_MAP
const COLUMN_MAP = getColumnMap('balance');
```

REVERSE_COLUMN_MAP 的生成代码保持不变（它从 COLUMN_MAP 推导，无需修改）。

- [ ] **Step 3: 修改 routes/summary.js**

```diff
- const { DEPT_CONFIG } = require('../utils/dept-config');
+ const { DEPT_CONFIG } = require('../modules');
```

- [ ] **Step 4: 修改 server.js**

```diff
- const { validateConfig } = require('./utils/dept-config');
+ const { validateConfig } = require('./modules');
```

- [ ] **Step 5: 运行全部测试**

```bash
npx jest --verbose
```

Expected: 所有测试 PASS（calc 测试 + modules 兼容性测试）

- [ ] **Step 6: 提交**

```bash
git add routes/records.js routes/import-export.js routes/summary.js server.js
git commit -m "refactor: switch all require paths from utils/ to modules/"
```

---

### Task 6: 删除旧文件 + 最终验证

**Files:**
- Delete: `utils/dept-config.js`
- Delete: `utils/calc.js`

- [ ] **Step 1: 更新 tests/modules.test.js，移除对旧文件的依赖**

删除旧文件前，`tests/modules.test.js` 引用了 `require('../utils/dept-config')`。需要把对比测试改为独立的断言（不再依赖旧文件）：

```js
// tests/modules.test.js（更新版）
// 兼容性测试：验证 modules/ 推导出的接口格式正确

const config = require('../modules');

describe('modules/ 兼容层', () => {

  describe('SHARED 常量', () => {
    test('SHARED_INPUT_FIELDS 包含 14 个共享输入字段', () => {
      expect(config.SHARED_INPUT_FIELDS).toEqual([
        'supervisor_count', 'worker_count', 'daily_output',
        'worker_wage', 'supervisor_wage', 'rent', 'utility_fee',
        'tool_investment', 'equipment', 'renovation', 'misc_fee',
        'shipping_fee', 'social_insurance', 'tax'
      ]);
    });

    test('SHARED_EXPENSE_FIELDS 包含 11 个共享费用字段', () => {
      expect(config.SHARED_EXPENSE_FIELDS).toEqual([
        'worker_wage', 'supervisor_wage', 'rent', 'utility_fee',
        'tool_investment', 'equipment', 'renovation', 'misc_fee',
        'shipping_fee', 'social_insurance', 'tax'
      ]);
    });

    test('SHARED_CALC_FIELDS 包含 balance 和 balance_ratio', () => {
      expect(config.SHARED_CALC_FIELDS).toEqual(['balance', 'balance_ratio']);
    });
  });

  describe('DEPT_CONFIG 结构', () => {
    test('beer: 基本信息正确', () => {
      expect(config.DEPT_CONFIG.beer.tableName).toBe('beer_records');
      expect(config.DEPT_CONFIG.beer.label).toBe('啤机部');
      expect(config.DEPT_CONFIG.beer.workshops).toEqual(['兴信A', '兴信B', '华登', '邵阳']);
    });

    test('beer: uniqueInputFields 有 14 个字段', () => {
      expect(config.DEPT_CONFIG.beer.uniqueInputFields).toHaveLength(14);
      expect(config.DEPT_CONFIG.beer.uniqueInputFields).toContain('total_machines');
      expect(config.DEPT_CONFIG.beer.uniqueInputFields).toContain('materials');
    });

    test('beer: uniqueCalcFields 有 6 个字段', () => {
      expect(config.DEPT_CONFIG.beer.uniqueCalcFields).toHaveLength(6);
      expect(config.DEPT_CONFIG.beer.uniqueCalcFields).toContain('machine_rate');
    });

    test('beer: uniqueExpenseFields 有 8 个字段', () => {
      expect(config.DEPT_CONFIG.beer.uniqueExpenseFields).toHaveLength(8);
      expect(config.DEPT_CONFIG.beer.uniqueExpenseFields).toContain('misc_worker_wage');
    });

    test('print: uniqueInputFields 有 23 个字段', () => {
      expect(config.DEPT_CONFIG.print.uniqueInputFields).toHaveLength(23);
    });

    test('print: uniqueExpenseFields 有 11 个字段', () => {
      expect(config.DEPT_CONFIG.print.uniqueExpenseFields).toHaveLength(11);
    });

    test('assembly: uniqueInputFields 有 12 个字段', () => {
      expect(config.DEPT_CONFIG.assembly.uniqueInputFields).toHaveLength(12);
    });

    test('assembly: uniqueCalcFields 包含 avg_output_per_worker', () => {
      expect(config.DEPT_CONFIG.assembly.uniqueCalcFields).toContain('avg_output_per_worker');
    });
  });

  describe('函数接口', () => {
    test('getAllInputFields(beer) 以 remark 结尾', () => {
      const fields = config.getAllInputFields('beer');
      expect(fields[fields.length - 1]).toBe('remark');
      expect(fields).toHaveLength(14 + 14 + 1); // shared + unique + remark
    });

    test('getExpenseFields(beer) 有 19 个费用字段', () => {
      expect(config.getExpenseFields('beer')).toHaveLength(11 + 8); // shared + unique
    });
  });

  describe('validateConfig', () => {
    test('校验通过不抛错', () => {
      expect(() => config.validateConfig()).not.toThrow();
    });
  });

  describe('getColumnMap', () => {
    const map = config.getColumnMap('balance');

    test('结构字段映射正确', () => {
      expect(map['日期']).toBe('record_date');
      expect(map['车间']).toBe('workshop_name');
      expect(map['车间名称']).toBe('workshop_name');
      expect(map['备注']).toBe('remark');
      expect(map['备 注']).toBe('remark');
    });

    test('共享字段及别名映射正确', () => {
      expect(map['管工人数']).toBe('supervisor_count');
      expect(map['员工人数(不包杂工)']).toBe('worker_count');
      expect(map['产值']).toBe('daily_output');
      expect(map['员工工资']).toBe('worker_wage');
      expect(map['湖南社保']).toBe('social_insurance');
    });

    test('skipColumns 映射到 _skip_calc', () => {
      expect(map['结余金额']).toBe('_skip_calc');
      expect(map['结余%']).toBe('_skip_calc');
    });

    test('部门特有共享字段别名正确', () => {
      expect(map['工具']).toBe('tool_investment');
      expect(map['运费_1']).toBe('shipping_fee');
      expect(map['夹具部工具投资']).toBe('tool_investment');
    });

    test('calc + importable 字段生成普通映射', () => {
      expect(map['人均产值']).toBe('avg_output_per_worker');
    });

    test('calc 字段的 skipAliases 映射到 _skip_calc', () => {
      expect(map['开机率']).toBe('_skip_calc');
      expect(map['平均每台结余']).toBe('_skip_calc');
      expect(map['结余减胶纸']).toBe('_skip_calc');
      expect(map['员工人均产值']).toBe('_skip_calc');
    });

    test('未知模块抛错', () => {
      expect(() => config.getColumnMap('unknown')).toThrow('未知模块');
    });
  });
});
```

- [ ] **Step 2: 删除旧文件**

```bash
git rm utils/dept-config.js utils/calc.js
```

- [ ] **Step 3: 运行全部测试，确认无残留引用**

```bash
npx jest --verbose
```

Expected: 所有测试 PASS

- [ ] **Step 4: 搜索确认无遗漏引用**

```bash
grep -r "utils/dept-config\|utils/calc" --include="*.js" .
```

Expected: 无匹配结果（设计文档中的引用不算）

- [ ] **Step 5: 启动服务验证**

```bash
node server.js
```

Expected: 看到 `[配置校验] 所有部门费用字段配置校验通过` 和端口 6001 监听成功

- [ ] **Step 6: 提交**

```bash
git add tests/modules.test.js
git commit -m "refactor: remove old utils/dept-config.js and utils/calc.js, update tests"
```

---

## 文件变更总结

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `modules/balance/config.js` | 字段定义（tagged objects） |
| 新建 | `modules/balance/calc.js` | 计算逻辑（从 utils/calc.js 迁移） |
| 新建 | `modules/index.js` | 兼容层（推导旧接口格式） |
| 新建 | `tests/modules.test.js` | 兼容性测试 |
| 修改 | `routes/records.js` | require 路径改为 modules/ |
| 修改 | `routes/import-export.js` | require 路径 + 删除 COLUMN_MAP 定义 |
| 修改 | `routes/summary.js` | require 路径改为 modules/ |
| 修改 | `server.js` | require 路径改为 modules/ |
| 修改 | `tests/calc.test.js` | require 路径改为 modules/balance/calc |
| 删除 | `utils/dept-config.js` | 被 modules/balance/config.js 替代 |
| 删除 | `utils/calc.js` | 被 modules/balance/calc.js 替代 |
