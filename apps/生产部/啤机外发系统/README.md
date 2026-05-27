# 啤机外发系统

生产部啤机外发模具订单管理系统。Node.js + Express 后端，React + Vite 前端，JSON 文件存储。

## 目录结构

```
啤机外发系统/
├── server/         — Express API (端口 3010)
│   ├── server.js
│   ├── package.json
│   └── data/       — JSON 数据文件
│       ├── orders.json       (外发订单)
│       ├── suppliers.json    (加工厂档案)
│       └── pc_orders.json    (PC 料外发)
├── client/         — Vite + React (端口 5180)
│   ├── src/
│   ├── package.json
│   └── vite.config.js
└── scripts/
    └── seed-from-xlsx.js     — 从 Excel 导入种子数据
```

## 启动

**开发模式（前后端分离）：**

```powershell
# 终端 1 — 后端
cd C:\claude\啤机外发系统\server
npm run dev          # 或 npm start

# 终端 2 — 前端
cd C:\claude\啤机外发系统\client
npm run dev
```

打开 http://localhost:5180

**生产模式（前端打包 + 后端一起服务）：**

```powershell
cd C:\claude\啤机外发系统\client
npm run build        # 生成 client/dist/

cd ..\server
npm start            # 后端自动 serve client/dist
```

打开 http://localhost:3010

## 种子数据

从 Excel 重新生成 JSON：

```powershell
cd C:\claude\啤机外发系统\scripts
node seed-from-xlsx.js
# 或指定其他文件
node seed-from-xlsx.js "C:\path\to\xlsx.xlsx"
```

**注意：** seed 会覆盖 server/data/ 下的全部 JSON 文件，运行前请先备份。

## 功能

- **外发明细**：636 条订单，全字段增删改查 + 搜索 + 供应商筛选
- **加工厂明细**：10 家供应商档案 + 占比/开机率自动计算
- **PC 料**：单独管理 PC 料外发计划
- **概览**：订单总数、本厂产值、外发产值、扣税后产值、按供应商分布

## 自动计算字段

后端在返回订单时自动计算（不需要前端填）：

- `estimated_days` = 订单数量(啤) ÷ 实际产能
- `in_house_output` = 订单数量(啤) × 核价$
- `outsource_output` = 订单数量(啤) × 供应商外发价$
- `supplier_tax_output` = 外发产值 × 13%
- `net_outsource_output` = 外发产值 − 供应商扣税产值

## API 接口

```
GET    /api/health
GET    /api/orders               列出全部订单
POST   /api/orders               新增
PUT    /api/orders/:id           更新
DELETE /api/orders/:id           删除

GET    /api/suppliers            加工厂档案
POST   /api/suppliers
PUT    /api/suppliers/:id
DELETE /api/suppliers/:id

GET    /api/pc-orders            PC 料
POST   /api/pc-orders
PUT    /api/pc-orders/:id
DELETE /api/pc-orders/:id

GET    /api/stats/summary        汇总
```

## 后续接入 RR-Portal

未来要集成到平台时：
1. 把整个项目搬到 `RR-Portal/apps/生产部/啤机外发系统/`
2. 加 Dockerfile（参考 `apps/生产部/AI注塑啤机排产系统/paiji`）
3. data 用 bind mount：`./apps/生产部/啤机外发系统/server/data:/app/data`
4. nginx 加 `/pi-outsource/` upstream
