# 印尼走货明细

印尼走货明细、报价、采购、生产、排期与出库管理系统。

## 技术栈

- ASP.NET Core 8 Web API
- EF Core + Dapper
- SQL Server 2019+
- React + TypeScript + Vite
- JWT 登录、账户管理及模块级只读/编辑权限

## 配置

仓库不保存数据库密码和 JWT 密钥。运行 API 前通过环境变量提供：

```text
ConnectionStrings__Default=Server=...;Database=IndoShipping;User Id=...;Password=...;TrustServerCertificate=True
Jwt__Key=<至少 32 字符的随机密钥>
```

首次建库执行 `db/rebuild_schema.sql`。初始化管理员为 `admin / admin123`，首次登录后必须立即修改密码。

## 本地运行

```powershell
dotnet run --project src/IndoShipping.Api
cd web
npm ci
npm run dev
```

前端默认使用 `/api`，Vite 开发服务器会代理到 `http://localhost:5180`。

## 现有数据快照

`seed/business-data.json` 是 2026-07-15 从当前运行系统导出的业务数据快照，包含客户、货号、物料、图片、字典、排期、采购单等数据，以及不含密码哈希的账户权限元数据。

快照不包含数据库连接信息、JWT 密钥、密码哈希、日志、缓存和编译产物。生产导入前应先备份目标数据库，并按 `db/rebuild_schema.sql` 的表结构执行一次性导入。

