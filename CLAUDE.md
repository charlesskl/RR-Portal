# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication

Always respond in 简体中文 (Simplified Chinese). Code, commands, file paths remain in English.

## Project Overview

**RR Portal** — 企业级微服务平台，Docker Compose 架构。
- **Cloud**: Aliyun ECS (8.148.146.194)
- **Core**: Python 3.12 + FastAPI (async) + SQLAlchemy 2.0 + asyncpg + Redis
- **Apps/Plugins**: Mixed Node.js/Express + Python/Flask, each self-contained
- **Infra**: Docker Compose + Nginx reverse proxy + PostgreSQL

### 核心概念

- **部门 (Department)**: 如 Engineering、Business 等，一个部门可以有**多个插件**
- **插件 (Plugin)**: 独立微服务，文件夹名 = GitHub repo 名
- 插件文件夹路径: `plugins/<repo-name>/`

```
RR-Portal/
├── apps/                          — 独立应用（当前全部 standalone）
│   ├── 注塑啤机排产系统/            — paiji (Node.js + React)
│   ├── 配色库存管理/                — peise (Flask)
│   ├── 华登包材管理/                — huadeng (Flask)
│   ├── 采购订单管理系统/            — jiangping (Flask + EasyOCR)
│   ├── 成品核对系统/                — liwenjuan (Flask)
│   ├── 套客表系统/                  — quotation (Node.js)
│   ├── TOMY排期核对系统/            — tomy-paiqi (Node.js + React)
│   ├── A-doc生成系統/               — zouhuo (Node.js)
│   ├── ZURU接单表入单系统/          — zuru-order-system (Flask)
│   └── task-api/                  — 任务 API (Node.js，仅本地 compose)
├── plugins/                       — 同 apps/，历史分类遗留
│   ├── 工程啤办单/                  — rr-production (Node.js)
│   ├── 模具手办采购订单系统/        — figure-mold-cost-system (Node.js)
│   └── ZURU总排期入单/              — zuru-master-schedule (Flask)
├── archived/                      — 下线 / 历史代码，不参与部署
├── core/                          — 核心服务 (FastAPI, 用户/权限/插件注册)
├── plugin_sdk/                    — 插件 SDK（目前无插件在用）
├── nginx/                         — Nginx 配置（含 nginx.cloud.conf）
├── frontend/                      — 门户静态页（Nginx 托管）
├── deploy/                        — CI 部署脚本（update-server.sh = auto-deploy 主流程）
├── devops/                        — 运维脚本 / 监控 / agent 配置
│   └── scripts/safe-redeploy.sh   — 手动单服务安全部署
├── scripts/                       — DB 初始化 SQL（init-db.sql）
├── docs/                          — 文档（含 操作手册.md）
├── docker-compose.yml             — 本地开发 compose
├── docker-compose.cloud.yml       — 云端部署 compose
├── CLAUDE.md                      — Claude Code 项目指令
└── TODOS.md                       — 任务追踪
```

**命名约定**：
- 文件夹名 = 前端显示名（中文），便于业务人直观识别
- Docker service 名 = 英文（`paiji`, `peise`, `rr-production` 等），容器间 DNS / nginx upstream 靠这个解析，**永远保持不变**
- URL 路径 = 英文（`/paiji/`, `/peise/`, `/rr/` 等），外部书签/链接稳定

**备注**：`apps/` vs `plugins/` 的分类是历史遗留（原意区分 standalone vs plugin_sdk），实际**全部都是 standalone**。将来可能合并为单一 `apps/`。

## 常用命令

### 单服务安全部署（**首选**，强烈推荐）

直接调脚本，封装了所有安全检查：

```bash
# 本地执行（脚本会 SSH 到 ECS）
./devops/scripts/safe-redeploy.sh <service-name>

# 纯重启不重 build（代码没变时）
./devops/scripts/safe-redeploy.sh <service-name> --restart-only
```

脚本做的事：扫僵尸容器 → 检查内存 → `--no-deps` build/restart 指定服务 → `nginx -t` → `nginx -s reload` → 健康检查。任一步失败立即停并回滚。

### 手动操作时的纪律规则（**四条铁律**）

