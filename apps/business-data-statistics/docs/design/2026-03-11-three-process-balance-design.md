# 三工结余模块设计文档

## 1. 系统概述

- **系统名称**：生产经营数据系统
- **第一期范围**：三工结余模块 + 用户管理 + 系统设置
- **技术栈**：Express + Vue 3 + Element Plus + PostgreSQL
- **部署**：局域网，多人同时使用
- **用户角色**：统计组（管理员）、录入员

## 2. 模块结构

```
生产经营数据系统
├── 三工结余
│   ├── 啤机部（收支表）
│   ├── 印喷部（产值表）
│   ├── 装配部（收支表）
│   └── 三工汇总
├── 用户管理
└── 系统设置
    ├── 车间管理
    ├── 费用项管理
    ├── 计算规则
    ├── 数据锁定
    ├── 操作日志
    └── 数据备份
```

## 3. 数据结构

### 3.1 三部门共有字段（列顺序）

| 序号 | 字段 | 类型 | 可编辑 |
|---|---|---|---|
| 1 | 日期 | date | 是 |
| 2 | 车间 | 下拉选择 | 是 |
| 3 | 管工人数 | int | 是 |
| 4 | 员工人数 | int | 是 |
| 5 | 总产值/天 | decimal | 是 |
| 6 | 员工工资/天 | decimal | 是 |
| 7 | 管工工资/天 | decimal | 是 |
| 8 | 房租 | decimal | 是 |
| 9 | 水电费 | decimal | 是 |
| 10 | 工具投资 | decimal | 是 |
| 11 | 设备 | decimal | 是 |
| 12 | 装修 | decimal | 是 |
| 13 | 杂费 | decimal | 是 |
| 14 | 运费 | decimal | 是 |
| 15 | 社保 | decimal | 是 |
| 16 | 税收 | decimal | 是 |
| 17 | 结余金额 | decimal | 自动计算 |
| 18 | 结余% | decimal | 自动计算 |
| — | 各部门独有费用项 | decimal | 是 |
| 末列 | 备注 | text | 是 |

### 3.2 各部门独有字段

**啤机部（19项）**：

| 字段 | DB列名 | 类型 | 输入/计算 |
|---|---|---|---|
| 总台数 | total_machines | int | 输入 |
| 开机台数 | running_machines | int | 输入 |
| 开机率 | machine_rate | numeric | 计算: running_machines / total_machines |
| 杂工人数 | misc_workers | int | 输入 |
| 批水口人数 | gate_workers | int | 输入 |
| 开机时间 | run_hours | numeric | 输入 |
| 总产值/天（含税） | output_tax_incl | numeric | 输入 |
| 每台机平均产值 | avg_output_per_machine | numeric | 计算: daily_output / running_machines |
| 杂工工资/天 | misc_worker_wage | numeric | 输入 |
| 总工资占产值% | wage_ratio | numeric | 计算: total_wage / daily_output |
| 机器维修 | machine_repair | numeric | 输入 |
| 模具维修 | mold_repair | numeric | 输入 |
| 模具费用占产值比% | mold_cost_ratio | numeric | 计算: mold_repair / daily_output |
| 批水口加工费（全包） | gate_processing_fee | numeric | 输入 |
| 批水口费用占产值比% | gate_cost_ratio | numeric | 计算: gate_processing_fee / daily_output |
| 装配帮啤机批水口配件费用 | assembly_gate_parts_fee | numeric | 输入 |
| 可回收外厂批水口加工费 | recoverable_gate_fee | numeric | 输入 |
| 原料补料 | material_supplement | numeric | 输入 |
| 平均每台结余 | avg_balance_per_machine | numeric | 计算: balance / running_machines |

**印喷部（28项）**：

