# QC 成品报告系统独立接入设计

日期：2026-07-22

## 目标

将现有 Flask “QC 成品报告系统”作为 RR-Portal 的独立 QA 应用接入，保留完整后端能力，同时与生产部现有“品质管理系统”完全隔离。

## 边界

- 新应用目录：`apps/QA部/QC成品报告系统/`
- Docker 服务名：`qc-report`
- 对外路径：`/qc-report/`
- 内部端口：`3410`
- 不修改、不迁移、不复用现有 `qc` 服务、`/qc/` 路由或其数据。
- PR 只包含源码、迁移、测试、空数据目录占位和无敏感值的配置示例。
- 禁止提交客户 PO、运行数据库、照片、电子签名、生成 PDF、日志、缓存、API Key、密码或其他业务数据。

## 架构

应用保持独立 Flask 服务，不改写成 Portal 核心插件。Web 与 AI Worker 使用同一代码镜像；生产环境使用 PostgreSQL 保存结构化数据、Redis/RQ 执行 AI 任务，文件使用宿主机 bind mount 持久化。Nginx 将 `/qc-report/` 代理到 `qc-report:3410`，并通过可信内部请求头传递子路径前缀，使 Flask 生成的页面、静态资源、上传接口和重定向都保留 `/qc-report`。

本地开发继续支持 SQLite 和无 Redis 的同步队列模式。`AI_MOCK_MODE` 默认关闭；未配置 OpenAI Key 时，非 AI 页面仍可使用，AI 操作明确返回“未配置”，不能回退到固定演示数据。

## 组件

### 应用服务

- 保留登录、PO 上传与校对、报告工作台、照片上传、AQL 判定、AI 草稿、QC 审核、签名、PDF 锁定、修订版和审计功能。
- 新增 `/health`，只检查进程、数据库连通性和持久化目录可写性，不泄露配置。
- 使用前缀中间件校验 `X-Script-Name=/qc-report`，设置 WSGI `SCRIPT_NAME`；外部请求不能借该头构造任意前缀。
- Cookie Path 设置为 `/qc-report/`，避免与 `/qc/` 或 Portal 其他应用冲突。

### 数据与文件

- `DATABASE_URL` 指向 RR-Portal PostgreSQL，使用独立数据库或独立 schema；不得连接现有 `qc` 的 SQLite 数据。
- `STORAGE_ROOT=/app/storage` 保存 PO、原图、分析副本、签名和 PDF。
- `data/`、`storage/` 在 Git 中只保留 `.gitkeep`，实际内容由 bind mount 持久化。
- Alembic 在 Web/Worker 启动前单独执行，避免多进程同时初始化。

### AI

- 真实 AI 使用服务器注入的 `OPENAI_API_KEY`、`OPENAI_MODEL` 和超时配置。
- 请求保持严格 JSON Schema、`store: false`、证据页码/照片绑定和 QC 人工确认。
- 生产环境强制 `AI_MOCK_MODE=false`；若误设为 true，应用启动失败。

### RR-Portal 集成

- `docker-compose.cloud.yml` 新增迁移、Web 和 Worker 服务，只为该应用创建必要依赖。
- `nginx/nginx.cloud.conf` 新增 `/qc-report` 重定向、健康检查和代理规则。
- `frontend/index.cloud.html` 在 QA 部增加“QC 成品报告系统”入口、详情卡和健康状态检查。
- `CLAUDE.md`/应用注册说明新增服务、端口和路径，明确它与现有 `qc` 分离。

## 数据流

1. 用户从 Portal 打开 `/qc-report/` 并登录独立 QC 账号。
2. 上传 PO 后，服务保存受控原文件并创建数据库任务。
3. Worker 调用真实 OpenAI 提取字段；每个值保存原文、页码和置信度。
4. QC 校对字段，上传现场照片，录入人工测试值。
5. Worker生成可审核缺陷草稿；QC 接受、修改或驳回。
6. 系统按授权 AQL 表与人工测试生成 PASS、ON HOLD 或 REJECT。
7. QC 签名后锁定数据与文件，生成带 SHA-256 的正式 PDF；修改只能创建新修订版。

## 错误处理

- OpenAI 未配置、超时、限流或返回无效结构时，任务进入明确失败状态，原始报告保持可编辑且不得伪造字段。
- Redis 不可用时生产 Worker/队列健康检查失败，不静默改为同步执行。
- 数据库或存储不可用时 `/health` 返回非 2xx，阻止部署健康检查通过。
- 必填证据缺失、AI 建议未审核或签名失效时，报告保持 ON HOLD。
- 文件下载前重新校验路径边界和 SHA-256。

## 测试与验收

- 运行现有 23 项 Python 自动测试。
- 新增生产模式禁止 mock、子路径 URL/Cookie、`/health`、空数据目录启动和敏感文件忽略测试。
- 构建 `qc-report` 镜像并以空 bind mount 启动。
- 经 Nginx 验证 `/qc-report/`、静态资源、登录、上传接口与 `/qc-report/health`。
- 扫描 PR 文件清单，确认无 `.env`、数据库、PO、照片、签名、PDF 或日志。

## 发布方式

本次只创建 Draft PR，不合并、不部署。合并与上线应走 RR-Portal 的 `/review-and-ship <PR#>` 流程，并在部署后检查新服务健康状态，同时确认原 `/qc/` 仍正常。
