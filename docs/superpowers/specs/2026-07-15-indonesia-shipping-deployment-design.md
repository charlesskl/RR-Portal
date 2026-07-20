# 印尼走货明细系统上线设计

## 目标

将 PR 268 中的印尼走货明细系统从业务部迁移到新部门 `apps/印尼小组/`，完整接入 RR Portal，并在现有 ECS 上运行独立的 SQL Server 数据库。上线后用户从门户“印尼小组”进入 `/indo-shipping/`，能够使用通过受控通道写入服务器私有目录的历史数据继续工作；真实业务快照不得进入 Git。

## 目录与稳定标识

- 源码目录：`apps/印尼小组/印尼走货明细/`
- Docker 应用服务：`indo-shipping`
- Docker 数据库服务：`indo-sqlserver`
- 外部 URL：`/indo-shipping/`
- 应用健康检查：`/indo-shipping/health`
- 数据库名：`IndoShipping`

中文目录用于门户归属；Docker 服务名和 URL 使用固定英文名称，后续不得随显示名称修改。

## 运行架构

使用两个容器：

1. `indo-sqlserver` 基于 Microsoft SQL Server 2022 Linux 镜像，只加入 `platform-net`，不发布宿主机端口。数据库文件通过 bind mount 持久化到仓库部署目录下的数据目录。
2. `indo-shipping` 使用多阶段 Docker 构建：Node 阶段构建 React，.NET 阶段发布 ASP.NET Core，最终镜像同时提供 API 和 SPA 静态文件。

Nginx 将 `/indo-shipping/` 转发给应用容器。React 使用 `/indo-shipping/` 作为 Vite base，Axios 使用 `/indo-shipping/api`，ASP.NET Core 在反向代理后接收去除前缀的 `/api/*` 请求。

## 数据初始化

首次启动采用幂等初始化流程：

1. 等待 SQL Server 健康。
2. 检查 `IndoShipping` 数据库及 schema 标记表是否存在。
3. 仅在空数据库执行 `db/rebuild_schema.sql`。
4. 仅在业务表为空且尚无导入标记时，从只读挂载的服务器私有文件 `data/indo-shipping-seed/business-data.json` 导入历史快照。
5. 校验快照中的客户、产品、物料、图片、采购单和采购明细数量。
6. 写入 schema/seed 版本标记，容器重建或重启时不再次导入。

初始化失败时应用容器保持失败状态并输出明确日志，不对已有数据库执行清空或重建。生产数据目录纳入现有备份脚本。

## 身份与 Secrets

以下值只存放在 GitHub Secrets 和服务器生产环境文件中：

- `INDO_SQL_SA_PASSWORD`：SQL Server SA 密码，由部署流程生成或设置。
- `INDO_SQL_APP_PASSWORD`：应用数据库账号 `indoshipping_app` 的密码，使用用户提供的值。
- `INDO_SHIPPING_JWT_KEY`：至少 32 字符的随机 JWT 密钥。
- `INDO_SHIPPING_ADMIN_PASSWORD`：首次 Web 管理员密码。

初始化脚本创建应用数据库账号并授予 `IndoShipping` 所需权限。应用不使用 SA 连接。代码、Compose 和日志不得输出完整连接字符串或密码。原 schema 中固定的 `admin123` 不作为生产密码；初始化后使用 Secret 中的管理员密码哈希。

## 资源与安全边界

- SQL Server 不开放公网 1433。
- 部署前检查 ECS 可用内存和磁盘空间；资源不足时停止新增服务，不重建其他服务。
- 为 SQL Server 设置明确内存上限，避免挤压现有服务。
- Compose 启动始终使用 `--no-deps` 和明确服务名；数据库首次上线按 `indo-sqlserver`、初始化、`indo-shipping` 的顺序执行。
- SQL Server 数据目录使用 bind mount，并加入备份与恢复说明。

## RR Portal 集成

需要同步修改：

- `docker-compose.yml` 与 `docker-compose.cloud.yml`
- `nginx/nginx.cloud.conf` 及本地 Nginx 配置
- `frontend/index.cloud.html` 的“印尼小组”部门、应用卡片和健康检查
- `AGENTS.md` 的目录结构、端口表和 App 注册表
- 部署脚本的变更路径到服务映射、数据目录权限和健康检查
- 备份脚本的 SQL Server 数据备份范围

门户只新增一个“印尼走货明细”应用，不把它继续显示在业务部。

## 错误处理与回滚

- 数据库不可用时 `/health` 返回失败，应用不接受业务请求。
- schema 或 seed 导入任一步失败都保留日志并停止上线，不写成功标记。
- 已存在数据时禁止自动重建 schema。
- 应用部署失败时回滚应用镜像；数据库数据目录不回滚、不删除。
- 首次数据导入前创建数据库备份；验证失败时恢复备份或删除仅本次创建的空数据库目录。

## 验证

本地与 CI 验证包括：

- `dotnet build IndoShipping.sln -c Release`
- `npm ci`、`npm run lint`、`npm run build`
- Docker 镜像构建和容器健康检查
- 子路径静态资源、前端路由和 API 路径检查
- 空数据库首次初始化与历史快照数量校验
- 第二次启动不重复导入
- 管理员登录、权限受限账号、核心只读 API 冒烟测试
- 数据写入后重启容器，确认持久化
- 门户“印尼小组”入口和线上 `/indo-shipping/health` 验收

## 非目标

- 不将应用改写为 PostgreSQL。
- 不开放 SQL Server 公网端口。
- 不重构 PR 268 中与上线无关的业务页面。
- 不迁移或修改其他部门应用。