| 字段 | DB列名 | 类型 | 输入/计算 |
|---|---|---|---|
| 移印机总台数 | pad_total_machines | int | 输入 |
| 移印机开机台数 | pad_running_machines | int | 输入 |
| 移印机开机率 | pad_machine_rate | numeric | 计算 |
| 喷油机总台数 | spray_total_machines | int | 输入 |
| 喷油机开机台数 | spray_running_machines | int | 输入 |
| 喷油机开机率 | spray_machine_rate | numeric | 计算 |
| 杂工人数 | misc_workers | int | 输入 |
| 工时 | work_hours | numeric | 输入 |
| 总时间 | total_hours | numeric | 输入 |
| 总产值含税 | output_tax_incl | numeric | 输入 |
| 员工人均产值 | avg_output_per_worker | numeric | 计算 |
| 补贴 | subsidy | numeric | 输入 |
| 总工资占产值% | wage_ratio | numeric | 计算 |
| 物料 | materials | numeric | 输入（含原子灰/胶头/油墨/喷码溶剂合计） |
| 维修费 | repair_fee | numeric | 输入 |
| 油水金额 | oil_water_amount | numeric | 输入 |
| 无产值工资 | no_output_wage | numeric | 输入 |
| 可收回工资 | recoverable_wage | numeric | 输入 |
| 可收回印尼工资 | recoverable_indonesia_wage | numeric | 输入 |
| 不可回收工具费 | non_recoverable_tool_fee | numeric | 输入 |
| 可收回工具费 | recoverable_tool_fee | numeric | 输入 |
| 可回收油漆金额 | recoverable_paint | numeric | 输入 |
| 车发部回收工资 | dept_recoverable_wage | numeric | 输入 |
| 付装配工资 | assembly_wage_paid | numeric | 输入 |
| 做办工资 | office_wage | numeric | 输入 |
| 做办工资占比 | office_wage_ratio | numeric | 计算 |
| 自动机模费 | auto_mold_fee | numeric | 输入 |
| 模费占产值% | mold_fee_ratio | numeric | 计算 |
| 发湖南模费 | hunan_mold_fee | numeric | 输入 |
| 发印尼模费 | indonesia_mold_fee | numeric | 输入 |
| 合计% | total_ratio | numeric | 计算 |

**装配部（15项）**：

| 字段 | DB列名 | 类型 | 输入/计算 |
|---|---|---|---|
| 人均产值 | avg_output_per_worker | numeric | 计算: daily_output / worker_count |
| 计划总工资（含税*1.13） | planned_wage_tax | numeric | 输入 |
| 实际总工资 | actual_wage | numeric | 输入 |
| 车间维修费 | workshop_repair | numeric | 输入 |
| 机电部维修费 | electrical_repair | numeric | 输入 |
| 车间物料费 | workshop_materials | numeric | 输入 |
| 拉伸膜 | stretch_film | numeric | 输入 |
| 补料 | supplement | numeric | 输入 |
| 外宿补贴 | housing_subsidy | numeric | 输入 |
| 可回收电费 | recoverable_electricity | numeric | 输入 |
| 胶纸 | tape | numeric | 输入 |
| 结余减胶纸 | balance_minus_tape | numeric | 计算: balance - tape |
| 减胶纸后结余占计划工资% | balance_tape_ratio | numeric | 计算 |
| 工具投资占计划工资% | tool_invest_ratio | numeric | 计算 |
| 外借人员工资 | borrowed_worker_wage | numeric | 输入 |
| 外借人员工资占计划工资% | borrowed_wage_ratio | numeric | 计算 |

### 3.3 计算公式

**结余金额（三部门通用逻辑）**：
```
结余金额 = 总产值/天 - 员工工资/天 - 管工工资/天 - 房租 - 水电费 - 工具投资 - 设备 - 装修 - 杂费 - 运费 - 社保 - 税收 - [各部门独有输入型费用项之和]
```

**结余%**：
```
结余% = 结余金额 / 总产值/天 × 100%
```

