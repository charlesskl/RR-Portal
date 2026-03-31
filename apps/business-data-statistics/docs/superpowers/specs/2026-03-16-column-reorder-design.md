# 三部门明细表表头重排与字段调整设计

## 1. 背景

当前三个部门（啤机、印喷、装配）的明细表字段顺序为"共有字段全部在前 → 独有字段堆在结余前 → 结余 → 备注"，独有字段中混杂了台数、人数、工资、费用等不同性质的内容，不便阅读和对比。

## 2. 目标

1. **按逻辑分组重排列顺序**：日期→车间→台数→人数→产值→工资→共有费用→结余→独有费用→备注
2. **独有字段按性质归位**：人数类归到人数组、工资类归到工资组、时间类归到产值前
3. **新增5个字段**：2个计算字段（印喷部）+ 3个输入字段（装配部）
4. **修正标签**：4处标签修正
5. **删除印喷 `output_tax_incl`**（与共有 daily_output 重复）
6. **修正费用分类**：啤机部 `recoverable_gate_fee`、装配部 `housing_subsidy` 改为非费用
7. **修正 `total_ratio` 公式**：从 `balance_ratio` 改为 `balance_ratio + mold_fee_ratio`
8. **移除共有字段别名冲突**：社保的"湖南社保"别名、税收的"湖南税收"别名、装配部 sharedFieldAliases 中的"夹具部工具投资"映射
9. **补充印喷部遗漏字段**：`avg_output_per_worker`、`wage_ratio` 加入列顺序

## 3. 三部门完整字段顺序

> 字段名使用代码中已有的名称。标注"已有"的计算字段表示代码中已存在计算逻辑，仅调整显示位置。

### 3.1 啤机部

| 序号 | 分组 | 字段名 | 标签 | 类型 | 状态 |
|:----:|------|--------|------|------|------|
| 1 | 固定 | record_date | 日期 | 固定 | |
| 2 | 固定 | workshop | 车间 | 固定 | |
| 3 | 台数 | total_machines | 总台数 | 输入 | |
| 4 | 台数 | running_machines | 开机台数 | 输入 | |
| 5 | 台数 | run_hours | 开机时间 | 输入 | |
| 6 | 台数 | machine_rate | 开机率 | 计算 | 已有 |
| 7 | 人数 | supervisor_count | 管工人数 | 输入 | |
| 8 | 人数 | worker_count | 员工人数 | 输入 | |
| 9 | 人数 | misc_workers | 杂工人数 | 输入 | |
| 10 | 人数 | gate_workers | 批水口人数 | 输入 | |
| 11 | 产值 | daily_output | 总产值/天 | 输入 | |
| 12 | 产值 | output_tax_incl | 不含税产值 | 计算 | 标签修正+输入→计算 |
| 13 | 产值 | avg_output_per_machine | 每台机平均产值 | 计算 | 已有 |
| 14 | 工资 | worker_wage | 员工工资/天 | 输入 | |
| 15 | 工资 | supervisor_wage | 管工工资/天 | 输入 | |
| 16 | 工资 | misc_worker_wage | 杂工工资/天 | 输入 | |
| 17 | 工资 | wage_ratio | 总工资占产值% | 计算 | 已有 |
| 18 | 共有费用 | rent | 房租 | 输入 | |
| 19 | 共有费用 | utility_fee | 水电费 | 输入 | |
| 20 | 共有费用 | tool_investment | 工具投资 | 输入 | |
| 21 | 共有费用 | equipment | 设备 | 输入 | |
| 22 | 共有费用 | renovation | 装修 | 输入 | |
| 23 | 共有费用 | misc_fee | 杂费 | 输入 | |
| 24 | 共有费用 | shipping_fee | 运费 | 输入 | |
| 25 | 共有费用 | social_insurance | 社保 | 输入 | |
| 26 | 共有费用 | tax | 税收 | 输入 | |
| 27 | 结余 | balance | 结余金额 | 计算 | 已有 |
| 28 | 结余 | avg_balance_per_machine | 平均每台结余 | 计算 | 已有 |
| 29 | 结余 | balance_ratio | 结余% | 计算 | 已有 |
| 30 | 独有-维修 | machine_repair | 机器维修 | 输入/费用 | |
| 31 | 独有-维修 | mold_repair | 模具维修 | 输入/费用 | |
| 32 | 独有-维修 | mold_cost_ratio | 模具维修占产值比% | 计算 | 已有，标签修正 |
| 33 | 独有-物料 | materials | 物料 | 输入/费用 | |
| 34 | 独有-物料 | material_supplement | 原料补料 | 输入/费用 | |
| 35 | 独有-水口 | gate_processing_fee | 批水口加工费 | 输入/费用 | |
| 36 | 独有-水口 | gate_cost_ratio | 批水口费用占产值比% | 计算 | 已有 |
| 37 | 独有-水口 | assembly_gate_parts_fee | 装配批水口配件费 | 输入/费用 | |
| 38 | 独有-水口 | recoverable_gate_fee | 可回收批水口费 | 输入/可回收 | ⚠️费用分类修正 |
| 39 | 备注 | remark | 备注 | 输入 | |

