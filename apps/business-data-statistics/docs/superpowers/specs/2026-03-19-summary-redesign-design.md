# 大车间汇总模块设计 — 可视化看板 + 汇总表

## 1. 概述

将现有"三工汇总"模块重构为"结余收支汇总"下的"大车间汇总"子模块，提供两种数据展示形式：
- **可视化看板**：管理层看趋势、看部门对比
- **汇总表**：统计组核查数据、对账

## 2. 导航结构变更

### 现有结构
```
三工汇总（顶级菜单）
```

### 新结构
```
结余收支汇总（父级菜单，可展开）
  ├─ 大车间汇总（原三工汇总，本次实现）
  ├─ 小部门汇总（未来扩展，暂不实现，菜单不显示）
  └─ 全厂总汇总（未来扩展，暂不实现，菜单不显示）
```

- "结余收支汇总"为可展开的父级菜单，点击展开子菜单列表
- 小部门汇总、全厂总汇总暂不在菜单中显示，待实现时再添加
- 左侧导航栏的菜单数据在 `app.js` 中定义，需修改菜单配置

## 3. 大车间汇总 — 页面结构

页面顶部有两个 Tab：「可视化看板」和「汇总表」，点击切换视图。

### 3.1 可视化看板（经典看板布局）

#### 筛选栏
- 年份选择（下拉框，默认当年）
- 月份选择（下拉框，默认当月；可选"全年"，此时 API 参数 `month` 不传，后端返回全年汇总）

#### 指标卡片行（4个）
| 卡片 | 数据来源 | 颜色 |
|------|---------|------|
| 本月总产值 | 三部门 daily_output 之和 | 主色 #7F41C0 顶边 |
| 本月总费用 | 三部门所有费用字段之和（含工资） | 豆沙粉 #E88EA0 顶边 |
| 本月总结余 | 总产值 - 总费用 | 青柠绿 #57B894 顶边 |
| 平均结余率 | 总结余 / 总产值 | 天青蓝 #5B9BD5 顶边 |

每张卡片只显示主数值（环比功能暂不实现，待历史数据积累后添加）。

#### 图表区（上半部分，左右分栏）

**左侧（60%）— 部门对比柱状图**
- 类型：分组柱状图
- X轴：啤机部、印喷部、装配部
- 每组3根柱子：产值（#7F41C0）、费用（#E88EA0）、结余（#57B894）
- 数据：当月或选定月份的汇总数据

**右侧（40%）— 月度结余率趋势**
- 类型：折线图
- X轴：月份（1月-12月，显示选定年份的所有月份）
- 三条折线：啤机部（#7F41C0）、印喷部（#5B9BD5）、装配部（#57B894）
- Y轴：结余率百分比

#### 图表区（下半部分，全宽）

**费用构成堆叠柱状图（三部门合计）**
- 类型：堆叠柱状图
- X轴：月份（1月-12月，选定年份）
- 堆叠层及对应字段：见下方"费用分类映射表"
- 颜色：#7F41C0, #9B6DC6, #5B9BD5, #57B894, #E88EA0, #FFB74D

#### 费用分类映射表（堆叠图使用）
| 分类名 | 包含字段 | 颜色 |
|--------|---------|------|
| 工资 | worker_wage, supervisor_wage（三部门共有）+ misc_worker_wage（啤机）+ no_output_wage, assembly_wage_paid, office_wage（印喷）+ actual_wage, borrowed_worker_wage（装配） | #7F41C0 |
| 房租水电 | rent, utility_fee | #9B6DC6 |
| 社保税收 | social_insurance, tax + hunan_social_insurance, hunan_tax（装配） | #5B9BD5 |
| 维修物料 | tool_investment, equipment, renovation + machine_repair, mold_repair, materials, material_supplement（啤机）+ repair_fee, materials, oil_water_amount, non_recoverable_tool_fee（印喷）+ workshop_repair, electrical_repair, workshop_materials, stretch_film, tape, supplement, workshop_tool_investment, fixture_tool_investment（装配） | #57B894 |
| 加工模费 | gate_processing_fee, assembly_gate_parts_fee（啤机）+ auto_mold_fee, hunan_mold_fee, indonesia_mold_fee（印喷） | #E88EA0 |
| 其他 | misc_fee, shipping_fee + subsidy（印喷） | #FFB74D |