**合计行结余%**：
```
合计结余% = 合计结余金额 / 合计总产值 × 100%（用合计值重算，不是百分比直接求和）
```

注：具体哪些费用项参与结余计算，可在「系统设置 > 计算规则」中配置。上述为默认公式。

### 3.4 数据库表结构

**共有字段（三张表都有）**：

| 列名 | 类型 | 说明 |
|---|---|---|
| id | SERIAL PRIMARY KEY | 主键 |
| record_date | DATE NOT NULL | 日期 |
| workshop_id | INT REFERENCES workshops(id) | 车间外键 |
| supervisor_count | INT | 管工人数 |
| worker_count | INT | 员工人数 |
| daily_output | NUMERIC(14,2) | 总产值/天 |
| worker_wage | NUMERIC(12,2) | 员工工资/天 |
| supervisor_wage | NUMERIC(12,2) | 管工工资/天 |
| rent | NUMERIC(12,2) | 房租 |
| utility_fee | NUMERIC(12,2) | 水电费 |
| tool_investment | NUMERIC(12,2) | 工具投资 |
| equipment | NUMERIC(12,2) | 设备 |
| renovation | NUMERIC(12,2) | 装修 |
| misc_fee | NUMERIC(12,2) | 杂费 |
| shipping_fee | NUMERIC(12,2) | 运费 |
| social_insurance | NUMERIC(12,2) | 社保 |
| tax | NUMERIC(12,2) | 税收 |
| balance | NUMERIC(14,2) | 结余金额（计算后存储） |
| balance_ratio | NUMERIC(8,4) | 结余%（计算后存储） |
| remark | TEXT | 备注 |
| created_by | INT | 创建人 |
| updated_by | INT | 最后修改人 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

各部门独有字段追加在对应表中（列名见 3.2 节 DB列名）。

**数据表名称**：`beer_records`（啤机）、`print_records`（印喷）、`assembly_records`（装配）

**辅助表**：

| 表名 | 说明 |
|---|---|
| users | 用户表（id, username, password_hash, name, role, department, status, batch_permission, created_at） |
| workshops | 车间表（id, name, region, department, sort_order, status） |
| expense_items | 费用项配置表（id, department, field_name, display_name, sort_order, is_shared, is_calculated, enabled） |
| calc_rules | 计算规则表（id, department, formula_type, participating_fields） |
| data_locks | 数据锁定表（id, department, lock_month, locked_by, locked_at） |
| audit_logs | 操作日志表（id, user_id, action, table_name, record_id, old_value, new_value, created_at） |
| user_modules | 用户模块权限表（user_id, module_name） |

### 3.5 车间分布

### 3.4 车间分布

| 部门 | 车间 | 地区分组 |
|---|---|---|
| 啤机部 | 兴信A、兴信B、华登、邵阳 | 清溪（兴信A+兴信B+华登）、邵阳 |
| 印喷部 | 兴信A、华登、邵阳 | 清溪（兴信A+华登）、邵阳 |
| 装配部 | 兴信A、兴信B、华登、邵阳 | 清溪（兴信A+兴信B+华登）、邵阳 |

## 4. 核心功能

### 4.1 数据录入与编辑

- 单元格直接点击编辑（浅黄色背景标识可编辑单元格）
- 上方/下方插入行（新增数据记录）
- 批量粘贴（从 Excel 复制多行直接粘贴）
- 日期模板：选日期自动生成各车间空行
- 计算字段（结余金额、结余%）自动算，不可手改
- 每行有编辑/删除操作

### 4.2 数据导入/导出

- 拖拽上传区（工具栏上方，紫色虚线框，支持 .xlsx/.xls）
- 点击选择文件上传
- 导入时字段映射校验
- 导出 Excel（按当前筛选范围导出）

### 4.3 筛选与搜索

- 默认显示：近7天（今天往前推7个自然日，含今天共7天）
- 快捷按钮：近7天（默认）/ 本月 / 本季
- 自定义日期范围选择
- 车间搜索框
- 全部数据一次性展示，页面滚动（不分页）

