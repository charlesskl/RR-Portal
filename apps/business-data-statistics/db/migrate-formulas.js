/**
 * 迁移脚本：将 config.js 中的硬编码字段定义和公式迁移到数据库
 *
 * 迁移内容：
 * 1. field_registry — 从 config.js 读取所有字段定义
 * 2. field_tags — 从 expense: true 标记生成费用标签
 * 3. formula_configs — 从 calc.js 逻辑提取公式文本
 *
 * 幂等设计：使用 ON CONFLICT DO NOTHING，可重复执行
 * 用法：node db/migrate-formulas.js
 */

const { query } = require('./postgres');
const balanceConfig = require('../modules/balance/config');

const MODULE = 'balance';

// ===== 1. 迁移 field_registry =====

async function migrateFieldRegistry() {
  let order = 0;

  // 1a. 共享输入字段
  for (const f of balanceConfig.sharedFields) {
    order++;
    const fieldType = f.calc ? 'calc' : (f.expense ? 'expense' : 'input');
    const aliases = f.aliases ? JSON.stringify(f.aliases) : null;
    await query(
      `INSERT INTO field_registry (module, department, field_key, field_label, field_type, data_type, aliases, importable, sort_order)
       VALUES (?, '_shared', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (module, department, field_key) DO NOTHING`,
      [MODULE, f.field, f.label, fieldType, f.type || 'number', aliases, true, order]
    );
  }
  console.log(`  共享输入字段：${order} 个`);

  // 1b. 共享计算字段
  for (const f of balanceConfig.sharedCalcFields) {
    order++;
    await query(
      `INSERT INTO field_registry (module, department, field_key, field_label, field_type, data_type, aliases, importable, sort_order)
       VALUES (?, '_shared', ?, ?, 'calc', ?, NULL, false, ?)
       ON CONFLICT (module, department, field_key) DO NOTHING`,
      [MODULE, f.field, f.label, f.type || 'number', order]
    );
  }
  console.log(`  共享计算字段：${balanceConfig.sharedCalcFields.length} 个`);

  // 1c. 各部门独有字段
  for (const [dept, deptConf] of Object.entries(balanceConfig.departments)) {
    let deptOrder = 0;
    for (const f of deptConf.uniqueFields) {
      deptOrder++;
      const fieldType = f.calc ? 'calc' : (f.expense ? 'expense' : 'input');
      // 合并 aliases 和 skipAliases
      const allAliases = [...(f.aliases || []), ...(f.skipAliases || [])];
      const aliasesJson = allAliases.length > 0 ? JSON.stringify(allAliases) : null;
      const importable = f.calc ? (f.importable === true) : true;
      await query(
        `INSERT INTO field_registry (module, department, field_key, field_label, field_type, data_type, aliases, importable, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (module, department, field_key) DO NOTHING`,
        [MODULE, dept, f.field, f.label, fieldType, f.type || 'number', aliasesJson, importable, deptOrder]
      );
    }
    console.log(`  ${deptConf.label} 独有字段：${deptOrder} 个`);
  }
}

// ===== 2. 迁移 field_tags =====

async function migrateFieldTags() {
  let count = 0;

  // 2a. 共享费用字段打 expense 标签
  for (const f of balanceConfig.sharedFields) {
    if (f.expense) {
      await query(
        `INSERT INTO field_tags (module, department, field_key, tag)
         VALUES (?, '_shared', ?, 'expense')
         ON CONFLICT (module, department, field_key, tag) DO NOTHING`,
        [MODULE, f.field]
      );
      count++;
    }
  }

  // 2b. 各部门独有费用字段打 expense 标签
  for (const [dept, deptConf] of Object.entries(balanceConfig.departments)) {
    for (const f of deptConf.uniqueFields) {
      if (f.expense) {
        await query(
          `INSERT INTO field_tags (module, department, field_key, tag)
           VALUES (?, ?, ?, 'expense')
           ON CONFLICT (module, department, field_key, tag) DO NOTHING`,
          [MODULE, dept, f.field]
        );
        count++;
      }
    }
  }
  console.log(`  费用标签：${count} 个`);
}

// ===== 3. 迁移 formula_configs =====
// 从 calc.js 的硬编码逻辑提取公式文本

