# 排期系统重建设计文档

## 日期：2026-04-06

## 背景

order-sync 排期系统代码混乱，功能不稳定，需要全部推翻重写。

## 核心需求

1. **扫描导入** — 扫描Z盘各客排期文件夹的Excel，解析新订单导入系统
2. **手动录入** — 支持在系统内直接新增/编辑订单
3. **排期管理** — 完整的订单生命周期管理（进行中→完成→取消）
4. **前端展示** — 类Excel界面，用Handsontable还原Excel表格外观
5. **Excel导出** — 按模板格式导出，还原原始Excel的样式
6. **多车间** — 3个车间（A/B/C华登），借鉴排机系统架构

## 不再需要

- 金山文档集成（Puppeteer/Python方案全部去掉）
- 所有test_*.js测试文件

## 技术方案

### 架构

- 前端：React 19 + Vite + Ant Design + Handsontable
- 后端：Express.js (port 8080)
- 数据库：SQLite（借鉴排机系统）
- 项目结构：沿用 order-sync 的 client/server 分离

### 前端Tab页（对应Excel的Sheet）

1. 产值明细汇总
2. 排期表（刘方尧）— 进行中的订单
3. 完成订单
4. 取消单
5. Sheet9
6. 完成成品数
7. 外发货号
8. 取消订单

### 数据模型

#### orders 表

```sql
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workshop TEXT NOT NULL,           -- 'A' / 'B' / 'C'
  status TEXT DEFAULT 'active',     -- 'active' / 'completed' / 'cancelled'
  
  -- 基本信息
  supervisor TEXT,                  -- 主管
  line_name TEXT,                   -- 拉名
  worker_count INTEGER,            -- 人数
  factory_area TEXT,               -- 厂区
  client TEXT,                     -- 客名
  order_date TEXT,                 -- 来单日期
  third_party TEXT,                -- 第三方客户名称
  country TEXT,                    -- 国家
  contract TEXT,                   -- 合同
  item_no TEXT,                    -- 货号
  product_name TEXT,               -- 产品名称
  version TEXT,                    -- 版本
  quantity INTEGER,                -- 数量
  work_type TEXT,                  -- 做工名称（成品/半成品）
  
  -- 生产跟踪
  production_count INTEGER DEFAULT 0,  -- 生产数
  production_progress REAL DEFAULT 0,  -- 生产进度
  special_notes TEXT,              -- 特别备注
  
  -- 物料复期
  plastic_due TEXT,                -- 胶件复期
  material_due TEXT,               -- 来料复期
  carton_due TEXT,                 -- 纸箱复期
  packaging_due TEXT,              -- 包材复期
  sticker TEXT,                    -- 客贴纸
  
  -- 日期
  start_date TEXT,                 -- 上拉日期
  complete_date TEXT,              -- 完成日期
  ship_date TEXT,                  -- 走货期
  
  -- 产值
  target_time REAL,                -- 目标数生产时间
  daily_target INTEGER,            -- 每天目标数
  days REAL,                       -- 天数
  unit_price REAL,                 -- 货价
  process_value REAL,              -- 加工产值
  inspection_date TEXT,            -- 行Q期
  month INTEGER,                   -- 月份
  warehouse_record TEXT,           -- 入库记录
  output_value REAL,               -- 产值
  process_price REAL,              -- 加工价
  remark TEXT,                     -- 备注
  
  -- 每日产量（1号~31号）
  day_1 INTEGER DEFAULT 0,
  day_2 INTEGER DEFAULT 0,
  day_3 INTEGER DEFAULT 0,
  day_4 INTEGER DEFAULT 0,
  day_5 INTEGER DEFAULT 0,
  day_6 INTEGER DEFAULT 0,
  day_7 INTEGER DEFAULT 0,
  day_8 INTEGER DEFAULT 0,
  day_9 INTEGER DEFAULT 0,
  day_10 INTEGER DEFAULT 0,
  day_11 INTEGER DEFAULT 0,
  day_12 INTEGER DEFAULT 0,
  day_13 INTEGER DEFAULT 0,
  day_14 INTEGER DEFAULT 0,
  day_15 INTEGER DEFAULT 0,
  day_16 INTEGER DEFAULT 0,
  day_17 INTEGER DEFAULT 0,
  day_18 INTEGER DEFAULT 0,
  day_19 INTEGER DEFAULT 0,
  day_20 INTEGER DEFAULT 0,
  day_21 INTEGER DEFAULT 0,
  day_22 INTEGER DEFAULT 0,
  day_23 INTEGER DEFAULT 0,
  day_24 INTEGER DEFAULT 0,
  day_25 INTEGER DEFAULT 0,
  day_26 INTEGER DEFAULT 0,
  day_27 INTEGER DEFAULT 0,
  day_28 INTEGER DEFAULT 0,
  day_29 INTEGER DEFAULT 0,
  day_30 INTEGER DEFAULT 0,
  day_31 INTEGER DEFAULT 0,
  
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

#### summary 表（产值明细汇总）

```sql
CREATE TABLE summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workshop TEXT NOT NULL,
  line_name TEXT,
  worker_count INTEGER,
  client TEXT,
  month INTEGER,
  value REAL DEFAULT 0,
  year INTEGER
);
```

### API 设计

- `GET /api/orders?workshop=A&status=active` — 获取订单列表
- `POST /api/orders` — 新增订单
- `PUT /api/orders/:id` — 编辑订单
- `DELETE /api/orders/:id` — 删除订单
- `PUT /api/orders/:id/status` — 状态流转（active→completed/cancelled）
- `GET /api/scan` — 扫描Z盘
- `POST /api/scan/import` — 导入扫描到的订单
- `GET /api/export?workshop=A` — 导出Excel
- `GET /api/summary?workshop=A` — 获取产值汇总

### 参考

- Excel模板：C:\Users\Administrator\Desktop\2026年3月21日更新.xlsx
- 排机系统（车间架构）：C:\Users\Administrator\paiji-system\