### 4.4 底部固定合计表

- 固定在页面底部，不随滚动消失
- 带表头行（窄，悬停 tooltip 显示全称）
- 合计层级（以啤机部为例）：
  - 兴信A合计
  - 兴信B合计
  - 华登合计
  - **清溪合计**（兴信A + 兴信B + 华登）
  - 邵阳合计
  - **总合计**（清溪 + 邵阳）
- 合计范围 = 当前筛选结果
- 数值列求和，结余%用合计后的值重新计算（结余金额合计 ÷ 产值合计）

### 4.5 数据管理

- 新增/编辑/删除单条记录
- 批量删除（需批量权限）
- 数据锁定：统计组按月锁定，锁定后录入员不可修改
- 操作日志：记录谁在什么时候改了什么数据

### 4.6 数据校验

- 人数不能为负
- 开机台数不能大于总台数（啤机/印喷）
- 计算字段不允许手动修改
- 导入时字段映射校验和数据格式校验

## 5. 用户管理

### 5.1 用户列表字段

ID、用户名、姓名、角色、所属部门、状态、模块权限、批量权限、数据锁定权限、创建时间、操作

### 5.2 用户操作

- 新增/编辑用户：用户名、姓名、角色（统计组/录入员）、所属部门、批量权限开关
- 模块授权：按模块分组勾选（三工结余子模块 + 系统模块）
- 重置密码
- 禁用/启用

### 5.3 权限控制

| 角色 | 数据操作 | 批量操作 | 数据锁定 | 系统设置 |
|---|---|---|---|---|
| 统计组 | 全部部门 | 允许 | 可锁定/解锁 | 全部 |
| 录入员 | 仅授权部门 | 取决于用户的「批量权限」开关 | 不可 | 不可 |

## 6. 系统设置

| 模块 | 功能 |
|---|---|
| 车间管理 | 树形结构：地区→车间，增删改排序，关联部门 |
| 费用项管理 | 管理预定义费用项的显示名称、排序、启用/停用。不支持运行时动态加列，新增费用项需开发配合 |
| 计算规则 | 结余公式配置：产值 - 参与计算的费用项 |
| 数据锁定 | 按月查看/操作锁定状态 |
| 操作日志 | 按时间/用户/操作类型筛选 |
| 数据备份 | 手动备份/备份记录/恢复 |

## 7. 界面设计

### 7.1 配色方案（低饱和莫兰迪色系）

| 用途 | 色值 | 名称 |
|---|---|---|
| 明细表表头 | `#3D8361` | 橄榄绿（结余列高亮） |
| 其他表头 | `#7030A0` | 幽砚紫（主表头、导航栏） |
| 主色 | `#7030A0` | 幽砚紫 |
| 辅色 | `#57B894` | 青柠绿（新增/确认按钮） |
| 辅色 | `#E88EA0` | 豆沙粉（删除/警告按钮） |
| 中性 | `#B8D8C8` | 薄荷绿 |
| 中性 | `#A88DF3` | 浅粉紫（导出/授权按钮） |

### 7.2 页面布局

- **顶部**：幽砚紫导航栏（系统名 + 用户角色 + 退出）
- **左侧**：可折叠侧边栏菜单
  - 三工结余（展开：啤机部/印喷部/装配部/三工汇总）
  - 后续模块（灰色预留）
  - 用户管理
  - 系统设置
- **面包屑**：三工结余 / 啤机部
- **拖拽上传区**：紫色虚线框
- **工具栏**：日期筛选 + 快捷按钮 + 搜索 + 操作按钮
- **数据表格**：中间可滚动区域，表头固定
- **底部固定合计**：带表头 + 各车间/地区/总合计

### 7.3 交互细节

