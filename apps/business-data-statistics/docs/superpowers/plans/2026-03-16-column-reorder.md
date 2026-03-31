# 三部门明细表表头重排与字段调整 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按逻辑分组重排三个部门的明细表列顺序，新增5个字段，修正标签/公式/费用分类，删除1个重复字段。

**Architecture:** 修改后端字段配置 `config.js` 控制字段定义和顺序 → 修改 `calc.js` 添加/修正计算逻辑 → 重写前端 `getDeptColumns()` 实现分组拼接 → 数据库迁移新增列。COLUMN_MAP 由 `modules/index.js` 从 config 自动生成，无需手动维护。

**Tech Stack:** Express + PostgreSQL + Vue 3 (CDN) + Element Plus

**Spec:** `docs/superpowers/specs/2026-03-16-column-reorder-design.md`

---

## Chunk 1: 后端配置与计算逻辑

### Task 1: 更新测试用例（TDD - 先写失败测试）

**Files:**
- Modify: `tests/calc.test.js`

- [ ] **Step 1: 添加啤机部 output_tax_incl 计算测试**

```javascript
test('beer: output_tax_incl = daily_output / 1.13', () => {
  const r = calculateRecord('beer', {
    daily_output: 50000,
    worker_wage: 6000, supervisor_wage: 2000, rent: 900, utility_fee: 7000,
    tool_investment: 0, equipment: 0, renovation: 0, misc_fee: 0,
    shipping_fee: 0, social_insurance: 263, tax: 809,
    misc_worker_wage: 3960, machine_repair: 1500, mold_repair: 1500,
    gate_processing_fee: 2750, assembly_gate_parts_fee: 0,
    recoverable_gate_fee: 0, material_supplement: 0, materials: 0,
    total_machines: 42, running_machines: 30
  });
  expect(r.output_tax_incl).toBeCloseTo(50000 / 1.13, 2);
});
```

- [ ] **Step 2: 添加印喷部新计算字段测试**

```javascript
test('print: hunan/indonesia mold ratios and total_ratio formula', () => {
  const r = calculateRecord('print', {
    daily_output: 80000,
    worker_wage: 5000, supervisor_wage: 2000, rent: 500, utility_fee: 800,
    tool_investment: 0, equipment: 0, renovation: 0, misc_fee: 0,
    shipping_fee: 0, social_insurance: 400, tax: 600,
    pad_total_machines: 20, pad_running_machines: 15,
    spray_total_machines: 10, spray_running_machines: 8,
    subsidy: 0, materials: 0, repair_fee: 0, oil_water_amount: 0,
    no_output_wage: 0, non_recoverable_tool_fee: 0,
    assembly_wage_paid: 0, office_wage: 1000,
    auto_mold_fee: 500, hunan_mold_fee: 300, indonesia_mold_fee: 200,
    worker_count: 50
  });
  // 新增：发湖南模费占产值%
  expect(r.hunan_mold_ratio).toBeCloseTo(300 / 80000, 4);
  // 新增：发印尼模费占产值%
  expect(r.indonesia_mold_ratio).toBeCloseTo(200 / 80000, 4);
  // 修正：total_ratio = balance_ratio + mold_fee_ratio (自动机模费占产值%)
  expect(r.mold_fee_ratio).toBeCloseTo(500 / 80000, 4);
  expect(r.total_ratio).toBeCloseTo(r.balance_ratio + r.mold_fee_ratio, 4);
});
```

- [ ] **Step 3: 添加装配部 tool_invest_ratio 新公式测试**

```javascript
test('assembly: tool_invest_ratio uses workshop + fixture tool investment', () => {
  const r = calculateRecord('assembly', {
    daily_output: 100000,
    worker_wage: 0, supervisor_wage: 10000, rent: 800, utility_fee: 1000,
    tool_investment: 900, equipment: 0, renovation: 0, misc_fee: 0,
    shipping_fee: 0, social_insurance: 900, tax: 1200,
    actual_wage: 20000, workshop_repair: 0, electrical_repair: 0,
    workshop_materials: 0, stretch_film: 0, supplement: 0,
    housing_subsidy: 0, tape: 300, borrowed_worker_wage: 0,
    planned_wage_tax: 30000, worker_count: 100,
    workshop_tool_investment: 500, fixture_tool_investment: 300
  });
  // 修正：工具投资占计划工资% = (车间工具投资 + 夹具部工具投资) / 计划工资含税
  expect(r.tool_invest_ratio).toBeCloseTo((500 + 300) / 30000, 4);
});
```

- [ ] **Step 4: 添加费用分类修正测试（recoverable_gate_fee 和 housing_subsidy）**

