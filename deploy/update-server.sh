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
git fetch origin
git reset --hard origin/main

# Ensure data directories exist for new plugins
mkdir -p plugins/new-product-schedule/data plugins/new-product-schedule/uploads
mkdir -p plugins/figure-mold-cost-system/data plugins/figure-mold-cost-system/public/uploads
mkdir -p apps/zouhuo/data apps/zouhuo/uploads
mkdir -p apps/jiangping/data apps/jiangping/uploads
mkdir -p apps/paiji/data apps/paiji/uploads

echo "[2/3] Rebuilding and restarting services..."
docker compose -f docker-compose.cloud.yml --env-file "$ENV_FILE" up -d --build

echo "[3/3] Restarting nginx and waiting for services (20s)..."
docker compose -f docker-compose.cloud.yml restart nginx
sleep 20

# Health check
if curl -sf http://localhost/nginx-health > /dev/null 2>&1; then
    echo "[OK] Update complete, all services healthy."
else
    echo "[WARN] nginx not responding. Check: docker compose -f docker-compose.cloud.yml logs"
fi
