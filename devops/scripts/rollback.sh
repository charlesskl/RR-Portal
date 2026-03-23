#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Rollback Script — Quick rollback to previous version
# ============================================================
# Restores the :previous Docker image tag as :latest and
# redeploys the container. Used for emergency rollbacks.
#
# Usage: rollback.sh <app-name>
#
# Required environment variables:
#   DEPLOY_SERVER  — SSH target
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

source "${SCRIPT_DIR}/utils/telegram.sh"
source "${SCRIPT_DIR}/utils/registry.sh"
source "${SCRIPT_DIR}/utils/audit.sh"

APP_NAME="${1:?Usage: rollback.sh <app-name>}"

if [[ -z "${DEPLOY_SERVER:-}" ]]; then
  echo "ERROR: DEPLOY_SERVER not set"
  exit 1
fi

DEPLOY_SERVER_HOST="${DEPLOY_SERVER#*@}"
DEPLOY_COMPOSE_PATH="${DEPLOY_COMPOSE_PATH:-/opt/rr-portal/docker-compose.cloud.yml}"
COMPOSE_DIR="$(dirname "${DEPLOY_COMPOSE_PATH}")"

# Read port from apps.json
HOST_PORT=$(registry_get_port "${APP_NAME}" 2>/dev/null || echo "")

if [[ -z "$HOST_PORT" ]]; then
  echo "ERROR: App '${APP_NAME}' not found in apps.json"
  exit 1
fi

echo "=== ROLLBACK: ${APP_NAME} ==="
echo "Server: ${DEPLOY_SERVER}"
echo "Port: ${HOST_PORT}"

# Check if :previous image exists on server
HAS_PREVIOUS=$(ssh "${DEPLOY_SERVER}" "docker images rr-portal/${APP_NAME}:previous -q 2>/dev/null" || true)

if [[ -z "$HAS_PREVIOUS" ]]; then
  echo "ERROR: No :previous image found for ${APP_NAME}. Cannot rollback."
  send_telegram "Rollback FAILED for ${APP_NAME} — no previous image available."
  exit 1
fi

echo "Previous image found. Rolling back..."

# Restore :previous as :latest
ssh "${DEPLOY_SERVER}" "docker tag rr-portal/${APP_NAME}:previous rr-portal/${APP_NAME}:latest"
echo "  [OK] Retagged :previous as :latest"

# Redeploy
ssh "${DEPLOY_SERVER}" "cd ${COMPOSE_DIR} && docker compose -f $(basename "${DEPLOY_COMPOSE_PATH}") up -d ${APP_NAME}" 2>/dev/null || true
echo "  [OK] Container restarted"

# Health check
echo "  Waiting for health check..."
for attempt in $(seq 1 10); do
  sleep 3
  if curl -sf --max-time 5 "http://${DEPLOY_SERVER_HOST}:${HOST_PORT}/health" > /dev/null 2>&1; then
    echo "  [OK] Health check passed (attempt ${attempt}/10)"
    send_telegram "${APP_NAME} rolled back successfully. Previous version is now live on port ${HOST_PORT}."
    audit_rollback "${APP_NAME}" "Manual rollback to previous version"
    echo ""
    echo "=== ROLLBACK COMPLETE ==="
    exit 0
  fi
done

echo "  [FAIL] Health check failed after rollback"
send_telegram "Rollback of ${APP_NAME} health check FAILED. Manual intervention needed."
audit_rollback "${APP_NAME}" "Rollback attempted but health check failed"
exit 1