**费用分类修正：**
- `recoverable_gate_fee`：当前 `expense: true` → 改为 `expense: false`（可回收费用，在结余计算中应加回而非减去）

**计算公式（均已存在，无需新增）：**
- `开机率` = 开机台数 ÷ 总台数
- `不含税产值` = 总产值/天 ÷ 1.13
- `每台机平均产值` = 总产值/天 ÷ 开机台数
- `总工资占产值%` = (管工工资 + 员工工资 + 杂工工资) ÷ 总产值
- `结余金额` = 总产值/天 - 费用合计 + 可回收费用
- `平均每台结余` = 结余 ÷ 开机台数
- `结余%` = 结余 ÷ 总产值
- `模具维修占产值比%` = 模具维修 ÷ 总产值
- `批水口费用占产值比%` = 批水口加工费 ÷ 总产值

### 3.2 印喷部

| 序号 | 分组 | 字段名 | 标签 | 类型 | 状态 |
|:----:|------|--------|------|------|------|
| 1 | 固定 | record_date | 日期 | 固定 | |
| 2 | 固定 | workshop | 车间 | 固定 | |
| 3 | 台数 | pad_total_machines | 移印总台数 | 输入 | |
| 4 | 台数 | pad_running_machines | 移印开机台数 | 输入 | |
| 5 | 台数 | pad_machine_rate | 移印开机率 | 计算 | 已有 |
| 6 | 台数 | spray_total_machines | 喷油总台数 | 输入 | |
| 7 | 台数 | spray_running_machines | 喷油开机台数 | 输入 | |
| 8 | 台数 | spray_machine_rate | 喷油开机率 | 计算 | 已有 |
| 9 | 人数 | supervisor_count | 管工人数 | 输入 | |
| 10 | 人数 | worker_count | 员工人数 | 输入 | |
| 11 | 人数 | misc_workers | 杂工人数 | 输入 | |
| 12 | 时间 | work_hours | 员工工时 | 输入 | 标签修正 |
| 13 | 时间 | total_hours | 总工时 | 输入 | 标签修正 |
| 14 | 产值 | daily_output | 总产值/天 | 输入 | |
| 15 | 产值 | avg_output_per_worker | 员工人均产值 | 计算 | 已有，补充到列顺序 |
| 16 | 工资 | worker_wage | 员工工资/天 | 输入 | |
| 17 | 工资 | supervisor_wage | 管工工资/天 | 输入 | |
| 18 | 工资 | wage_ratio | 总工资占产值% | 计算 | 已有，补充到列顺序 |
| 19 | 共有费用 | rent | 房租 | 输入 | |
| 20 | 共有费用 | utility_fee | 水电费 | 输入 | |
| 21 | 共有费用 | tool_investment | 工具投资 | 输入 | |
| 22 | 共有费用 | equipment | 设备 | 输入 | |
| 23 | 共有费用 | renovation | 装修 | 输入 | |
| 24 | 共有费用 | misc_fee | 杂费 | 输入 | |
| 25 | 共有费用 | shipping_fee | 运费 | 输入 | |
| 26 | 共有费用 | social_insurance | 社保 | 输入 | |
| 27 | 共有费用 | tax | 税收 | 输入 | |
| 28 | 结余 | balance | 结余金额 | 计算 | 已有 |
| 29 | 结余 | balance_ratio | 结余% | 计算 | 已有 |
| 30 | 独有-维修 | repair_fee | 维修费 | 输入/费用 | |
| 31 | 独有-物料 | materials | 物料 | 输入/费用 | |
| 32 | 独有-其他费用 | oil_water_amount | 油水金额 | 输入/费用 | |
| 33 | 独有-其他费用 | subsidy | 补贴 | 输入/费用 | |
| 34 | 独有-其他费用 | no_output_wage | 无产值工资 | 输入/费用 | |
| 35 | 独有-其他费用 | assembly_wage_paid | 付装配工资 | 输入/费用 | |
| 36 | 独有-做办 | office_wage | 做办工资 | 输入/费用 | |
| 37 | 独有-做办 | office_wage_ratio | 做办工资占比% | 计算 | 已有 |
| 38 | 独有-可回收 | recoverable_wage | 可收回工资 | 输入/可回收 | |
| 39 | 独有-可回收 | dept_recoverable_wage | 车发部回收工资 | 输入/可回收 | |
| 40 | 独有-可回收 | recoverable_indonesia_wage | 可收回印尼工资 | 输入/可回收 | |
| 41 | 独有-可回收 | recoverable_tool_fee | 可收回工具费 | 输入/可回收 | |
| 42 | 独有-可回收 | non_recoverable_tool_fee | 不可回收工具费 | 输入/费用 | |
| 43 | 独有-可回收 | recoverable_paint | 可回收油漆 | 输入/可回收 | |
| 44 | 独有-模费 | auto_mold_fee | 自动机模费 | 输入/费用 | |
| 45 | 独有-模费 | mold_fee_ratio | 自动机模费占产值% | 计算 | 已有，标签修正 |
| 46 | 独有-模费 | hunan_mold_fee | 发湖南模费 | 输入/费用 | |
| 47 | 独有-模费 | hunan_mold_ratio | 发湖南模费占产值% | 计算 | ⚠️新增 |
| 48 | 独有-模费 | indonesia_mold_fee | 发印尼模费 | 输入/费用 | |
| 49 | 独有-模费 | indonesia_mold_ratio | 发印尼模费占产值% | 计算 | ⚠️新增 |
| 50 | 独有-合计 | total_ratio | 结余%+自模费% | 计算 | 已有，公式+标签修正 |
| 51 | 备注 | remark | 备注 | 输入 | |

