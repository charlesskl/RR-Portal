# StitchCostPro 后端 API

车缝核价对比系统后端。.NET 8 (ASP.NET Core Web API) + EF Core + Dapper + SQL Server。

## 技术约定

- **数据库唯一真相源** = `../db/rebuild_schema.sql`。EF Core 只做映射，**不用 migration 建表**，避免两套结构打架。
- 实体用 PascalCase POCO，`AppDbContext` 统一映射 snake_case 表名/列名（表名取实体类名单数）。
- CRUD 用 EF Core；对比主界面等大查询用 Dapper（`IDbConnectionFactory`）。
- 产品核价颗粒度为具体款式，每款只保存一组产品总价；订单保存下单时的价格快照。

## 本地运行

前置：SQL Server / LocalDB。先建库：

```bash
# 用 LocalDB（已验证）
sqlcmd -S "(localdb)\MSSQLLocalDB" -i ../db/rebuild_schema.sql
```

跑 API：

```bash
cd StitchCostPro.Api
set ASPNETCORE_ENVIRONMENT=Development   # PowerShell: $env:ASPNETCORE_ENVIRONMENT="Development"
dotnet run --urls "http://localhost:5100"
```

- Swagger: http://localhost:5100/swagger
- 健康检查: http://localhost:5100/health
- 前端开发服务器在 http://localhost:5200（5173 已被本机 ERP 占用，CORS 已对应放行）
- 开发环境启动时自动跑幂等种子数据（`DbSeeder`）：部门、admin 用户、测试货号和供应商。

## 默认账号

| 账号 | 密码 | 说明 |
|------|------|------|
| admin | admin123 | 系统管理员（dept=本厂，userbqrpower=111111111） |

> ⚠️ `appsettings.json` 里的 `Jwt:Secret` 是开发占位值，上线前必须换成强密钥（环境变量注入）。

## 连接串

`appsettings.json` → `ConnectionStrings:Default`，默认指向 `(localdb)\MSSQLLocalDB` 的 `StitchCostPro` 库。

## 已实现

- 基础档案：部门、产品、供应商和用户
- 产品级核价库、外发订单、订单价格维护、核价对比、品质管理和供应商评价
- 认证：JWT + bcrypt（`POST /api/auth/login`、`GET /api/auth/me`）
- EF Core 实体与 SQL Server 手写升级脚本