- 可编辑单元格：浅黄色背景标识
- 计算字段：浅绿色背景，不可编辑
- 合计表头列名缩短，鼠标悬停显示完整名称（tooltip）
- 行操作：编辑（青柠绿）、删除（豆沙粉）
- 斑马纹隔行背景

## 8. 三工汇总页

只读汇总页面，展示三个部门在同一时间范围内的结余对比。

**显示内容**：

| 部门 | 总产值 | 总工资 | 总费用 | 结余金额 | 结余% |
|---|---|---|---|---|---|
| 啤机部 | 汇总 | 汇总 | 汇总 | 汇总 | 重算 |
| 印喷部 | 汇总 | 汇总 | 汇总 | 汇总 | 重算 |
| 装配部 | 汇总 | 汇总 | 汇总 | 汇总 | 重算 |
| **三工合计** | 汇总 | 汇总 | 汇总 | 汇总 | 重算 |

- 使用与各部门相同的筛选条件（近7天/本月/本季/自定义）
- 只读，不可编辑
- 可下钻到各部门详情页
- 可导出 Excel

## 9. API 路由结构

### 9.1 认证

| 方法 | 路由 | 说明 |
|---|---|---|
| POST | /api/auth/login | 登录，返回 JWT |
| POST | /api/auth/logout | 登出 |
| GET | /api/auth/me | 获取当前用户信息 |

### 9.2 三工结余数据（:dept = beer/print/assembly）

| 方法 | 路由 | 说明 |
|---|---|---|
| GET | /api/:dept/records | 查询记录（支持日期范围、车间筛选） |
| POST | /api/:dept/records | 新增一条或多条记录 |
| PUT | /api/:dept/records/:id | 更新单条记录 |
| DELETE | /api/:dept/records/:id | 删除单条记录 |
| DELETE | /api/:dept/records/batch | 批量删除 |
| GET | /api/:dept/summary | 获取合计数据 |
| POST | /api/:dept/import | Excel 导入 |
| GET | /api/:dept/export | Excel 导出 |

### 9.3 三工汇总

| 方法 | 路由 | 说明 |
|---|---|---|
| GET | /api/summary/overview | 三部门汇总数据 |
| GET | /api/summary/export | 汇总导出 |

### 9.4 用户管理

| 方法 | 路由 | 说明 |
|---|---|---|
| GET | /api/users | 用户列表 |
| POST | /api/users | 新增用户 |
| PUT | /api/users/:id | 编辑用户 |
| PUT | /api/users/:id/status | 启用/禁用 |
| PUT | /api/users/:id/password | 重置密码 |
| GET | /api/users/:id/modules | 获取模块权限 |
| PUT | /api/users/:id/modules | 设置模块权限 |

### 9.5 系统设置

| 方法 | 路由 | 说明 |
|---|---|---|
| GET/POST/PUT/DELETE | /api/workshops | 车间 CRUD |
| GET/PUT | /api/expense-items | 费用项管理 |
| GET/PUT | /api/calc-rules | 计算规则 |
| GET/POST/DELETE | /api/data-locks | 数据锁定 |
| GET | /api/audit-logs | 操作日志查询 |
| POST | /api/backup | 手动备份 |
| GET | /api/backup/list | 备份记录 |
| POST | /api/backup/restore | 恢复数据 |

## 10. 后续扩展预留

- 侧边栏预留位：预计产值、实际产值、人工成本、固定支出、物料支出、年度汇总
- 模块授权预留后续模块勾选
- 系统设置预留：客户、供应商、仓储等子模块
- 总公式入口：总产值 - 人工 - 物料 - 固定支出 + 三工结余 = 最终结余

## 11. 技术要点

- PostgreSQL NUMERIC 类型保证财务计算精度
- 每个部门独立数据表
- JWT 认证 + 角色/模块权限中间件
- 前端 Vue 3 单页应用，Element Plus 组件库
- 合计行前端实时计算（筛选变化时重算）
- Excel 导入/导出使用 xlsx 库（SheetJS）