脚本跑不通要手动 ssh 操作时，务必遵守：

1. **任何 `docker compose up` 必须带 `--no-deps` + 服务名**。否则会拉起所有依赖，触发全站 recreate + IP 重洗：
   ```bash
   # ✅ 安全
   docker compose -f docker-compose.cloud.yml --env-file .env.cloud.production up -d --build --no-deps <service>
   # ❌ 危险（会 recreate 全部）
   docker compose -f docker-compose.cloud.yml --env-file .env.cloud.production up -d --build
   # ❌ 危险（会 recreate 依赖链）
   docker compose -f docker-compose.cloud.yml --env-file .env.cloud.production up -d --build <service>
   ```

2. **代码没变只重启进程，用 `restart` 不用 `up`**。`restart` 不 recreate 容器，不触发 IP 重洗：
   ```bash
   docker compose restart <service>  # 容器 ID 不变，nginx upstream 不受影响
   ```

3. **`git push main` 和手动 SSH deploy 不要同时动同一个 service**。push main 触发 `.github/workflows/deploy.yml` → `deploy/update-server.sh`，**现在是 diff-based 智能部署**（2026-04-22 之后）：只 rebuild 改动的服务，nginx 用 hot reload。两者并行动 **不同** service 是安全的；动同一 service 会容器名冲突。不确定就隔 60 秒。

4. **`restart nginx` 前必扫僵尸容器**：
   ```bash
   ssh rr-portal 'docker ps -a --filter status=created'
   # 有任何 Created / Restarting 的先清掉
   ssh rr-portal 'docker ps -a --filter status=created -q | xargs -r docker rm'
   ```

### 其他常用命令

```bash
# 查看日志
docker compose logs <service-name>
docker compose logs -f <service-name>  # 实时跟踪

# nginx 热重载（改 nginx.conf 后）— 比 restart 安全
docker exec rr-portal-nginx-1 nginx -t && docker exec rr-portal-nginx-1 nginx -s reload

# 健康检查
curl http://localhost:<port>/health
```

### DevOps 脚本（从 RR-Portal/ 目录运行）

日常部署首选 `safe-redeploy.sh`（见上方）。下面是其他运维工具：

```bash
./devops/scripts/health-check.sh     # 服务健康监控
./devops/scripts/status.sh           # 系统状态
./devops/scripts/rollback.sh         # 回滚到上一版本
./devops/scripts/logs.sh             # 日志聚合
./devops/scripts/qc-runner.sh        # 质量检查
./devops/scripts/backup-db.sh        # PostgreSQL + SQLite 备份
```

## 核心服务架构

### 认证流程 (core/app/auth/)
1. 用户登录 → `POST /api/auth/login` → bcrypt 验证密码
2. 生成 JWT token（含 user_id, role, department, permissions）
3. Token 有效期：60 分钟（`JWT_EXPIRATION_MINUTES`）
4. 依赖注入：`get_current_user()` 验证 token，`require_admin()` 限制管理员
5. 插件端用 `plugin_sdk.auth.require_plugin_permission("<name>:read")` 做权限校验

### 数据库 (core/app/database.py)
- PostgreSQL async，连接池 size=20, max_overflow=10
- **public schema**: 核心表（users, plugins, audit）
- **plugin_* schemas**: 每个插件独立 schema（如 `plugin_engineering`）
- 初始化脚本：`scripts/init-db.sql`

### 事件总线 (core/app/events.py)
- Redis pub/sub，插件间通信
- plugin_sdk 提供 `PluginEventBus` 封装

### 配置 (core/app/config.py)
- Pydantic BaseSettings 从 `.env` 加载
- **必填**：`JWT_SECRET`（≥32 字符）、`ADMIN_PASSWORD`（≥10 字符）
- 启动时自动创建默认 admin 用户

## 服务端口映射

