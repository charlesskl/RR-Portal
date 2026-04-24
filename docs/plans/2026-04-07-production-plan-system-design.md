# 生产计划管理系统 - 设计文档

> 日期：2026-04-07

## 目标

将现有的"手动从排期 Excel 复制粘贴到金山文档"流程，改为"上传 Excel → 自动提取 → 网页排单 → 导出 Excel"的全流程系统。

## 核心流程

```
业务排期 Excel → 拖入/上传网页 → XML解析检测颜色(黄=新单/蓝=修改)
    → 预览选择 → 存入 SQLite → 网页排单管理 → 按车间导出 Excel
```

## 系统架构

```
浏览器 (React + Ant Design)
    ↕ HTTP API
Express Server (Node.js, port 8080)
    ↕
SQLite 数据库 (server/data/production.db)
```

## 1. 数据库设计 (SQLite)

### orders 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| supervisor | TEXT | 主管 |
| line_name | TEXT | 拉名 |
| worker_count | INTEGER | 人数 |
| factory | TEXT | 厂区 |
| client | TEXT | 客名 |
| order_date | TEXT | 来单日期 |
| third_party | TEXT | 第三方客户名称 |
| country | TEXT | 国家 |
| contract | TEXT | 合同 |
| product_code | TEXT | 货号 |
| product_name | TEXT | 产品名称 |
| version | TEXT | 版本 |
| quantity | INTEGER | 数量 |
| work_type | TEXT | 做工名称 |
| produced | INTEGER | 生产数 |
| progress | REAL | 生产进度 |
| remark | TEXT | 特别备注 |
| plastic_date | TEXT | 胶件复期 |
| material_date | TEXT | 来料复期 |
| carton_date | TEXT | 纸箱复期 |
| packaging_date | TEXT | 包材复期 |
| sticker | TEXT | 客贴纸 |
| start_date | TEXT | 上拉日期 |
| finish_date | TEXT | 完成日期 |
| ship_date | TEXT | 走货期 |
| inspect_date | TEXT | 行Q期 |
| month | TEXT | 月份 |
| daily_target | INTEGER | 每天目标数 |
| target_days | REAL | 天数 |
| workshop | TEXT | 车间 (A/B/华登) |
| status | TEXT | 状态 (active/completed/cancelled/outsource) |
| source_file | TEXT | 来源文件名 |
| import_type | TEXT | 导入类型 (new/modified) |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### summary 表（产值明细汇总）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| workshop | TEXT | 车间 |
| line_name | TEXT | 拉名 |
| worker_count | INTEGER | 人数 |
| client_values | TEXT | JSON: {客名: 产值} |
| subtotal | REAL | 小计 |
| month | INTEGER | 月份 |
| remark | TEXT | 备注 |

## 2. API 设计

### 文件上传与解析
- `POST /api/upload` — 上传 Excel 文件，XML 解析检测黄/蓝行，返回预览数据
- `POST /api/import` — 确认导入选中的订单到数据库

### 订单管理
- `GET /api/orders?workshop=B&status=active` — 查询订单
- `PUT /api/orders/:id` — 编辑订单（支持部分更新）
- `PUT /api/orders/:id/status` — 更新状态
- `POST /api/orders/batch-status` — 批量更新状态
- `DELETE /api/orders/:id` — 删除订单

### 导出
- `GET /api/export?workshop=B` — 按车间导出 Excel

### 产值汇总
- `GET /api/summary?workshop=B` — 获取产值汇总
- `PUT /api/summary` — 更新产值数据

## 3. 前端页面

### 页面结构
```
首页（车间选择）
  → A车间 / B车间 / 华登
    → 排期管理（主页面，表格编辑）
    → 上传导入
    → 产值汇总
    → 导出
```

### 3.1 车间选择页
- 三张卡片：A车间、B车间、华登
- 显示各车间在产订单数

### 3.2 排期管理页（核心）
- 类似 Excel 的表格界面（Handsontable）
- 列与金山文档完全一致
- 支持直接编辑单元格，自动保存
- Tab 切换：在产订单 / 完成订单 / 取消单 / 外发货号
- 工具栏：上传导入、新增行、导出 Excel

### 3.3 上传导入
- 拖拽区域或点击选择文件
- 上传后显示检测结果：黄色行(新单)、蓝色行(修改单)
- 勾选要导入的订单 → 确认导入

### 3.4 导出
- 按车间导出完整 Excel
- Sheet 结构与金山文档一致：
  - 产值明细汇总
  - [主管名]（在产订单）
  - 完成订单
  - 取消单
  - Sheet9
  - 完成成品数
  - 外发货号
  - 取消订单

## 4. 颜色检测方案

不使用 ExcelJS 读颜色（已验证读不准），改为直接解析 xlsx ZIP 包中的 XML：

1. 用 JSZip 解压 xlsx 文件
2. 读取 `xl/styles.xml` → 解析 fills 和 cellXfs，建立 styleIndex → color 映射
3. 读取 `xl/theme/theme1.xml` → 解析 theme 颜色用于转换
4. 读取 `xl/worksheets/sheetN.xml` → 检查每行单元格的 `s` 属性
5. 通过映射判断行颜色：黄色系 = 新单，蓝色系 = 修改单

已验证此方案可以 100% 准确读取颜色。

## 5. 技术选型

| 组件 | 技术 | 理由 |
|------|------|------|
| 后端 | Express + Node.js | 现有技术栈 |
| 数据库 | SQLite (better-sqlite3) | 零安装，单机够用 |
| 颜色检测 | JSZip + XML 解析 | ExcelJS 读不准，自己解析100%准确 |
| Excel 导出 | ExcelJS | 写入功能正常 |
| 前端 | React + Ant Design | 现有技术栈 |
| 表格编辑 | Handsontable | 类 Excel 体验 |
| 文件上传 | antd Upload + multer | 拖拽/点击上传 |
