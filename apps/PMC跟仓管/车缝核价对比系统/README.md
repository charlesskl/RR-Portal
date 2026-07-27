# StitchCostPro 车缝核价对比系统

用于把本厂自制成本、外发加工成本、订单交付和品质数据放到同一条业务链中，回答“同一产品自产还是外发更划算”。

## RR-Portal 部署

门户路径为 `/stitch-cost/`，云端使用 RR-Portal 共享 PostgreSQL 中的独立
`stitch_cost` schema。本地安装版仍使用 SQL Server，不受门户数据库配置影响。

部署时必须通过服务器环境变量提供 `DB_USER`、`DB_PASSWORD`、`DB_NAME`、
`STITCH_COST_JWT_SECRET` 和 `STITCH_COST_ADMIN_PASSWORD`，禁止把实际值提交到 Git。

首次启动会在 `stitch_cost` schema 中创建本系统数据表。现有业务数据必须在服务
部署完成后通过受控的数据迁移流程导入，不得把数据库备份、导出数据或用户密码
放入公开仓库。

## 当前功能

- 外发订单与交期跟进
- 核价录入、Excel 旧核价导入、核价对比看板
- 产品库与逻辑作废/回收站
- 加工厂、品质和综合评价
- 六角色权限与用户管理
- 可配置汇率、税率、评价权重和评级阈值
- 综合评价 CSV 导出

## 本地启动

首次运行先安装前端依赖并准备数据库。日常启动：

```powershell
.\start-local.ps1
```

打开 <http://127.0.0.1:5200/login>。停止服务：

```powershell
.\stop-local.ps1
```

默认开发账号为 `admin / admin123`，正式环境必须修改密码。

## 数据库

- 全新重建：`db/rebuild_current.sql`（会清空现有数据）
- 保留数据升级：`db/apply_current.sql`
- 详细说明：`db/README.md`

## 上线配置

生产环境必须通过环境变量提供独立 JWT 强密钥：

```powershell
$env:Jwt__Secret = '<至少 32 字节的随机强密钥>'
$env:ASPNETCORE_ENVIRONMENT = 'Production'
```

后端会拒绝使用仓库内的开发占位密钥启动生产环境。生产连接串建议通过 `ConnectionStrings__Default` 注入。

## 验证

```powershell
dotnet test backend\StitchCostPro.sln
cd frontend
npm run build
```

真实数据对照结果见 `docs/验收记录-2026-07-15.md`。