**删除字段：**
- `output_tax_incl`（总产值含税）— 与共有字段 daily_output 重复

**计算公式变更：**
- `mold_fee_ratio`：已有，标签从"模费占产值%"改为"自动机模费占产值%"
- `total_ratio`：公式从 `balance_ratio` 改为 `balance_ratio + mold_fee_ratio`，标签从"合计%"改为"结余%+自模费%"
- `hunan_mold_ratio`（⚠️新增）= 发湖南模费 ÷ 总产值
- `indonesia_mold_ratio`（⚠️新增）= 发印尼模费 ÷ 总产值

**其他已有公式（无需修改）：**
- `移印开机率` = 移印开机台数 ÷ 移印总台数
- `喷油开机率` = 喷油开机台数 ÷ 喷油总台数
- `员工人均产值` = 总产值/天 ÷ 员工人数
- `总工资占产值%` = (员工工资 + 管工工资) ÷ 总产值
- `做办工资占比%` = 做办工资 ÷ 总产值
- `结余金额` = 总产值/天 - 费用合计 + 可回收费用
- `结余%` = 结余 ÷ 总产值

### 3.3 装配部

| 序号 | 分组 | 字段名 | 标签 | 类型 | 状态 |
|:----:|------|--------|------|------|------|
| 1 | 固定 | record_date | 日期 | 固定 | |
| 2 | 固定 | workshop | 车间 | 固定 | |
| 3 | 人数 | supervisor_count | 管工人数 | 输入 | |
| 4 | 人数 | worker_count | 员工人数 | 输入 | |
| 5 | 产值 | daily_output | 总产值/天 | 输入 | |
| 6 | 产值 | avg_output_per_worker | 人均产值 | 计算 | 已有 |
| 7 | 工资 | worker_wage | 员工工资/天 | 输入 | |
| 8 | 工资 | supervisor_wage | 管工工资/天 | 输入 | |
| 9 | 工资 | planned_wage_tax | 计划总工资含*1.13 | 输入 | |
| 10 | 工资 | actual_wage | 实际总工资 | 输入/费用 | |
| 11 | 共有费用 | rent | 房租 | 输入 | |
| 12 | 共有费用 | utility_fee | 水电费 | 输入 | |
| 13 | 共有费用 | tool_investment | 工具投资 | 输入 | |
| 14 | 共有费用 | equipment | 设备 | 输入 | |
| 15 | 共有费用 | renovation | 装修 | 输入 | |
| 16 | 共有费用 | misc_fee | 杂费 | 输入 | |
| 17 | 共有费用 | shipping_fee | 运费 | 输入 | |
| 18 | 共有费用 | social_insurance | 社保 | 输入 | |
| 19 | 共有费用 | tax | 税收 | 输入 | |
| 20 | 结余 | balance | 结余金额 | 计算 | 已有 |
| 21 | 结余 | balance_ratio | 结余% | 计算 | 已有 |
| 22 | 结余后 | hunan_social_insurance | 湖南社保 | 输入/费用 | ⚠️新增 |
| 23 | 结余后 | hunan_tax | 湖南税收 | 输入/费用 | ⚠️新增 |
| 24 | 独有-维修 | workshop_repair | 车间维修费 | 输入/费用 | |
| 25 | 独有-维修 | electrical_repair | 机电部维修费 | 输入/费用 | |
| 26 | 独有-物料 | workshop_materials | 车间物料费 | 输入/费用 | |
| 27 | 独有-物料 | stretch_film | 拉伸膜 | 输入/费用 | |
| 28 | 独有-物料 | tape | 胶纸 | 输入/费用 | |
| 29 | 独有-物料 | balance_minus_tape | 结余减胶纸 | 计算 | 已有 |
| 30 | 独有-物料 | balance_tape_ratio | 减胶纸后结余占计划工资% | 计算 | 已有 |
| 31 | 独有-可回收 | recoverable_electricity | 可回收电费 | 输入/可回收 | |
| 32 | 独有-工具投资 | workshop_tool_investment | 车间工具投资 | 输入/费用 | |
| 33 | 独有-工具投资 | fixture_tool_investment | 夹具部工具投资 | 输入/费用 | ⚠️新增 |
| 34 | 独有-工具投资 | tool_invest_ratio | 工具投资占计划工资% | 计算 | 已有，公式修正 |
| 35 | 独有-其他 | housing_subsidy | 外宿补贴 | 输入/非费用 | |
| 36 | 独有-其他 | supplement | 补料 | 输入/费用 | |
| 37 | 独有-其他 | borrowed_worker_wage | 外借人员工资 | 输入/费用 | |
| 38 | 独有-其他 | borrowed_wage_ratio | 外借人员工资占计划工资% | 计算 | 已有 |
| 39 | 备注 | remark | 备注 | 输入 | |

