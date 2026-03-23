#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Exec — Open shell or run command in a container
# ============================================================
# Usage: exec.sh <app-name> [command...]
#
#   exec.sh zouhuo                — open /bin/sh shell
#   exec.sh zouhuo ls /app       — run command
#   exec.sh db psql -U postgres  — connect to PostgreSQL
# ============================================================

APP_NAME="${1:?Usage: exec.sh <app-name> [command...]}"
shift

if [[ -z "${DEPLOY_SERVER:-}" ]]; then
  echo "ERROR: DEPLOY_SERVER not set"
  exit 1
fi

COMPOSE_PATH="${DEPLOY_COMPOSE_PATH:-/opt/rr-portal/docker-compose.cloud.yml}"
COMPOSE_DIR="$(dirname "$COMPOSE_PATH")"
COMPOSE_FILE="$(basename "$COMPOSE_PATH")"

# Find the container name
CONTAINER=$(ssh "${DEPLOY_SERVER}" "docker ps --format '{{.Names}}' | grep '${APP_NAME}' | head -1" 2>/dev/null || true)

if [[ -z "$CONTAINER" ]]; then
  echo "ERROR: No running container found matching '${APP_NAME}'"
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "Opening shell in ${CONTAINER}..."
  ssh -t "${DEPLOY_SERVER}" "docker exec -it ${CONTAINER} /bin/sh"
else
  ssh "${DEPLOY_SERVER}" "docker exec ${CONTAINER} $*"
fi
