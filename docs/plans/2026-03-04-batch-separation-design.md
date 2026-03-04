# Batch A/B 代码分离 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 RR Portal 插件分为 Batch A（云部署）和 Batch B（本地），通过独立的 docker-compose 文件实现代码分离。

**Architecture:** 同一 repo 内新增 `docker-compose.cloud.yml`（Batch A）和 `docker-compose.local.yml`（Batch B），各自配套独立的 nginx 配置和前端门户。不修改任何现有文件。

**Tech Stack:** Docker Compose, Nginx, PostgreSQL, Redis, Node.js, Python/FastAPI

---

## Batch 分组

| 组件 | 批次 | 原因 |
|------|------|------|
| core + db + redis + nginx | A | 基础设施 |
| rr-production (工程啤办单) | A | 纯 Node.js + JSON，无硬件依赖 |
| indonesia-export (印尼小组) | A | 纯静态 HTML |
| 3D打印 | B | 直连局域网打印机 |
| schedule-system | B | SMB/IMAP/Windows 路径依赖 |
| zuru-ma | B | 用户选择暂不上云 |

---

### Task 1: 创建 .env.cloud 环境变量模板

**Files:**
- Create: `.env.cloud`

**Step 1: 创建文件**

```env
# ─── Cloud Deployment Environment ───
# 所有标记为 REQUIRED 的变量必须在部署前填写

# ─── Server ───
PORT=80
DEBUG=false

# ─── Database ───
DB_USER=rrportal
DB_PASSWORD=                    # REQUIRED: 设置强密码
DB_NAME=rrportal
DB_HOST=db
DB_PORT=5432

# ─── Redis ───
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=                 # REQUIRED: 设置强密码

# ─── JWT ───
JWT_SECRET=                     # REQUIRED: 至少32位随机字符串
JWT_ALGORITHM=HS256
JWT_EXPIRATION_MINUTES=60

# ─── Admin Bootstrap ───
ADMIN_USERNAME=admin
ADMIN_PASSWORD=                 # REQUIRED: 设置强密码
ADMIN_EMAIL=admin@company.com

# ─── CORS ───
ALLOWED_ORIGINS=                # REQUIRED: 填写实际域名，如 https://portal.example.com
```

**Step 2: 验证文件存在**

Run: `cat .env.cloud | head -5`
Expected: 文件头部显示 `# ─── Cloud Deployment Environment ───`

**Step 3: Commit**

```bash
git add .env.cloud
git commit -m "feat: add .env.cloud template for Batch A cloud deployment"
```

---

### Task 2: 创建 docker-compose.cloud.yml

**Files:**
- Create: `docker-compose.cloud.yml`

**Step 1: 创建文件**

```yaml
# Batch A: Cloud Deployment
# Usage: docker compose -f docker-compose.cloud.yml up -d --build
#
# Includes: core + db + redis + nginx + rr-production + indonesia-export
# Excludes: 3D打印 (hardware), schedule-system (SMB/Windows), zuru-ma (deferred)

services:
  # ──────────────────────────────────────
  # Infrastructure
  # ──────────────────────────────────────
  nginx:
    image: nginx:1.25-alpine
    ports:
      - "${PORT:-80}:80"
    volumes:
      - ./nginx/nginx.cloud.conf:/etc/nginx/nginx.conf:ro
      - ./frontend/index.cloud.html:/usr/share/nginx/html/index.html:ro
      - ./frontend/logo.png:/usr/share/nginx/html/logo.png:ro
    depends_on:
      core:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - platform-net

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${DB_USER:-rrportal}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME:-rrportal}
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-rrportal}"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped
    networks:
      - platform-net

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped
    networks:
      - platform-net

  # ──────────────────────────────────────
  # Core System
  # ──────────────────────────────────────
  core:
    build:
      context: ./core
      dockerfile: Dockerfile
    env_file: .env.cloud
    environment:
      - SERVICE_NAME=core
      - DATABASE_URL=postgresql+asyncpg://${DB_USER:-rrportal}:${DB_PASSWORD}@db:5432/${DB_NAME:-rrportal}
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped
    networks:
      - platform-net

  # ──────────────────────────────────────
  # Batch A Plugins
  # ──────────────────────────────────────
  rr-production:
    build:
      context: ./plugins/工程啤办单
      dockerfile: Dockerfile.node
    environment:
      - BASE_PATH=/rr
      - PORT=3000
    volumes:
      - ./plugins/工程啤办单/data:/app/data
    restart: unless-stopped
    networks:
      - platform-net

  indonesia-export:
    build:
      context: ./plugins/印尼小组
      dockerfile: Dockerfile
    restart: unless-stopped
    networks:
      - platform-net

networks:
  platform-net:
    driver: bridge
```

