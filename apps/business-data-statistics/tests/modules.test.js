// tests/modules.test.js
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

    test('beer: uniqueInputFields 有 13 个字段', () => {
      // output_tax_incl 从 input 改为 calc，从14变为13
      expect(config.DEPT_CONFIG.beer.uniqueInputFields).toHaveLength(13);
      expect(config.DEPT_CONFIG.beer.uniqueInputFields).toContain('total_machines');
      expect(config.DEPT_CONFIG.beer.uniqueInputFields).toContain('materials');
    });

    test('beer: uniqueCalcFields 有 7 个字段', () => {
      // output_tax_incl 从 input 改为 calc，从6变为7
      expect(config.DEPT_CONFIG.beer.uniqueCalcFields).toHaveLength(7);
      expect(config.DEPT_CONFIG.beer.uniqueCalcFields).toContain('machine_rate');
    });

    test('beer: uniqueExpenseFields 有 7 个字段', () => {
      // recoverable_gate_fee 从 expense 改为非 expense，output_tax_incl 从 input 改为 calc
      expect(config.DEPT_CONFIG.beer.uniqueExpenseFields).toHaveLength(7);
      expect(config.DEPT_CONFIG.beer.uniqueExpenseFields).toContain('misc_worker_wage');
      expect(config.DEPT_CONFIG.beer.uniqueExpenseFields).not.toContain('recoverable_gate_fee');
    });

    test('print: uniqueInputFields 有 23 个字段', () => {
      // 删除了 output_tax_incl（与共有 daily_output 重复），从24变为23
      expect(config.DEPT_CONFIG.print.uniqueInputFields).toHaveLength(23);
    });

    test('print: uniqueExpenseFields 有 11 个字段', () => {
      expect(config.DEPT_CONFIG.print.uniqueExpenseFields).toHaveLength(11);
    });

    test('assembly: uniqueInputFields 有 15 个字段', () => {
      // 新增 hunan_social_insurance, hunan_tax, fixture_tool_investment；housing_subsidy 改为非 expense 但仍是 input
      expect(config.DEPT_CONFIG.assembly.uniqueInputFields).toHaveLength(15);
    });

    test('assembly: uniqueCalcFields 包含 avg_output_per_worker', () => {
      expect(config.DEPT_CONFIG.assembly.uniqueCalcFields).toContain('avg_output_per_worker');
    });
  });

  describe('函数接口', () => {
    test('getAllInputFields(beer) 以 remark 结尾', () => {
      const fields = config.getAllInputFields('beer');
      expect(fields[fields.length - 1]).toBe('remark');
      // beer: 13 unique input + 14 shared input + 1 remark = 28
      expect(fields).toHaveLength(13 + 14 + 1);
    });

    test('getExpenseFields(beer) 有 18 个费用字段', () => {
      // 11 shared + 7 unique (recoverable_gate_fee 不再是费用)
      expect(config.getExpenseFields('beer')).toHaveLength(11 + 7);
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
      // 湖南社保现在映射到独立字段，不再是社保的别名
      expect(map['湖南社保']).toBe('hunan_social_insurance');
    });

    test('skipColumns 映射到 _skip_calc', () => {
      expect(map['结余金额']).toBe('_skip_calc');
      expect(map['结余%']).toBe('_skip_calc');
    });

    test('部门特有共享字段别名正确', () => {
      expect(map['工具']).toBe('tool_investment');
      expect(map['运费_1']).toBe('shipping_fee');
      // 夹具部工具投资现在是独立字段，不再映射到 tool_investment
      expect(map['夹具部工具投资']).toBe('fixture_tool_investment');
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