```javascript
test('beer: recoverable_gate_fee should NOT be subtracted from balance', () => {
  const r = calculateRecord('beer', {
    daily_output: 50000,
    worker_wage: 6000, supervisor_wage: 2000, rent: 900, utility_fee: 7000,
    tool_investment: 0, equipment: 0, renovation: 0, misc_fee: 0,
    shipping_fee: 0, social_insurance: 263, tax: 809,
    misc_worker_wage: 3960, machine_repair: 1500, mold_repair: 1500,
    gate_processing_fee: 2750, assembly_gate_parts_fee: 0,
    recoverable_gate_fee: 1000, material_supplement: 0, materials: 0,
    total_machines: 42, running_machines: 30
  });
  // recoverable_gate_fee=1000 不应被减去
  const expectedExpense = 6000 + 2000 + 900 + 7000 + 263 + 809 + 3960 + 1500 + 1500 + 2750;
  expect(r.balance).toBeCloseTo(50000 - expectedExpense, 1);
});

test('assembly: housing_subsidy should NOT be subtracted from balance', () => {
  const r = calculateRecord('assembly', {
    daily_output: 100000,
    worker_wage: 0, supervisor_wage: 10000, rent: 800, utility_fee: 1000,
    tool_investment: 900, equipment: 0, renovation: 0, misc_fee: 0,
    shipping_fee: 0, social_insurance: 900, tax: 1200,
    actual_wage: 20000, workshop_repair: 0, electrical_repair: 0,
    workshop_materials: 0, stretch_film: 0, supplement: 0,
    housing_subsidy: 500, tape: 300, borrowed_worker_wage: 0,
    planned_wage_tax: 30000, worker_count: 100,
    workshop_tool_investment: 0
  });
  // housing_subsidy=500 不应被减去
  const expectedExpense = 10000 + 800 + 1000 + 900 + 1200 + 20000 + 300;
  expect(r.balance).toBeCloseTo(100000 - expectedExpense, 1);
});
```

注意：这两个测试会在 Task 3 更新 config.js 费用分类后才能通过。先添加到测试文件但暂时跳过（或在 Task 3 完成后再运行验证）。

- [ ] **Step 5: 运行测试确认新测试失败**

Run: `cd "d:/03-AI related/02-Business data statistics" && npm test`
Expected: 新增的测试部分 FAIL（output_tax_incl 未被计算、hunan_mold_ratio 未定义、tool_invest_ratio 公式不同、费用分类尚未修正）

- [ ] **Step 6: 提交测试代码**

```bash
git add tests/calc.test.js
git commit -m "test: add failing tests for new calc fields and formula changes"
```

---

### Task 2: 更新 calc.js 计算逻辑

**Files:**
- Modify: `modules/balance/calc.js:19-48`

- [ ] **Step 1: 啤机部 - 添加 output_tax_incl 计算**

在 `if (dept === 'beer')` 块中（约第19行后），添加：

```javascript
result.output_tax_incl = dailyOutput / 1.13;
```

- [ ] **Step 2: 印喷部 - 添加 hunan_mold_ratio 和 indonesia_mold_ratio，修正 total_ratio**

在 `else if (dept === 'print')` 块中（约第28行后），添加两个新计算并修改 total_ratio：

```javascript
result.hunan_mold_ratio = dailyOutput > 0 ? (parseFloat(result.hunan_mold_fee) || 0) / dailyOutput : 0;
result.indonesia_mold_ratio = dailyOutput > 0 ? (parseFloat(result.indonesia_mold_fee) || 0) / dailyOutput : 0;
```

修改 `result.total_ratio` 一行（原为 `result.balance_ratio`）：

```javascript
result.total_ratio = result.balance_ratio + result.mold_fee_ratio;
```

- [ ] **Step 3: 装配部 - 修正 tool_invest_ratio 公式**

在 `else if (dept === 'assembly')` 块中，修改 `tool_invest_ratio` 一行（约第46行）：

原：
```javascript
result.tool_invest_ratio = plannedWage > 0 ? (parseFloat(result.tool_investment) || 0) / plannedWage : 0;
```
改为：
```javascript
result.tool_invest_ratio = plannedWage > 0 ? ((parseFloat(result.workshop_tool_investment) || 0) + (parseFloat(result.fixture_tool_investment) || 0)) / plannedWage : 0;
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `cd "d:/03-AI related/02-Business data statistics" && npm test`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add modules/balance/calc.js
git commit -m "feat(calc): add output_tax_incl calc, mold ratios, fix total_ratio and tool_invest formulas"
```

---

