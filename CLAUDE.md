# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication

Always respond in 简体中文 (Simplified Chinese).

## Project Overview

**RR Portal** — 企业级微服务平台，Docker Compose 架构。

### 核心概念

- **部门 (Department)**: 如 Engineering、Business 等，一个部门可以有**多个插件**
- **插件 (Plugin)**: 独立微服务，文件夹名 = GitHub repo 名
- 插件文件夹路径: `plugins/<repo-name>/`

```
RR Portal
├── apps/            — 独立应用（非 plugin_sdk）
│   ├── task-api/    — 任务 API (Node.js)
│   └── zouhuo/      — 走货明细系统 (Node.js)
├── core/            — 核心服务 (FastAPI, 用户/权限/插件注册)
├── devops/          — DevOps 自动化（agent、脚本、部署模板）
├── frontend/        — 前端静态文件 (Nginx托管)
├── plugin_sdk/      — 插件SDK (所有插件共用)
├── plugins/         — 插件目录（按 repo 名命名）
│   └── 工程啤办单/   — 工程啤办单 (Engineering, Node.js)
├── nginx/           — Nginx配置
└── docker-compose.yml
```

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

### 3. Hardcoded 配置 → 环境变量
- [ ] IP 地址 → `process.env.XXX_IP`
- [ ] 端口号 → `process.env.PORT`
- [ ] API 密钥/密码 → `process.env.XXX_KEY`
- [ ] 文件路径 → `process.env.DATA_PATH`
- [ ] 数据库连接串 → `process.env.DATABASE_URL`
- [ ] 创建 `.env` 文件（填入实际值）
- [ ] 创建 `.env.example` 文件（模板，不含敏感信息）

### 4. 网络访问
- [ ] 检查是否需要访问局域网硬件（打印机、扫描仪、PLC 等）
  - 如果需要：考虑 `network_mode: host`（注意 Windows Docker Desktop 限制）
  - 如果不需要：使用默认 `platform-net` bridge 网络即可
- [ ] 检查是否调用外部 API（需确保 DNS 解析正常）

### 5. docker-compose.yml
- [ ] 添加服务定义（build、env_file、environment、volumes）
- [ ] 添加 `restart: unless-stopped`
- [ ] 添加 `networks: platform-net`（除非用 host 模式）
- [ ] 如需通过 nginx 访问：更新 nginx.conf（upstream + location）

### 6. 数据库 Schema（plugin_sdk 插件）
- [ ] 确认 PostgreSQL 中存在对应 schema：`CREATE SCHEMA IF NOT EXISTS plugin_xxx`
- [ ] 或在 `init-db.sql` 中添加

### 7. 部署后验证
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
| zouhuo | 走货明细系统 | Engineering | Standalone (Node.js) | /zouhuo/ | https://github.com/duanlei10/123 |
| task-api | 任务 API | — | Standalone (Node.js) | — | — |
| new-product-schedule | 新产品开发进度表 | Engineering | Standalone (Node.js) | /new-product-schedule/ | https://github.com/hufan4308-blip/new-product-schedule |
| figure-mold-cost-system | 模具手办采购订单 | Engineering | Standalone (Node.js) | /figure-mold-cost-system/ | https://github.com/hufan4308-blip/figure-mold-cost-system |
| jiangping | 采购订单管理系统 | PMC跟仓管 | Standalone (Python/Flask) | /jiangping/ | https://github.com/fxxaxxx/jiangping |

### 旧插件（已删除）

以下插件已从 plugins/ 目录移除（2026-03-23）：
- 3D打印 (Engineering)
- Zuru MA 包装差价系统 (Business)
- 印尼小组 (Indonesia)
- schedule-system (Production)
