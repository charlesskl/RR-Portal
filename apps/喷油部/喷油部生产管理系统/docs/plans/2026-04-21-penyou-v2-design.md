# 喷油部系统 v2 · 设计文档(2026-04-21)

> 本文档规划整个系统第二阶段。v1 的「核价表 / 分拉 / 收支表」三页交付后,用户反馈需要自动化录入、排产、标准价复用、月度汇总。v2 按「**少手输、多自动**」主线重构。

## 一、背景与目标

v1 问题:
- 核价表要主管手填每道工序的工价(经验值,重复劳动)
- 分拉页只支持手选拉,没有订单概念、没有产能估算
- 收支表的产值/工资是按「目标数」估算,和实际生产不匹配
- 没有月度汇总,没法看整月生意情况

v2 核心流程:

```
新建订单(名+数量+起始日)
  ↓  系统按核价表展开工序,按「工序→拉」映射自动分拉
排产单(工序|拉|件数|日产能|天数|起止日)
  ↓  主管只需选喷油工序的拉,其它默认
每日录入(拉×货号×工序 → 生产数+人数)
  ↓  自动套核价算工资/产值
收支表日视图 + 月视图
```

**新能力:**
1. **标准价表** 驱动核价表:输入工序+人数,自动填建议工价
2. **订单+排产** 取代原「分拉」,含产能估算
3. **每日录入** 按拉×工序粒度,真实生产数替代估算
4. **月度产值汇总** 加到收支表

## 二、范围

**包含:**
- 新建菜单「标准价表」「排产」「每日录入」;保留「核价表」「收支表」
- 新增 5 张表;扩 `lines` 种子 UV 拉;弃用 `dispatches` 表(保留数据不写)
- 5 套新/改 API
- 收支表聚合逻辑改:从 `daily_records` 算,不再估算

**不包含(YAGNI):**
- 工人名册、计件工资单独报表(已砍)
- 智能预测未来订单(D 方案,需要 ML)
- 自动分配喷油拉(喷油每单主管手选,按需求)
- 跨车间/工厂管理

## 三、数据模型

### 新表

#### `wage_standards` 工序标准价表
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| technique | TEXT | 工序名:喷油/移印/散枪/UV/2印/... |
| worker_count | INTEGER | 人数 |
| unit_wage | REAL | 建议工价(元/件) |
| updated_at | DATETIME | |

`UNIQUE(technique, worker_count)`

**Bootstrap 策略:** 初次空表,「从历史推导」按钮把 `product_processes` 按 `(technique, worker_count)` 分组取**中位数**写入(中位数抗异常值)。

#### `technique_line_defaults` 工序→默认拉映射
| 字段 | 类型 | 说明 |
|---|---|---|
| technique | TEXT PK | 工序名 |
| line_id | INTEGER NULL FK lines(id) | NULL 表示主管手选(喷油用) |
| updated_at | DATETIME | |

**种子数据:**
```
喷油       → NULL (手选)
移印       → 胡旗移印
UV         → UV
散枪       → 宋沛霖手喷
洗货/洗油   → 宋沛霖手喷
2印/1印/4印 → 胡旗移印
2夹/2边/1边/1夹 → 宋沛霖手喷
自动机     → 宋沛霖自动
```

