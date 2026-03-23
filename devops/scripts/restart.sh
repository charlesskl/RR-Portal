#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Restart — Restart a single app or all services
# ============================================================
# Usage: restart.sh <app-name|all> [--rebuild]
#
#   restart.sh zouhuo           — restart container
#   restart.sh zouhuo --rebuild — rebuild image then restart
#   restart.sh all              — restart all services
#   restart.sh nginx            — reload nginx config
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

source "${SCRIPT_DIR}/utils/telegram.sh"
source "${SCRIPT_DIR}/utils/audit.sh"

APP_NAME="${1:?Usage: restart.sh <app-name|all> [--rebuild]}"
REBUILD="${2:-}"

if [[ -z "${DEPLOY_SERVER:-}" ]]; then
  echo "ERROR: DEPLOY_SERVER not set"
  exit 1
fi

DEPLOY_SERVER_HOST="${DEPLOY_SERVER#*@}"
COMPOSE_PATH="${DEPLOY_COMPOSE_PATH:-/opt/rr-portal/docker-compose.cloud.yml}"
COMPOSE_DIR="$(dirname "$COMPOSE_PATH")"
COMPOSE_FILE="$(basename "$COMPOSE_PATH")"

echo "=== RESTART: ${APP_NAME} ==="

if [[ "$APP_NAME" == "nginx" ]]; then
  echo "Reloading nginx configuration..."
  ssh "${DEPLOY_SERVER}" "docker exec \$(docker ps -q -f name=nginx) nginx -s reload" 2>/dev/null
  echo "  [OK] nginx reloaded"
  exit 0
fi

if [[ "$APP_NAME" == "all" ]]; then
  echo "Restarting all services..."
  ssh "${DEPLOY_SERVER}" "cd ${COMPOSE_DIR} && docker compose -f ${COMPOSE_FILE} restart" 2>/dev/null
  echo "  [OK] All services restarted"
  audit_restart "all" "Manual restart of all services"
  exit 0
fi

if [[ "$REBUILD" == "--rebuild" ]]; then
  echo "Rebuilding image on server..."
  ssh "${DEPLOY_SERVER}" "cd ${COMPOSE_DIR}/apps/${APP_NAME} && docker build -t rr-portal/${APP_NAME}:latest . 2>&1 | tail -3" 2>/dev/null
  echo "  [OK] Image rebuilt"
fi

echo "Restarting ${APP_NAME}..."
ssh "${DEPLOY_SERVER}" "cd ${COMPOSE_DIR} && docker compose -f ${COMPOSE_FILE} up -d ${APP_NAME}" 2>/dev/null
echo "  [OK] Container restarted"

# Health check
sleep 5
HOST_PORT=$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
print(d.get(sys.argv[2], {}).get('port', ''))
" "${REPO_ROOT}/devops/config/apps.json" "$APP_NAME" 2>/dev/null || echo "")

if [[ -n "$HOST_PORT" ]]; then
  if curl -sf --max-time 5 "http://${DEPLOY_SERVER_HOST}:${HOST_PORT}/health" > /dev/null 2>&1; then
    echo "  [OK] Health check passed"
  else
    echo "  [WARN] Health check failed — container may still be starting"
  fi
fi

audit_restart "${APP_NAME}" "Manual restart${REBUILD:+ (rebuilt)}"
echo "=== RESTART COMPLETE ==="
