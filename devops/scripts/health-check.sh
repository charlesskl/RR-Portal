#!/usr/bin/env bash
set -euo pipefail
# ============================================================
# Health Check — Periodic monitoring for all active RR-Portal apps
# ============================================================
# Curls /health on every active app from apps.json. On failure,
# auto-restarts the container via SSH and sends Telegram alerts.
# Tracks app state across runs to detect recovery events.
#
# Usage: health-check.sh  (no arguments, called by cron)
#
# Required environment variables:
#   DEPLOY_SERVER        — SSH target (e.g., charles@192.168.1.50)
#   DEPLOY_COMPOSE_PATH  — Path to docker-compose.yml on server (default: /opt/rr-portal/docker-compose.yml)
# ============================================================

# --- Resolve paths ---
REPO_ROOT="$(git rev-parse --show-toplevel)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Source utilities ---
source "${SCRIPT_DIR}/utils/telegram.sh"

# --- Logging setup ---
mkdir -p "${REPO_ROOT}/devops/logs"
LOG_FILE="${REPO_ROOT}/devops/logs/health-check.log"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"; }

# --- Validate environment ---
if [ -z "${DEPLOY_SERVER:-}" ]; then
  log "ERROR: DEPLOY_SERVER environment variable is required (e.g., charles@192.168.1.50)"
  exit 0  # Exit cleanly — do not crash cron scheduler
fi

DEPLOY_SERVER_HOST="${DEPLOY_SERVER#*@}"

# Default compose path if not set
DEPLOY_COMPOSE_PATH="${DEPLOY_COMPOSE_PATH:-/opt/rr-portal/docker-compose.yml}"
DEPLOY_COMPOSE_DIR="$(dirname "${DEPLOY_COMPOSE_PATH}")"

# --- Adaptive interval: intensive (every 60s) within 30min of last deploy, normal (every 5min) otherwise ---
DEPLOYMENTS_JSONL="${REPO_ROOT}/devops/logs/deployments.jsonl"
INTENSIVE_WINDOW_SECONDS=1800  # 30 minutes

_should_run() {
  local now_epoch
  now_epoch=$(date +%s)

  # Try to read the last deployment entry
  if [[ -f "${DEPLOYMENTS_JSONL}" ]]; then
    local last_line
    last_line=$(tail -1 "${DEPLOYMENTS_JSONL}" 2>/dev/null || true)
    if [[ -n "${last_line}" ]]; then
      local last_ts
      last_ts=$(python3 -c "
import json, sys, datetime
try:
    entry = json.loads(sys.argv[1])
    # Skip dry-run deployments
    if entry.get('dry_run', False):
        print('0')
        sys.exit(0)
    ts = entry.get('ts', '')
    dt = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
    print(int(dt.timestamp()))
except Exception:
    print('0')
" "$last_line" 2>/dev/null || echo "0")

      local elapsed=$(( now_epoch - last_ts ))
      if [[ "${elapsed}" -lt "${INTENSIVE_WINDOW_SECONDS}" ]]; then
        # Within 30min of last deploy: always run (intensive mode)
        return 0
      fi
    fi
  fi

  # Normal mode: only run if current minute is divisible by 5
  local current_minute
  current_minute=$(date +%M | sed 's/^0//')
  current_minute=${current_minute:-0}
  if (( current_minute % 5 == 0 )); then
    return 0
  fi

  return 1
}

if ! _should_run; then
  exit 0  # Not our turn — skip this cycle
fi

# --- State tracking ---
STATE_FILE="${REPO_ROOT}/devops/logs/health-state.json"
if [ ! -f "${STATE_FILE}" ]; then
  echo "{}" > "${STATE_FILE}"
fi

# Load current state
HEALTH_STATE=$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    print(json.dumps(json.load(f)))
" "$STATE_FILE")

# Helper: get previous state for an app ("up", "down", or "unknown")
get_prev_state() {
  local app="$1"
  python3 -c "
import json, sys
state = json.loads(sys.argv[1])
print(state.get(sys.argv[2], 'unknown'))
" "$HEALTH_STATE" "$app"
}

# Helper: set state for an app
set_state() {
  local app="$1"
  local new_state="$2"
  HEALTH_STATE=$(python3 -c "
import json, sys
state = json.loads(sys.argv[1])
state[sys.argv[2]] = sys.argv[3]
print(json.dumps(state))
" "$HEALTH_STATE" "$app" "$new_state")
}

# --- Read apps from registry ---
APPS_FILE="${REPO_ROOT}/devops/config/apps.json"
if [ ! -f "${APPS_FILE}" ]; then
  log "ERROR: apps.json not found at ${APPS_FILE}"
  exit 0
fi

APPS=$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for name, info in d.items():
    if info.get('status') == 'active':
        print(f\"{name}:{info['port']}\")
" "$APPS_FILE")

if [ -z "${APPS}" ]; then
  log "No active apps found in apps.json"
  exit 0
fi

# --- Health-check loop ---
log "=== HEALTH-CHECK: Starting health checks ==="

for entry in ${APPS}; do
  app_name="${entry%%:*}"
  port="${entry##*:}"

  log "Checking ${app_name} on port ${port}..."

  prev_state=$(get_prev_state "${app_name}")

  # Check health (MON-01)
  if curl -sf --max-time 5 "http://${DEPLOY_SERVER_HOST}:${port}/health" > /dev/null 2>&1; then
    log "${app_name}: OK"

    # Recovery detection: was down, now up (without restart this cycle)
    if [ "${prev_state}" = "down" ]; then
      log "${app_name}: Recovered — was previously down, now healthy"
      send_telegram "${app_name} has recovered and is back online on port ${port}."
    fi

    set_state "${app_name}" "up"
  else
    log "${app_name}: FAIL — health check failed"

    # Auto-restart (MON-02)
    log "${app_name}: Attempting auto-restart via SSH..."
    if ssh "${DEPLOY_SERVER}" "cd ${DEPLOY_COMPOSE_DIR} && docker compose restart ${app_name}" 2>&1; then
      log "${app_name}: Restart command sent. Waiting 15 seconds..."
      sleep 15

      # Re-check health after restart
      if curl -sf --max-time 5 "http://${DEPLOY_SERVER_HOST}:${port}/health" > /dev/null 2>&1; then
        log "${app_name}: Auto-restart succeeded — app is back online"
        send_telegram "${app_name} was down. Auto-restarted successfully. It is back online on port ${port}."
        set_state "${app_name}" "up"
      else
        log "${app_name}: Auto-restart FAILED — app still not responding"
        send_telegram "${app_name} is DOWN and auto-restart failed. Manual intervention needed. Port ${port}."
        set_state "${app_name}" "down"
      fi
    else
      log "${app_name}: SSH restart command failed"
      send_telegram "${app_name} is DOWN and auto-restart failed. Manual intervention needed. Port ${port}."
      set_state "${app_name}" "down"
    fi
  fi
done

# --- Save updated state ---
python3 -c "
import json, sys
state = json.loads(sys.argv[1])
with open(sys.argv[2], 'w') as f:
    json.dump(state, f, indent=2)
    f.write('\n')
" "$HEALTH_STATE" "$STATE_FILE"

log "=== HEALTH-CHECK: Complete ==="
exit 0