### Task 3: 更新 config.js 字段配置

**Files:**
- Modify: `modules/balance/config.js`

这是最大的改动，需要分步执行。每步完成后检查服务是否能正常启动（`node -e "require('./modules')"` 不报错）。

- [ ] **Step 1: 修正共享字段别名（删除冲突别名）**

在 `sharedFields` 数组中：
- `social_insurance` 条目（约第34行）：删除 `aliases: ['湖南社保']`（整行删除 aliases 属性）
- `tax` 条目（约第37行）：删除 `aliases: ['湖南税收']`（整行删除 aliases 属性）

- [ ] **Step 2: 更新啤机部字段**

在 `departments.beer` 中：
1. `output_tax_incl`（约第61行）：标签从 `'总产值含税'` 改为 `'不含税产值'`，`input: true` 改为 `input: false`，添加 `calc: true`，添加 `skipAliases: ['不含税产值', '不含税产值（含税产值/1.13）', '不含税产值(含税产值/1.13)']`（原 aliases 内容转为 skipAliases）
2. `recoverable_gate_fee`（约第70行）：`expense: true` 改为 `expense: false`
3. `mold_cost_ratio`（约第80行）：标签从 `'模具费用占产值比%'` 改为 `'模具维修占产值比%'`，更新 skipAliases 为 `['模具费用占产值比%', '模具维修占产值比%']`
4. 重排 uniqueFields 数组顺序为：

```javascript
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
  // 产值组
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
```

- [ ] **Step 3: 更新印喷部字段**

在 `departments.print` 中：
1. 删除 `output_tax_incl` 条目（约第110行）
2. `work_hours` 标签改为 `'员工工时'`
3. `total_hours` 标签改为 `'总工时'`
4. `mold_fee_ratio` 标签改为 `'自动机模费占产值%'`，更新 skipAliases
5. `total_ratio` 标签改为 `'结余%+自模费%'`，skipAliases 中删除 `'发印尼模费占产值%'`
6. 新增 `hunan_mold_ratio` 和 `indonesia_mold_ratio` 计算字段
7. 重排顺序为：

```javascript
uniqueFields: [
  // 台数组
  { field: 'pad_total_machines', label: '移印机总台数', type: 'integer', input: true, expense: false,
    aliases: ['移印总台数'] },
  { field: 'pad_running_machines', label: '每天开机台数', type: 'integer', input: true, expense: false,
    aliases: ['移印开机台数'] },
  { field: 'pad_machine_rate', label: '移印开机率', type: 'ratio', calc: true,
    skipAliases: ['开机率'] },
  { field: 'spray_total_machines', label: '喷油机总台数', type: 'integer', input: true, expense: false,
    aliases: ['喷油总台数'] },
  { field: 'spray_running_machines', label: '每天开机台数_1', type: 'integer', input: true, expense: false },
  { field: 'spray_machine_rate', label: '喷油开机率', type: 'ratio', calc: true,
    skipAliases: ['开机率_1'] },
  // 人数组
  { field: 'misc_workers', label: '杂工人数', type: 'integer', input: true, expense: false },
  // 时间组
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
```

- [ ] **Step 4: 更新装配部字段**

在 `departments.assembly` 中：
1. 删除 `sharedFieldAliases` 中的 `tool_investment: ['夹具部工具投资']`（因为新增了独立字段）
2. `housing_subsidy` 的 `expense` 改为 `false`
3. 新增3个字段：`hunan_social_insurance`、`hunan_tax`、`fixture_tool_investment`
4. 重排顺序为：

```javascript
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
```

- [ ] **Step 5: 验证配置加载不报错**

Run: `cd "d:/03-AI related/02-Business data statistics" && node -e "const m = require('./modules'); m.validateConfig(); console.log('OK')"`
Expected: `[配置校验] 所有部门费用字段配置校验通过` + `OK`

- [ ] **Step 6: 运行测试确认全部通过**

Run: `cd "d:/03-AI related/02-Business data statistics" && npm test`
Expected: ALL PASS

- [ ] **Step 7: 提交**

```bash
git add modules/balance/config.js
git commit -m "feat(config): reorder fields, fix labels/expense flags, add new fields"
```

---

## Chunk 2: 数据库迁移与前端

### Task 4: 数据库迁移

**Files:**
- Modify: `db/init.sql:191-237`（装配部建表语句）
- Modify: `db/init.sql:129-189`（印喷部建表语句 - output_tax_incl 注释说明）

- [ ] **Step 1: 执行数据库迁移 SQL**