async function migrateFormulaConfigs() {
  // 所有部门共享的公式
  const sharedFormulas = [
    { field_key: 'balance', field_label: '结余金额', formula_text: '{daily_output} - SUM(expense)', display_format: 'currency', decimal_places: 2 },
    { field_key: 'balance_ratio', field_label: '结余%', formula_text: '{balance} / {daily_output}', display_format: 'percent', decimal_places: 4 },
  ];

  // 啤机部独有公式
  const beerFormulas = [
    { field_key: 'machine_rate', field_label: '开机率', formula_text: '{running_machines} / {total_machines}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'output_tax_incl', field_label: '不含税产值', formula_text: '{daily_output} / 1.13', display_format: 'currency', decimal_places: 2 },
    { field_key: 'avg_output_per_machine', field_label: '每台机平均产值', formula_text: '{daily_output} / {running_machines}', display_format: 'currency', decimal_places: 2 },
    { field_key: 'wage_ratio', field_label: '总工资占产值%', formula_text: '({worker_wage} + {supervisor_wage} + {misc_worker_wage}) / {daily_output}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'mold_cost_ratio', field_label: '模具维修占产值比%', formula_text: '{mold_repair} / {daily_output}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'gate_cost_ratio', field_label: '批水口费用占产值比%', formula_text: '{gate_processing_fee} / {daily_output}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'avg_balance_per_machine', field_label: '平均每台结余', formula_text: '{balance} / {running_machines}', display_format: 'currency', decimal_places: 2 },
  ];

  // 印喷部独有公式
  const printFormulas = [
    { field_key: 'pad_machine_rate', field_label: '移印开机率', formula_text: '{pad_running_machines} / {pad_total_machines}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'spray_machine_rate', field_label: '喷油开机率', formula_text: '{spray_running_machines} / {spray_total_machines}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'avg_output_per_worker', field_label: '员工人均产值', formula_text: '{daily_output} / {worker_count}', display_format: 'currency', decimal_places: 2 },
    { field_key: 'wage_ratio', field_label: '总工资占产值%', formula_text: '({worker_wage} + {supervisor_wage}) / {daily_output}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'office_wage_ratio', field_label: '做办工资占比%', formula_text: '{office_wage} / {daily_output}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'mold_fee_ratio', field_label: '自动机模费占产值%', formula_text: '{auto_mold_fee} / {daily_output}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'hunan_mold_ratio', field_label: '发湖南模费占产值%', formula_text: '{hunan_mold_fee} / {daily_output}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'indonesia_mold_ratio', field_label: '发印尼模费占产值%', formula_text: '{indonesia_mold_fee} / {daily_output}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'total_ratio', field_label: '结余%+自模费%', formula_text: '{balance_ratio} + {mold_fee_ratio}', display_format: 'percent', decimal_places: 4 },
  ];

  // 装配部独有公式
  const assemblyFormulas = [
    { field_key: 'avg_output_per_worker', field_label: '人均产值', formula_text: '{daily_output} / {worker_count}', display_format: 'currency', decimal_places: 2 },
    { field_key: 'balance_minus_tape', field_label: '结余减胶纸', formula_text: '{balance} - {tape}', display_format: 'currency', decimal_places: 2 },
    { field_key: 'balance_tape_ratio', field_label: '减胶纸后结余占计划工资%', formula_text: '{balance_minus_tape} / {planned_wage_tax}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'tool_invest_ratio', field_label: '工具投资占计划工资%', formula_text: '({workshop_tool_investment} + {fixture_tool_investment}) / {planned_wage_tax}', display_format: 'percent', decimal_places: 4 },
    { field_key: 'borrowed_wage_ratio', field_label: '外借人员工资占计划工资%', formula_text: '{borrowed_worker_wage} / {planned_wage_tax}', display_format: 'percent', decimal_places: 4 },
  ];

  // 插入函数
  async function insertFormulas(dept, formulas) {
    for (let i = 0; i < formulas.length; i++) {
      const f = formulas[i];
      await query(
        `INSERT INTO formula_configs (module, department, field_key, field_label, formula_text, display_format, decimal_places, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (module, department, field_key) DO NOTHING`,
        [MODULE, dept, f.field_key, f.field_label, f.formula_text, f.display_format, f.decimal_places, i + 1]
      );
    }
  }

  // 共享公式需要为每个部门各插入一份
  const departments = ['beer', 'print', 'assembly'];
  for (const dept of departments) {
    await insertFormulas(dept, sharedFormulas);
  }
  console.log(`  共享公式：${sharedFormulas.length} × ${departments.length} 部门`);

  // 部门独有公式（sort_order 在共享公式之后）
  const deptFormulaMap = { beer: beerFormulas, print: printFormulas, assembly: assemblyFormulas };
  for (const [dept, formulas] of Object.entries(deptFormulaMap)) {
    // 排序号从共享公式数量+1开始
    const offsetFormulas = formulas.map((f, i) => ({ ...f }));
    for (let i = 0; i < offsetFormulas.length; i++) {
      await query(
        `INSERT INTO formula_configs (module, department, field_key, field_label, formula_text, display_format, decimal_places, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (module, department, field_key) DO NOTHING`,
        [MODULE, dept, offsetFormulas[i].field_key, offsetFormulas[i].field_label, offsetFormulas[i].formula_text, offsetFormulas[i].display_format, offsetFormulas[i].decimal_places, sharedFormulas.length + i + 1]
      );
    }
    console.log(`  ${dept} 独有公式：${formulas.length} 个`);
  }
}

// ===== 执行迁移 =====

async function migrate() {
  console.log('===== 开始迁移 =====');

  console.log('\n1. 迁移字段注册表 (field_registry)...');
  await migrateFieldRegistry();

  console.log('\n2. 迁移字段标签 (field_tags)...');
  await migrateFieldTags();

  console.log('\n3. 迁移公式配置 (formula_configs)...');
  await migrateFormulaConfigs();

  console.log('\n===== 迁移完成 =====');

  // 验证数据
  const registryCount = await query('SELECT COUNT(*) as cnt FROM field_registry');
  const tagsCount = await query('SELECT COUNT(*) as cnt FROM field_tags');
  const formulaCount = await query('SELECT COUNT(*) as cnt FROM formula_configs');
  console.log(`\n验证: field_registry=${registryCount.rows[0].cnt} 条, field_tags=${tagsCount.rows[0].cnt} 条, formula_configs=${formulaCount.rows[0].cnt} 条`);

  process.exit(0);
}

migrate().catch(err => {
  console.error('迁移失败:', err);
  process.exit(1);
});
