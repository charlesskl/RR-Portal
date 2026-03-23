#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Cleanup Script — Docker and system maintenance
# ============================================================
# Removes dangling images, old containers, unused volumes,
# and rotates old deploy logs. Run periodically via cron/launchd.
#
# Usage: cleanup.sh  (no arguments)
#
# Required environment variables:
#   DEPLOY_SERVER  — SSH target
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${SCRIPT_DIR}/utils/telegram.sh"

mkdir -p "${REPO_ROOT}/devops/logs"
LOG_FILE="${REPO_ROOT}/devops/logs/cleanup.log"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"; }

if [[ -z "${DEPLOY_SERVER:-}" ]]; then
  log "ERROR: DEPLOY_SERVER not set"
  exit 0
fi

DEPLOY_SERVER_HOST="${DEPLOY_SERVER#*@}"

log "=== CLEANUP: Starting maintenance ==="

# --- 1. Remove dangling Docker images on server ---
log "Cleaning dangling Docker images..."
DANGLING_COUNT=$(ssh "${DEPLOY_SERVER}" "docker images -f dangling=true -q | wc -l" 2>/dev/null || echo "0")
DANGLING_COUNT=$(echo "$DANGLING_COUNT" | tr -d '[:space:]')

if [[ "$DANGLING_COUNT" -gt 0 ]]; then
  ssh "${DEPLOY_SERVER}" "docker image prune -f" 2>/dev/null || true
  log "Removed ${DANGLING_COUNT} dangling image(s)"
else
  log "No dangling images"
fi

# --- 2. Remove stopped containers ---
log "Cleaning stopped containers..."
STOPPED_COUNT=$(ssh "${DEPLOY_SERVER}" "docker ps -aq -f status=exited | wc -l" 2>/dev/null || echo "0")
STOPPED_COUNT=$(echo "$STOPPED_COUNT" | tr -d '[:space:]')

if [[ "$STOPPED_COUNT" -gt 0 ]]; then
  ssh "${DEPLOY_SERVER}" "docker container prune -f" 2>/dev/null || true
  log "Removed ${STOPPED_COUNT} stopped container(s)"
else
  log "No stopped containers"
fi

# --- 3. Remove unused Docker volumes ---
log "Cleaning unused volumes..."
ssh "${DEPLOY_SERVER}" "docker volume prune -f" 2>/dev/null || true
log "Volume cleanup done"

# --- 4. Check disk usage ---
DISK_USAGE=$(ssh "${DEPLOY_SERVER}" "df -h / | tail -1 | awk '{print \$5}' | tr -d '%'" 2>/dev/null || echo "0")

if [[ "$DISK_USAGE" -gt 80 ]]; then
  log "WARNING: Disk usage at ${DISK_USAGE}%"
  send_telegram "⚠️ Server disk usage at ${DISK_USAGE}%. Consider cleaning up old data or images."
elif [[ "$DISK_USAGE" -gt 60 ]]; then
  log "Disk usage at ${DISK_USAGE}% — within normal range but growing"
else
  log "Disk usage at ${DISK_USAGE}% — healthy"
fi

# --- 5. Check memory usage ---
MEM_AVAILABLE=$(ssh "${DEPLOY_SERVER}" "free -m | awk '/Mem:/ {print \$7}'" 2>/dev/null || echo "0")

if [[ "$MEM_AVAILABLE" -lt 256 ]]; then
  log "WARNING: Available memory low (${MEM_AVAILABLE}MB)"
  send_telegram "⚠️ Server available memory is ${MEM_AVAILABLE}MB. Containers may be under pressure."
else
  log "Available memory: ${MEM_AVAILABLE}MB — healthy"
fi

# --- 6. Rotate local deploy logs (keep last 30 days) ---
log "Rotating deploy logs..."
find "${REPO_ROOT}/devops/logs" -name "deploy-*.log" -mtime +30 -delete 2>/dev/null || true
find "${REPO_ROOT}/devops/logs" -name "verify-*.log" -mtime +30 -delete 2>/dev/null || true
log "Old logs cleaned"

# --- 7. Report Docker image sizes ---
log "Docker image sizes:"
ssh "${DEPLOY_SERVER}" "docker images --format '  {{.Repository}}:{{.Tag}}\t{{.Size}}' | grep rr-portal" 2>/dev/null || true

# --- 8. Prune old app images (keep :latest and :previous per app) ---
# For each app registered in apps.json, we keep only the :latest and :previous
# tagged images. All other tags (old git-hash deploys, etc.) are removed.
# Safety: we skip any image currently used by a running container.
log "Pruning old app images..."

APPS_JSON="${REPO_ROOT}/devops/config/apps.json"
if [[ -f "$APPS_JSON" ]]; then
  # Get list of image IDs currently used by running containers (safe list)
  RUNNING_IMAGES=$(ssh "${DEPLOY_SERVER}" "docker ps --format '{{.Image}}'" 2>/dev/null || echo "")

  # Extract app names from apps.json (top-level keys)
  APP_NAMES=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('\n'.join(d.keys()))" "$APPS_JSON" 2>/dev/null || true)

  for APP in $APP_NAMES; do
    REPO_NAME="rr-portal/${APP}"
    log "  Checking images for ${REPO_NAME}..."

    # List all tags for this repo on the server, excluding :latest and :previous
    OLD_IMAGES=$(ssh "${DEPLOY_SERVER}" \
      "docker images '${REPO_NAME}' --format '{{.Repository}}:{{.Tag}}' \
       | grep -v ':latest\$' \
       | grep -v ':previous\$' \
       | grep -v '<none>'" 2>/dev/null || echo "")

    if [[ -z "$OLD_IMAGES" ]]; then
      log "    No old images to remove"
      continue
    fi

    REMOVED=0
    while IFS= read -r IMG; do
      [[ -z "$IMG" ]] && continue
      # Skip if this image is currently in use by a running container
      if echo "$RUNNING_IMAGES" | grep -qF "$IMG"; then
        log "    Skipping ${IMG} (in use by running container)"
        continue
      fi
      ssh "${DEPLOY_SERVER}" "docker rmi \"${IMG}\"" 2>/dev/null || true
      REMOVED=$((REMOVED + 1))
    done <<< "$OLD_IMAGES"

    log "    Removed ${REMOVED} old image(s) for ${APP}"
  done

  # Also clean up any rr-portal/* images for apps no longer in apps.json
  ALL_RR_REPOS=$(ssh "${DEPLOY_SERVER}" \
    "docker images --format '{{.Repository}}' | grep '^rr-portal/' | sort -u" 2>/dev/null || echo "")

  for REPO_NAME in $ALL_RR_REPOS; do
    APP="${REPO_NAME#rr-portal/}"
    if ! echo "$APP_NAMES" | grep -qx "$APP"; then
      log "  Removing images for deregistered app: ${APP}"
      ssh "${DEPLOY_SERVER}" \
        "docker images '${REPO_NAME}' --format '{{.Repository}}:{{.Tag}}' | while read img; do
           docker rmi \"\$img\" 2>/dev/null || true
         done" 2>/dev/null || true
    fi
  done
else
  log "  apps.json not found — skipping per-app image pruning"
fi

log "App image pruning done"

log "=== CLEANUP: Complete ==="
exit 0
