# Batch A 云部署实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 RR Portal Batch A 部署到阿里云 ECS，使多个工厂可通过公网 IP 访问。

**Architecture:** 在一台阿里云 ECS（Ubuntu 22.04）上安装 Docker，直接使用 `docker-compose.cloud.yml` 启动所有 Batch A 服务。先在本地创建部署脚本和修复 init-db.sql，再到服务器上执行。

**Tech Stack:** Docker Compose, Nginx, PostgreSQL 16, Redis 7, Node.js, Python/FastAPI

---

### Task 1: 创建云端 init-db.sql

**问题:** 现有 `scripts/init-db.sql` 中 `GRANT ALL ... TO postgres`，但云端 DB 用户是 `rrportal`。需要创建一个兼容版本。

**Files:**
- Create: `scripts/init-db.cloud.sql`
- Modify: `docker-compose.cloud.yml`

**Step 1: 创建 init-db.cloud.sql**

```sql
-- Cloud deployment: schemas for Batch A plugins
-- DB user is rrportal (not postgres)

CREATE SCHEMA IF NOT EXISTS plugin_business;
CREATE SCHEMA IF NOT EXISTS plugin_engineering;
CREATE SCHEMA IF NOT EXISTS plugin_indonesia;

-- Grant to the cloud DB user (matches DB_USER in .env.cloud)
DO $$
DECLARE
    db_user TEXT := current_user;
BEGIN
    EXECUTE format('GRANT ALL ON SCHEMA plugin_business TO %I', db_user);
    EXECUTE format('GRANT ALL ON SCHEMA plugin_engineering TO %I', db_user);
    EXECUTE format('GRANT ALL ON SCHEMA plugin_indonesia TO %I', db_user);
END
$$;
```

**Step 2: 更新 docker-compose.cloud.yml 使用新的 init-db**

In the `db` service, change:
```yaml
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql:ro
```
to:
```yaml
      - ./scripts/init-db.cloud.sql:/docker-entrypoint-initdb.d/init.sql:ro
```

**Step 3: 验证 SQL 语法**

Run: `cat scripts/init-db.cloud.sql`
Expected: 文件内容正确，无语法错误

**Step 4: Commit**

```bash
git add scripts/init-db.cloud.sql docker-compose.cloud.yml
git commit -m "feat: add cloud-compatible init-db.sql with dynamic user grants"
```

---

### Task 2: 创建一键部署脚本

**Files:**
- Create: `deploy/setup-server.sh`

**Step 1: 创建脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail

# ─── RR Portal Cloud Deployment Script ───
# Run this on a fresh Ubuntu 22.04 server as root
# Usage: bash setup-server.sh

echo "=== RR Portal Batch A - Cloud Deployment ==="

# ─── 1. System update ───
echo "[1/7] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ─── 2. Install Docker ───
echo "[2/7] Installing Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    echo "Docker already installed, skipping."
fi

# Verify Docker Compose plugin
if ! docker compose version &>/dev/null; then
    apt-get install -y -qq docker-compose-plugin
fi

echo "Docker version: $(docker --version)"
echo "Compose version: $(docker compose version)"

# ─── 3. Install git ───
echo "[3/7] Installing git..."
apt-get install -y -qq git

# ─── 4. Clone repository ───
INSTALL_DIR="/opt/rr-portal"
REPO_URL="https://github.com/charlesskl/RR-Portal.git"

echo "[4/7] Cloning repository to ${INSTALL_DIR}..."
if [ -d "$INSTALL_DIR" ]; then
    echo "Directory exists, pulling latest..."
    cd "$INSTALL_DIR"
    git pull
else
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# ─── 5. Configure environment ───
echo "[5/7] Configuring environment..."
ENV_FILE="${INSTALL_DIR}/.env.cloud.production"

if [ ! -f "$ENV_FILE" ]; then
    cp .env.cloud "$ENV_FILE"

    # Generate random passwords
    DB_PASS=$(openssl rand -base64 24 | tr -d '/+=')
    REDIS_PASS=$(openssl rand -base64 24 | tr -d '/+=')
    JWT_SEC=$(openssl rand -base64 48 | tr -d '/+=')
    ADMIN_PASS=$(openssl rand -base64 16 | tr -d '/+=')

    # Fill in required fields
    sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=${DB_PASS}/" "$ENV_FILE"
    sed -i "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=${REDIS_PASS}/" "$ENV_FILE"
    sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${JWT_SEC}/" "$ENV_FILE"
    sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${ADMIN_PASS}/" "$ENV_FILE"
    sed -i "s/^ALLOWED_ORIGINS=.*/ALLOWED_ORIGINS=*/" "$ENV_FILE"

    echo ""
    echo "╔══════════════════════════════════════════╗"
    echo "║  IMPORTANT: Save these credentials!      ║"
    echo "╚══════════════════════════════════════════╝"
    echo ""
    echo "Admin Username: admin"
    echo "Admin Password: ${ADMIN_PASS}"
    echo "DB Password:    ${DB_PASS}"
    echo "Redis Password: ${REDIS_PASS}"
    echo ""
    echo "Credentials saved in: ${ENV_FILE}"
    echo "Back up this file securely!"
    echo ""
else
    echo "Environment file exists, keeping existing config."
fi

# ─── 6. Ensure data directories exist ───
echo "[6/7] Creating data directories..."
mkdir -p data/postgres
mkdir -p plugins/工程啤办单/data

# ─── 7. Start services ───
echo "[7/7] Building and starting services..."
docker compose -f docker-compose.cloud.yml --env-file "$ENV_FILE" up -d --build

echo ""
echo "=== Deployment complete! ==="
echo ""