#### `production_orders` 订单
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| order_name | TEXT | 订单名(如「47723 2#农场车套装 4月第一批」) |
| product_id | INTEGER FK | |
| total_qty | INTEGER | 订单数量 |
| start_date | DATE | 起始日 |
| remarks | TEXT | |
| created_at | DATETIME | |
| deleted | INTEGER DEFAULT 0 | |

#### `order_schedule_lines` 排产明细
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| order_id | INTEGER FK | |
| product_process_id | INTEGER FK | |
| line_id | INTEGER FK NULL | 分到拉(NULL 待主管选) |
| qty | INTEGER | 这道工序要做的件数(默认 = order.total_qty) |
| daily_capacity | INTEGER | 每天产能(默认 = product_processes.target_qty) |
| est_days | INTEGER | = ceil(qty / daily_capacity) |
| start_date | DATE | |
| end_date | DATE | = start_date + est_days - 1 |
| started_at | DATETIME NULL | 打卡开始 |
| completed_at | DATETIME NULL | 打卡完成 |

`UNIQUE(order_id, product_process_id)`

#### `daily_records` 每日实际录入
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| record_date | DATE | |
| line_id | INTEGER FK | |
| product_id | INTEGER FK | |
| product_process_id | INTEGER FK | |
| produced_qty | INTEGER | 实际生产数 |
| worker_count | INTEGER | 实际参与人数 |
| remarks | TEXT | |
| created_at | DATETIME | |

`UNIQUE(record_date, line_id, product_process_id)` —— 同一天同一拉同一工序一行

### 改动

- `lines` 新增种子 `{name: 'UV', sort_order: 4}`
- `dispatches` **弃用**:不再从前端写入;保留表 + 数据
- `ledger_edits` 不动

### 聚合函数改造

`server/lib/ledger.js` 的 `buildLedger(db, date)`:

**v1:** 从 `dispatches` 拿当日分拉 → 按 `(product, line)` 聚合 `target_qty × quote_price / target_qty × unit_wage` 估算
**v2:** 从 `daily_records` 拿当日记录 → 按 `(product_id, line_id)` 分组:
```
总产值 = Σ(produced_qty × products.quote_price)
员工总工资 = Σ(produced_qty × product_processes.unit_wage)
员工人数 = Σ(DISTINCT record × worker_count) —— 或当日每拉去重最大值
```

手填列(`ledger_edits`)逻辑不变。

## 四、后端 API

### 标准价表
- `GET /api/wage-standards` — 全表
- `POST /api/wage-standards` body `{technique, worker_count, unit_wage}` — upsert
- `DELETE /api/wage-standards/:id`
- `POST /api/wage-standards/suggest-from-history` — 从 `product_processes` 按 `(technique, worker_count)` 中位数写入空格子(已有不覆盖);返回 `{added: N}`

### 工序→拉 默认映射
- `GET /api/line-defaults` — 全表
- `PUT /api/line-defaults/:technique` body `{line_id}` — upsert

### 排产
- `GET /api/orders?month=YYYY-MM&q=` — 列表(月份+搜索订单名/货号)
- `GET /api/orders/:id` — 详情,含 schedule_lines
- `POST /api/orders` body `{order_name, product_id, total_qty, start_date, remarks}` — 创建时事务里展开 schedule_lines:对产品每道未删 process,按 `line_defaults` 查默认拉,按 `target_qty` 当 daily_capacity,算 `est_days = ceil(total_qty / daily_capacity)`,`end_date = start_date + est_days - 1`
- `PUT /api/orders/:id/schedule-lines/:sl_id` body `{line_id?, qty?, daily_capacity?, start_date?}` — 主管调喷油工序的拉、或调某行产能;变更 `qty / daily_capacity` 自动重算 `est_days` / `end_date`
- `POST /api/orders/:id/schedule-lines/:sl_id/start` — 打卡开始
- `POST /api/orders/:id/schedule-lines/:sl_id/complete` — 打卡完成
- `POST /api/orders/:id/schedule-lines/:sl_id/reset` — 重置打卡
- `DELETE /api/orders/:id` — 软删

### 每日录入
- `GET /api/daily-records?date=YYYY-MM-DD` — 当日全部,带 JOIN 的 line_name / product_code / product_name / part_name / technique / unit_wage / quote_price
- `POST /api/daily-records` body `{record_date, line_id, product_id, product_process_id, produced_qty, worker_count, remarks}` — upsert
- `DELETE /api/daily-records/:id`

### 收支表
- `GET /api/ledger?date=` — 内部用 `daily_records` 汇总(改造)
- `POST /api/ledger/edits` — 不变
- `GET /api/ledger/export?date=` — 不变
- **新增** `GET /api/ledger/monthly?month=YYYY-MM` — 返回:
  ```json
  {
    "total_output": 123456.78,
    "by_line": [{line_name, output, wage, worker_days}],
    "by_product": [{code, name, output, days}]
  }
  ```

### 弃用(保留不删)
- `/api/dispatches/*` 全部弃用,前端不再用

## 五、前端页面

### `/products` 核价表(扩展)

- 顶部按钮加「从历史推导标准价」→ 调 `suggest-from-history`
- 产品编辑弹窗:工序行在「工序类型 + 人数」都有值后,离焦 → `GET /api/wage-standards?...`,命中自动填工价(可手改)
- 弹窗底部汇总块:总工价 / 总核价 / 油漆占比(油漆价/总核价,红色)

### `/wage-standards` 标准价表(新)

- Table 编辑:工序 | 人数 | 工价 | 操作
- 按钮:新增行 / 从历史推导 / 保存

### `/orders` 排产(新)

**Tab「新建订单」** —— 表单 + 自动展开工序表 + 保存
**Tab「订单列表」** —— 按月筛选 + 展开看明细 + 每行 打卡按钮;顶部显示月度产值汇总

### `/daily-records` 每日录入(新)

- 日期选择 + 表格:`拉 | 货号 | 工序 | 生产数 | 人数 | 备注 | 删`
- 「+添加一行」底部
- 改动防抖 500ms 自动保存
- 右上角:当日条数 + 产值估算 + 工资估算

### `/ledger` 收支表(改造)

- 聚合数据源改为 `daily_records`
- Tab 切换:日视图(Luckysheet)/ 月视图(月度汇总表)

### 菜单

```
核价表 / 标准价表 / 排产 / 每日录入 / 收支表
```

「分拉」菜单删除(功能并入排产)。

## 六、迁移/兼容

- `dispatches` 表数据保留,前端不再访问
- 老数据(20 个产品 + 目前分拉记录)继续在核价表/收支表里可见
- 新建订单才走 v2 流程;已分拉的旧数据不转换(价值不高)

## 七、测试

- `wage_standards` 上/下确界边界(人数 0/负数拒绝,技术名 trim)
- `suggest-from-history` 中位数算对
- `POST /api/orders` 展开 schedule_lines 正确(数量、默认拉、est_days、end_date)
- `PUT schedule-lines` 变更 qty 自动重算 end_date
- `buildLedger` 改造后对 `daily_records` 的聚合正确
- 前端改动手工验证(浏览器)

## 八、成功标准

- [ ] 标准价表可从历史一键生成,可手动调整并用于核价表
- [ ] 新建订单后,排产单自动出每工序的拉/天数/起止日,喷油留空待主管选
- [ ] 每日录入页保存后,收支表当日产值/工资 反映实际生产数
- [ ] 收支表月视图显示当月产值汇总
- [ ] 导出 xlsx 格式不变,但数据来自实际生产

## 九、显式不做

- 自动预测未来订单
- 跨车间/公司级合并
- 手机/平板响应式
- 分拉页的旧「开始/完成」功能(迁移到排产页)
- 历史数据从 dispatches 迁到 order_schedule_lines(手工重录更快)
