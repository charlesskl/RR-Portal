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

生产首次建库由 `IndoShipping.Bootstrap` 完成。管理员 `admin` 的密码只从
`INDO_SHIPPING_ADMIN_PASSWORD` 读取；仓库和 schema 不提供可登录的默认密码。
`db/rebuild_schema.sql` 含本地重建用的破坏性语句，不应直接用于生产初始化。

## 本地运行

```powershell
dotnet run --project src/IndoShipping.Api
cd web
npm ci
npm run dev
```

前端默认使用 `/api`，Vite 开发服务器会代理到 `http://localhost:5180`。

## 历史数据快照

真实历史快照包含客户、货号、物料、图片、字典、排期、采购单及账户权限元数据，属于私有业务数据，不进入 Git。生产服务器在首次部署前必须将快照放到：

```text
data/indo-shipping-seed/business-data.json
```

Compose 只读挂载该服务器私有目录，部署脚本会在启动任何印尼容器前检查文件存在且非空。`seed/example-data.json` 仅为无真实业务信息的自动测试样例，不能用于生产迁移。
