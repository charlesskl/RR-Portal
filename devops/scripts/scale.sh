#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Scale — Adjust container replicas
# ============================================================
# Usage: scale.sh <app-name> <replicas>
#
#   scale.sh zouhuo 3   — run 3 instances of zouhuo
#   scale.sh zouhuo 1   — scale back to 1
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

source "${SCRIPT_DIR}/utils/telegram.sh"
source "${SCRIPT_DIR}/utils/audit.sh"

APP_NAME="${1:?Usage: scale.sh <app-name> <replicas>}"
REPLICAS="${2:?Usage: scale.sh <app-name> <replicas>}"

if [[ -z "${DEPLOY_SERVER:-}" ]]; then
  echo "ERROR: DEPLOY_SERVER not set"
  exit 1
fi

COMPOSE_PATH="${DEPLOY_COMPOSE_PATH:-/opt/rr-portal/docker-compose.cloud.yml}"
COMPOSE_DIR="$(dirname "$COMPOSE_PATH")"
COMPOSE_FILE="$(basename "$COMPOSE_PATH")"

echo "=== SCALE: ${APP_NAME} to ${REPLICAS} replica(s) ==="

ssh "${DEPLOY_SERVER}" "cd ${COMPOSE_DIR} && docker compose -f ${COMPOSE_FILE} up -d --scale ${APP_NAME}=${REPLICAS} ${APP_NAME}" 2>/dev/null

echo "  [OK] Scaled to ${REPLICAS} replica(s)"

# Show running instances
ssh "${DEPLOY_SERVER}" "docker ps --format '  {{.Names}}\t{{.Status}}' | grep ${APP_NAME}" 2>/dev/null || true

audit_log "scale" "${APP_NAME}" "Scaled to ${REPLICAS} replicas"
send_telegram "${APP_NAME} scaled to ${REPLICAS} replica(s)"

echo "=== SCALE COMPLETE ==="