#### 空状态处理
- 无数据时：卡片显示 ¥0 / 0%，图表显示空状态提示文字"暂无数据"
- API 失败时：显示错误提示（ElMessage.error）

#### 图表库
- **ECharts 5.5.0**（通过 CDN 引入）
- CDN 地址：`https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js`
- 侧边栏折叠/展开时需调用 `chart.resize()` 重新适配宽度

### 3.2 汇总表（分Tab页签）

#### 筛选栏
- 月份选择器（el-date-picker type="month"），默认当月
- 导出 Excel 按钮

#### 导出规则
- 总览 Tab：导出总览表（单 Sheet）
- 部门 Tab：导出该部门按车间的完整明细（单 Sheet）

#### Tab 页签结构

**总览 Tab（横向并列，所有费用项展开）**
| 分类 | 费用项目 | 啤机部 | 印喷部 | 装配部 | 合计 |
|------|---------|--------|--------|--------|------|
| 产值 | 总产值 | | | | |
| 人员 | 管工人数 | | | | |
| 人员 | 员工人数 | | | | |
| 共有费用 | 员工工资 | | | | |
| 共有费用 | 管工工资 | | | | |
| 共有费用 | 房租 ... 税收（共11项） | | | | |
| 啤机独有 | 机器维修 ... （共6项） | 有值 | — | — | |
| 印喷独有 | 维修费 ... （共11项） | — | 有值 | — | |
| 装配独有 | 车间维修费 ... （共12项） | — | — | 有值 | |
| 合计 | **费用总计** | | | | |
| 结余 | **结余** | | | | |
| 结余 | **结余率** | | | | |

> 其他部门无此费用项的单元格显示"—"

**部门 Tab（啤机部 / 印喷部 / 装配部）**
- 列 = 该部门各车间 + 合计
- 行 = 产值 + 人员 + 共有费用项 + 部门独有费用项（完整列出）+ 结余 + 结余率
- 默认显示当月汇总，筛选栏可选月份

#### 啤机部 Tab 示例
| 分类 | 费用项目 | 兴信A | 兴信B | 华登A | 邵阳华登 | 合计 |
|------|---------|-------|-------|-------|---------|------|
| 产值 | 总产值 | | | | | |
| 人员 | 管工人数 | | | | | |
| 人员 | 员工人数 | | | | | |
| 共有 | 员工工资 | | | | | |
| 共有 | 管工工资 | | | | | |
| 共有 | 房租 | | | | | |
| ... | ... | | | | | |
| 独有 | 机器维修 | | | | | |
| 独有 | 模具维修 | | | | | |
| ... | ... | | | | | |
| 合计 | **费用总计** | | | | | |
| 结余 | **结余** | | | | | |
| 结余 | **结余率** | | | | | |

## 4. 三部门费用字段清单

### 4.1 共有费用字段（11项，三部门都有）

工资类（expense: true，参与结余计算）：
| 字段名 | 中文标签 |
|--------|---------|
| worker_wage | 员工工资 |
| supervisor_wage | 管工工资 |

其他共有费用（expense: true）：
| 字段名 | 中文标签 |
|--------|---------|
| rent | 房租 |
| utility_fee | 水电费 |
| tool_investment | 工具投资 |
| equipment | 设备 |
| renovation | 装修 |
| misc_fee | 杂费 |
| shipping_fee | 运费 |
| social_insurance | 社保 |
| tax | 税收 |

> **注意：** worker_wage 和 supervisor_wage 在 config.js 中标记为 `expense: true`，是费用字段，参与结余计算（结余 = 产值 - 所有 expense 字段之和）。