**计算公式变更：**
- `tool_invest_ratio`：公式从 `tool_investment ÷ 计划工资` 改为 `(workshop_tool_investment + fixture_tool_investment) ÷ 计划工资含税`

**装配部结余公式**：暂不调整，等用户后续确认

**其他已有公式（无需修改）：**
- `人均产值` = 总产值/天 ÷ 员工人数
- `结余金额` = 当前公式保持不变（待后续确认）
- `结余%` = 结余 ÷ 总产值
- `结余减胶纸` = 结余 - 胶纸
- `减胶纸后结余占计划工资%` = (结余 - 胶纸) ÷ 计划工资含税
- `外借人员工资占计划工资%` = 外借人员工资 ÷ 计划工资含税

## 4. 变更汇总

### 4.1 新增字段（5个）

| 部门 | 字段名 | 标签 | 类型 | 需数据库列 |
|------|--------|------|------|:----------:|
| 印喷 | hunan_mold_ratio | 发湖南模费占产值% | 计算 | 否 |
| 印喷 | indonesia_mold_ratio | 发印尼模费占产值% | 计算 | 否 |
| 装配 | hunan_social_insurance | 湖南社保 | 输入/费用 | 是 |
| 装配 | hunan_tax | 湖南税收 | 输入/费用 | 是 |
| 装配 | fixture_tool_investment | 夹具部工具投资 | 输入/费用 | 是 |

