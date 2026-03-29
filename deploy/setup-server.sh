#!/usr/bin/env bash
set -euo pipefail

# ─── RR Portal Batch A - Cloud Deployment Script ───
# Run this on a fresh Ubuntu 22.04 server as root
# Usage: bash setup-server.sh

echo "=== RR Portal Batch A - Cloud Deployment ==="

# ─── 1. System update ───
echo "[1/8] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ─── 2. Install Docker ───
echo "[2/8] Installing Docker..."
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

# ─── 3. Configure Docker mirror (China) ───
echo "[3/8] Configuring Docker mirror for China..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DAEMON'
{
    "registry-mirrors": [
        "https://mirror.ccs.tencentyun.com",
        "https://docker.m.daocloud.io"
    ]
}
DAEMON
systemctl daemon-reload
systemctl restart docker

# ─── 4. Install git ───
echo "[4/8] Installing git..."
apt-get install -y -qq git

# ─── 5. Clone repository ───
INSTALL_DIR="/opt/rr-portal"
REPO_URL="https://github.com/charlesskl/RR-Portal.git"

echo "[5/8] Cloning repository to ${INSTALL_DIR}..."
if [ -d "$INSTALL_DIR" ]; then
    echo "Directory exists, pulling latest..."
    cd "$INSTALL_DIR"
    git pull
else
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# ─── 6. Configure environment ───
echo "[6/8] Configuring environment..."
ENV_FILE="${INSTALL_DIR}/.env.cloud.production"

if [ ! -f "$ENV_FILE" ]; then
    cp .env.cloud "$ENV_FILE"

    # Generate random passwords
    DB_PASS=$(openssl rand -base64 24 | tr -d '/+=')
    REDIS_PASS=$(openssl rand -base64 24 | tr -d '/+=')
    JWT_SEC=$(openssl rand -base64 48 | tr -d '/+=')
    ADMIN_PASS=$(openssl rand -base64 16 | tr -d '/+=')
    FIGURE_MOLD_SEC=$(openssl rand -base64 48 | tr -d '/+=')
    ZOUHUO_SEC=$(openssl rand -base64 48 | tr -d '/+=')
    JIANGPING_SEC=$(openssl rand -base64 48 | tr -d '/+=')

    # Detect server public IP for default CORS/origins
    SERVER_IP=$(curl -sf https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

    # Fill in required fields
    sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=${DB_PASS}/" "$ENV_FILE"
    sed -i "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=${REDIS_PASS}/" "$ENV_FILE"
    sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${JWT_SEC}/" "$ENV_FILE"
    sed -i "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${ADMIN_PASS}/" "$ENV_FILE"
    sed -i "s/^ALLOWED_ORIGINS=.*/ALLOWED_ORIGINS=http:\/\/${SERVER_IP}/" "$ENV_FILE"
    sed -i "s/^FIGURE_MOLD_JWT_SECRET=.*/FIGURE_MOLD_JWT_SECRET=${FIGURE_MOLD_SEC}/" "$ENV_FILE"
    sed -i "s/^ZOUHUO_JWT_SECRET=.*/ZOUHUO_JWT_SECRET=${ZOUHUO_SEC}/" "$ENV_FILE"
    sed -i "s/^JIANGPING_SECRET_KEY=.*/JIANGPING_SECRET_KEY=${JIANGPING_SEC}/" "$ENV_FILE"
    sed -i "s/^ZOUHUO_CORS_ORIGIN=.*/ZOUHUO_CORS_ORIGIN=http:\/\/${SERVER_IP}/" "$ENV_FILE"

    echo ""
    echo "╔══════════════════════════════════════════════╗"
    echo "║  IMPORTANT: Save these credentials!          ║"
    echo "╚══════════════════════════════════════════════╝"
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

# ─── 7. Ensure data directories exist ───
echo "[7/8] Creating data directories..."
mkdir -p data/postgres
mkdir -p "plugins/工程啤办单/data"
mkdir -p plugins/new-product-schedule/data
mkdir -p plugins/new-product-schedule/uploads
mkdir -p plugins/figure-mold-cost-system/data
mkdir -p plugins/figure-mold-cost-system/public/uploads

# ─── 8. Start services ───
echo "[8/8] Building and starting services..."
docker compose -f docker-compose.cloud.yml --env-file "$ENV_FILE" up -d --build

echo ""
echo "=== Deployment complete! ==="
echo ""

# Wait for services to be healthy
echo "Waiting for services to start (60s)..."
sleep 60

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
    echo "╔══════════════════════════════════════════════╗"
    echo "║  RR Portal is live!                          ║"
    echo "╚══════════════════════════════════════════════╝"
    echo ""
    echo "Access: http://$(curl -sf https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')/"
    echo ""
else
    echo "Some services failed. Check logs with:"
    echo "  cd /opt/rr-portal"
    echo "  docker compose -f docker-compose.cloud.yml logs"
fi
