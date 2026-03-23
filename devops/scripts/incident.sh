#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Incident Response — Automated diagnostics and recovery
# ============================================================
# When an app is down, this script runs a full diagnostic
# and attempts automated recovery steps.
#
# Usage: incident.sh <app-name>
#
# Steps:
# 1. Check container status
# 2. Collect container logs
# 3. Check disk/memory/CPU
# 4. Attempt restart
# 5. If restart fails, attempt rollback
# 6. Report findings via Telegram
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

source "${SCRIPT_DIR}/utils/telegram.sh"
source "${SCRIPT_DIR}/utils/audit.sh"

APP_NAME="${1:?Usage: incident.sh <app-name>}"

if [[ -z "${DEPLOY_SERVER:-}" ]]; then
  echo "ERROR: DEPLOY_SERVER not set"
  exit 1
fi

DEPLOY_SERVER_HOST="${DEPLOY_SERVER#*@}"
COMPOSE_PATH="${DEPLOY_COMPOSE_PATH:-/opt/rr-portal/docker-compose.cloud.yml}"
COMPOSE_DIR="$(dirname "$COMPOSE_PATH")"
COMPOSE_FILE="$(basename "$COMPOSE_PATH")"

# Read port
HOST_PORT=$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
print(d.get(sys.argv[2], {}).get('port', ''))
" "${REPO_ROOT}/devops/config/apps.json" "$APP_NAME" 2>/dev/null || echo "")

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_FILE="${REPO_ROOT}/devops/logs/incident-${APP_NAME}-${TIMESTAMP}.log"
mkdir -p "${REPO_ROOT}/devops/logs"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$REPORT_FILE"; }

log "============================================"
log "  INCIDENT RESPONSE: ${APP_NAME}"
log "============================================"
log ""

# --- Step 1: Container status ---
log "--- Step 1: Container Status ---"
CONTAINER_STATUS=$(ssh "${DEPLOY_SERVER}" "docker ps -a --format '{{.Names}}\t{{.Status}}' | grep ${APP_NAME}" 2>/dev/null || echo "NOT FOUND")
log "  $CONTAINER_STATUS"

# --- Step 2: Recent logs ---
log ""
log "--- Step 2: Recent Container Logs ---"
RECENT_LOGS=$(ssh "${DEPLOY_SERVER}" "cd ${COMPOSE_DIR} && docker compose -f ${COMPOSE_FILE} logs --tail=30 ${APP_NAME}" 2>/dev/null || echo "Could not fetch logs")
echo "$RECENT_LOGS" | tail -15 | sed 's/^/  /' | tee -a "$REPORT_FILE"

# --- Step 3: Server resources ---
log ""
log "--- Step 3: Server Resources ---"
ssh "${DEPLOY_SERVER}" "
  echo \"  Disk: \$(df -h / | awk 'NR==2 {print \$5 \" used, \" \$4 \" available\"}')\"
  echo \"  Memory: \$(free -h | awk '/Mem:/ {print \$3 \" used, \" \$7 \" available\"}')\"
  echo \"  Load: \$(cat /proc/loadavg | awk '{print \$1, \$2, \$3}')\"
" 2>/dev/null | tee -a "$REPORT_FILE"

# Check if disk is full
DISK_PCT=$(ssh "${DEPLOY_SERVER}" "df / | awk 'NR==2 {print \$5}' | tr -d '%'" 2>/dev/null || echo "0")
if [[ "$DISK_PCT" -gt 90 ]]; then
  log ""
  log "  *** DISK USAGE CRITICAL: ${DISK_PCT}% ***"
  log "  Running emergency cleanup..."
  ssh "${DEPLOY_SERVER}" "docker system prune -f" 2>/dev/null || true
  log "  Docker cleanup done"
fi

# --- Step 4: Attempt restart ---
log ""
log "--- Step 4: Attempting Restart ---"
ssh "${DEPLOY_SERVER}" "cd ${COMPOSE_DIR} && docker compose -f ${COMPOSE_FILE} up -d ${APP_NAME}" 2>/dev/null || true
log "  Restart command sent. Waiting 15 seconds..."
sleep 15

if [[ -n "$HOST_PORT" ]]; then
  if curl -sf --max-time 5 "http://${DEPLOY_SERVER_HOST}:${HOST_PORT}/health" > /dev/null 2>&1; then
    log "  RECOVERED: Health check passed after restart"
    audit_log "incident-resolved" "$APP_NAME" "Auto-restart resolved the incident"
    send_telegram "INCIDENT RESOLVED: ${APP_NAME} recovered after restart. Report: ${REPORT_FILE}"
    log ""
    log "=== INCIDENT RESOLVED ==="
    exit 0
  fi
  log "  Restart did not resolve — health check still failing"
fi

# --- Step 5: Attempt rollback ---
log ""
log "--- Step 5: Attempting Rollback ---"
HAS_PREVIOUS=$(ssh "${DEPLOY_SERVER}" "docker images rr-portal/${APP_NAME}:previous -q 2>/dev/null" || true)

if [[ -n "$HAS_PREVIOUS" ]]; then
  log "  Previous image found. Rolling back..."
  ssh "${DEPLOY_SERVER}" "docker tag rr-portal/${APP_NAME}:previous rr-portal/${APP_NAME}:latest" 2>/dev/null
  ssh "${DEPLOY_SERVER}" "cd ${COMPOSE_DIR} && docker compose -f ${COMPOSE_FILE} up -d ${APP_NAME}" 2>/dev/null || true
  sleep 15

  if [[ -n "$HOST_PORT" ]] && curl -sf --max-time 5 "http://${DEPLOY_SERVER_HOST}:${HOST_PORT}/health" > /dev/null 2>&1; then
    log "  RECOVERED: Rollback successful — previous version is live"
    audit_rollback "$APP_NAME" "Incident auto-rollback"
    send_telegram "INCIDENT RESOLVED: ${APP_NAME} recovered via rollback to previous version. Report: ${REPORT_FILE}"
    log ""
    log "=== INCIDENT RESOLVED (via rollback) ==="
    exit 0
  fi
  log "  Rollback also failed"
else
  log "  No previous image available for rollback"
fi

# --- Step 6: Escalate ---
log ""
log "--- Step 6: ESCALATION ---"
log "  All automated recovery failed."
log "  Manual intervention required."
log ""

SUMMARY="INCIDENT UNRESOLVED: ${APP_NAME}
Container: ${CONTAINER_STATUS}
Disk: ${DISK_PCT}% used
Restart: FAILED
Rollback: FAILED
Report: ${REPORT_FILE}
Manual intervention needed."

send_telegram "$SUMMARY"
audit_log "incident-escalated" "$APP_NAME" "Auto-recovery failed, escalated"

log "=== INCIDENT ESCALATED ==="
exit 1
