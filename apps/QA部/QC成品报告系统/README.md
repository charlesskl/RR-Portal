# AI 辅助 QC 验货报告系统

公司内网使用的中文 QC 工作台：上传 PDF、Excel 或扫描图片 PO，逐货号校对提取字段，按管理员照片清单拍照，手动运行 AI 可见问题分析，由 QC 接受、修改或驳回建议并填写受影响数量，最后按 AQL 和人工测试生成统一英文正式报告。

AI 只生成可审核草稿，不能自动定稿、填写缺陷数量或代替 QC 承担质量责任。PO 中不存在的字段保持空白；普通照片不能推断跌落、扭力、拉力、电流或电压测试结果。

## 本地启动（Windows）

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:AI_MOCK_MODE="true"  # 仅本地演示；生产环境必须为 false
.\.venv\Scripts\python.exe app.py
```

打开 `http://localhost:8000`。

- 管理员初始账号：`admin / Admin@12345`
- QC 初始账号：`qc / QC@12345`

正式使用前必须设置 `SECRET_KEY`、`ADMIN_PASSWORD`、`QC_PASSWORD` 和 `OPENAI_API_KEY`，并修改所有初始密码。`OPENAI_API_KEY`、模型和接口地址只从服务器环境变量读取，不进入网页、数据库审计内容或 AI 请求上下文。

## Docker 内网部署

1. 将 `.env.example` 复制为 `.env`，更换全部密码与密钥，保持 `AI_MOCK_MODE=false`。
2. 运行 `docker compose up -d --build`。
3. 浏览器访问服务器的 `8000` 端口。

Docker 由 PostgreSQL、Redis、数据库迁移、单次基础数据初始化、Web、RQ Worker 和持久文件存储组成。迁移与初始化成功后 Web 和 Worker 才启动，避免多个 Web 进程同时写入初始数据；Redis 使用 AOF，照片/签名/PDF 使用共享 `qc-storage` 卷。

## RR-Portal 接入

Portal 中的独立服务名为 `qc-report`，内部端口 `3410`，对外路径为 `/qc-report/`。Nginx 删除路径前缀后转发请求，同时传入受信任的 `X-Forwarded-Prefix`；应用只接受与 `PROXY_PREFIX` 完全相同的值。Session Cookie 限定在 `/qc-report/`，不与现有 `/qc/` 品质管理系统共享。

RR-Portal 云端部署使用独立 SQLite 数据库、宿主机持久化目录和 Redis DB 2；`AI_MOCK_MODE` 固定为 `false`。启用前必须在生产环境文件中设置 `QC_REPORT_SECRET_KEY`、`QC_REPORT_ADMIN_PASSWORD` 和 `QC_REPORT_QC_PASSWORD`，OpenAI 凭证使用 `QC_REPORT_OPENAI_API_KEY`。

## AI 配置

主要服务器环境变量：

- `OPENAI_API_KEY`：生产必填。
- `OPENAI_BASE_URL`：默认 `https://api.openai.com/v1`。
- `OPENAI_MODEL`：默认 `gpt-5.6-terra`，可按公司成本和准确率验证结果调整。
- `AI_MOCK_MODE=true`：只用于本地演示和自动测试，返回确定性 5226155 / Long loose thread 数据。
- `REDIS_URL`：Docker 内部自动配置；本地未设置时任务同步执行。

AI 请求使用 Responses API、严格 JSON Schema 和 `store: false`。每次运行保存模型、Prompt/Schema 版本、请求号、置信度、证据照片和 QC 修改前后记录。

## 数据库迁移

Alembic 管理数据库结构：

```powershell
$env:DATABASE_URL="postgresql+psycopg2://..."
.\.venv\Scripts\alembic.exe upgrade head
```

迁移包含旧系统基线和 AI 工作流增量；对已有且结构完整的旧库会保留现有表并登记版本。升级前必须同时备份数据库和文件存储。

## 数据与文件规则

- 每个 PO 货号对应一份报告；每个字段保存原值、标准化值、置信度、页码/单元格出处及 QC 确认状态。
- 照片同时保存受限原图和清除 EXIF、纠正方向后的分析副本，两者分别保存 SHA-256。
- 必拍照片缺失、照片要求补拍、AI 建议未审核或必填测试未填时为 `ON HOLD`。
- AQL 达到 Re、Critical 达到 Re 或必填测试 `FAIL` 时为 `REJECT`；资料齐全且全部不超过 Ac 时为 `PASS`。
- QC 签字后只生成统一英文正式 PDF；数据、照片和 PDF 不可覆盖，修改生成 Rev.1、Rev.2。
- 系统只预置用于验收 `PO-26032401` 的示例抽样规则。上线前必须由管理员录入公司有权使用的完整 AQL 表。

## 备份

- Linux/Docker：使用 `scripts/backup.sh`；恢复使用 `scripts/restore.sh BACKUP_FOLDER --confirm`。
- Windows：使用 `scripts/backup.ps1`；恢复使用 `scripts/restore.ps1 -BackupFolder PATH -ConfirmRestore`。
- 备份必须同时包含 PostgreSQL 导出和 `qc-storage` 文件卷；恢复后抽查 PDF、原图和分析副本校验值。
- 为保证数据库与照片处于同一时间点，脚本会在备份或恢复期间暂停 Web 与 Worker；备份结束后自动恢复服务，恢复失败时服务保持停止以免继续写入半恢复数据。

## 验证

```powershell
$env:AI_MOCK_MODE="true"
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe scripts\self_verify.py
.\.venv\Scripts\python.exe scripts\load_smoke.py
```

自动测试覆盖原有功能和新 AI 流程，包括 PO 字段证据、照片双副本、Long loose thread / Minor 草稿、QC 确认数量 2、AQL 边界、必填测试、统一 PDF、锁定和修订版本。