Run:
```bash
cd "d:/03-AI related/02-Business data statistics" && node -e "
const db = require('./db/postgres');
async function migrate() {
  await db.query('ALTER TABLE assembly_records ADD COLUMN IF NOT EXISTS hunan_social_insurance DECIMAL(12,2) DEFAULT 0');
  await db.query('ALTER TABLE assembly_records ADD COLUMN IF NOT EXISTS hunan_tax DECIMAL(12,2) DEFAULT 0');
  await db.query('ALTER TABLE assembly_records ADD COLUMN IF NOT EXISTS fixture_tool_investment DECIMAL(12,2) DEFAULT 0');
  console.log('Assembly migration done');
  process.exit(0);
}
migrate().catch(e => { console.error(e); process.exit(1); });
"
```

印喷部的 `hunan_mold_ratio` 和 `indonesia_mold_ratio` 是计算字段，需要在 print_records 表添加对应列以存储计算结果：

```bash
cd "d:/03-AI related/02-Business data statistics" && node -e "
const db = require('./db/postgres');
async function migrate() {
  await db.query('ALTER TABLE print_records ADD COLUMN IF NOT EXISTS hunan_mold_ratio NUMERIC(8,4) DEFAULT 0');
  await db.query('ALTER TABLE print_records ADD COLUMN IF NOT EXISTS indonesia_mold_ratio NUMERIC(8,4) DEFAULT 0');
  console.log('Print migration done');
  process.exit(0);
}
migrate().catch(e => { console.error(e); process.exit(1); });
"
```

- [ ] **Step 2: 迁移装配部"湖南社保/湖南税收"数据**

之前"湖南社保"和"湖南税收"是共有字段 `social_insurance` 和 `tax` 的别名，导入的数据写在了共有字段里。现在需要把装配部的这些数据迁移到新的独立字段。

```bash
cd "d:/03-AI related/02-Business data statistics" && node -e "
const db = require('./db/postgres');
async function migrate() {
  // 将装配部的 social_insurance 数据复制到 hunan_social_insurance
  await db.query('UPDATE assembly_records SET hunan_social_insurance = social_insurance WHERE social_insurance > 0');
  // 将装配部的 tax 数据复制到 hunan_tax
  await db.query('UPDATE assembly_records SET hunan_tax = tax WHERE tax > 0');
  // 清空装配部的共有社保和税收字段（因为装配部的社保/税收实际是湖南的）
  // 注意：如果装配部确实有清溪社保/税收数据，不要执行这两行！
  // await db.query('UPDATE assembly_records SET social_insurance = 0, tax = 0');
  console.log('Data migration done');
  process.exit(0);
}
migrate().catch(e => { console.error(e); process.exit(1); });
"
```

> **重要**：迁移前请确认装配部是否同时有清溪社保和湖南社保数据。如果只有湖南社保（没有清溪的），迁移后还需要把共有字段清零。

- [ ] **Step 3: 更新 init.sql 建表语句**

在 `assembly_records` 表的 `workshop_tool_investment` 行后（约第231行），添加：
```sql
  hunan_social_insurance NUMERIC(12,2) DEFAULT 0,
  hunan_tax NUMERIC(12,2) DEFAULT 0,
  fixture_tool_investment NUMERIC(12,2) DEFAULT 0,
```

在 `print_records` 表中 `total_ratio` 行前（约第182行），添加：
```sql
  hunan_mold_ratio NUMERIC(8,4) DEFAULT 0,
  indonesia_mold_ratio NUMERIC(8,4) DEFAULT 0,
```

在 `print_records` 的 `output_tax_incl` 行（约第162行）添加注释：
```sql
  output_tax_incl NUMERIC(14,2) DEFAULT 0, -- 已废弃：前端不再使用，保留列避免数据丢失
```

- [ ] **Step 3: 提交**

```bash
git add db/init.sql
git commit -m "feat(db): add assembly new columns, print mold ratio columns, mark deprecated field"
```

---

### Task 5: 重写前端 getDeptColumns 和 DEPT_CONFIG

**Files:**
- Modify: `public/js/app.js:6-94`（DEPT_CONFIG、SHARED_COLUMNS、getDeptColumns）

这是前端的核心改动。新方案：每个部门的 uniqueFields 按新顺序排列，getDeptColumns 改为分组插入模式。

- [ ] **Step 1: 拆分 SHARED_COLUMNS 为分组常量**

将 `SHARED_COLUMNS`（第75-92行）替换为分组版本：