**Step 2: 验证 YAML 语法**

Run: `docker compose -f docker-compose.cloud.yml config --quiet 2>&1 || echo "YAML ERROR"`
Expected: 无输出（syntax OK），或显示缺少环境变量的警告（正常，因为 .env.cloud 中的 REQUIRED 字段为空）

**Step 3: Commit**

```bash
git add docker-compose.cloud.yml
git commit -m "feat: add docker-compose.cloud.yml for Batch A cloud deployment"
```

---

### Task 3: 创建 nginx/nginx.cloud.conf

**Files:**
- Create: `nginx/nginx.cloud.conf`

**Step 1: 创建文件**

基于现有 `nginx/nginx.conf`，移除 Batch B 的 upstream 和 location。

```nginx
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include       mime.types;
    default_type  application/json;

    # ─── Logging ───
    log_format main '$remote_addr - $remote_user [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    '"$http_referer" "$http_user_agent" '
                    'rt=$request_time';
    access_log /var/log/nginx/access.log main;
    error_log  /var/log/nginx/error.log warn;

    # ─── Performance ───
    sendfile        on;
    tcp_nopush      on;
    keepalive_timeout 65;
    client_max_body_size 50m;

    # ─── Upstreams (Batch A only) ───
    upstream core_backend {
        server core:8000;
    }

    upstream rr_production {
        server rr-production:3000;
    }

    upstream indonesia_export {
        server indonesia-export:8080;
    }

    server {
        listen 80;
        server_name _;

        # ─── Portal (landing page) ───
        root /usr/share/nginx/html;
        index index.html;

        location = / {
            try_files /index.html =404;
        }

        # ─── Health check ───
        location /nginx-health {
            return 200 '{"status":"ok"}';
        }

        # ─── Core API ───
        location /api/auth {
            proxy_pass http://core_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /api/admin {
            proxy_pass http://core_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /api/plugins {
            proxy_pass http://core_backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location /health {
            proxy_pass http://core_backend;
            proxy_set_header Host $host;
        }

        # ─── Core docs / openapi ───
        location /docs {
            proxy_pass http://core_backend;
            proxy_set_header Host $host;
        }

        location /openapi.json {
            proxy_pass http://core_backend;
            proxy_set_header Host $host;
        }

        location /redoc {
            proxy_pass http://core_backend;
            proxy_set_header Host $host;
        }

        # ─── Standalone: RR 工程啤办单 ───
        location = /rr {
            return 301 /rr/;
        }
        location /rr/ {
            proxy_pass http://rr_production/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # ─── Standalone: 印尼出货明细资料核对系统 ───
        location = /indonesia {
            return 301 /indonesia/;
        }
        location /indonesia/ {
            proxy_pass http://indonesia_export/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # ─── RR 工程啤办单 API（前端用绝对路径 /api/...）───
        location ~ ^/api/(injection|slush|spray|stats|problems|material-prices|material-stats|injection-costs|requisitions) {
            proxy_pass http://rr_production;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

**Step 2: 验证 nginx 配置语法**

Run: `docker run --rm -v "$(pwd)/nginx/nginx.cloud.conf:/etc/nginx/nginx.conf:ro" nginx:1.25-alpine nginx -t 2>&1`
Expected: `nginx: configuration file /etc/nginx/nginx.conf test is successful`

**Step 3: Commit**

```bash
git add nginx/nginx.cloud.conf
git commit -m "feat: add nginx.cloud.conf for Batch A (no 3D/schedule/zuru-ma routes)"
```

---

### Task 4: 创建 frontend/index.cloud.html

**Files:**
- Create: `frontend/index.cloud.html`

**Step 1: 创建文件**

基于现有 `frontend/index.html`，仅保留工程部和印尼小组两个部门卡片。移除业务部和 3D 打印。移除所有硬编码 IP。统计数字相应调整（2 个部门，2 个插件）。

具体变化：
- `allDepts` 数组改为 `['engineering', 'indonesia']`
- 移除 `businessDetail`、`printing3dDetail` 整个 section
- 移除首页中业务部和 3D打印 的 dept-card
- `statDepts` 默认值改为 2
- 健康检查只检查 rr 和 indonesia
- 所有链接使用相对路径（无 `192.168.x.x`）

**完整文件内容见附录 A（太长不在此展示，实施时从 `frontend/index.html` 复制并删除 Batch B 相关部分）。**

核心改动点：

1. `var allDepts = ['engineering', 'indonesia'];` （移除 business, printing3d）

2. 首页 stats-bar 中 `statDepts` 改为 `2`

3. 移除业务部和 3D打印的 dept-card div

4. 移除 `businessDetail` 和 `printing3dDetail` 的 detail-view div

5. `checkHealth` 函数中 checks 数组只保留：
```javascript
const checks = [
  { name: 'indonesia', url: '/api/indonesia/health' },
  { name: 'rr', url: '/rr/health' },
];
```

6. `updateDots` 只调用 indonesia 和 rr

**Step 2: 在浏览器中打开确认页面结构正确**

Run: `wc -l frontend/index.cloud.html`
Expected: 行数约 350 行左右（原文件 527 行减去移除的部分）

**Step 3: Commit**

```bash
git add frontend/index.cloud.html
git commit -m "feat: add index.cloud.html portal showing only Batch A plugins"
```

---

### Task 5: 创建 docker-compose.local.yml

**Files:**
- Create: `docker-compose.local.yml`

**Step 1: 创建文件**

```yaml
# Batch B: Local-only services (hardware/network dependencies)
# Usage: docker compose -f docker-compose.local.yml up -d --build
#
# Includes: zuru-ma, schedule-system, nginx-local (with 3D printing proxy)
# Note: 3D打印 runs natively on host (启动服务器.bat), not in Docker
# Note: This file does NOT include core/db/redis - use alongside
#        docker-compose.yml for full local stack

