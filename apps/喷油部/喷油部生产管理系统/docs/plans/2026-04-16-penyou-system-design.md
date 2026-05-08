# 喷油部系统 设计文档

**日期:** 2026-04-16
**项目路径:** `C:\Users\Administrator\penyou-system\`

## 一、背景

喷油部现用 Excel(`兴信(发印尼）喷油核价.xlsx`)管理产品核价,工单与工人计件依赖手工统计。需要一个小型内部系统替代,主管手动派单、每日登记计件、自动算工资。

## 二、范围

**包含:**
- 产品核价表管理(基础数据)
- 工人名册
- 工单管理(主管手动创建,关联产品自动展开工序)
- 每日计件录入
- 工资/产量报表

**不包含(本期不做):**
- 与走货系统(order-sync)自动对接 — 暂手动录单
- 工人自助登录 — 固定名册,主管代登记
- 油漆/物料库存 — 核价表里只记录油漆单价
- 手机端适配 — 局域网 Web 够用,有需要再做响应式

## 三、数据模型

### products 产品
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| code | TEXT | 货号(如 73622) |
| name | TEXT | 货名(如 布鲁伊爸爸杯) |
| quote_price | REAL | 客户报价 |
| remarks | TEXT | 备注 |
| created_at | DATETIME | |

### product_processes 产品工序(核价明细)
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| product_id | INTEGER FK | |
| part_name | TEXT | 部位(耳朵/眼睛/鼻子…) |
| technique | TEXT | 工艺(2印/1印/2边/2夹/4印) |
| target_qty | INTEGER | 日目标数 |
| worker_count | INTEGER | 所需人数 |
| unit_wage | REAL | 工价(每件) |
| calc_price | REAL | 核价 = 工价 × 2.1 |
| paint_price | REAL | 油漆价 = 核价 × 0.35 |
| total_price | REAL | 总核价 = 核价 + 油漆价 |
| remarks | TEXT | |

### workers 工人
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| code | TEXT | 工号(可选) |
| name | TEXT | 姓名 |
| active | INTEGER | 是否在职 1/0 |
| created_at | DATETIME | |

### work_orders 工单
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| order_no | TEXT | 工单号(自动生成,如 WO202604160001) |
| product_id | INTEGER FK | |
| quantity | INTEGER | 下单数量 |
| customer | TEXT | 客户 |
| due_date | DATE | 交期 |
| status | TEXT | 待做/进行中/完工 |
| remarks | TEXT | |
| created_at | DATETIME | |

### production_records 计件记录
| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| work_date | DATE | 生产日期 |
| worker_id | INTEGER FK | |
| work_order_id | INTEGER FK | |
| product_process_id | INTEGER FK | 指定哪道工序 |
| qty | INTEGER | 件数 |
| unit_wage | REAL | 单价(快照,工价可能变动) |
| total_wage | REAL | 工资 = qty × unit_wage |
| remarks | TEXT | |
| created_at | DATETIME | |

## 四、功能模块

### 1. 核价表管理
- 列表:按货号搜索,展开看工序明细
- 新建/编辑:手动录入或**从 Excel 导入**(兼容当前 `兴信(发印尼）喷油核价.xlsx` 格式)
- 删除:软删除(避免影响历史工单)

### 2. 工人名册
- 简单列表:增/改/停用

### 3. 工单管理
- 新建:选择产品 → 填数量/客户/交期 → 自动带出工序清单
- 列表:按状态/交期筛选
- 详情:显示本工单下已完成的计件记录汇总

### 4. 计件录入
- 按日期批量录入:选日期 → 选工人 → 选工单 → 选工序 → 填件数 → 自动算工资
- 支持一次录多条(表格式录入)

### 5. 工资/产量报表
- 按工人+日期范围 → 汇总工资、件数、工序明细
- 按工单 → 统计已完工比例、累计工资
- 导出 Excel

## 五、技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 后端 | Node.js + Express | 与 order-sync 一致 |
| 数据库 | better-sqlite3 | 轻量,单文件,够用 |
| 前端 | React + Vite | 与 order-sync 一致 |
| Excel | ExcelJS | 导入核价表 / 导出报表 |
| 启动 | start.bat | 一键启动后端+前端 |

## 六、目录结构

```
penyou-system/
├── server/
│   ├── app.js
│   ├── db/
│   │   ├── init.sql
│   │   └── penyou.db
│   ├── routes/
│   │   ├── products.js
│   │   ├── processes.js
│   │   ├── workers.js
│   │   ├── work-orders.js
│   │   ├── production.js
│   │   └── reports.js
│   ├── services/
│   │   └── pricing-importer.js
│   └── package.json
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Products.jsx
│   │   │   ├── Workers.jsx
│   │   │   ├── WorkOrders.jsx
│   │   │   ├── ProductionEntry.jsx
│   │   │   └── Reports.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
├── docs/plans/
│   └── 2026-04-16-penyou-system-design.md
└── start.bat
```

## 七、部署

- 局域网 Web:后端监听 `0.0.0.0:3100`,前端 Vite dev 或打包后 Express 托管
- 主管 PC 启动 `start.bat`,其他电脑浏览器访问 `http://<主管电脑IP>:3100`

## 八、里程碑(交付顺序)

1. 项目骨架 + 数据库初始化 + 核价表 Excel 导入
2. 工人名册 + 产品/工序 CRUD 页面
3. 工单创建 + 列表
4. 每日计件录入
5. 工资报表 + Excel 导出
6. 局域网部署调试