```javascript
// ===== 共享字段分组 =====
const SHARED_PEOPLE = [
  { field: 'supervisor_count', label: '管工人数', editable: true, type: 'integer' },
  { field: 'worker_count', label: '员工人数', editable: true, type: 'integer' },
];
const SHARED_OUTPUT = [
  { field: 'daily_output', label: '总产值/天', editable: true, type: 'number' },
];
const SHARED_WAGE = [
  { field: 'worker_wage', label: '员工工资/天', editable: true, type: 'number' },
  { field: 'supervisor_wage', label: '管工工资/天', editable: true, type: 'number' },
];
const SHARED_EXPENSE = [
  { field: 'rent', label: '房租', editable: true, type: 'number' },
  { field: 'utility_fee', label: '水电费', editable: true, type: 'number' },
  { field: 'tool_investment', label: '工具投资', editable: true, type: 'number' },
  { field: 'equipment', label: '设备', editable: true, type: 'number' },
  { field: 'renovation', label: '装修', editable: true, type: 'number' },
  { field: 'misc_fee', label: '杂费', editable: true, type: 'number' },
  { field: 'shipping_fee', label: '运费', editable: true, type: 'number' },
  { field: 'social_insurance', label: '社保', editable: true, type: 'number' },
  { field: 'tax', label: '税收', editable: true, type: 'number' },
];
const SHARED_BALANCE = [
  { field: 'balance', label: '结余金额', editable: false, type: 'number', calculated: true },
  { field: 'balance_ratio', label: '结余%', editable: false, type: 'ratio', calculated: true },
];

// 保留 SHARED_COLUMNS 用于向后兼容（如果有其他地方引用）
const SHARED_COLUMNS = [...SHARED_PEOPLE, ...SHARED_OUTPUT, ...SHARED_WAGE, ...SHARED_EXPENSE, ...SHARED_BALANCE];
```

- [ ] **Step 2: 重写啤机部 uniqueFields**

```javascript
beer: { key: 'beer', name: '啤机部', uniqueFields: [
  // 台数组（插入到人数前）
  { field: 'total_machines', label: '总台数', editable: true, type: 'integer' },
  { field: 'running_machines', label: '开机台数', editable: true, type: 'integer' },
  { field: 'run_hours', label: '开机时间', editable: true, type: 'number' },
  { field: 'machine_rate', label: '开机率', editable: false, type: 'ratio', calculated: true },
  // 人数组（插入到共有人数后）
  { field: 'misc_workers', label: '杂工人数', editable: true, type: 'integer' },
  { field: 'gate_workers', label: '批水口人数', editable: true, type: 'integer' },
  // 产值组（插入到共有产值后）
  { field: 'output_tax_incl', label: '不含税产值', editable: false, type: 'number', calculated: true },
  { field: 'avg_output_per_machine', label: '每台机平均产值', editable: false, type: 'number', calculated: true },
  // 工资组（插入到共有工资后）
  { field: 'misc_worker_wage', label: '杂工工资/天', editable: true, type: 'number' },
  { field: 'wage_ratio', label: '总工资占产值%', editable: false, type: 'ratio', calculated: true },
  // 结余组（插入到共有结余后）
  { field: 'avg_balance_per_machine', label: '平均每台结余', editable: false, type: 'number', calculated: true },
  // 独有费用（结余后）
  { field: 'machine_repair', label: '机器维修', editable: true, type: 'number' },
  { field: 'mold_repair', label: '模具维修', editable: true, type: 'number' },
  { field: 'mold_cost_ratio', label: '模具维修占产值比%', editable: false, type: 'ratio', calculated: true },
  { field: 'materials', label: '物料', editable: true, type: 'number' },
  { field: 'material_supplement', label: '原料补料', editable: true, type: 'number' },
  { field: 'gate_processing_fee', label: '批水口加工费', editable: true, type: 'number' },
  { field: 'gate_cost_ratio', label: '批水口费用占产值比%', editable: false, type: 'ratio', calculated: true },
  { field: 'assembly_gate_parts_fee', label: '装配批水口配件费', editable: true, type: 'number' },
  { field: 'recoverable_gate_fee', label: '可回收批水口费', editable: true, type: 'number' },
]},
```

- [ ] **Step 3: 重写印喷部 uniqueFields**