| Service | Tech | Internal Port | Nginx Path |
|---------|------|---------------|------------|
| core | FastAPI | 8000 | /api/ |
| task-api | Node.js | 8080 | — |
| figure-mold-cost-system | Node.js | 3001 | /figure-mold-cost-system/ |
| zouhuo | Node.js | 3002 | /zouhuo/ |
| jiangping | Flask | 5001 | /jiangping/ |
| paiji | Node.js | 3000 | /paiji/ |
| zuru-master-schedule (ZURU总排期入单) | Flask | 5003 | /zuru-master/ |
| zuru-order-system (ZURU接单表入单系统) | Flask | 5005 | /zuru-order-system/ |
| quotation 套客表系统 | Node.js | 3004 | /quotation/ |
| tomy-paiqi TOMY排期核对系统 | Node.js/React | 3006 | /tomy-paiqi/ |
| liwenjuan 成品核对系统 | Flask | 5004 | /liwenjuan/ |
| peise 配色库存管理 | Flask | 5006 | /peise/ |
| huadeng 华登包材管理 | Flask | 5007 | /huadeng/ |

## 插件类型

RR Portal 支持两种插件类型：

### 1. Standalone Service（独立服务）
团队成员用自己熟悉的技术栈（Node.js/Express 等）开发，直接容器化运行，不依赖 plugin_sdk。
- 数据存储：JSON 文件 + bind mount（`./plugins/xxx/data:/app/data`）
- 认证：自行实现（如 PIN 验证、X-User header）
- Nginx：通过子路径代理（如 `/rr/` → `rr-production:3000`）
- **当前 Standalone 服务：工程啤办单 (Node.js, plugins/)、zouhuo (Node.js, apps/)、task-api (Node.js, apps/)**

### 2. Plugin SDK 插件（Python/FastAPI）
使用 plugin_sdk 统一架构，适用于需要核心权限系统和 PostgreSQL 的场景。

## Plugin SDK 规范（仅适用于 Plugin SDK 类型插件）

以下规范适用于选择使用 plugin_sdk 的插件：

### 文件结构
```
plugins/<repo-name>/
├── plugin.yaml        — 插件清单 (name, version, api_prefix, permissions)
├── Dockerfile         — 基于 python:3.12-slim, 安装 plugin_sdk
├── requirements.txt   — 额外依赖
└── app/
    ├── __init__.py
    ├── main.py        — 插件入口, 继承 BasePlugin
    ├── models.py      — SQLAlchemy async 模型, 使用 PluginDatabase
    └── router.py      — FastAPI APIRouter, 所有路由
```

### main.py 模板
```python
import logging
from plugin_sdk import BasePlugin, PluginEventBus
from app.models import db, Base
from app.router import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
event_bus = PluginEventBus()

class XxxPlugin(BasePlugin):
    async def on_startup(self):
        await db.init_tables(Base)
        await event_bus.connect()
        await event_bus.start_listening()
    async def on_shutdown(self):
        await event_bus.disconnect()
        await db.close()

plugin = XxxPlugin("plugin.yaml")
app = plugin.app
app.include_router(router)
```

### models.py 规范
```python
from sqlalchemy import Column, Integer, String, DateTime, Text, Numeric, ForeignKey
from sqlalchemy.sql import func
from plugin_sdk.database import PluginDatabase

db = PluginDatabase("plugin_<name>")   # schema 名称
Base = db.create_base()

class MyModel(Base):
    __tablename__ = "my_table"
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # ...
```

### router.py 规范
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from plugin_sdk.auth import require_plugin_permission, TokenPayload
from plugin_sdk.models import StandardResponse, PaginatedResponse
from app.models import db, MyModel

router = APIRouter(prefix="/api/<name>", tags=["<DisplayName>"])

@router.get("/items", response_model=StandardResponse)
async def list_items(
    _: TokenPayload = Depends(require_plugin_permission("<name>:read")),
    session: AsyncSession = Depends(db.get_session),
):
    # ...
```

### plugin.yaml 格式
```yaml
name: <name>
display_name: "插件显示名"
version: "1.0.0"
department: <Department>
description: 功能描述
api_prefix: /api/<name>
health_check: /api/<name>/health
permissions:
  - <name>:read
  - <name>:write
  - <name>:manage
```

### Dockerfile 模板
```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY plugin_sdk /tmp/plugin_sdk
RUN pip install --no-cache-dir /tmp/plugin_sdk && rm -rf /tmp/plugin_sdk
COPY plugins/<repo-name>/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY plugins/<repo-name>/ .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## 插件快速更新流程