### 4.2 啤机部独有费用字段（6项）
| 字段名 | 中文标签 |
|--------|---------|
| machine_repair | 机器维修 |
| mold_repair | 模具维修 |
| materials | 物料 |
| material_supplement | 原料补料 |
| gate_processing_fee | 批水口加工费 |
| assembly_gate_parts_fee | 装配批水口配件费 |

### 4.3 印喷部独有费用字段（11项）
| 字段名 | 中文标签 |
|--------|---------|
| repair_fee | 维修费 |
| materials | 物料 |
| oil_water_amount | 油水金额 |
| subsidy | 补贴 |
| no_output_wage | 无产值工资 |
| assembly_wage_paid | 付装配工资 |
| office_wage | 做办工资 |
| non_recoverable_tool_fee | 不可回收工具费 |
| auto_mold_fee | 自动机模费 |
| hunan_mold_fee | 发湖南模费 |
| indonesia_mold_fee | 发印尼模费 |

### 4.4 装配部独有费用字段（12项）
| 字段名 | 中文标签 |
|--------|---------|
| actual_wage | 实际总工资 |
| hunan_social_insurance | 湖南社保 |
| hunan_tax | 湖南税收 |
| workshop_repair | 车间维修费 |
| electrical_repair | 机电部维修费 |
| workshop_materials | 车间物料费 |
| stretch_film | 拉伸膜 |
| tape | 胶纸 |
| supplement | 补料 |
| borrowed_worker_wage | 外借人员工资 |
| workshop_tool_investment | 车间工具投资 |
| fixture_tool_investment | 夹具部工具投资 |

### 4.5 车间名称（以数据库 workshops 表为准）
| 部门 | 车间 |
|------|------|
| 啤机部 | 兴信A, 兴信B, 华登A, 邵阳华登 |
| 印喷部 | 兴信A, 华登A, 邵阳华登 |
| 装配部 | 兴信A, 兴信B, 华登A, 华嘉, 邵阳华登 |

## 5. 后端 API 改造

### 5.1 现有问题
当前 `/api/summary/overview` 只 SELECT 了 10 个硬编码字段，漏掉了 29 个部门独有费用字段。

### 5.2 需要的 API

#### API 1：看板数据
```
GET /api/summary/dashboard?year=2026&month=3
```
- `month` 可选，不传则返回全年汇总（卡片显示年度总额，柱状图显示年度汇总）
- 月度趋势和费用构成始终返回该年所有月份的数据

返回：
```json
{
  "cards": {
    "total_output": 2847560,
    "total_expense": 1923410,
    "total_balance": 924150,
    "avg_ratio": 0.325
  },
  "departments": [
    { "dept": "beer", "label": "啤机部", "output": 982350, "expense": 635200, "balance": 347150, "ratio": 0.354 },
    { "dept": "print", "label": "印喷部", "output": 838210, "expense": 582010, "balance": 256200, "ratio": 0.306 },
    { "dept": "assembly", "label": "装配部", "output": 1027000, "expense": 706200, "balance": 320800, "ratio": 0.312 }
  ],
  "monthly_trend": [
    { "month": "2026-01", "beer_ratio": 0.34, "print_ratio": 0.29, "assembly_ratio": 0.31 },
    { "month": "2026-02", "beer_ratio": 0.32, "print_ratio": 0.30, "assembly_ratio": 0.28 }
  ],
  "expense_breakdown": [
    { "month": "2026-01", "wage": 796800, "rent_utility": 161600, "insurance_tax": 127200, "repair_material": 98500, "process_mold": 56000, "other": 22300 }
  ]
}
```

后端实现要点：
- 从 `modules/balance/config.js` 动态读取各部门所有 expense 字段，避免硬编码
- `expense_breakdown` 按"费用分类映射表"（3.1节）分组聚合
- 月度趋势按 `EXTRACT(YEAR FROM record_date)` 和 `EXTRACT(MONTH FROM record_date)` 分组