```javascript
print: { key: 'print', name: '印喷部', uniqueFields: [
  // 台数组
  { field: 'pad_total_machines', label: '移印总台数', editable: true, type: 'integer' },
  { field: 'pad_running_machines', label: '移印开机台数', editable: true, type: 'integer' },
  { field: 'pad_machine_rate', label: '移印开机率', editable: false, type: 'ratio', calculated: true },
  { field: 'spray_total_machines', label: '喷油总台数', editable: true, type: 'integer' },
  { field: 'spray_running_machines', label: '喷油开机台数', editable: true, type: 'integer' },
  { field: 'spray_machine_rate', label: '喷油开机率', editable: false, type: 'ratio', calculated: true },
  // 人数组
  { field: 'misc_workers', label: '杂工人数', editable: true, type: 'integer' },
  // 时间组（产值前）
  { field: 'work_hours', label: '员工工时', editable: true, type: 'number' },
  { field: 'total_hours', label: '总工时', editable: true, type: 'number' },
  // 产值组
  { field: 'avg_output_per_worker', label: '员工人均产值', editable: false, type: 'number', calculated: true },
  // 工资组
  { field: 'wage_ratio', label: '总工资占产值%', editable: false, type: 'ratio', calculated: true },
  // 独有费用（结余后）
  { field: 'repair_fee', label: '维修费', editable: true, type: 'number' },
  { field: 'materials', label: '物料（原子灰、胶头、油墨、喷码溶剂）', editable: true, type: 'number' },
  { field: 'oil_water_amount', label: '油水金额', editable: true, type: 'number' },
  { field: 'subsidy', label: '补贴', editable: true, type: 'number' },
  { field: 'no_output_wage', label: '无产值工资', editable: true, type: 'number' },
  { field: 'assembly_wage_paid', label: '付装配工资', editable: true, type: 'number' },
  { field: 'office_wage', label: '做办工资', editable: true, type: 'number' },
  { field: 'office_wage_ratio', label: '做办工资占比%', editable: false, type: 'ratio', calculated: true },
  { field: 'recoverable_wage', label: '可收回工资', editable: true, type: 'number' },
  { field: 'dept_recoverable_wage', label: '车发部回收工资', editable: true, type: 'number' },
  { field: 'recoverable_indonesia_wage', label: '可收回印尼工资', editable: true, type: 'number' },
  { field: 'recoverable_tool_fee', label: '可收回工具费', editable: true, type: 'number' },
  { field: 'non_recoverable_tool_fee', label: '不可回收工具费', editable: true, type: 'number' },
  { field: 'recoverable_paint', label: '可回收油漆金额', editable: true, type: 'number' },
  { field: 'auto_mold_fee', label: '自动机模费', editable: true, type: 'number' },
  { field: 'mold_fee_ratio', label: '自动机模费占产值%', editable: false, type: 'ratio', calculated: true },
  { field: 'hunan_mold_fee', label: '发湖南模费', editable: true, type: 'number' },
  { field: 'hunan_mold_ratio', label: '发湖南模费占产值%', editable: false, type: 'ratio', calculated: true },
  { field: 'indonesia_mold_fee', label: '发印尼模费', editable: true, type: 'number' },
  { field: 'indonesia_mold_ratio', label: '发印尼模费占产值%', editable: false, type: 'ratio', calculated: true },
  { field: 'total_ratio', label: '结余%+自模费%', editable: false, type: 'ratio', calculated: true },
]},
```

- [ ] **Step 4: 重写装配部 uniqueFields**

```javascript
assembly: { key: 'assembly', name: '装配部', uniqueFields: [
  // 产值组
  { field: 'avg_output_per_worker', label: '人均产值', editable: false, type: 'number', calculated: true },
  // 工资组
  { field: 'planned_wage_tax', label: '计划工资含税', editable: true, type: 'number' },
  { field: 'actual_wage', label: '实际总工资', editable: true, type: 'number' },
  // 结余后
  { field: 'hunan_social_insurance', label: '湖南社保', editable: true, type: 'number' },
  { field: 'hunan_tax', label: '湖南税收', editable: true, type: 'number' },
  // 独有费用
  { field: 'workshop_repair', label: '车间维修费', editable: true, type: 'number' },
  { field: 'electrical_repair', label: '机电部维修费', editable: true, type: 'number' },
  { field: 'workshop_materials', label: '车间物料费', editable: true, type: 'number' },
  { field: 'stretch_film', label: '拉伸膜', editable: true, type: 'number' },
  { field: 'tape', label: '胶纸', editable: true, type: 'number' },
  { field: 'balance_minus_tape', label: '结余减胶纸', editable: false, type: 'number', calculated: true },
  { field: 'balance_tape_ratio', label: '减胶纸后结余占计划工资%', editable: false, type: 'ratio', calculated: true },
  { field: 'recoverable_electricity', label: '可回收电费', editable: true, type: 'number' },
  { field: 'workshop_tool_investment', label: '车间工具投资', editable: true, type: 'number' },
  { field: 'fixture_tool_investment', label: '夹具部工具投资', editable: true, type: 'number' },
  { field: 'tool_invest_ratio', label: '工具投资占计划工资%', editable: false, type: 'ratio', calculated: true },
  { field: 'housing_subsidy', label: '外宿补贴', editable: true, type: 'number' },
  { field: 'supplement', label: '补料', editable: true, type: 'number' },
  { field: 'borrowed_worker_wage', label: '外借人员工资', editable: true, type: 'number' },
  { field: 'borrowed_wage_ratio', label: '外借人员工资占计划工资%', editable: false, type: 'ratio', calculated: true },
]}
```

