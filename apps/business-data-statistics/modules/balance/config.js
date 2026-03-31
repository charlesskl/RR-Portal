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
    { field: 'social_insurance', label: '社保', type: 'number', input: true, expense: true },
    { field: 'tax', label: '税收', type: 'number', input: true, expense: true },
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
        // 台数组
        { field: 'total_machines', label: '总台数', type: 'integer', input: true, expense: false },
        { field: 'running_machines', label: '开机台数', type: 'integer', input: true, expense: false },
        { field: 'run_hours', label: '开机时间', type: 'number', input: true, expense: false },
        { field: 'machine_rate', label: '开机率', type: 'ratio', calc: true,
          skipAliases: ['开机率'] },
        // 人数组
        { field: 'misc_workers', label: '杂工人数', type: 'integer', input: true, expense: false },
        { field: 'gate_workers', label: '批水口人数', type: 'integer', input: true, expense: false },
        // 产值组（output_tax_incl 从输入改为计算字段）
        { field: 'output_tax_incl', label: '不含税产值', type: 'number', calc: true,
          skipAliases: ['不含税产值', '不含税产值（含税产值/1.13）', '不含税产值(含税产值/1.13)', '总产值含税'] },
        { field: 'avg_output_per_machine', label: '每台机平均产值', type: 'number', calc: true,
          skipAliases: ['每台机平均产值'] },
        // 工资组
        { field: 'misc_worker_wage', label: '杂工工资/天', type: 'number', input: true, expense: true },
        { field: 'wage_ratio', label: '总工资占产值%', type: 'ratio', calc: true,
          skipAliases: ['总工资（包管工）占产值%', '总工资(包管工)占产值%'] },
        // 结余组
        { field: 'avg_balance_per_machine', label: '平均每台结余', type: 'number', calc: true,
          skipAliases: ['平均每台结余'] },
        // 独有费用-维修
        { field: 'machine_repair', label: '机器维修', type: 'number', input: true, expense: true },
        { field: 'mold_repair', label: '模具维修', type: 'number', input: true, expense: true },
        { field: 'mold_cost_ratio', label: '模具维修占产值比%', type: 'ratio', calc: true,
          skipAliases: ['模具费用占产值比%', '模具维修占产值比%'] },
        // 独有费用-物料
        { field: 'materials', label: '物料', type: 'number', input: true, expense: true },
        { field: 'material_supplement', label: '原料补料', type: 'number', input: true, expense: true },
        // 独有费用-水口
        { field: 'gate_processing_fee', label: '批水口加工费', type: 'number', input: true, expense: true,
          aliases: ['批水口加工费（全包）', '批水口加工费(全包)'] },
        { field: 'gate_cost_ratio', label: '批水口费用占产值比%', type: 'ratio', calc: true,
          skipAliases: ['批水口费用占产值比%'] },
        { field: 'assembly_gate_parts_fee', label: '装配批水口配件费', type: 'number', input: true, expense: true,
          aliases: ['装配帮啤机批水口加工配件费用', '装配帮啤机批水口配件费用'] },
        { field: 'recoverable_gate_fee', label: '可回收批水口费', type: 'number', input: true, expense: false,
          aliases: ['可回收外厂批水口加工费'] },
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
        // 台数组
        { field: 'pad_total_machines', label: '移印机总台数', type: 'integer', input: true, expense: false,
          aliases: ['移印总台数', '移印机总台数'] },
        { field: 'pad_running_machines', label: '每天开机台数', type: 'integer', input: true, expense: false,
          aliases: ['移印开机台数'] },
        { field: 'pad_machine_rate', label: '移印开机率', type: 'ratio', calc: true,
          skipAliases: ['开机率'] },
        { field: 'spray_total_machines', label: '喷油机总台数', type: 'integer', input: true, expense: false,
          aliases: ['喷油总台数', '喷油机总台数'] },
        { field: 'spray_running_machines', label: '每天开机台数_1', type: 'integer', input: true, expense: false },
        { field: 'spray_machine_rate', label: '喷油开机率', type: 'ratio', calc: true,
          skipAliases: ['开机率_1'] },
        // 人数组
        { field: 'misc_workers', label: '杂工人数', type: 'integer', input: true, expense: false },
        // 时间组（产值前）
        { field: 'work_hours', label: '员工工时', type: 'number', input: true, expense: false,
          aliases: ['工作时间', '工时'] },
        { field: 'total_hours', label: '总工时', type: 'number', input: true, expense: false,
          aliases: ['总时间'] },
        // 产值组
        { field: 'avg_output_per_worker', label: '员工人均产值', type: 'number', calc: true,
          skipAliases: ['员工人均产值'] },
        // 工资组
        { field: 'wage_ratio', label: '总工资占产值%', type: 'ratio', calc: true,
          skipAliases: ['总工资占产值%'] },
        // 独有费用-维修
        { field: 'repair_fee', label: '维修费', type: 'number', input: true, expense: true },
        // 独有费用-物料+其他
        { field: 'materials', label: '物料（原子灰、胶头、油墨、喷码溶剂）', type: 'number', input: true, expense: true,
          aliases: ['物料(原子灰、胶头、油墨、喷码溶剂)'] },
        { field: 'oil_water_amount', label: '油水金额', type: 'number', input: true, expense: true },
        { field: 'subsidy', label: '补贴', type: 'number', input: true, expense: true },
        { field: 'no_output_wage', label: '无产值工资', type: 'number', input: true, expense: true,
          aliases: ['无产出工资'] },
        { field: 'assembly_wage_paid', label: '付装配工资', type: 'number', input: true, expense: true,
          aliases: ['装配工资代付'] },
        // 独有-做办
        { field: 'office_wage', label: '做办工资', type: 'number', input: true, expense: true,
          aliases: ['办公室工资'] },
        { field: 'office_wage_ratio', label: '做办工资占比%', type: 'ratio', calc: true,
          skipAliases: ['所占比例'] },
        // 独有-可回收
        { field: 'recoverable_wage', label: '可收回工资', type: 'number', input: true, expense: false,
          aliases: ['可回收工资'] },
        { field: 'dept_recoverable_wage', label: '车发部回收工资', type: 'number', input: true, expense: false,
          aliases: ['部门可回收工资'] },
        { field: 'recoverable_indonesia_wage', label: '可收回印尼工资', type: 'number', input: true, expense: false,
          aliases: ['可回收印尼工资'] },
        { field: 'recoverable_tool_fee', label: '可收回工具费', type: 'number', input: true, expense: false,
          aliases: ['可回收工具费'] },
        { field: 'non_recoverable_tool_fee', label: '不可回收工具费', type: 'number', input: true, expense: true },
        { field: 'recoverable_paint', label: '可回收油漆金额', type: 'number', input: true, expense: false,
          aliases: ['可回收油漆'] },
        // 独有-模费
        { field: 'auto_mold_fee', label: '自动机模费', type: 'number', input: true, expense: true,
          aliases: ['自动模费'] },
        { field: 'mold_fee_ratio', label: '自动机模费占产值%', type: 'ratio', calc: true,
          skipAliases: ['模费占产值%', '模费占产值%_1'] },
        { field: 'hunan_mold_fee', label: '发湖南模费', type: 'number', input: true, expense: true,
          aliases: ['湖南模费'] },
        { field: 'hunan_mold_ratio', label: '发湖南模费占产值%', type: 'ratio', calc: true,
          skipAliases: ['发湖南模费占产值%'] },
        { field: 'indonesia_mold_fee', label: '发印尼模费', type: 'number', input: true, expense: true,
          aliases: ['印尼模费'] },
        { field: 'indonesia_mold_ratio', label: '发印尼模费占产值%', type: 'ratio', calc: true,
          skipAliases: ['发印尼模费占产值%'] },
        // 独有-合计
        { field: 'total_ratio', label: '结余%+自模费%', type: 'ratio', calc: true,
          skipAliases: ['合计%'] },
      ]
    },

    assembly: {
      tableName: 'assembly_records',
      label: '装配部',
      workshops: ['兴信A', '兴信B', '华登', '邵阳'],
      sharedFieldAliases: {},
      uniqueFields: [
        // 产值组
        { field: 'avg_output_per_worker', label: '人均产值', type: 'number', calc: true, importable: true },
        // 工资组
        { field: 'planned_wage_tax', label: '计划总工资含*1.13', type: 'number', input: true, expense: false,
          aliases: ['计划工资含税'] },
        { field: 'actual_wage', label: '实际总工资', type: 'number', input: true, expense: true,
          aliases: ['实际工资'] },
        // 结余后
        { field: 'hunan_social_insurance', label: '湖南社保', type: 'number', input: true, expense: true },
        { field: 'hunan_tax', label: '湖南税收', type: 'number', input: true, expense: true },
        // 独有-维修
        { field: 'workshop_repair', label: '车间维修费', type: 'number', input: true, expense: true,
          aliases: ['车间维修'] },
        { field: 'electrical_repair', label: '机电部维修费', type: 'number', input: true, expense: true,
          aliases: ['电工维修'] },
        // 独有-物料
        { field: 'workshop_materials', label: '车间物料费', type: 'number', input: true, expense: true,
          aliases: ['车间物料'] },
        { field: 'stretch_film', label: '拉伸膜', type: 'number', input: true, expense: true },
        { field: 'tape', label: '胶纸', type: 'number', input: true, expense: true,
          aliases: ['胶带'] },
        { field: 'balance_minus_tape', label: '结余减胶纸', type: 'number', calc: true,
          skipAliases: ['结余减胶纸'] },
        { field: 'balance_tape_ratio', label: '减胶纸后结余占计划工资%', type: 'ratio', calc: true,
          skipAliases: ['减胶纸后结余占计划工资%'] },
        // 独有-可回收
        { field: 'recoverable_electricity', label: '可回收电费', type: 'number', input: true, expense: false },
        // 独有-工具投资
        { field: 'workshop_tool_investment', label: '车间工具投资', type: 'number', input: true, expense: true },
        { field: 'fixture_tool_investment', label: '夹具部工具投资', type: 'number', input: true, expense: true },
        { field: 'tool_invest_ratio', label: '工具投资占计划工资%', type: 'ratio', calc: true,
          skipAliases: ['工具投资占计划工资%'] },
        // 独有-其他
        { field: 'housing_subsidy', label: '外宿补贴', type: 'number', input: true, expense: false,
          aliases: ['住房补贴'] },
        { field: 'supplement', label: '补料', type: 'number', input: true, expense: true },
        { field: 'borrowed_worker_wage', label: '外借人员工资', type: 'number', input: true, expense: true,
          aliases: ['借调工人工资'] },
        { field: 'borrowed_wage_ratio', label: '外借人员工资占计划工资%', type: 'ratio', calc: true,
          skipAliases: ['外借人员工资占计划工资%'] },
      ]
    },
  }
};