# Wait for services to be healthy
echo "Waiting for services to start (30s)..."
sleep 30

# Health check
echo "Running health checks..."
NGINX_OK=false
CORE_OK=false

if curl -sf http://localhost/nginx-health > /dev/null 2>&1; then
    echo "  [OK] nginx"
    NGINX_OK=true
else
    echo "  [FAIL] nginx"
fi

if curl -sf http://localhost/health > /dev/null 2>&1; then
    echo "  [OK] core"
    CORE_OK=true
else
    echo "  [FAIL] core"
fi

echo ""
if $NGINX_OK && $CORE_OK; then
    SERVER_IP=$(curl -sf http://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
    echo "╔══════════════════════════════════════════╗"
    echo "║  RR Portal is live!                      ║"
    echo "╚══════════════════════════════════════════╝"
    echo ""
    echo "Access: http://${SERVER_IP}/"
    echo ""
else
    echo "Some services failed. Check logs with:"
    echo "  docker compose -f docker-compose.cloud.yml logs"
fi
```

**Step 2: 设置可执行权限**

Run: `chmod +x deploy/setup-server.sh`

**Step 3: 验证脚本语法**

Run: `bash -n deploy/setup-server.sh && echo "Syntax OK"`
Expected: `Syntax OK`

**Step 4: Commit**

```bash
git add deploy/setup-server.sh
git commit -m "feat: add one-click cloud deployment script for Batch A"
```

---

### Task 3: 创建更新脚本

**Files:**
- Create: `deploy/update-server.sh`

**Step 1: 创建脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail

# ─── RR Portal Cloud Update Script ───
# Run on the cloud server to update to latest code
# Usage: bash /opt/rr-portal/deploy/update-server.sh

INSTALL_DIR="/opt/rr-portal"
ENV_FILE="${INSTALL_DIR}/.env.cloud.production"

cd "$INSTALL_DIR"

echo "=== Updating RR Portal ==="

echo "[1/3] Pulling latest code..."
git pull

echo "[2/3] Rebuilding and restarting services..."
docker compose -f docker-compose.cloud.yml --env-file "$ENV_FILE" up -d --build

echo "[3/3] Waiting for services (20s)..."
sleep 20

# Health check
if curl -sf http://localhost/nginx-health > /dev/null 2>&1; then
    echo "[OK] Update complete, all services healthy."
else
    echo "[WARN] nginx not responding. Check: docker compose -f docker-compose.cloud.yml logs"
fi
```

**Step 2: 设置可执行权限**

Run: `chmod +x deploy/update-server.sh`

**Step 3: Commit**

```bash
git add deploy/update-server.sh
git commit -m "feat: add cloud update script"
```

---

### Task 4: Push 并在服务器上执行部署

**前提:** 你已购买阿里云 ECS 服务器，拿到公网 IP。

**Step 1: Push 代码到 GitHub**

```bash
git push origin main
```

**Step 2: SSH 登录服务器**

```bash
ssh root@<公网IP>
```

**Step 3: 下载并运行部署脚本**

在服务器上执行：
```bash
apt-get update && apt-get install -y git curl
git clone https://github.com/charlesskl/RR-Portal.git /opt/rr-portal
cd /opt/rr-portal
bash deploy/setup-server.sh
```

**Step 4: 记录输出的管理员密码**

脚本会输出生成的密码，截图或复制保存。

**Step 5: 从工厂浏览器测试访问**

打开浏览器访问: `http://<公网IP>/`
Expected: 看到 RR Portal 门户页面，显示工程部和印尼小组两个部门。

**Step 6: 测试各插件**

- `http://<公网IP>/rr/` → 工程啤办单
- `http://<公网IP>/indonesia/` → 印尼出货明细

---

### Task 5: 配置防火墙（服务器上执行）

**Step 1: 启用 ufw**

```bash
ufw allow ssh
ufw allow 80/tcp
ufw --force enable
ufw status
```

Expected output:
```
Status: active
To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
```

**Step 2: 确认阿里云安全组规则**

在阿里云控制台 → ECS → 安全组，确保：
- 入方向: 允许 TCP 80（HTTP）
- 入方向: 允许 TCP 22（SSH）
- 其他端口全部拒绝

---

### Task 6: 验证部署完整性

**Step 1: 检查所有容器运行状态**

```bash
cd /opt/rr-portal
docker compose -f docker-compose.cloud.yml ps
```

Expected: 6 个容器全部 `Up` 或 `healthy`

**Step 2: 检查日志无报错**

```bash
docker compose -f docker-compose.cloud.yml logs --tail=20
```

Expected: 无 ERROR 级别日志

**Step 3: 测试数据持久化**

1. 在工程啤办单中创建一条测试数据
2. 重启服务: `docker compose -f docker-compose.cloud.yml restart rr-production`
3. 确认数据仍然存在

**Step 4: 确认外部访问**

从不同网络（如手机热点）访问 `http://<公网IP>/`
Expected: 正常加载门户页面

---

## 阿里云 ECS 购买指南（参考）

1. 访问 https://ecs.console.aliyun.com/
2. 点击「创建实例」
3. 选择配置：
   - **地域**: 华南 1（深圳）或华南 2（广州）
   - **实例类型**: ecs.c6.large（2 vCPU, 4GB）或 ecs.s6-c1m2.large
   - **镜像**: Ubuntu 22.04 64位
   - **系统盘**: 40GB SSD 云盘
   - **网络**: 默认 VPC，分配公网 IP，按流量计费
   - **安全组**: 新建，开放 22 和 80 端口
   - **登录方式**: 密钥对（推荐）或自定义密码
4. 确认下单，等待实例启动
5. 在实例列表获取公网 IP 地址