- [ ] **Step 5: 重写 getDeptColumns 函数**

将第149-160行的 `getDeptColumns` 替换为分组拼接版本：

```javascript
// getDeptColumns: 按逻辑分组拼接共有字段和独有字段
// 独有字段通过注释标记分组，按顺序插入到对应的共有分组后面
function getDeptColumns(dept) {
  const config = DEPT_CONFIG[dept];
  if (!config) return [...SHARED_COLUMNS, REMARK_COLUMN];

  const unique = config.uniqueFields || [];

  // 将独有字段按分组分类（根据字段在数组中的位置和注释约定）
  // 分组规则：台数类、人数类、时间类、产值类、工资类放在对应共有组后
  //          结余后字段和独有费用放在共有结余后
  const groups = {
    machines: [],  // 台数（共有人数前）
    people: [],    // 人数（共有人数后）
    time: [],      // 时间（共有产值前）
    output: [],    // 产值（共有产值后）
    wage: [],      // 工资（共有工资后）
    afterBalance: [] // 结余后+独有费用（共有结余后）
  };

  // 用字段名判断归属分组
  const machineFields = ['total_machines', 'running_machines', 'run_hours', 'machine_rate',
    'pad_total_machines', 'pad_running_machines', 'pad_machine_rate',
    'spray_total_machines', 'spray_running_machines', 'spray_machine_rate'];
  const peopleFields = ['misc_workers', 'gate_workers'];
  const timeFields = ['work_hours', 'total_hours'];
  const outputFields = ['output_tax_incl', 'avg_output_per_machine', 'avg_output_per_worker'];
  const wageFields = ['misc_worker_wage', 'wage_ratio', 'planned_wage_tax', 'actual_wage'];

  for (const f of unique) {
    if (machineFields.includes(f.field)) groups.machines.push(f);
    else if (peopleFields.includes(f.field)) groups.people.push(f);
    else if (timeFields.includes(f.field)) groups.time.push(f);
    else if (outputFields.includes(f.field)) groups.output.push(f);
    else if (wageFields.includes(f.field)) groups.wage.push(f);
    else groups.afterBalance.push(f);
  }

  return [
    ...groups.machines,
    ...SHARED_PEOPLE, ...groups.people,
    ...groups.time,
    ...SHARED_OUTPUT, ...groups.output,
    ...SHARED_WAGE, ...groups.wage,
    ...SHARED_EXPENSE,
    ...SHARED_BALANCE,
    ...groups.afterBalance,
    REMARK_COLUMN
  ];
}
```

- [ ] **Step 6: 在浏览器中验证三个部门的表头顺序**

打开 `http://localhost:6001`，分别切换到啤机部、印喷部、装配部，检查：
1. 列顺序是否符合设计文档
2. 计算字段是否正常显示（不可编辑）
3. 数据是否正常加载

- [ ] **Step 7: 提交**

```bash
git add public/js/app.js
git commit -m "feat(frontend): rewrite getDeptColumns with group-based insertion, reorder all dept fields"
```

---

### Task 6: 修改导出列顺序匹配前端显示

**Files:**
- Modify: `routes/import-export.js:125-161`

当前导出使用 `Object.keys(r)` 遍历数据库记录，列顺序跟随数据库列定义顺序。需要改为按前端 `getDeptColumns` 的顺序输出。

- [ ] **Step 1: 在 import-export.js 中引入前端列顺序配置**

由于前端列顺序定义在 `app.js`（浏览器端），后端无法直接引用。需要在 `modules/index.js` 中新增一个函数，从 config.js 推导出每个部门的完整列顺序。

在 `modules/index.js` 中添加 `getOrderedFields` 函数（在 `module.exports` 前）：