#### API 2：汇总表数据
```
GET /api/summary/detail?start_date=2026-03-01&end_date=2026-03-31
GET /api/summary/detail?dept=beer&start_date=2026-03-01&end_date=2026-03-31
```
- `dept` 为空时返回总览数据（三部门概要）
- `dept=beer|print|assembly` 时返回该部门按车间分列的完整费用明细

返回（总览，dept 为空）：
```json
{
  "departments": [
    { "dept": "beer", "label": "啤机部",
      "total_output": 982350, "shared_expense": 635200, "unique_expense": 31800,
      "total_expense": 667000, "balance": 315350, "balance_ratio": 0.321 }
  ],
  "total": { "total_output": 2847560, "shared_expense": 1270000, "unique_expense": 128900,
             "total_expense": 1398900, "balance": 1448660, "balance_ratio": 0.509 }
}
```

返回（部门明细，dept=beer）：
```json
{
  "dept": "beer",
  "workshops": ["兴信A", "兴信B", "华登A", "邵阳华登"],
  "rows": [
    { "category": "产值", "field": "daily_output", "label": "总产值",
      "values": { "兴信A": 320000, "兴信B": 280000, "华登A": 250000, "邵阳华登": 132350 },
      "total": 982350 },
    { "category": "人员", "field": "supervisor_count", "label": "管工人数",
      "values": { "兴信A": 4, "兴信B": 3, "华登A": 3, "邵阳华登": 2 },
      "total": 12 },
    { "category": "共有", "field": "worker_wage", "label": "员工工资",
      "values": { "兴信A": 85200, "兴信B": 72400, "华登A": 68000, "邵阳华登": 60000 },
      "total": 285600 },
    { "category": "独有", "field": "machine_repair", "label": "机器维修",
      "values": { "兴信A": 3000, "兴信B": 2500, "华登A": 1800, "邵阳华登": 1200 },
      "total": 8500 }
  ],
  "expense_total": { "兴信A": 210000, "兴信B": 185000, "华登A": 150000, "邵阳华登": 120000, "total": 665000 },
  "balance": { "兴信A": 110000, "兴信B": 95000, "华登A": 100000, "邵阳华登": 12350, "total": 317350 },
  "balance_ratio": { "兴信A": 0.344, "兴信B": 0.339, "华登A": 0.400, "邵阳华登": 0.093, "total": 0.323 }
}
```

## 6. 前端改动

### 6.1 导航菜单（app.js）
- 新增"结余收支汇总"父级菜单
- "大车间汇总"作为子菜单（路由复用或替换原"三工汇总"）
- 小部门汇总、全厂总汇总暂不显示在菜单中

### 6.2 SummaryPage 组件重构
- 顶部 Tab：「可视化看板」 | 「汇总表」
- 可视化看板：引入 ECharts，4个卡片 + 3个图表
- 汇总表：4个子Tab（总览 / 啤机 / 印喷 / 装配），el-table 渲染
- 侧边栏折叠/展开时需监听事件，调用所有 ECharts 实例的 `resize()`

### 6.3 新增 CDN
- `index.html` 中添加 ECharts CDN：`https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js`

## 7. 颜色规范

严格遵循设计原子库：
- 主色/导航：#7F41C0（深晶紫）
- 啤机部标识：#3D8361（橄榄绿）
- 印喷部标识：#5B9BD5（天青蓝）
- 装配部标识：#E88EA0（豆沙粉）
- 成功/正值：#57B894（青柠绿）
- 警告/负值：#E88EA0（豆沙粉）
- 背景：#FFFCEF（浅米黄）
- 文字：#333333（炭墨灰）

## 8. 不做的事项

- 小部门汇总（胶袋/吸塑/配色等）— 未来扩展
- 全厂总汇总 — 未来扩展
- 同比/环比计算 — 需要历史数据积累，可后续添加（卡片暂只显示主数值）
- 数据钻取到单条记录 — 已有部门明细表承担此功能