团队成员将插件设计上传到各自的 GitHub 仓库（可能是 Node.js/Express 或其他技术栈）。
**插件文件夹名 = GitHub repo 名**。

**当用户说 "更新 `<插件名>` 插件，repo: `<GitHub URL>`" 时，执行以下流程：**

1. `git clone --depth 1 <url> /tmp/<repo-name>` 拉取代码
2. 读取 repo 中的源码，分析数据模型、字段、API 路由、业务逻辑
3. 将功能转换为上述 plugin_sdk 架构（models.py + router.py）
4. 更新 `plugins/<repo-name>/` 下的文件（若不存在则创建）
5. 如需更新 docker-compose.yml，一并处理
6. **执行下方「插件上线 Checklist」确保容器内功能完整**

**关键原则：**
- **Standalone Service 优先**：如果 repo 本身已是完整可运行的应用（Node.js/Express 等），保持原技术栈，直接容器化
- 仅在需要核心权限系统或 PostgreSQL 时，才转换为 plugin_sdk 架构
- Standalone 服务通过 nginx 子路径代理接入平台
- 数据持久化统一用 bind mount

## 插件上线 Checklist（本地 → Docker 适配）

团队成员在本地开发的应用，放到 Docker 容器后环境不同。**每次新增/更新插件必须逐项检查：**

### 1. Dockerfile
- [ ] 必须有 Dockerfile，没有就创建
- [ ] 确认基础镜像正确（Node.js 用 `node:20-alpine`，Python 用 `python:3.12-slim`）
- [ ] 安装所有依赖（package.json / requirements.txt）

### 2. 数据持久化
- [ ] 找到所有数据文件（json、sqlite、uploads 目录等）
- [ ] **必须用 bind mount**，不要用 named volume（防止重建丢数据）
- [ ] 数据路径改为环境变量：`process.env.DATA_PATH` / `os.environ["DATA_PATH"]`
- [ ] docker-compose.yml 配置：`"./plugins/xxx/data:/app/data"`
- [ ] 确保本地 data 目录存在且包含初始数据

```yaml
# ✅ 正确 - bind mount，数据在本地磁盘
volumes:
  - "./plugins/xxx/data:/app/data"

# ❌ 错误 - named volume，重建容器数据可能丢失
volumes:
  - xxx_data:/app/data
```

### 3. 首次启动种子数据
- [ ] 确认 app 在**全空数据目录**下能正常启动（不能崩溃）
- [ ] 如果 app 需要预置数据（工厂列表、默认用户、模板配置等），**必须在代码中内置种子逻辑**
- [ ] 种子逻辑仅在数据为空时运行（幂等），不覆盖已有数据
- [ ] 不依赖 gitignored 的数据文件作为唯一数据来源
- [ ] 验证：删除 data 目录 → 重启容器 → app 功能正常且有必要的初始数据

```javascript
// ✅ 正确 - 代码内置种子数据
if (orders.length === 0 && fs.existsSync(seedFile)) {
  const seed = JSON.parse(fs.readFileSync(seedFile));
  insertAll(seed);
}

// ❌ 错误 - 仅依赖 gitignored 文件，首次部署数据丢失
const data = JSON.parse(fs.readFileSync('data/data.json'));
```

### 4. Hardcoded 配置 → 环境变量
- [ ] IP 地址 → `process.env.XXX_IP`
- [ ] 端口号 → `process.env.PORT`
- [ ] API 密钥/密码 → `process.env.XXX_KEY`
- [ ] 文件路径 → `process.env.DATA_PATH`
- [ ] 数据库连接串 → `process.env.DATABASE_URL`
- [ ] 创建 `.env` 文件（填入实际值）
- [ ] 创建 `.env.example` 文件（模板，不含敏感信息）

### 5. 网络访问
- [ ] 检查是否需要访问局域网硬件（打印机、扫描仪、PLC 等）
  - 如果需要：考虑 `network_mode: host`（注意 Windows Docker Desktop 限制）
  - 如果不需要：使用默认 `platform-net` bridge 网络即可
- [ ] 检查是否调用外部 API（需确保 DNS 解析正常）