```javascript
// 获取部门的有序字段列表（用于导出时保证列顺序）
// 顺序逻辑与前端 getDeptColumns 一致：台数→人数→时间→产值→工资→共有费用→结余→独有费用→备注
function getOrderedFields(dept) {
  const config = balanceConfig.departments[dept];
  if (!config) return [];

  const unique = config.uniqueFields || [];

  // 字段分组（与前端 getDeptColumns 逻辑一致）
  const machineFields = ['total_machines', 'running_machines', 'run_hours', 'machine_rate',
    'pad_total_machines', 'pad_running_machines', 'pad_machine_rate',
    'spray_total_machines', 'spray_running_machines', 'spray_machine_rate'];
  const peopleFields = ['misc_workers', 'gate_workers'];
  const timeFields = ['work_hours', 'total_hours'];
  const outputFields = ['output_tax_incl', 'avg_output_per_machine', 'avg_output_per_worker'];
  const wageFields = ['misc_worker_wage', 'wage_ratio', 'planned_wage_tax', 'actual_wage'];

  const groups = { machines: [], people: [], time: [], output: [], wage: [], afterBalance: [] };
  for (const f of unique) {
    const name = f.field;
    if (machineFields.includes(name)) groups.machines.push(f);
    else if (peopleFields.includes(name)) groups.people.push(f);
    else if (timeFields.includes(name)) groups.time.push(f);
    else if (outputFields.includes(name)) groups.output.push(f);
    else if (wageFields.includes(name)) groups.wage.push(f);
    else groups.afterBalance.push(f);
  }

  // 共享字段
  const sharedPeople = balanceConfig.sharedFields.filter(f => ['supervisor_count', 'worker_count'].includes(f.field));
  const sharedOutput = balanceConfig.sharedFields.filter(f => f.field === 'daily_output');
  const sharedWage = balanceConfig.sharedFields.filter(f => ['worker_wage', 'supervisor_wage'].includes(f.field));
  const sharedExpense = balanceConfig.sharedFields.filter(f => f.expense && !['worker_wage', 'supervisor_wage'].includes(f.field));
  const sharedCalc = balanceConfig.sharedCalcFields;

  // 结构字段
  const structural = balanceConfig.structuralFields.filter(f => f.field !== 'remark');
  const remark = balanceConfig.structuralFields.filter(f => f.field === 'remark');

  return [
    ...structural,
    ...groups.machines,
    ...sharedPeople, ...groups.people,
    ...groups.time,
    ...sharedOutput, ...groups.output,
    ...sharedWage, ...groups.wage,
    ...sharedExpense,
    ...sharedCalc,
    ...groups.afterBalance,
    ...remark
  ].map(f => f.field);
}
```

在 `module.exports` 中添加 `getOrderedFields`。

- [ ] **Step 2: 修改导出逻辑使用有序字段**

修改 `routes/import-export.js` 的导出部分（约第142-151行），替换为：

```javascript
  const { getOrderedFields } = require('../modules');
  const orderedFields = getOrderedFields(dept);

  const exportData = records.map(r => {
    const row = {};
    // 按照前端显示顺序输出列
    for (const field of orderedFields) {
      if (r[field] !== undefined) {
        const label = REVERSE_COLUMN_MAP[field] || field;
        row[label] = r[field];
      }
    }
    // 补充有序列表中可能遗漏的字段（防御性）
    Object.keys(r).forEach(key => {
      const label = REVERSE_COLUMN_MAP[key] || key;
      if (!['id', 'workshop_id', 'created_by', 'updated_by', 'created_at', 'updated_at'].includes(key) && !row[label]) {
        row[label] = r[key];
      }
    });
    return row;
  });
```

- [ ] **Step 3: 验证导出顺序**

导出一份啤机部的 Excel，检查列顺序是否为：日期→车间→总台数→开机台数→开机时间→开机率→管工人数→...

- [ ] **Step 4: 提交**

```bash
git add modules/index.js routes/import-export.js
git commit -m "feat(export): align Excel export column order with frontend display order"
```

---

### Task 7: 最终验证与提交

- [ ] **Step 1: 运行全部测试**

Run: `cd "d:/03-AI related/02-Business data statistics" && npm test`
Expected: ALL PASS

- [ ] **Step 2: 重启服务验证**

Run: `cd "d:/03-AI related/02-Business data statistics" && pm2 restart ecosystem.config.js`

- [ ] **Step 3: 端到端验证**

在浏览器中验证以下场景：
1. **啤机部**：确认列顺序为 日期→车间→台数→开机台数→开机时间→开机率→管工人数→员工人数→杂工人数→批水口人数→总产值→不含税产值→每台机平均产值→...
2. **印喷部**：确认 output_tax_incl 不再显示，工时显示为"员工工时"，新增两个模费占产值%列
3. **装配部**：确认新增的湖南社保、湖南税收、夹具部工具投资可以输入数据
4. **Excel导入**：导入一份测试文件，确认字段映射正确
5. **Excel导出**：导出后检查列是否包含新增字段