### 4.2 删除字段（1个）

| 部门 | 字段名 | 标签 | 原因 |
|------|--------|------|------|
| 印喷 | output_tax_incl | 总产值含税 | 与共有字段 daily_output 重复 |

### 4.3 标签修正（4个）

| 部门 | 字段名 | 原标签 | 新标签 |
|------|--------|--------|--------|
| 啤机 | output_tax_incl | 总产值含税 | 不含税产值 |
| 啤机 | mold_cost_ratio | 模具费用占产值比% | 模具维修占产值比% |
| 印喷 | work_hours | 工时 | 员工工时 |
| 印喷 | total_hours | 总时间 | 总工时 |

### 4.4 公式修正（2个）

| 部门 | 字段名 | 原公式 | 新公式 |
|------|--------|--------|--------|
| 印喷 | total_ratio | balance_ratio | balance_ratio + mold_fee_ratio |
| 装配 | tool_invest_ratio | tool_investment ÷ planned_wage_tax | (workshop_tool_investment + fixture_tool_investment) ÷ planned_wage_tax |

### 4.5 费用分类修正（2个）

| 部门 | 字段名 | 原分类 | 新分类 | 原因 |
|------|--------|--------|--------|------|
| 啤机 | recoverable_gate_fee | expense: true | expense: false | 可回收费用应加回而非扣除 |
| 装配 | housing_subsidy | expense: true | expense: false | 外宿补贴不参与结余计算（用户Excel公式中未包含此项） |

### 4.5b 字段类型变更（1个）

| 部门 | 字段名 | 原类型 | 新类型 | 说明 |
|------|--------|--------|--------|------|
| 啤机 | output_tax_incl | input: true（手动输入） | calc: true（自动计算） | 改为自动计算：总产值/天 ÷ 1.13，不再需要手动输入 |

### 4.6 别名冲突修正（4处）

| 位置 | 原别名 | 操作 | 原因 |
|------|--------|------|------|
| sharedFields → social_insurance | '湖南社保' | 删除此别名 | 装配部新增独立字段 hunan_social_insurance |
| sharedFields → tax | '湖南税收' | 删除此别名 | 装配部新增独立字段 hunan_tax |
| departments.assembly.sharedFieldAliases | tool_investment → '夹具部工具投资' | 删除此映射 | 装配部新增独立字段 fixture_tool_investment |
| departments.print → total_ratio.skipAliases | '发印尼模费占产值%' | 删除此 skipAlias | 与新增字段 indonesia_mold_ratio 的标签冲突 |

## 5. 需要修改的文件

### 5.1 `modules/balance/config.js`（核心字段配置）