### 6. docker-compose.yml
- [ ] 添加服务定义（build、env_file、environment、volumes）
- [ ] 添加 `restart: unless-stopped`
- [ ] 添加 `networks: platform-net`（除非用 host 模式）
- [ ] 如需通过 nginx 访问：更新 nginx.conf（upstream + location）

### 7. 数据库 Schema（plugin_sdk 插件）
- [ ] 确认 PostgreSQL 中存在对应 schema：`CREATE SCHEMA IF NOT EXISTS plugin_xxx`
- [ ] 或在 `init-db.sql` 中添加

### 8. 部署后验证
- [ ] `docker compose up -d --build <service>` 构建启动
- [ ] `docker compose logs <service>` 检查无报错
- [ ] `docker compose restart nginx` 刷新 nginx DNS
- [ ] 从浏览器访问确认功能正常
- [ ] 确认数据读写正常（创建数据 → 重启容器 → 数据仍在）

## App 注册表

所有 app 按部门组织。部署新 app 时需指定所属部门。

### 已部署 Apps

| App 名 | 显示名 | 部门 | 类型 | 路径 | GitHub Repo |
|---------|--------|------|------|------|-------------|
| rr-production (工程啤办单) | 工程啤办单 | Engineering | Standalone (Node.js) | /rr/ | https://github.com/hufan4308-blip/RR-production-system |
| zouhuo | A-doc生成系統 | Engineering | Standalone (Node.js) | /zouhuo/ | https://github.com/duanlei10/123 |
| task-api | 任务 API | — | Standalone (Node.js) | — | — |
| figure-mold-cost-system | 模具手办采购订单 | Engineering | Standalone (Node.js) | /figure-mold-cost-system/ | https://github.com/hufan4308-blip/figure-mold-cost-system |
| jiangping | 采购订单管理系统 | PMC跟仓管 | Standalone (Python/Flask) | /jiangping/ | https://github.com/fxxaxxx/jiangping |
| paiji | AI注塑啤机排产系统 | 生产部 | Standalone (Node.js) | /paiji/ | https://github.com/duanlei10/234 |
| zuru-master-schedule | ZURU总排期入单 | 业务部 | Standalone (Python/Flask) | /zuru-master/ | (PR #59) |
| zuru-order-system | ZURU接单表入单系统 | 业务部 | Standalone (Python/Flask) | /zuru-order-system/ | https://github.com/hanson678/zuru-order-system |
| quotation | 套客表系统 | 业务部 | Standalone (Node.js) | /quotation/ | — |
| tomy-paiqi | TOMY排期核对系统 | 业务部 | Standalone (Node.js/React) | /tomy-paiqi/ | — |
| liwenjuan | 成品核对系统 | PMC跟仓管 | Standalone (Python/Flask) | /liwenjuan/ | — |
| peise | 配色库存管理 | PMC跟仓管 | Standalone (Python/Flask) | /peise/ | https://github.com/fxxaxxx/peisecangku |
| huadeng | 华登包材管理 | PMC跟仓管 | Standalone (Python/Flask) | /huadeng/ | — |

### 旧插件（已删除）

以下插件已从 plugins/ 目录移除：
- 3D打印 (Engineering) — 2026-03-23
- Zuru MA 包装差价系统 (Business) — 2026-03-23
- 印尼小组 (Indonesia) — 2026-03-23
- business-data-statistics 生产经营数据系统 (总部) — 2026-04-15
- schedule-system (Production)
- ZURU出货助手 zuru-shipment-deploy (业务部) — 2026-04-21（源码已归档到 archived/zuru-shipment-deploy/，需要恢复时 git mv 回来；服务器数据 /opt/rr-portal/apps/zuru-shipment-deploy/data/ 也保留）
- 新产品开发进度表 / new-product-schedule (Engineering) — 2026-04-22 完全下线（git rm 源码 + 删服务器 data/uploads；数据备份至 `~/rr-backups/new-product-schedule-20260422-*.tar.gz`）
- quotation-system (旧版) — 2026-04-22（git rm；已被 apps/quotation/ 完全取代）
- product-library — 2026-04-22（git rm；从未实现过，只有占位 README）