services:
  # ──────────────────────────────────────
  # Batch B Plugins
  # ──────────────────────────────────────
  zuru-ma:
    build:
      context: "./plugins/Zuru MA 包装差价系统"
      dockerfile: Dockerfile
    environment:
      - BASE_PATH=/zuru-ma
      - PORT=3000
    restart: unless-stopped
    networks:
      - platform-net

  schedule-system:
    build:
      context: "./plugins/schedule-system"
      dockerfile: Dockerfile
    ports:
      - "5000:5000"
    environment:
      - APP_PORT=5000
      - CONTAINER_MODE=1
      - BROWSE_ROOT=/host/mnt/host
    volumes:
      - "./plugins/schedule-system/data:/app/data"
      - "./plugins/schedule-system/uploads:/app/uploads"
      - "/:/host:rw"
    restart: unless-stopped
    networks:
      - platform-net

  # 3D打印: 宿主机直接运行 (plugins/3D打印/启动服务器.bat)
  # nginx 通过 host.docker.internal:3001 代理

networks:
  platform-net:
    driver: bridge
```

**Step 2: 验证 YAML 语法**

Run: `docker compose -f docker-compose.local.yml config --quiet 2>&1 || echo "YAML ERROR"`
Expected: 无输出或仅警告

**Step 3: Commit**

```bash
git add docker-compose.local.yml
git commit -m "feat: add docker-compose.local.yml for Batch B local-only services"
```

---

### Task 6: 创建 data/postgres/.gitkeep

**Files:**
- Create: `data/postgres/.gitkeep`

**Step 1: 创建目录和占位文件**

cloud compose 使用 bind mount `./data/postgres`，需要确保目录存在。

```bash
mkdir -p data/postgres
touch data/postgres/.gitkeep
```

**Step 2: 添加到 .gitignore**

在项目根目录 `.gitignore` 中添加（如果文件存在）：

```
data/postgres/*
!data/postgres/.gitkeep
```

**Step 3: Commit**

```bash
git add data/postgres/.gitkeep .gitignore
git commit -m "feat: add data/postgres bind mount directory for cloud deployment"
```

---

### Task 7: 最终验证

**Step 1: 验证所有新增文件存在**

Run: `ls -la docker-compose.cloud.yml docker-compose.local.yml nginx/nginx.cloud.conf frontend/index.cloud.html .env.cloud data/postgres/.gitkeep`
Expected: 6 个文件全部列出

**Step 2: 验证原文件未被修改**

Run: `git diff docker-compose.yml nginx/nginx.conf frontend/index.html`
Expected: 无输出（没有修改）

**Step 3: 验证 cloud compose 配置完整性**

Run: `docker compose -f docker-compose.cloud.yml config --services`
Expected output:
```
core
db
indonesia-export
nginx
redis
rr-production
```

**Step 4: Commit 汇总（如果前面未逐步 commit）**

```bash
git add .
git commit -m "feat: separate RR Portal into Batch A (cloud) and Batch B (local)"
```