**改动点：**
1. 重排三个部门 `uniqueFields` 数组的字段顺序
2. 印喷部新增 `hunan_mold_ratio`、`indonesia_mold_ratio` 计算字段定义
3. 装配部新增 `hunan_social_insurance`、`hunan_tax`、`fixture_tool_investment` 输入字段定义
4. 删除印喷部 `output_tax_incl` 字段
5. 修正标签（4处）
6. 修正 `recoverable_gate_fee` 的 `expense` 为 `false`
7. 删除 sharedFields 中 social_insurance 的 '湖南社保' 别名
8. 删除 sharedFields 中 tax 的 '湖南税收' 别名
9. 删除 assembly.sharedFieldAliases 中 '夹具部工具投资' 的映射

### 5.2 `modules/balance/calc.js`（后端计算）

**改动点：**
1. 啤机部新增 `output_tax_incl` 计算逻辑：`daily_output / 1.13`（原为输入字段，改为计算）
2. 印喷部新增 `hunan_mold_ratio` 和 `indonesia_mold_ratio` 计算逻辑
3. 印喷部修正 `total_ratio` 公式：`balance_ratio + mold_fee_ratio`
4. 装配部修正 `tool_invest_ratio` 公式：`(workshop_tool_investment + fixture_tool_investment) / planned_wage_tax`

### 5.3 `public/js/app.js`（前端）

**改动点：**
1. 重写 `DEPT_CONFIG` 中三个部门的 `uniqueFields` 数组，按新顺序排列
2. 重写 `getDeptColumns()` 函数，改为分组拼接模式（共有字段按分组插入，独有字段穿插到对应分组）
3. 删除印喷部 `output_tax_incl` 相关前端定义
4. 修正标签
5. 新增2个印喷计算字段、3个装配输入字段的前端定义

### 5.4 `routes/import-export.js`（Excel导入导出）

**改动点：**
1. 更新 COLUMN_MAP 列映射顺序匹配新字段顺序
2. 新增3个装配部输入字段的导入/导出映射
3. 新增2个印喷部计算字段的导出列
4. 删除印喷部 output_tax_incl 的映射
5. 确保导出列顺序与前端显示顺序一致

### 5.5 `db/init.sql`（数据库建表脚本）

**改动点：**
- `assembly_records` 表新增3列定义
- `print_records` 表移除 `output_tax_incl` 列定义（或注释保留）

### 5.6 数据库迁移 SQL

```sql
-- 装配部新增3个输入字段（均为费用字段，参与结余计算）
ALTER TABLE assembly_records ADD COLUMN IF NOT EXISTS hunan_social_insurance DECIMAL(12,2) DEFAULT 0;
ALTER TABLE assembly_records ADD COLUMN IF NOT EXISTS hunan_tax DECIMAL(12,2) DEFAULT 0;
ALTER TABLE assembly_records ADD COLUMN IF NOT EXISTS fixture_tool_investment DECIMAL(12,2) DEFAULT 0;

-- 印喷部 output_tax_incl：保留数据库列不删除，仅前端和配置中移除
-- 避免已有数据丢失，后续可清理
```

## 6. 实现策略

### 6.1 前端架构调整

当前 `getDeptColumns()` 的逻辑是"共有全放前 → 独有插 balance 前"，新方案需要改为**分组拼接**模式：

```
每个部门的列 = [
  日期, 车间,
  ...台数组(独有),
  ...人数组(共有 + 独有人数字段),
  ...时间组(独有),
  ...产值组(共有 + 独有产值计算字段),
  ...工资组(共有 + 独有工资字段),
  ...费用组(共有),
  ...结余组(共有 + 独有结余后字段),
  ...独有费用组(按子类分组),
  备注
]
```

每个部门定义自己的完整列顺序，不再依赖简单的"共有+独有"拼接。

### 6.2 计算字段实现

新增的2个印喷部计算字段在 `calc.js` 中添加计算逻辑，通过 `config.js` 中 `calc: true` 标记在前端显示为不可编辑。

## 7. 待后续确认事项

1. **装配部结余公式**：用户Excel中装配部结余 = 计划总工资含税 - 15项费用，与当前代码（总产值/天 - 费用）不同。待用户确认后单独处理。
2. **装配部费用项细则**：具体哪些字段参与装配部结余计算，待结余公式确认后同步调整。
