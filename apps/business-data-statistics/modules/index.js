// modules/index.js
// 模块注册表 + 兼容层：从新配置格式推导出旧接口格式
const balanceConfig = require('./balance/config');

// === 模块注册表 ===

const MODULES = {
  balance: balanceConfig,
};

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

// === 导出用：字段名→中文标签映射（包含计算字段） ===

function getExportLabelMap(moduleKey) {
  const config = MODULES[moduleKey];
  if (!config) throw new Error(`[getExportLabelMap] 未知模块: ${moduleKey}`);
  const map = {};

  // 结构字段
  for (const sf of config.structuralFields) {
    map[sf.field] = sf.label;
  }

  // 共享输入字段
  for (const f of config.sharedFields) {
    map[f.field] = f.label;
  }

  // 共享计算字段（结余金额、结余%）
  for (const f of config.sharedCalcFields) {
    map[f.field] = f.label;
  }

  // 各部门独有字段（输入+计算）
  for (const [dept, deptConf] of Object.entries(config.departments)) {
    for (const f of deptConf.uniqueFields) {
      if (!map[f.field]) map[f.field] = f.label;
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
  getExportLabelMap,
};
