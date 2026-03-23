#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Logs — Stream or view container logs
# ============================================================
# Usage: logs.sh <app-name> [--tail N] [--follow]
#
#   logs.sh zouhuo              — last 50 lines
#   logs.sh zouhuo --tail 200   — last 200 lines
#   logs.sh zouhuo --follow     — live stream
#   logs.sh all                 — last 20 lines from all apps
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

if [[ -z "${DEPLOY_SERVER:-}" ]]; then
  echo "ERROR: DEPLOY_SERVER not set"
  exit 1
fi

APP_NAME="${1:?Usage: logs.sh <app-name> [--tail N] [--follow]}"
shift

TAIL_LINES=50
FOLLOW=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tail) TAIL_LINES="$2"; shift 2 ;;
    --follow|-f) FOLLOW=true; shift ;;
    *) shift ;;
  esac
done

COMPOSE_PATH="${DEPLOY_COMPOSE_PATH:-/opt/rr-portal/docker-compose.cloud.yml}"
COMPOSE_DIR="$(dirname "$COMPOSE_PATH")"
COMPOSE_FILE="$(basename "$COMPOSE_PATH")"

if [[ "$APP_NAME" == "all" ]]; then
  echo "=== Logs from all containers ==="
  ssh "${DEPLOY_SERVER}" "cd ${COMPOSE_DIR} && docker compose -f ${COMPOSE_FILE} logs --tail=${TAIL_LINES}" 2>/dev/null
elif [[ "$APP_NAME" == "nginx" ]]; then
  echo "=== Nginx access log ==="
  ssh "${DEPLOY_SERVER}" "docker exec \$(docker ps -q -f name=nginx) tail -${TAIL_LINES} /var/log/nginx/access.log" 2>/dev/null
else
  if [[ "$FOLLOW" == "true" ]]; then
    echo "=== Following logs for ${APP_NAME} (Ctrl+C to stop) ==="
    ssh "${DEPLOY_SERVER}" "cd ${COMPOSE_DIR} && docker compose -f ${COMPOSE_FILE} logs -f ${APP_NAME}" 2>/dev/null
  else
    echo "=== Last ${TAIL_LINES} lines from ${APP_NAME} ==="
    ssh "${DEPLOY_SERVER}" "cd ${COMPOSE_DIR} && docker compose -f ${COMPOSE_FILE} logs --tail=${TAIL_LINES} ${APP_NAME}" 2>/dev/null
  fi
fi
